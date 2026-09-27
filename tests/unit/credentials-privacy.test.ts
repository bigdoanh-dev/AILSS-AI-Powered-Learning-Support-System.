import { describe, expect, it } from "vitest";
import {
  CredentialService,
  InMemoryCredentialRepository,
} from "../../apps/learning-service/src/credentials/service.js";

describe("Phase 21.8: Verified Credentials Standards & Privacy Disclosure", () => {
  const signingSecret = "test-credential-hmac-secret-key-phase21";

  it("handles MINIMAL, STANDARD, and FULL privacy disclosure levels", async () => {
    const repo = new InMemoryCredentialRepository();
    const service = new CredentialService({ repository: repo, signingSecret });

    const issued = await service.issueCertificate({
      studentId: "student-private-12345",
      courseId: "course-adv-database",
      courseVersion: 2,
      organizationId: "org-hcmut",
      completionPercent: 95,
      grade: "EXCELLENT",
    });

    // 1. FULL Privacy Level (internal or authenticated student view)
    const full = await service.verifyCertificate(issued.certificateId, { privacyLevel: "FULL" });
    expect(full.valid).toBe(true);
    expect(full.privacyLevel).toBe("FULL");
    expect(full.certificate?.studentId).toBe("student-private-12345");
    expect(full.certificate?.completionPercent).toBe(95);
    expect(full.certificate?.grade).toBe("EXCELLENT");

    // 2. STANDARD Privacy Level (public employer verification)
    const standard = await service.verifyCertificate(issued.certificateId, { privacyLevel: "STANDARD" });
    expect(standard.valid).toBe(true);
    expect(standard.privacyLevel).toBe("STANDARD");
    expect(standard.certificate?.studentId).toBeUndefined(); // Redacted for student privacy
    expect(standard.certificate?.completionPercent).toBe(95);
    expect(standard.certificate?.grade).toBe("EXCELLENT");
    expect(standard.certificate?.courseId).toBe("course-adv-database");

    // 3. MINIMAL Privacy Level (zero-knowledge or minimal public check)
    const minimal = await service.verifyCertificate(issued.certificateId, { privacyLevel: "MINIMAL" });
    expect(minimal.valid).toBe(true);
    expect(minimal.privacyLevel).toBe("MINIMAL");
    expect(minimal.certificate?.studentId).toBeUndefined();
    expect(minimal.certificate?.completionPercent).toBeUndefined();
    expect(minimal.certificate?.grade).toBeUndefined();
    expect(minimal.certificate?.courseId).toBe("course-adv-database");
    expect(minimal.certificate?.status).toBe("ACTIVE");
  });

  it("redacts sensitive disciplinary reason during public / standard verification of revoked certificate", async () => {
    const repo = new InMemoryCredentialRepository();
    const service = new CredentialService({ repository: repo, signingSecret });

    const issued = await service.issueCertificate({
      studentId: "student-violator-999",
      courseId: "course-distributed-systems",
      courseVersion: 1,
      organizationId: "org-hcmut",
      completionPercent: 90,
      grade: "PASS",
    });

    await service.revokeCertificate({
      certificateId: issued.certificateId,
      revokedBy: "academic-affairs-officer",
      reason: "Cheating on final proctored exam and academic misconduct",
    });

    // Public verification (STANDARD level): must NOT leak disciplinary accusation
    const publicCheck = await service.verifyCertificate(issued.certificateId, { privacyLevel: "STANDARD" });
    expect(publicCheck.valid).toBe(false);
    expect(publicCheck.status).toBe("REVOKED");
    expect(publicCheck.reason).toBe("Certificate was revoked by issuer");
    expect(publicCheck.reason).not.toContain("Cheating");
    expect(publicCheck.reason).not.toContain("misconduct");
    expect(publicCheck.certificate?.studentId).toBeUndefined();

    // Internal verification (FULL level): authorized audit can view reason
    const internalCheck = await service.verifyCertificate(issued.certificateId, { privacyLevel: "FULL" });
    expect(internalCheck.valid).toBe(false);
    expect(internalCheck.status).toBe("REVOKED");
    expect(internalCheck.reason).toContain("Cheating on final proctored exam");
  });
});
