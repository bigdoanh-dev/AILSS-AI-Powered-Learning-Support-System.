import { describe, expect, it } from "vitest";
import {
  InMemorySearchIndexRepository,
  MultiTenantSearchService,
  type SearchDocument,
} from "../../apps/learning-service/src/search/index.js";
import type { ActorContext } from "../../packages/security/src/index.js";

describe("Phase 21A: Multi-Tenant Search & Retrieval Boundary Authorization", () => {
  const adminActor: ActorContext = {
    userId: "admin-1",
    sessionId: "sess-admin",
    roles: ["PLATFORM_ADMIN"],
    tokenVersion: 1,
    correlationId: "corr-admin",
    issuedAt: 1000,
    expiresAt: 2000,
  };

  const orgAStudent: ActorContext = {
    userId: "student-a",
    sessionId: "sess-student-a",
    roles: ["STUDENT"],
    tokenVersion: 1,
    correlationId: "corr-student-a",
    issuedAt: 1000,
    expiresAt: 2000,
  };

  const orgBStudent: ActorContext = {
    userId: "student-b",
    sessionId: "sess-student-b",
    roles: ["STUDENT"],
    tokenVersion: 1,
    correlationId: "corr-student-b",
    issuedAt: 1000,
    expiresAt: 2000,
  };

  async function createFixture() {
    const repo = new InMemorySearchIndexRepository();
    const service = new MultiTenantSearchService(repo);

    const docs: SearchDocument[] = [
      {
        id: "doc-pub-1",
        entityType: "COURSE",
        organizationId: "org-hcmut",
        title: "Introduction to Computer Science",
        content: "Fundamental concepts of programming and data structures.",
        tags: ["cs", "intro"],
        visibility: "PUBLIC",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "doc-org-a-internal",
        entityType: "RESOURCE",
        organizationId: "org-hcmut",
        title: "HCMUT Internal Faculty Syllabus 2026",
        content: "Internal department guidelines and semester calendar for HCMUT faculty.",
        tags: ["internal", "syllabus"],
        visibility: "INSTITUTIONAL",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "doc-org-b-internal",
        entityType: "RESOURCE",
        organizationId: "org-stanford",
        title: "Stanford Department Operating Manual",
        content: "Proprietary course structure and lab access rules for Stanford.",
        tags: ["internal", "manual"],
        visibility: "INSTITUTIONAL",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "doc-course-restricted",
        entityType: "LESSON",
        organizationId: "org-hcmut",
        courseId: "course-db-adv",
        title: "Advanced Database Midterm Exam Solution",
        content: "Official solutions for the 2026 Advanced Database Midterm Exam.",
        tags: ["exam", "solution"],
        visibility: "RESTRICTED",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    for (const d of docs) {
      await service.index(d, adminActor);
    }

    return { service, repo };
  }

  it("permits public documents to be retrieved across tenant boundaries", async () => {
    const { service } = await createFixture();

    const responseA = await service.search(
      { query: "programming" },
      { actor: orgAStudent, accessibleTenantIds: ["org-hcmut"] },
    );
    expect(responseA.results.some((r) => r.id === "doc-pub-1")).toBe(true);

    const responseB = await service.search(
      { query: "programming" },
      { actor: orgBStudent, accessibleTenantIds: ["org-stanford"] },
    );
    expect(responseB.results.some((r) => r.id === "doc-pub-1")).toBe(true);
  });

  it("strictly enforces tenant boundaries on institutional documents (zero leakage)", async () => {
    const { service } = await createFixture();

    // Org A student searches for "internal"
    const responseA = await service.search(
      { query: "internal" },
      { actor: orgAStudent, accessibleTenantIds: ["org-hcmut"] },
    );
    expect(responseA.results.some((r) => r.id === "doc-org-a-internal")).toBe(true);
    expect(responseA.results.some((r) => r.id === "doc-org-b-internal")).toBe(false);

    // Org B student searches for "internal"
    const responseB = await service.search(
      { query: "internal" },
      { actor: orgBStudent, accessibleTenantIds: ["org-stanford"] },
    );
    expect(responseB.results.some((r) => r.id === "doc-org-b-internal")).toBe(true);
    expect(responseB.results.some((r) => r.id === "doc-org-a-internal")).toBe(false);
  });

  it("protects restricted course documents to enrolled students or instructors", async () => {
    const { service } = await createFixture();

    // Not enrolled in course-db-adv
    const unenrolledResponse = await service.search(
      { query: "Midterm Exam" },
      {
        actor: orgAStudent,
        accessibleTenantIds: ["org-hcmut"],
        enrolledCourseIds: ["other-course"],
      },
    );
    expect(unenrolledResponse.results.some((r) => r.id === "doc-course-restricted")).toBe(false);

    // Enrolled in course-db-adv
    const enrolledResponse = await service.search(
      { query: "Midterm Exam" },
      {
        actor: orgAStudent,
        accessibleTenantIds: ["org-hcmut"],
        enrolledCourseIds: ["course-db-adv"],
      },
    );
    expect(enrolledResponse.results.some((r) => r.id === "doc-course-restricted")).toBe(true);
  });

  it("rejects unauthorized cross-tenant query with TENANT_ACCESS_DENIED", async () => {
    const { service } = await createFixture();

    // Org B student tries to query org-hcmut directly
    await expect(
      service.search(
        { query: "Syllabus", organizationId: "org-hcmut" },
        { actor: orgBStudent, accessibleTenantIds: ["org-stanford"] },
      ),
    ).rejects.toMatchObject({
      code: "TENANT_ACCESS_DENIED",
      status: 403,
    });

    // Platform admin can query org-hcmut directly without error
    const adminResponse = await service.search(
      { query: "Syllabus", organizationId: "org-hcmut" },
      { actor: adminActor },
    );
    expect(adminResponse.results.length).toBeGreaterThanOrEqual(1);
  });
});
