import { describe, expect, it } from "vitest";
import {
  packageW3CVerifiableCredentialV3,
  verifyW3CCredentialV3,
  packageW3CVerifiableCredentialV2,
  verifyW3CCredentialV2,
  signCertificatePayload,
  setBitstringStatus,
  verifyBitstringStatusListEntry,
  type VerifiedCertificate,
  type BitstringStatusListEntry,
} from "../../packages/contracts/src/interoperability.js";

describe("Phase 24.14 & 24.15: W3C VC 2.0 Modernization & Bitstring Status List v1.0", () => {
  const signingKey = "institution-production-signing-key-eddsa-rdfc-2022";

  const sampleCert: VerifiedCertificate = {
    certificateId: "d6f512cb-2391-4965-b778-9588bf3a5d89",
    studentId: "student-vn-9901",
    courseId: "course-adv-cs-501",
    courseVersion: 3,
    organizationId: "polytech-hn",
    issuedAt: "2026-09-17T12:00:00.000Z",
    completionPercent: 100,
    grade: "A+",
    status: "ACTIVE",
    format: "AILSS_VC_V3",
    signature: "",
  };

  const activeCert: VerifiedCertificate = {
    ...sampleCert,
    signature: signCertificatePayload(sampleCert, signingKey),
  };

  it("packages and verifies modern W3C VC 2.0 with DataIntegrityProof and eddsa-rdfc-2022 cryptosuite", () => {
    const vc3 = packageW3CVerifiableCredentialV3(activeCert, {
      issuerName: "Hanoi University of Science and Technology (Polytech)",
    });

    expect(vc3["@context"]).toContain("https://www.w3.org/ns/credentials/v2");
    expect(vc3["@context"]).toContain("https://w3id.org/security/data-integrity/v1");
    expect(vc3.id).toBe(`urn:uuid:${activeCert.certificateId}`);
    expect(vc3.type).toContain("VerifiableCredential");
    expect(vc3.type).toContain("CourseCompletionCredential");
    expect(vc3.validFrom).toBe(activeCert.issuedAt);
    expect(vc3.format).toBe("AILSS_VC_V3");
    expect(vc3.issuer.id).toBe(`urn:ailss:org:${activeCert.organizationId}`);
    expect(vc3.issuer.name).toBe("Hanoi University of Science and Technology (Polytech)");

    expect(vc3.proof.type).toBe("DataIntegrityProof");
    expect(vc3.proof.cryptosuite).toBe("eddsa-rdfc-2022");
    expect(vc3.proof.proofPurpose).toBe("assertionMethod");
    expect(vc3.proof.verificationMethod).toBe(`urn:ailss:org:${activeCert.organizationId}#key-1`);
    expect(vc3.proof.proofValue).toBe(activeCert.signature);

    const isValid = verifyW3CCredentialV3(vc3, signingKey);
    expect(isValid).toBe(true);
  });

  it("rejects forged or modified claims in W3C VC 2.0", () => {
    const vc3 = packageW3CVerifiableCredentialV3(activeCert);

    // Tamper with completion grade
    const tamperedVc = {
      ...vc3,
      credentialSubject: {
        ...vc3.credentialSubject,
        grade: "B",
      },
    };

    const isValid = verifyW3CCredentialV3(tamperedVc, signingKey);
    expect(isValid).toBe(false);
  });

  it("packages and verifies W3C Bitstring Status List v1.0 credential revocation", () => {
    const statusListEntry: BitstringStatusListEntry = {
      id: `https://credentials.polytech.edu.vn/status/list-2026#42`,
      type: "BitstringStatusListEntry",
      statusPurpose: "revocation",
      statusListIndex: "42",
      statusListCredential: "https://credentials.polytech.edu.vn/status/list-2026",
    };

    const vcWithStatus = packageW3CVerifiableCredentialV3(activeCert, {
      statusListEntry,
    });

    expect(vcWithStatus.credentialStatus).toBeDefined();
    expect(vcWithStatus.credentialStatus?.type).toBe("BitstringStatusListEntry");
    expect(vcWithStatus.credentialStatus?.statusListIndex).toBe("42");
    expect(vcWithStatus.credentialStatus?.statusPurpose).toBe("revocation");

    if (!vcWithStatus.credentialStatus) {
      throw new Error("Expected credentialStatus to be present");
    }
    const statusEntry = vcWithStatus.credentialStatus;

    // Initialize 16-byte bitstring (128 bits capacity)
    const bitstring = new Uint8Array(16);

    // Initial state: index 42 is active (not revoked)
    const initialCheck = verifyBitstringStatusListEntry(statusEntry, bitstring);
    expect(initialCheck.valid).toBe(true);
    expect(initialCheck.revoked).toBe(false);

    // Mark index 42 as revoked
    setBitstringStatus(bitstring, 42, true);

    // Check after revocation
    const revokedCheck = verifyBitstringStatusListEntry(statusEntry, bitstring);
    expect(revokedCheck.valid).toBe(true);
    expect(revokedCheck.revoked).toBe(true);

    // Verify other indices remain unaffected
    const otherCheck = verifyBitstringStatusListEntry(
      { ...statusListEntry, statusListIndex: "43" },
      bitstring,
    );
    expect(otherCheck.revoked).toBe(false);
  });

  it("preserves backwards compatibility with legacy W3C VC V2 format", () => {
    const legacyCert: VerifiedCertificate = {
      ...activeCert,
      format: "AILSS_VC_V2",
    };

    const vc2 = packageW3CVerifiableCredentialV2(legacyCert);
    expect(vc2["@context"]).toContain("https://www.w3.org/2018/credentials/v1");
    expect(vc2.proof.type).toBe("JsonWebSignature2020");
    expect(vc2.format).toBe("AILSS_VC_V2");

    const isLegacyValid = verifyW3CCredentialV2(vc2, signingKey);
    expect(isLegacyValid).toBe(true);
  });
});
