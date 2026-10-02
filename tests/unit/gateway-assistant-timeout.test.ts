import { createServer } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assistantProxyFactory } from "../../apps/api-gateway/src/assistant-proxy.js";
import {
  CircuitBreakerRegistry,
  gatewayCircuitBreakerMiddleware,
  installGatewayFetchInterceptor,
} from "../../apps/api-gateway/src/circuit-breaker.js";
import type { AppConfig } from "../../packages/config/src/index.js";
import { errorMiddleware } from "../../packages/http/src/index.js";

vi.mock("../../packages/security/src/index.js", async (original) => ({
  ...(await original<object>()),
  loadPublicKey: vi.fn(async () => ({})),
  loadPrivateKey: vi.fn(async () => ({})),
  verifyAccessToken: vi.fn(async () => ({ userId: "student", roles: ["STUDENT"] })),
  signActorContext: vi.fn(async () => "trusted-context"),
}));
vi.mock("../../packages/http/src/index.js", async (original) => ({
  ...(await original<object>()),
  currentRequestContext: () => ({ correlationId: "timeout-test" }),
}));

const nativeFetch = globalThis.fetch;
const servers: ReturnType<typeof createServer>[] = [];
let restoreFetch: (() => void) | undefined;
let registry: CircuitBreakerRegistry | undefined;

afterEach(async () => {
  restoreFetch?.();
  registry?.disposeAll();
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function listen(app: express.Express) {
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind");
  return `http://127.0.0.1:${String(address.port)}`;
}

async function fixture() {
  const ai = express();
  ai.use(express.json());
  ai.all("/api/v1/assistant/{*operation}", async (_req, res) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (!res.destroyed) res.json({ data: { content: "Verified response" } });
  });
  const config = {
    AI_SERVICE_URL: await listen(ai),
    INTERNAL_HTTP_TIMEOUT_MS: 40,
    AI_PROVIDER_TIMEOUT_MS: 40,
    JWT_PUBLIC_KEY_PATH: "test-public",
    ACTOR_CONTEXT_PRIVATE_KEY_PATH: "test-private",
    ACTOR_CONTEXT_TTL_SECONDS: 30,
  } as AppConfig;
  registry = new CircuitBreakerRegistry({ timeoutMs: 40 });
  restoreFetch = installGatewayFetchInterceptor(registry, config);
  const gateway = express();
  gateway.use(
    express.json(),
    gatewayCircuitBreakerMiddleware(registry, config.AI_PROVIDER_TIMEOUT_MS + 10_000),
  );
  const proxy = await assistantProxyFactory(config);
  gateway.post("/api/v1/assistant/chat", proxy.chat);
  gateway.get("/api/v1/assistant/conversations", proxy.conversationsList);
  gateway.use(errorMiddleware);
  return await listen(gateway);
}

describe("Assistant deadlines through Gateway middleware and fetch interceptor", () => {
  it("allows a chat response beyond the ordinary service deadline", async () => {
    const url = await fixture();
    const response = await nativeFetch(`${url}/api/v1/assistant/chat`, {
      method: "POST",
      headers: { authorization: "Bearer test.token.signature", "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { content: "Verified response" } });
    expect(registry?.get("ai").getStats().failures).toBe(0);
  });

  it("keeps the ordinary deadline for conversation reads", async () => {
    const url = await fixture();
    const response = await nativeFetch(`${url}/api/v1/assistant/conversations`, {
      headers: { authorization: "Bearer test.token.signature" },
    });
    expect(response.status).toBe(503);
    expect(registry?.get("ai").getStats().failures).toBe(1);
  });

  it("still aborts chat when its provider and persistence budget expires", async () => {
    const url = await fixture();
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    const deadlines: number[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      deadlines.push(milliseconds);
      return timeout(milliseconds === 10_040 ? 60 : milliseconds);
    });
    const response = await nativeFetch(`${url}/api/v1/assistant/chat`, {
      method: "POST",
      headers: { authorization: "Bearer test.token.signature", "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(503);
    expect(deadlines).toEqual([10_040, 10_040]);
    expect(registry?.get("ai").getStats().failures).toBe(1);
  });
});
