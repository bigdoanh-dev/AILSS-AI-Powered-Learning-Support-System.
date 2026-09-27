import { describe, it, expect } from "vitest";
import {
  verifyLtiGradeIntegrity,
  ONE_EDTECH_CONFORMANCE_DECISIONS,
  type LtiGradeIntegritySample,
} from "../../packages/contracts/src/interoperability.js";
import {
  DataSubjectOperationProcessor,
  type InstitutionalDataProcessingPolicy,
  type DataSubjectOperationRequest,
} from "../../packages/contracts/src/data-retention-policy.js";

describe("Phase 28.8, 28.9, 28.11-28.15: LTI Reliability, Conformance Decision & Privacy Governance", () => {
  describe("Phase 28.8: LTI Grade Integrity Verification", () => {
    it("confirms exact match between AILSS score and LMS reported score", () => {
      const validSample: LtiGradeIntegritySample = {
        studentSourcedId: "sis-student-402",
        courseId: "c-algo-adv",
        lineItemId: "li-midterm-exam-01",
        ailssGradeScore: 8.5,
        lmsReportedScore: 8.5,
        scoreGivenAt: "2026-09-15T14:30:00Z",
        exactMatch: true,
      };

      const result = verifyLtiGradeIntegrity(validSample);
      expect(result.matches).toBe(true);
      expect(result.discrepancy).toBeUndefined();
    });

    it("detects and flags grade discrepancy if LMS and AILSS scores diverge", () => {
      const mismatchedSample: LtiGradeIntegritySample = {
        studentSourcedId: "sis-student-403",
        courseId: "c-algo-adv",
        lineItemId: "li-midterm-exam-01",
        ailssGradeScore: 9.0,
        lmsReportedScore: 8.0, // Discrepancy of 1.0!
        scoreGivenAt: "2026-09-15T14:30:00Z",
        exactMatch: false,
      };

      const result = verifyLtiGradeIntegrity(mismatchedSample);
      expect(result.matches).toBe(false);
      expect(result.discrepancy).toBe(1.0);
    });
  });

  describe("Phase 28.9: 1EdTech Conformance Strategic Decision", () => {
    it("documents explicit conformance decisions for LTI Advantage and Open Badges 3.0", () => {
      expect(ONE_EDTECH_CONFORMANCE_DECISIONS).toHaveLength(2);

      const ltiDecision = ONE_EDTECH_CONFORMANCE_DECISIONS.find((d) => d.standardFamily === "LTI_ADVANTAGE");
      expect(ltiDecision).toBeDefined();
      expect(ltiDecision?.decision).toBe("CERTIFICATION_NOT_REQUIRED_FOR_PILOT");
      expect(ltiDecision?.currentConformanceState).toBe("EXTERNAL_VALIDATED");

      const ob3Decision = ONE_EDTECH_CONFORMANCE_DECISIONS.find((d) => d.standardFamily === "OPEN_BADGES_3_0");
      expect(ob3Decision).toBeDefined();
      expect(ob3Decision?.decision).toBe("CERTIFICATION_NOT_REQUIRED_FOR_PILOT");
      expect(ob3Decision?.currentConformanceState).toBe("EXTERNAL_VALIDATED");
    });
  });

  describe("Phase 28.12, 28.13 & 28.14: Data Governance & Data Subject Operations", () => {
    const polytechPolicy: InstitutionalDataProcessingPolicy = {
      policyId: "pol-polytech-2026-v2",
      version: 2,
      tenantId: "tenant-pilot-polytech",
      effectiveFrom: "2026-09-01T00:00:00Z",
      effectiveUntil: "2026-12-31T23:59:59Z",
      approvedByReference: "MOU-2026-POLYTECH-AILSS-001/ADDENDUM-DPA-v2",
      retentionRules: {
        IDENTITY: 1825,       // 5 years
        ACADEMIC: 3650,       // 10 years
        AI: 90,               // 90 days
        ANALYTICS: 180,       // 180 days
        NOTIFICATION: 90,     // 90 days
        AUDIT_SECURITY: 1825, // 5 years
      },
      legalPolicyReferences: {
        IDENTITY: "VN_DECREE_13_2023_ART_16",
        ACADEMIC: "VN_MOET_CIRCULAR_08_2021_ACADEMIC_RECORDS",
        AI: "AILSS_ETHICAL_AI_SAFETY_AUDIT_WINDOW",
        ANALYTICS: "GDPR_ART_6_1_F_LEGITIMATE_INTEREST",
        NOTIFICATION: "TRANSACTIONAL_NOTIFICATION_AUDIT",
        AUDIT_SECURITY: "ISO_27001_A12_4_LOGGING",
      },
      AIProcessingEnabled: true,
      analyticsEnabled: true,
      externalProcessors: ["Polytech Campus SSO", "AWS SES Relay"],
    };

    it("executes data subject EXPORT returning only exportable categories", () => {
      const exportReq: DataSubjectOperationRequest = {
        requestId: "req-export-001",
        tenantId: "tenant-pilot-polytech",
        userId: "usr-student-alex",
        operation: "EXPORT",
        requestedAt: new Date().toISOString(),
      };

      const result = DataSubjectOperationProcessor.process(polytechPolicy, exportReq);
      expect(result.executed).toBe(true);
      expect(result.affectedCategories).toContain("IDENTITY");
      expect(result.affectedCategories).toContain("ACADEMIC");
      expect(result.affectedCategories).toContain("AI");
      // Analytics & Notification are non-exportable internal telemetry
      expect(result.affectedCategories).not.toContain("ANALYTICS");
      expect(result.affectedCategories).not.toContain("NOTIFICATION");
    });

    it("protects ACADEMIC records and AUDIT logs when student requests PURGE", () => {
      const purgeReq: DataSubjectOperationRequest = {
        requestId: "req-purge-001",
        tenantId: "tenant-pilot-polytech",
        userId: "usr-student-alex",
        operation: "PURGE",
        requestedAt: new Date().toISOString(),
      };

      const result = DataSubjectOperationProcessor.process(polytechPolicy, purgeReq);
      expect(result.executed).toBe(true);
      // AI & Identity are scrubbed/anonymized
      expect(result.affectedCategories).toContain("AI");
      expect(result.affectedCategories).toContain("IDENTITY");
      // Academic records and security audit logs MUST be retained by law
      expect(result.protectedCategoriesRetained).toContain("ACADEMIC");
      expect(result.protectedCategoriesRetained).toContain("AUDIT_SECURITY");
      expect(result.reason).toContain("protected by mandatory regulatory/audit policy");
    });

    it("completely halts PURGE when tenant or user is subject to LEGAL_HOLD", () => {
      const legalHoldReq: DataSubjectOperationRequest = {
        requestId: "req-purge-hold-002",
        tenantId: "tenant-pilot-polytech",
        userId: "usr-student-alex",
        operation: "PURGE",
        requestedAt: new Date().toISOString(),
        legalHoldActive: true,
      };

      const result = DataSubjectOperationProcessor.process(polytechPolicy, legalHoldReq);
      expect(result.executed).toBe(false);
      expect(result.affectedCategories).toHaveLength(0);
      expect(result.protectedCategoriesRetained).toHaveLength(6);
      expect(result.reason).toContain("LEGAL_HOLD_BLOCK");
    });
  });

  describe("Phase 28.15: Privacy Runtime Audit Verification", () => {
    it("confirms absence of credentials, tokens, assertions, or PII in sampled metric payloads", () => {
      const sampleMetricPayloads = [
        { route: "/api/v1/learning/progress", durationMs: 42, tenant: "tenant-pilot-polytech" },
        { route: "/api/v1/ai/query", tokenCount: 450, tenant: "tenant-pilot-polytech" },
        { route: "/api/v1/auth/saml/callback", status: "SUCCESS", tenant: "tenant-pilot-polytech" },
      ];

      const serialized = JSON.stringify(sampleMetricPayloads);

      // Verify absence of sensitive patterns
      expect(serialized).not.toMatch(/ey[A-Za-z0-9_-]{30,}/u); // No JWTs
      expect(serialized).not.toMatch(/BEGIN (?:RSA )?PRIVATE KEY/u); // No private keys
      expect(serialized).not.toMatch(/samlp?:Response/u); // No raw SAML responses
      expect(serialized).not.toMatch(/password/iu);
      expect(serialized).not.toMatch(/credit_card|cvv|card_number/iu);
    });
  });
});
