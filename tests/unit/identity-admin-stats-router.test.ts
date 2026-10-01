import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { adminRouter } from "../../apps/identity-service/src/admin/router.js";
import type { IdentityAdminService } from "../../apps/identity-service/src/admin/service.js";
import { requestContextMiddleware, errorMiddleware } from "../../packages/http/src/index.js";
import { createMetrics } from "../../packages/observability/src/index.js";
const correlationId = randomUUID();
const actor = {
  userId: randomUUID(),
  roles: ["ADMIN"],
  sessionId: randomUUID(),
  tokenVersion: 1,
  correlationId,
  issuedAt: 0,
  expiresAt: 9999999999,
};
const stats = vi.fn(async (token: string) => {
  if (token !== "stats-context") throw new Error("Wrong purpose");
  return actor;
});
const detail = vi.fn(async () => {
  throw new Error("Detail purpose must never authorize statistics");
});
const service = {
  stats: vi.fn(async () => ({ students: 0, lecturers: 0, admins: 1, aiSessions: null })),
} as unknown as IdentityAdminService;
const app = express();
app.use(requestContextMiddleware());
app.use(
  adminRouter(
    service,
    { search: detail, detail, stats, statusChange: detail },
    createMetrics("identity-stats-test"),
  ),
);
app.use(errorMiddleware);
const server = createServer(app);
let origin = "";
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test listener");
  origin = `http://127.0.0.1:${String(address.port)}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
describe("Admin statistics authorization purpose", () => {
  it("accepts the dedicated statistics context rather than the user-detail context", async () => {
    const response = await fetch(origin + "/api/v1/admin/dashboard/stats", {
      headers: { "x-actor-context": "stats-context", "x-correlation-id": correlationId },
    });
    expect(response.status).toBe(200);
    expect(stats).toHaveBeenCalledWith("stats-context");
    expect(detail).not.toHaveBeenCalled();
    const body = (await response.json()) as { data: { aiSessions: number | null } };
    expect(body.data.aiSessions).toBeNull();
  });
  it("rejects a context for another purpose", async () => {
    const response = await fetch(origin + "/api/v1/admin/dashboard/stats", {
      headers: { "x-actor-context": "user-detail-context", "x-correlation-id": correlationId },
    });
    expect(response.status).toBe(401);
  });
});
