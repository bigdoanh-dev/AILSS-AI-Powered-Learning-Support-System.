import { describe, expect, it } from "vitest";
import {
  mapLtiRoles,
  XAPI_VERBS,
  type LtiGradePassbackPayload,
  type XApiStatement,
} from "../../packages/contracts/src/interoperability.js";
import {
  CredentialService,
  InMemoryCredentialRepository,
} from "../../apps/learning-service/src/credentials/service.js";

describe("Phase 20D & 20E: Educational Interoperability & Verified Credentials", () => {
  const SECRET_KEY = "super-secure-production-credentials-key";

  describe("Verified Credentials Service", () => {
    it("issues, verifies, and detects tampered certificates", async () => {
      const repo = new InMemoryCredentialRepository();
      const service = new CredentialService({
        repository: repo,
        signingSecret: SECRET_KEY,
      });

      const studentId = "student-uuid-111";
      const courseId = "course-uuid-222";
      const orgId = "org-uuid-333";

      // 1. Issue certificate
      const cert = await service.issueCertificate({
        studentId,
        courseId,
        courseVersion: 2,
        organizationId: orgId,
        completionPercent: 100,
        grade: "EXCELLENT",
      });

      expect(cert.certificateId).toBeDefined();
      expect(cert.status).toBe("ACTIVE");
      expect(cert.signature).toBeDefined();

      // 2. Public verification succeeds
      const verifySuccess = await service.verifyCertificate(cert.certificateId);
      expect(verifySuccess.valid).toBe(true);
      expect(verifySuccess.status).toBe("ACTIVE");
      expect(verifySuccess.certificate?.grade).toBe("EXCELLENT");

      // 3. Tampered payload fails cryptographic check
      const tamperedRepo = new InMemoryCredentialRepository();
      const tamperedCert = { ...cert, grade: "DISTINCTION" }; // modified without resign
      await tamperedRepo.saveCertificate(tamperedCert);
      const tamperedService = new CredentialService({
        repository: tamperedRepo,
        signingSecret: SECRET_KEY,
      });

      const verifyTampered = await tamperedService.verifyCertificate(cert.certificateId);
      expect(verifyTampered.valid).toBe(false);
      expect(verifyTampered.status).toBe("INVALID_SIGNATURE");
    });

    it("rejects issuance if completion percent is below criteria (< 80%)", async () => {
      const repo = new InMemoryCredentialRepository();
      const service = new CredentialService({
        repository: repo,
        signingSecret: SECRET_KEY,
      });

      await expect(
        service.issueCertificate({
          studentId: "student-1",
          courseId: "course-1",
          courseVersion: 1,
          organizationId: "org-1",
          completionPercent: 75,
          grade: "INCOMPLETE",
        }),
      ).rejects.toThrowError(/CERTIFICATE_CRITERIA_NOT_MET/);
    });

    it("handles revocation lifecycle with audit reason and timestamp", async () => {
      const repo = new InMemoryCredentialRepository();
      const service = new CredentialService({
        repository: repo,
        signingSecret: SECRET_KEY,
      });

      const cert = await service.issueCertificate({
        studentId: "student-1",
        courseId: "course-1",
        courseVersion: 1,
        organizationId: "org-1",
        completionPercent: 95,
        grade: "VERY_GOOD",
      });

      const revoked = await service.revokeCertificate({
        certificateId: cert.certificateId,
        revokedBy: "admin-principal-99",
        reason: "Academic integrity investigation: Plagiarism confirmed in Capstone",
      });

      expect(revoked.status).toBe("REVOKED");
      expect(revoked.revocationReason).toContain("Plagiarism");
      expect(revoked.revokedAt).toBeDefined();

      // Public verification must report revoked
      const verification = await service.verifyCertificate(cert.certificateId);
      expect(verification.valid).toBe(false);
      expect(verification.status).toBe("REVOKED");
      expect(verification.reason).toContain("Plagiarism");
    });
  });

  describe("LTI 1.3 Advantage & xAPI Interoperability", () => {
    it("maps LTI 1.3 standard roles correctly", () => {
      expect(
        mapLtiRoles(["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"]),
      ).toBe("STUDENT");

      expect(
        mapLtiRoles([
          "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner",
          "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor",
        ]),
      ).toBe("LECTURER");

      expect(
        mapLtiRoles(["http://purl.imsglobal.org/vocab/lis/v2/membership#Administrator"]),
      ).toBe("INSTITUTION_ADMIN");
    });

    it("constructs compliant LTI 1.3 AGS Grade Passback payload", () => {
      const gradePayload: LtiGradePassbackPayload = {
        userId: "canvas-user-12345",
        scoreGiven: 9.5,
        scoreMaximum: 10.0,
        comment: "AI Quiz 3 passed with Bloom Level 5 mastery",
        timestamp: "2026-09-17T12:00:00Z",
        activityProgress: "Completed",
        gradingProgress: "FullyGraded",
      };

      expect(gradePayload.scoreGiven).toBe(9.5);
      expect(gradePayload.activityProgress).toBe("Completed");
    });

    it("generates compliant xAPI learning event statement", () => {
      const statement: XApiStatement = {
        id: "xapi-statement-uuid-1",
        actor: {
          mbox: "mailto:student@university.edu.vn",
        },
        verb: XAPI_VERBS.PASSED,
        object: {
          id: "https://ailss.edu.vn/courses/csdl-nang-cao/quizzes/quiz-1",
          definition: {
            name: { "vi-VN": "Bài kiểm tra Tối ưu hóa Truy vấn", "en-US": "Query Optimization Quiz" },
            type: "http://adlnet.gov/expapi/activities/assessment",
          },
        },
        result: {
          score: { scaled: 0.95, raw: 9.5, min: 0, max: 10 },
          success: true,
          completion: true,
        },
        timestamp: "2026-09-17T12:00:00Z",
        context: {
          extensions: {
            "https://ailss.edu.vn/xapi/ext/bloom-level": 5,
            "https://ailss.edu.vn/xapi/ext/tenant": "hcmut",
          },
        },
      };

      expect(statement.verb.id).toBe("http://adlnet.gov/expapi/verbs/passed");
      expect(statement.result?.success).toBe(true);
      expect(statement.context?.extensions?.["https://ailss.edu.vn/xapi/ext/bloom-level"]).toBe(5);
    });
  });
});
