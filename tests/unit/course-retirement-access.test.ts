import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ActorContext } from "../../packages/security/src/index.js";
import { LearningCommerceService } from "../../apps/learning-service/src/commerce/service.js";
import { LearningLessonService } from "../../apps/learning-service/src/lessons/service.js";
import { LearningProgressService } from "../../apps/learning-service/src/progress/service.js";
import { LearningAuthoringService } from "../../apps/learning-service/src/authoring/service.js";

const courseId = randomUUID();
const lecturerId = randomUUID();
const studentId = randomUUID();
const offeringId = randomUUID();
const actor: ActorContext = {
  userId: studentId,
  roles: ["STUDENT"],
  sessionId: randomUUID(),
  tokenVersion: 1,
  correlationId: randomUUID(),
  issuedAt: 1,
  expiresAt: 2,
};

describe("hidden course access across Learning services", () => {
  it("serves a hidden course detail to the owner and an enrolled student only", async () => {
    const course = {
      courseId,
      ownerLecturerId: lecturerId,
      title: "Cơ sở dữ liệu",
      slug: "co-so-du-lieu",
      categoryId: randomUUID(),
      state: "HIDDEN",
      recordVersion: 2,
      contentVersion: 1,
      priceType: "FREE",
      price: "0",
      currency: "VND",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const service = new LearningAuthoringService(
      { get: async () => course } as never,
      {} as never,
      "secret",
      async (id) => id === studentId,
      async () => 1,
    );
    await expect(service.managedCourse(actor, courseId)).resolves.toMatchObject({ state: "HIDDEN" });
    await expect(
      service.managedCourse({ ...actor, userId: lecturerId, roles: ["LECTURER"] }, courseId),
    ).resolves.toMatchObject({ activeStudentCount: 1 });
    await expect(service.managedCourse({ ...actor, userId: randomUUID() }, courseId)).rejects.toMatchObject({
      status: 403,
    });
  });
  it("blocks new offering checkout after a course is hidden", async () => {
    const repo = {
      offering: async () => ({
        offeringId,
        courseId,
        state: "PUBLISHED",
        salesEndAt: new Date("2025-01-01T00:00:00.000Z"),
      }),
      course: async () => ({ courseId, state: "HIDDEN" }),
    };
    const service = new LearningCommerceService(repo as never, {} as never, {} as never, "secret");
    const gateway = service as unknown as {
      requireOffering(id: string, now: Date, existingOrder?: boolean): Promise<unknown>;
    };
    await expect(gateway.requireOffering(offeringId, new Date())).rejects.toMatchObject({
      status: 404,
      code: "COURSE_NOT_AVAILABLE",
    });
    await expect(gateway.requireOffering(offeringId, new Date(), true)).resolves.toMatchObject({
      offeringId,
    });
  });

  it("preserves lesson listing for entitled students and rejects outsiders", async () => {
    let entitled = true;
    const repo = {
      course: async () => ({ courseId, ownerLecturerId: lecturerId, state: "HIDDEN", contentVersion: 1 }),
      hasAccess: async () => entitled,
      list: async () => [],
    };
    const service = new LearningLessonService(
      repo as never,
      { get: async () => ({}) as never },
      undefined,
      "secret",
    );
    await expect(service.list({ courseId, actor, requestId: randomUUID() })).resolves.toMatchObject({
      courseId,
      lessons: [],
    });
    entitled = false;
    await expect(service.list({ courseId, actor, requestId: randomUUID() })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("keeps progress readable only for active entitlements", async () => {
    let entitlement = "ACTIVE";
    const repo = {
      entitlement: async () => entitlement,
      progress: async () => undefined,
      course: async () => ({ state: "HIDDEN", contentVersion: 1 }),
      syllabus: async () => [randomUUID()],
    };
    const service = new LearningProgressService(repo as never, "secret");
    await expect(service.read(courseId, actor)).resolves.toMatchObject({
      publishedTotal: 1,
      completedCount: 0,
    });
    entitlement = "REVOKED";
    await expect(service.read(courseId, actor)).rejects.toMatchObject({
      status: 403,
      code: "COURSE_ACCESS_DENIED",
    });
  });
});
