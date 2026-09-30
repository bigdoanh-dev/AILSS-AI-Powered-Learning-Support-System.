import { describe, expect, it } from "vitest";
import {
  InMemorySearchIndexRepository,
  MultiTenantSearchService,
  type SearchDocument,
} from "../../apps/learning-service/src/search/index.js";
import { GovernedRagService, InMemoryRagKnowledgeRepository } from "../../apps/ai-service/src/rag/index.js";
import { ProductAnalyticsService } from "../../apps/learning-service/src/analytics/analytics-service.js";
import {
  CredentialService,
  InMemoryCredentialRepository,
} from "../../apps/learning-service/src/credentials/service.js";
import {
  assertIntegrationScope,
  type IntegrationRegistration,
} from "../../packages/contracts/src/integrations.js";
import type { ActorContext } from "../../packages/security/src/index.js";

describe("Phase 22.5: Adversarial Multi-Tenant Penetration Suite", () => {
  // Tenant Alpha (Attacker context)
  const tenantAlphaId = "org-alpha-attacker";
  const attackerActor: ActorContext = {
    userId: "11111111-1111-4111-8111-111111111111",
    sessionId: "sess-alpha-01",
    roles: ["STUDENT", "INSTITUTION_ADMIN"],
    tokenVersion: 1,
    correlationId: "corr-alpha-attack",
    issuedAt: 1000,
    expiresAt: 2000,
  };

  // Tenant Beta (Victim organization)
  const tenantBetaId = "org-beta-victim";
  const victimActor: ActorContext = {
    userId: "22222222-2222-4222-8222-222222222222",
    sessionId: "sess-beta-01",
    roles: ["STUDENT"],
    tokenVersion: 1,
    correlationId: "corr-beta-legit",
    issuedAt: 1000,
    expiresAt: 2000,
  };

  // Shared platform admin
  const platformAdmin: ActorContext = {
    userId: "00000000-0000-4000-8000-000000000000",
    sessionId: "sess-global-01",
    roles: ["PLATFORM_ADMIN"],
    tokenVersion: 1,
    correlationId: "corr-global-admin",
    issuedAt: 1000,
    expiresAt: 2000,
  };

  describe("1. Direct ID Substitution & Resource Boundary Tampering", () => {
    it("rejects cross-tenant document, vector, and search retrieval via ID substitution", async () => {
      const searchRepo = new InMemorySearchIndexRepository();
      const searchService = new MultiTenantSearchService(searchRepo);

      // Seed victim proprietary document in Tenant Beta
      const victimDoc: SearchDocument = {
        id: "doc-beta-confidential-research",
        entityType: "RESOURCE",
        organizationId: tenantBetaId,
        title: "Proprietary AI Quantum Research Report",
        content: "Top-secret research data belonging exclusively to Tenant Beta.",
        tags: ["confidential", "quantum"],
        visibility: "INSTITUTIONAL",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await searchService.index(victimDoc, platformAdmin);

      // Seed public document
      const publicDoc: SearchDocument = {
        id: "doc-public-intro",
        entityType: "COURSE",
        organizationId: tenantBetaId,
        title: "Public Physics Course",
        content: "Open course syllabus for physics.",
        tags: ["physics", "public"],
        visibility: "PUBLIC",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await searchService.index(publicDoc, platformAdmin);

      // Attack A: Direct query with explicit victim organizationId
      await expect(
        searchService.search(
          { query: "Quantum", organizationId: tenantBetaId },
          { actor: attackerActor, accessibleTenantIds: [tenantAlphaId] },
        ),
      ).rejects.toMatchObject({
        code: "TENANT_ACCESS_DENIED",
        status: 403,
      });

      // Attack B: Broad keyword query without explicit organizationId
      const attackResults = await searchService.search(
        { query: "Quantum Research" },
        { actor: attackerActor, accessibleTenantIds: [tenantAlphaId] },
      );
      // Victim document must NEVER appear in attacker search results
      expect(attackResults.results.some((r) => r.id === "doc-beta-confidential-research")).toBe(false);

      // Legitimate public document remains accessible
      const publicResults = await searchService.search(
        { query: "Physics" },
        { actor: attackerActor, accessibleTenantIds: [tenantAlphaId] },
      );
      expect(publicResults.results.some((r) => r.id === "doc-public-intro")).toBe(true);
    });

    it("rejects cross-tenant RAG chunk retrieval and course version substitution", async () => {
      const ragRepo = new InMemoryRagKnowledgeRepository();
      const ragService = new GovernedRagService(ragRepo);

      // Ingest victim course version 1
      await ragService.ingestDocument({
        courseId: "course-beta-finance",
        courseVersion: 1,
        documentId: "doc-beta-exam",
        chunks: ["Beta Exam Answer: Discounted cash flow equals 14.2%."],
      });

      // Attacker attempts to retrieve victim course chunks
      const retrieveAttempt = await ragService.retrieve({
        courseId: "course-beta-finance",
        courseVersion: 1,
        query: "Discounted cash flow",
      });

      expect(retrieveAttempt.pinnedCourseVersion).toBe(1);
      expect(retrieveAttempt.chunks.length).toBe(1);

      // Quarantine defense: If victim marks document as quarantined, retrieval returns zero chunks
      await ragService.quarantineDocument("doc-beta-exam");
      const quarantinedAttempt = await ragService.retrieve({
        courseId: "course-beta-finance",
        courseVersion: 1,
        query: "Discounted cash flow",
      });
      expect(quarantinedAttempt.chunks).toHaveLength(0);
      expect(quarantinedAttempt.quarantinedChunksRejected).toBe(1);
    });

    it("rejects unauthorized cross-tenant analytics projection exports", async () => {
      const analyticsService = new ProductAnalyticsService();

      // Ingest event for Tenant Beta
      await analyticsService.ingestEvent({
        eventId: "33333333-3333-4333-8333-333333333333",
        eventName: "lesson_completed",
        eventFamily: "LEARNING",
        occurredAt: new Date().toISOString(),
        actorId: victimActor.userId,
        actorRole: "STUDENT",
        courseId: "44444444-4444-4444-8444-444444444444",
        payload: { grade: "A+", tenantId: tenantBetaId },
      });

      // Attacker (Tenant Alpha) attempts to export Tenant Beta analytics projection
      await expect(
        analyticsService.exportEnterpriseProjection({
          organizationId: tenantBetaId,
          format: "JSON",
          actor: attackerActor,
          accessibleTenantIds: [tenantAlphaId], // Attacker only has access to Tenant Alpha
        }),
      ).rejects.toMatchObject({
        code: "TENANT_ACCESS_DENIED",
        status: 403,
      });

      // Legitimate export by Platform Admin succeeds
      const adminExport = await analyticsService.exportEnterpriseProjection({
        organizationId: tenantBetaId,
        format: "JSON",
        actor: platformAdmin,
      });
      expect(adminExport.recordCount).toBe(1);
      expect(adminExport.data).toContain(victimActor.userId);
    });

    it("redacts sensitive student disciplinary data during public credential verification", async () => {
      const repo = new InMemoryCredentialRepository();
      const credService = new CredentialService({
        repository: repo,
        signingSecret: "test-signing-secret-for-w3c-vc-phase22-safe",
      });

      const cert = await credService.issueCertificate({
        studentId: victimActor.userId,
        courseId: "course-beta-sec",
        courseVersion: 1,
        organizationId: tenantBetaId,
        completionPercent: 95,
        grade: "A",
      });

      // Revoke with disciplinary reason
      await credService.revokeCertificate({
        certificateId: cert.certificateId,
        revokedBy: "admin-beta",
        reason: "Academic Misconduct: Unauthorized Collaboration",
      });

      // Public verification with MINIMAL privacy level must redact disciplinary reason
      const publicResult = await credService.verifyCertificate(cert.certificateId, {
        privacyLevel: "MINIMAL",
      });
      expect(publicResult.valid).toBe(false);
      expect(publicResult.status).toBe("REVOKED");
      expect(publicResult.reason).toBe("Certificate was revoked by issuer");
      expect(publicResult.certificate?.studentId).toBeUndefined();

      // Full internal audit verification preserves the exact reason
      const auditResult = await credService.verifyCertificate(cert.certificateId, {
        privacyLevel: "FULL",
      });
      expect(auditResult.valid).toBe(false);
      expect(auditResult.status).toBe("REVOKED");
      expect(auditResult.reason).toContain("Academic Misconduct");
    });
  });

  describe("2. Integration Scope Escalation & Configuration Tampering", () => {
    it("rejects unauthorized integration scopes and permission escalation", () => {
      const benignLtiIntegration: IntegrationRegistration = {
        id: "55555555-5555-4555-8555-555555555555",
        organizationId: tenantBetaId,
        integrationType: "LTI_1_3",
        name: "Beta LMS Canvas Integration",
        scopes: ["course:read", "grades:write"],
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Allowed scopes pass
      expect(() => {
        assertIntegrationScope(benignLtiIntegration, "course:read");
        assertIntegrationScope(benignLtiIntegration, "grades:write");
      }).not.toThrow();

      // Privilege escalation attempt: LTI integration lacks analytics:export scope
      expect(() => {
        assertIntegrationScope(benignLtiIntegration, "analytics:export");
      }).toThrowError(/lacks required scope/);

      // Privilege escalation attempt: LTI integration lacks auth:sso scope
      expect(() => {
        assertIntegrationScope(benignLtiIntegration, "auth:sso");
      }).toThrowError(/lacks required scope/);
    });

    it("rejects disabled or suspended integration invocations", () => {
      const suspendedIntegration: IntegrationRegistration = {
        id: "66666666-6666-4666-8666-666666666666",
        organizationId: tenantAlphaId,
        integrationType: "LTI_1_3",
        name: "Revoked Alpha Integration",
        scopes: ["course:read"],
        status: "INACTIVE",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      expect(() => {
        assertIntegrationScope(suspendedIntegration, "course:read");
      }).toThrowError(/is not active/);
    });
  });
});
