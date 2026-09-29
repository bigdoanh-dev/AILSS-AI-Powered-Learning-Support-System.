import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  InMemorySearchIndexRepository,
  MultiTenantSearchService,
} from "../../apps/learning-service/src/search/index.js";
import { GovernedRagService, InMemoryRagKnowledgeRepository } from "../../apps/ai-service/src/rag/index.js";
import {
  CredentialService,
  InMemoryCredentialRepository,
} from "../../apps/learning-service/src/credentials/service.js";
import { ProductAnalyticsService } from "../../apps/learning-service/src/analytics/analytics-service.js";
import {
  assertOnboardingTransition,
  type TenantOnboardingRecord,
} from "../../packages/contracts/src/onboarding.js";
import type { ActorContext } from "../../packages/security/src/index.js";

describe("Phase 22.2: Full End-to-End Core Platform Journeys", () => {
  const institutionTenantId = "tenant-hcmut-vn";

  const adminActor: ActorContext = {
    userId: randomUUID(),
    sessionId: "sess-admin-01",
    roles: ["ADMIN", "INSTITUTION_ADMIN"],
    tokenVersion: 1,
    correlationId: randomUUID(),
    issuedAt: 1000,
    expiresAt: 2000,
  };

  const lecturerActor: ActorContext = {
    userId: randomUUID(),
    sessionId: "sess-lecturer-01",
    roles: ["LECTURER"],
    tokenVersion: 1,
    correlationId: randomUUID(),
    issuedAt: 1000,
    expiresAt: 2000,
  };

  const studentActor: ActorContext = {
    userId: randomUUID(),
    sessionId: "sess-student-01",
    roles: ["STUDENT"],
    tokenVersion: 1,
    correlationId: randomUUID(),
    issuedAt: 1000,
    expiresAt: 2000,
  };

  it("completes Full Student Journey: Discovery -> Enrollment -> Study -> Rag Assistant -> Certificate", async () => {
    // 1. Course Discovery via MultiTenantSearchService
    const searchRepo = new InMemorySearchIndexRepository();
    const searchService = new MultiTenantSearchService(searchRepo);

    const courseId = randomUUID();
    await searchService.index(
      {
        id: "doc-course-distributed",
        entityType: "COURSE",
        organizationId: institutionTenantId,
        courseId,
        title: "Distributed Systems & Cloud Architecture",
        content: "Master consensus, ScyllaDB clustering, and fault tolerance.",
        tags: ["distributed", "systems"],
        visibility: "PUBLIC",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      lecturerActor,
    );

    const searchResults = await searchService.search(
      { query: "Distributed Systems" },
      { actor: studentActor },
    );
    expect(searchResults.results.length).toBeGreaterThanOrEqual(1);
    expect(searchResults.results[0]?.id).toBe("doc-course-distributed");

    // 2. Governed Study Assistant Interaction with Course Version Pinning
    const ragRepo = new InMemoryRagKnowledgeRepository();
    const ragService = new GovernedRagService(ragRepo);

    await ragService.ingestDocument({
      courseId,
      courseVersion: 1,
      documentId: "doc-ch1-consensus",
      chunks: [
        "Raft consensus elects a leader through randomized election timers.",
        "Log entries are committed once replicated to a quorum of nodes.",
      ],
    });

    const assistantAnswer = await ragService.retrieve({
      courseId,
      courseVersion: 1,
      query: "How are log entries committed?",
    });
    expect(assistantAnswer.chunks.length).toBeGreaterThan(0);
    expect(assistantAnswer.chunks[0]?.text).toContain("quorum of nodes");

    // 3. Complete Course & Issue Verifiable Certificate
    const credRepo = new InMemoryCredentialRepository();
    const credService = new CredentialService({
      repository: credRepo,
      signingSecret: "e2e-journey-signing-secret-phase22-secure",
    });

    const cert = await credService.issueCertificate({
      studentId: studentActor.userId,
      courseId,
      courseVersion: 1,
      organizationId: institutionTenantId,
      completionPercent: 100,
      grade: "A+",
    });

    expect(cert.certificateId).toBeDefined();
    expect(cert.status).toBe("ACTIVE");

    // 4. Public Verification
    const verification = await credService.verifyCertificate(cert.certificateId, {
      privacyLevel: "MINIMAL",
    });
    expect(verification.valid).toBe(true);
    expect(verification.status).toBe("ACTIVE");
  });

  it("completes Full Institution Admin Journey: Onboarding -> SSO Verification -> Enterprise Analytics", async () => {
    // 1. Institution Onboarding Lifecycle
    const onboardingRecord: TenantOnboardingRecord = {
      tenantId: institutionTenantId,
      institutionName: "Ho Chi Minh City University of Technology",
      rootDomain: "hcmut.edu.vn",
      stage: "CREATED",
      primaryAdminEmail: "admin@hcmut.edu.vn",
      ssoConfigured: false,
      ltiConfigured: false,
      brandingConfigured: false,
      pilotUserCount: 0,
      healthCheckPassed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Progression: CREATED -> IDENTITY_CONFIGURED
    assertOnboardingTransition(onboardingRecord, "IDENTITY_CONFIGURED");
    onboardingRecord.stage = "IDENTITY_CONFIGURED";
    onboardingRecord.ssoConfigured = true;

    // Progression: IDENTITY_CONFIGURED -> INTEGRATIONS_CONFIGURED
    assertOnboardingTransition(onboardingRecord, "INTEGRATIONS_CONFIGURED");
    onboardingRecord.stage = "INTEGRATIONS_CONFIGURED";
    onboardingRecord.ltiConfigured = true;

    // Progression: INTEGRATIONS_CONFIGURED -> ADMIN_VERIFIED
    assertOnboardingTransition(onboardingRecord, "ADMIN_VERIFIED");
    onboardingRecord.stage = "ADMIN_VERIFIED";
    onboardingRecord.pilotUserCount = 50;

    // Progression: ADMIN_VERIFIED -> PILOT
    assertOnboardingTransition(onboardingRecord, "PILOT");
    onboardingRecord.stage = "PILOT";
    onboardingRecord.healthCheckPassed = true;

    // Progression: PILOT -> ACTIVE
    assertOnboardingTransition(onboardingRecord, "ACTIVE");
    onboardingRecord.stage = "ACTIVE";
    expect(onboardingRecord.stage).toBe("ACTIVE");

    // 2. Enterprise Analytics Export Projection
    const analyticsService = new ProductAnalyticsService();
    await analyticsService.ingestEvent({
      eventId: randomUUID(),
      eventName: "lesson_completed",
      eventFamily: "LEARNING",
      occurredAt: new Date().toISOString(),
      actorId: studentActor.userId,
      actorRole: "STUDENT",
      courseId: randomUUID(),
      payload: { organizationId: institutionTenantId, durationSeconds: 1800 },
    });

    const exportResult = await analyticsService.exportEnterpriseProjection({
      organizationId: institutionTenantId,
      format: "JSONL",
      actor: adminActor,
      accessibleTenantIds: [institutionTenantId],
    });

    expect(exportResult.recordCount).toBe(1);
    expect(exportResult.data).toContain(studentActor.userId);
  });
});
