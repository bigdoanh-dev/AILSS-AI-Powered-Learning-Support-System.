import { createServer } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CircuitBreakerRegistry,
  gatewayCircuitBreakerMiddleware,
  installGatewayFetchInterceptor,
} from "../../apps/api-gateway/src/circuit-breaker.js";
import { loginProxy, passwordResetProxy } from "../../apps/api-gateway/src/registration-proxy.js";
import type { AppConfig } from "../../packages/config/src/index.js";
import { errorMiddleware } from "../../packages/http/src/index.js";

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
  return `http://127.0.0.1:${address.port}`;
}

async function fixture(delayMs = 100) {
  const requests: unknown[] = [];
  const identity = express();
  identity.use(express.json());
  identity.post("/api/v1/auth/{*operation}", async (req, res) => {
    requests.push(req.body);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (!res.destroyed) res.status(202).json({ data: { accepted: true } });
  });
  const identityUrl = await listen(identity);
  const config = { IDENTITY_SERVICE_URL: identityUrl, INTERNAL_HTTP_TIMEOUT_MS: 40 } as AppConfig;
  registry = new CircuitBreakerRegistry({ timeoutMs: 40 });
  restoreFetch = installGatewayFetchInterceptor(registry, config);
  const gateway = express();
  gateway.use(express.json(), gatewayCircuitBreakerMiddleware(registry));
  for (const operation of ["request", "verify", "complete"] as const)
    gateway.post(`/api/v1/auth/password-reset/${operation}`, passwordResetProxy(config, operation));
  gateway.post("/api/v1/auth/login", loginProxy(config));
  gateway.use(errorMiddleware);
  return { gatewayUrl: await listen(gateway), requests };
}

describe("OTP delivery through Gateway and its fetch circuit breaker", () => {
  it("waits for SMTP work beyond the ordinary Identity timeout", async () => {
    const f = await fixture();
    const response = await nativeFetch(`${f.gatewayUrl}/api/v1/auth/password-reset/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "recovery@example.invalid" }),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ data: { accepted: true } });
    expect(f.requests).toEqual([{ email: "recovery@example.invalid" }]);
    expect(registry?.get("identity").getStats().failures).toBe(0);
  });

  it.each(["password-reset/verify", "password-reset/complete", "login"])(
    "still bounds ordinary auth operation %s",
    async (operation) => {
      const f = await fixture();
      const response = await nativeFetch(`${f.gatewayUrl}/api/v1/auth/${operation}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(response.status).toBe(503);
      expect(registry?.get("identity").getStats().failures).toBe(1);
    },
  );

  it("also aborts hung OTP delivery rather than waiting without a deadline", async () => {
    const f = await fixture(200);
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    const deadlines: number[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      deadlines.push(milliseconds);
      return timeout(milliseconds === 45_000 ? 60 : milliseconds);
    });
    const response = await nativeFetch(`${f.gatewayUrl}/api/v1/auth/password-reset/request`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(503);
    // Both the proxy's signal and the interceptor's breaker use the SMTP budget.
    expect(deadlines).toEqual([45_000, 45_000]);
    expect(registry?.get("identity").getStats().failures).toBe(1);
  });
});
