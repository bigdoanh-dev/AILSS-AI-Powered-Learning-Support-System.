import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assistantRouter } from "../../apps/ai-service/src/assistant/router.js";
import type { AssistantOrchestrator } from "../../apps/ai-service/src/assistant/orchestrator.js";
import type { AssistantRepository } from "../../apps/ai-service/src/assistant/repository.js";
import { requestContextMiddleware, errorMiddleware } from "../../packages/http/src/index.js";
import { createMetrics } from "../../packages/observability/src/index.js";
const app = express();
app.use(requestContextMiddleware());
app.use(
  assistantRouter(
    {} as AssistantOrchestrator,
    {} as AssistantRepository,
    async (token) => {
      if (token === "invalid") throw new Error("Invalid");
      return { userId: randomUUID(), role: token === "admin" ? "ADMIN" : "STUDENT" };
    },
    createMetrics("admin-assistant-test"),
    { adminSupportMode: "local-guide" },
  ),
);
app.use(errorMiddleware);
const server = createServer(app);
let origin = "";
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("No listener");
  origin = `http://127.0.0.1:${String(a.port)}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
describe("Admin assistant configuration visibility", () => {
  it("returns only the configured mode to the administrator", async () => {
    const response = await fetch(origin + "/api/v1/assistant/admin-status", {
      headers: { "x-actor-context": "admin" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { data: { mode: string } };
    expect(body.data).toEqual({ mode: "local-guide" });
  });
  it.each([
    ["student", 403],
    ["invalid", 401],
  ])("rejects %s", async (token, status) => {
    expect(
      (
        await fetch(origin + "/api/v1/assistant/admin-status", {
          headers: { "x-actor-context": token },
        })
      ).status,
    ).toBe(status);
  });
});
