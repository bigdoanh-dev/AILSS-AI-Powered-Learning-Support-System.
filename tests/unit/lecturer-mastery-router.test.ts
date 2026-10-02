import { createServer } from "node:http";
import express from "express";
import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from "vitest";
import {
  lecturerMasteryRouter,
  authorizeCourseMastery,
} from "../../apps/learning-service/src/adaptive/lecturer-mastery-router.js";
import { requestContextMiddleware, errorMiddleware } from "../../packages/http/src/index.js";
import type { ActorContext } from "../../packages/security/src/index.js";
const id = "11111111-1111-4111-8111-111111111111";
const actor: ActorContext = {
  userId: id,
  roles: ["LECTURER"],
  sessionId: id,
  tokenVersion: 1,
  correlationId: id,
  issuedAt: 0,
  expiresAt: 9999999999,
};
const mastery = vi.fn(async () => []);
const authority = {
  course: vi.fn(async () => ({ ownerLecturerId: id })),
  entitlement: vi.fn(async (_student?: string, _course?: string) => ({ state: "ACTIVE" })),
  roster: vi.fn(async () => [{ studentId: id }]),
};
const app = express();
app.use(requestContextMiddleware());
app.use(
  lecturerMasteryRouter(
    { mastery },
    async (token) => {
      if (token === "wrong-purpose") throw new Error("Rejected actor purpose");
      return token === "student" ? { ...actor, roles: ["STUDENT"] } : actor;
    },
    (a, c, s) => authorizeCourseMastery(a, c, s, authority),
    authority,
  ),
);
app.use(errorMiddleware);
beforeEach(() => {
  vi.clearAllMocks();
  authority.course.mockResolvedValue({ ownerLecturerId: id });
  authority.entitlement.mockResolvedValue({ state: "ACTIVE" });
  authority.roster.mockResolvedValue([{ studentId: id }]);
});
const server = createServer(app);
let origin = "";
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error();
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const request = (token?: string, correlation = id, course = id) =>
  fetch(`${origin}/api/v1/courses/${course}/students/${id}/mastery`, {
    headers: { "x-correlation-id": correlation, ...(token ? { "x-actor-context": token } : {}) },
  });
describe("Mastery lecturer route", () => {
  const summaryRequest = (token?: string, course = id) =>
    fetch(`${origin}/api/v1/courses/${course}/mastery-summary`, {
      headers: { "x-correlation-id": id, ...(token ? { "x-actor-context": token } : {}) },
    });
  it("summarizes only current active students, deduplicates the roster and exposes no student identifiers", async () => {
    authority.roster.mockResolvedValue([{ studentId: id }, { studentId: id }, { studentId: "revoked" }]);
    authority.entitlement.mockImplementation(async (student?: string) => ({
      state: student === "revoked" ? "REVOKED" : "ACTIVE",
    }));
    const response = await summaryRequest("owner");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { studentCount: 1, assessedStudentCount: 0, records: [] },
    });
    expect(mastery).toHaveBeenCalledTimes(1);
    expect(mastery).toHaveBeenCalledWith(id, id);
  });
  it("rejects unauthorized summary reads before looking up students", async () => {
    for (const [token, status] of [
      [undefined, 401],
      ["wrong-purpose", 401],
      ["student", 403],
    ] as const)
      expect((await summaryRequest(token)).status).toBe(status);
    authority.course.mockResolvedValue({ ownerLecturerId: "other" });
    expect((await summaryRequest("owner")).status).toBe(403);
    expect((await summaryRequest("owner", "invalid")).status).toBe(422);
    expect(authority.roster).not.toHaveBeenCalled();
    expect(mastery).not.toHaveBeenCalled();
  });
  it("returns a truthful empty summary for an empty course", async () => {
    authority.roster.mockResolvedValue([]);
    const response = await summaryRequest("owner");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { studentCount: 0, assessedStudentCount: 0, records: [] },
    });
    expect(mastery).not.toHaveBeenCalled();
  });
  it("accepts an authorized owner but rejects missing, wrong-purpose, cross-request and student actors", async () => {
    expect((await request("owner")).status).toBe(200);
    expect(mastery).toHaveBeenCalledWith(id, id);
    mastery.mockClear();
    for (const [token, correlation, status] of [
      [undefined, id, 401],
      ["wrong-purpose", id, 401],
      ["owner", "22222222-2222-4222-8222-222222222222", 401],
      ["student", id, 403],
    ] as const)
      expect((await request(token, correlation)).status).toBe(status);
    expect(mastery).not.toHaveBeenCalled();
  });
  it("does not read mastery for a revoked enrollment, another owner or invalid IDs", async () => {
    mastery.mockClear();
    authority.entitlement.mockResolvedValue({ state: "REVOKED" });
    expect((await request("owner")).status).toBe(403);
    authority.entitlement.mockResolvedValue({ state: "ACTIVE" });
    authority.course.mockResolvedValue({ ownerLecturerId: "other" });
    expect((await request("owner")).status).toBe(403);
    expect((await request("owner", id, "not-a-uuid")).status).toBe(422);
    expect(mastery).not.toHaveBeenCalled();
  });
});
