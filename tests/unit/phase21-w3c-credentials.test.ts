import { describe, expect, it } from "vitest";
import { verifyW3CCredentialV2 } from "../../packages/contracts/src/interoperability.js";
import {
  CredentialService,
  InMemoryCredentialRepository,
} from "../../apps/learning-service/src/credentials/service.js";

describe("W3C Verifiable Credentials V2 Packaging & Standards (P1)", () => {
  const signingSecret = "super-secret-w3c-vc-key-phase21";

  it("distinguishes AILSS_CREDENTIAL_V1 and AILSS_VC_V2 packaging formats", async () => {
    const repo = new InMemoryCredentialRepository();
    const service = new CredentialService({ repository: repo, signingSecret });

    const cert = await service.issueCertificate({
      studentId: "student-w3c-001",
      courseId: "course-adv-db",
      courseVersion: 3,
      organizationId: "org-hcmut",
      completionPercent: 100,
      grade: "A+",
    });

    // Default legacy format is AILSS_CREDENTIAL_V1
    expect(cert.format).toBe("AILSS_CREDENTIAL_V1");

    // Export as V1
    const v1 = await service.exportCredential(cert.certificateId, "AILSS_CREDENTIAL_V1");
    expect("format" in v1 && v1.format).toBe("AILSS_CREDENTIAL_V1");

    // Export as W3C VC V2
    const v2 = await service.exportCredential(cert.certificateId, "AILSS_VC_V2");
    expect("format" in v2 && v2.format).toBe("AILSS_VC_V2");
    expect(v2).toHaveProperty("@context");
    expect(v2).toHaveProperty("credentialSubject");
    expect(v2).toHaveProperty("proof");
  });

  it("produces compliant W3C JSON-LD envelope with proof", async () => {
    const repo = new InMemoryCredentialRepository();
    const service = new CredentialService({ repository: repo, signingSecret });

    const vc = await service.issueW3CCredential({
      studentId: "student-w3c-002",
      courseId: "course-distributed-systems",
      courseVersion: 1,
      organizationId: "org-stanford",
      completionPercent: 92,
      grade: "A",
    });

    expect(vc.format).toBe("AILSS_VC_V2");
    expect(vc["@context"]).toContain("https://www.w3.org/2018/credentials/v1");
    expect(vc.id).toMatch(/^urn:uuid:[a-f0-9-]+$/u);
    expect(vc.type).toContain("VerifiableCredential");
    expect(vc.type).toContain("CourseCompletionCredential");
    expect(vc.issuer).toBe("urn:ailss:org:org-stanford");
    expect(vc.credentialSubject.id).toBe("urn:ailss:student:student-w3c-002");
    expect(vc.credentialSubject.studentId).toBe("student-w3c-002");
    expect(vc.credentialSubject.courseId).toBe("course-distributed-systems");
    expect(vc.credentialSubject.completionPercent).toBe(92);
    expect(vc.credentialSubject.grade).toBe("A");
    expect(vc.proof.type).toBe("JsonWebSignature2020");
    expect(vc.proof.proofPurpose).toBe("assertionMethod");
    expect(vc.proof.verificationMethod).toBe("urn:ailss:org:org-stanford#key-1");
    expect(vc.proof.jws).toBeDefined();

    // Verify cryptographic integrity
    expect(verifyW3CCredentialV2(vc, signingSecret)).toBe(true);

    // Verification through service
    const verifyResult = await service.verifyW3CCredential(vc);
    expect(verifyResult.valid).toBe(true);
    expect(verifyResult.status).toBe("ACTIVE");
  });

  it("rejects tampered W3C VC proofs", async () => {
    const repo = new InMemoryCredentialRepository();
    const service = new CredentialService({ repository: repo, signingSecret });

    const vc = await service.issueW3CCredential({
      studentId: "student-w3c-003",
      courseId: "course-security",
      courseVersion: 1,
      organizationId: "org-mit",
      completionPercent: 85,
      grade: "B+",
    });

    // Tamper with subject grade
    const tamperedVc = {
      ...vc,
      credentialSubject: {
        ...vc.credentialSubject,
        grade: "A+",
      },
    };

    expect(verifyW3CCredentialV2(tamperedVc, signingSecret)).toBe(false);

    const result = await service.verifyW3CCredential(tamperedVc);
    expect(result.valid).toBe(false);
    expect(result.status).toBe("INVALID_SIGNATURE");
  });
});
