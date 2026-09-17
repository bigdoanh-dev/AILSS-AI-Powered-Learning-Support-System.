import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  checkBitstringStatus,
  packageW3CVerifiableCredentialV2,
  setBitstringStatus,
  signCertificatePayload,
  verifyW3CCredentialV2,
  type LtiAgsScore,
  type LtiContentItem,
  type LtiDeepLinkingResponse,
  type LtiNrpsMembership,
  type VerifiedCertificate,
} from "../../packages/contracts/src/interoperability.js";

describe("Phase 23J-23M: Educational Standards Interoperability (LTI 1.3 Advantage & Portable VC Status)", () => {
  const signingKey = "credential-master-signing-key-32b!";

  describe("LTI 1.3 Advantage Extensions", () => {
    it("formats LTI Deep Linking 2.0 response", () => {
      const items: LtiContentItem[] = [
        {
          type: "ltiResourceLink",
          title: "Introduction to Databases - Lab 1",
          text: "Hands-on SQL practice in browser",
          url: "https://ailss.edu.vn/courses/cs101/labs/1",
          lineItem: {
            scoreMaximum: 100,
            label: "Lab 1 Score",
            resourceId: "lab-1",
          },
        },
      ];

      const response: LtiDeepLinkingResponse = {
        "https://purl.imsglobal.org/spec/lti-dl/claim/content_items": items,
        "https://purl.imsglobal.org/spec/lti-dl/claim/data": "opaque-lms-state",
      };

      expect(response["https://purl.imsglobal.org/spec/lti-dl/claim/content_items"]).toHaveLength(1);
      expect(response["https://purl.imsglobal.org/spec/lti-dl/claim/content_items"][0]?.lineItem?.scoreMaximum).toBe(100);
    });

    it("formats LTI AGS Score payload for grade passback", () => {
      const score: LtiAgsScore = {
        userId: "student-lti-123",
        scoreGiven: 88,
        scoreMaximum: 100,
        comment: "Excellent work on SQL joins",
        timestamp: new Date().toISOString(),
        activityProgress: "Completed",
        gradingProgress: "FullyGraded",
      };

      expect(score.scoreGiven).toBe(88);
      expect(score.activityProgress).toBe("Completed");
    });

    it("formats LTI NRPS Membership synchronization payload", () => {
      const nrps: LtiNrpsMembership = {
        id: "https://lms.polytech.edu.vn/api/lti/courses/10/memberships",
        context: {
          id: "course-10",
          title: "Advanced Databases",
        },
        members: [
          {
            user_id: "u-inst-1",
            status: "Active",
            roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"],
          },
          {
            user_id: "u-stud-1",
            status: "Active",
            roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"],
          },
        ],
      };

      expect(nrps.members).toHaveLength(2);
    });
  });

  describe("BitstringStatusList2020: Portable Credential Status Verification", () => {
    it("accurately sets and verifies revocation bits at various indices", () => {
      // 16 bytes = 128 credentials
      const bitstring = new Uint8Array(16);

      // Initially all clean (0)
      expect(checkBitstringStatus(bitstring, 0)).toBe(false);
      expect(checkBitstringStatus(bitstring, 7)).toBe(false);
      expect(checkBitstringStatus(bitstring, 15)).toBe(false);
      expect(checkBitstringStatus(bitstring, 127)).toBe(false);

      // Revoke credential at index 0 and index 15
      setBitstringStatus(bitstring, 0, true);
      setBitstringStatus(bitstring, 15, true);

      expect(checkBitstringStatus(bitstring, 0)).toBe(true);
      expect(checkBitstringStatus(bitstring, 1)).toBe(false);
      expect(checkBitstringStatus(bitstring, 15)).toBe(true);
      expect(checkBitstringStatus(bitstring, 14)).toBe(false);

      // Un-revoke (re-instate) index 0
      setBitstringStatus(bitstring, 0, false);
      expect(checkBitstringStatus(bitstring, 0)).toBe(false);
      expect(checkBitstringStatus(bitstring, 15)).toBe(true);
    });
  });

  describe("W3C Verifiable Credentials 2.0: Integrity & Tamper Detection", () => {
    it("packages and cryptographically validates valid W3C VC 2.0", () => {
      const certPayload = {
        certificateId: randomUUID(),
        studentId: randomUUID(),
        courseId: "course-cs301",
        courseVersion: 1,
        organizationId: "polytech-hcm",
        issuedAt: new Date().toISOString(),
        completionPercent: 100,
        grade: "EXCELLENT",
      };

      const signature = signCertificatePayload(certPayload, signingKey);
      const cert: VerifiedCertificate = {
        ...certPayload,
        status: "ACTIVE",
        signature,
      };

      const vc = packageW3CVerifiableCredentialV2(cert);
      expect(vc.format).toBe("AILSS_VC_V2");
      expect(vc.proof.verificationMethod).toContain("urn:ailss:org:polytech-hcm#key-1");

      const isValid = verifyW3CCredentialV2(vc, signingKey);
      expect(isValid).toBe(true);
    });

    it("detects tampered payload in W3C VC 2.0", () => {
      const certPayload = {
        certificateId: randomUUID(),
        studentId: randomUUID(),
        courseId: "course-cs301",
        courseVersion: 1,
        organizationId: "polytech-hcm",
        issuedAt: new Date().toISOString(),
        completionPercent: 85,
        grade: "GOOD",
      };

      const signature = signCertificatePayload(certPayload, signingKey);
      const cert: VerifiedCertificate = { ...certPayload, status: "ACTIVE", signature };
      const vc = packageW3CVerifiableCredentialV2(cert);

      // Tamper with grade: "GOOD" -> "EXCELLENT"
      const tamperedVc = {
        ...vc,
        credentialSubject: {
          ...vc.credentialSubject,
          grade: "EXCELLENT",
        },
      };

      const isValid = verifyW3CCredentialV2(tamperedVc, signingKey);
      expect(isValid).toBe(false);
    });
  });
});
