import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { learningQuizEligibilityRouter } from "../../apps/learning-service/src/quiz-eligibility-router.js";
import { requestContextMiddleware, errorMiddleware } from "../../packages/http/src/index.js";
import type { LearningCatalogRepository } from "../../apps/learning-service/src/catalog/repository.js";
import type { LearningCommerceRepository } from "../../apps/learning-service/src/commerce/repository.js";
const courseId = randomUUID(),
  ownerLecturerId = randomUUID(),
  correlationId = randomUUID();
const getCanonicalCourse = vi.fn<LearningCatalogRepository["getCanonicalCourse"]>();
const entitlement = vi.fn<LearningCommerceRepository["entitlement"]>(async () => ({
  entitlementId: randomUUID(),
  studentId: randomUUID(),
  courseId,
  state: "ACTIVE",
  sourceOfferingId: randomUUID(),
  sourceEnrollmentId: randomUUID(),
  grantedAt: new Date(),
  version: 1,
  updatedAt: new Date(),
}));
const course = {
  courseId,
  ownerLecturerId,
  state: "DRAFT",
  recordVersion: 1,
  title: "Draft",
  slug: "draft",
  categoryId: randomUUID(),
  priceType: "FREE",
  price: "0",
  currency: "VND",
  createdAt: new Date(),
  updatedAt: new Date(),
};
const app = express();
app.use(requestContextMiddleware());
app.use(
  learningQuizEligibilityRouter(
    { getCanonicalCourse, entitlement },
    async () => ({ sub: "assessment-service" }),
    async () => ({
      userId: randomUUID(),
      roles: ["STUDENT"],
      sessionId: randomUUID(),
      tokenVersion: 1,
      correlationId,
      issuedAt: 0,
      expiresAt: 9999999999,
    }),
  ),
);
app.use(errorMiddleware);
const server = createServer(app);
let origin = "";
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No listener");
  origin = `http://127.0.0.1:${String(address.port)}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  vi.clearAllMocks();
  getCanonicalCourse.mockResolvedValue(course);
});
const request = (student = false) =>
  fetch(`${origin}/internal/v1/courses/${courseId}/quiz-eligibility`, {
    headers: {
      authorization: "Service test-token",
      "x-correlation-id": correlationId,
      ...(student ? { "x-actor-context": "student-token" } : {}),
    },
  });
describe("Unpublished course quiz eligibility", () => {
  it.each(["DRAFT", "IN_REVIEW"])("returns %s ownership facts to Assessment", async (state) => {
    getCanonicalCourse.mockResolvedValue({ ...course, state });
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { courseId, ownerLecturerId, state, recordVersion: 1 },
    });
    expect(entitlement).not.toHaveBeenCalled();
  });
  it.each(["DRAFT", "IN_REVIEW"])("blocks student access to %s even with entitlement", async (state) => {
    getCanonicalCourse.mockResolvedValue({ ...course, state });
    const response = await request(true);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "STUDENT_NOT_ELIGIBLE" } });
    expect(entitlement).not.toHaveBeenCalled();
  });
  it.each(["PUBLISHED", "HIDDEN"])("preserves entitled student access to %s", async (state) => {
    getCanonicalCourse.mockResolvedValue({ ...course, state });
    const response = await request(true);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { studentEligible: true } });
    expect(entitlement).toHaveBeenCalled();
  });
  it.each(["ARCHIVED", "DELETED"])("keeps %s unavailable", async (state) => {
    getCanonicalCourse.mockResolvedValue({ ...course, state });
    expect((await request()).status).toBe(404);
  });
  it("keeps a missing course unavailable", async () => {
    getCanonicalCourse.mockResolvedValue(undefined);
    expect((await request()).status).toBe(404);
  });
});
