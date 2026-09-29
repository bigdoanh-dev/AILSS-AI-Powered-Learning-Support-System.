import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ProductAnalyticsService } from "../../apps/learning-service/src/analytics/analytics-service.js";
import type { ActorContext } from "../../packages/security/src/index.js";

describe("Phase 21D: Enterprise Analytics Export Projections", () => {
  const platformAdmin: ActorContext = {
    userId: "admin-super",
    sessionId: "sess-admin",
    roles: ["PLATFORM_ADMIN"],
    tokenVersion: 1,
    correlationId: "corr-admin",
    issuedAt: 1000,
    expiresAt: 2000,
  };

  const orgAAdmin: ActorContext = {
    userId: "admin-org-a",
    sessionId: "sess-org-a",
    roles: ["INSTITUTION_ADMIN"],
    tokenVersion: 1,
    correlationId: "corr-org-a",
    issuedAt: 1000,
    expiresAt: 2000,
  };

  const student: ActorContext = {
    userId: "student-1",
    sessionId: "sess-student",
    roles: ["STUDENT"],
    tokenVersion: 1,
    correlationId: "corr-student",
    issuedAt: 1000,
    expiresAt: 2000,
  };

  async function createSetup() {
    const service = new ProductAnalyticsService();
    const courseId = randomUUID();
    const learnerId = randomUUID();

    // Ingest events
    await service.ingestEvent({
      eventId: randomUUID(),
      eventName: "lesson_completed",
      eventFamily: "LEARNING",
      version: 1,
      occurredAt: new Date().toISOString(),
      actorId: learnerId,
      actorRole: "STUDENT",
      courseId,
      payload: {
        organizationId: "org-hcmut",
        lessonId: "lesson-1",
        durationSeconds: 1500,
      },
    });

    await service.ingestEvent({
      eventId: randomUUID(),
      eventName: "lesson_completed",
      eventFamily: "LEARNING",
      version: 1,
      occurredAt: new Date().toISOString(),
      actorId: learnerId,
      actorRole: "STUDENT",
      courseId,
      payload: {
        organizationId: "org-hcmut",
        lessonId: "lesson-2",
        durationSeconds: 1200,
      },
    });

    return { service, courseId, learnerId };
  }

  it("exports CSV projection with proper header and aggregated progress metrics", async () => {
    const { service, courseId, learnerId } = await createSetup();

    const result = await service.exportEnterpriseProjection({
      organizationId: "org-hcmut",
      format: "CSV",
      actor: orgAAdmin,
      accessibleTenantIds: ["org-hcmut"],
    });

    expect(result.format).toBe("CSV");
    expect(result.recordCount).toBe(1);
    expect(result.data).toContain(
      "learnerId,courseId,organizationId,completedLessons,totalTimeSpentSeconds,lastActiveAt,status",
    );
    expect(result.data).toContain(`${learnerId},${courseId},org-hcmut,2,2700,`);
  });

  it("exports JSONL and JSON projections", async () => {
    const { service } = await createSetup();

    const jsonlResult = await service.exportEnterpriseProjection({
      organizationId: "org-hcmut",
      format: "JSONL",
      actor: orgAAdmin,
      accessibleTenantIds: ["org-hcmut"],
    });

    expect(jsonlResult.format).toBe("JSONL");
    const parsedLine = JSON.parse(jsonlResult.data.trim());
    expect(parsedLine.completedLessons).toBe(2);
    expect(parsedLine.totalTimeSpentSeconds).toBe(2700);

    const jsonResult = await service.exportEnterpriseProjection({
      organizationId: "org-hcmut",
      format: "JSON",
      actor: orgAAdmin,
      accessibleTenantIds: ["org-hcmut"],
    });

    expect(jsonResult.format).toBe("JSON");
    const parsedJson = JSON.parse(jsonResult.data);
    expect(Array.isArray(parsedJson)).toBe(true);
    expect(parsedJson[0].completedLessons).toBe(2);
  });

  it("strictly prevents foreign organization export with TENANT_ACCESS_DENIED", async () => {
    const { service } = await createSetup();

    // Org A admin tries to export Org B
    await expect(
      service.exportEnterpriseProjection({
        organizationId: "org-mit",
        format: "CSV",
        actor: orgAAdmin,
        accessibleTenantIds: ["org-hcmut"],
      }),
    ).rejects.toMatchObject({
      code: "TENANT_ACCESS_DENIED",
      status: 403,
    });

    // Student has no export clearance
    await expect(
      service.exportEnterpriseProjection({
        organizationId: "org-hcmut",
        format: "CSV",
        actor: student,
        accessibleTenantIds: ["org-hcmut"],
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });

    // Platform admin can export any org
    const adminResult = await service.exportEnterpriseProjection({
      organizationId: "org-mit",
      format: "CSV",
      actor: platformAdmin,
    });
    expect(adminResult.organizationId).toBe("org-mit");
  });
});
