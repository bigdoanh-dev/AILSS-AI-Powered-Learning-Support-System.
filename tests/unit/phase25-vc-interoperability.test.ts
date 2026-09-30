/**
 * Phase 25.16: W3C VC Independent Interoperability Verification
 *
 * Validates verifiable credential verification under adversarial conditions:
 * 1. Tampered subject — credential subject modified after signing
 * 2. Tampered issuer — issuer DID modified after signing
 * 3. Expired credential — validUntil in the past
 * 4. Revoked credential — statusListIndex marked revoked in bitstring
 * 5. Algorithm mismatch — wrong algorithm in proof block
 * 6. Valid credential round-trip — package → verify succeeds
 * 7. Issuer allowlist enforcement
 *
 * Uses Phase 25.16 DID-native API (packageVcInteropCredential / verifyVcInteropCredential)
 */

import { describe, it, expect } from "vitest";
import {
  packageVcInteropCredential,
  verifyVcInteropCredential,
  verifyBitstringStatusListByIndex,
  type VcInteropCredential,
} from "../../packages/contracts/src/interoperability.js";

describe("Phase 25.16: W3C VC Independent Interoperability", () => {
  // ── Fixture: valid VC ──────────────────────────────────────────────────────
  const validCredential = packageVcInteropCredential({
    credentialId: "urn:uuid:ailss-vc3-test-001",
    issuerDid: "did:web:ailss.edu.vn",
    subjectDid: "did:key:z6Mk-pilot-polytech-student-001",
    credentialData: {
      type: "CourseCompletion",
      courseId: "COURSE-CS101",
      completedAt: "2026-09-01T00:00:00Z",
      grade: "A",
      institution: "Đại học Bách Khoa",
    },
    issuedAt: new Date("2026-09-01T00:00:00Z"),
    expiresAt: new Date("2027-09-01T00:00:00Z"),
  });

  it("valid VC round-trip: packaged credential verifies successfully", () => {
    const result = verifyVcInteropCredential(validCredential, { allowedIssuers: ["did:web:ailss.edu.vn"] });
    expect(result.valid).toBe(true);
    expect(result.issuer).toBe("did:web:ailss.edu.vn");
    expect(result.subject).toBeTruthy();
  });

  it("tampered subject: modifying credentialSubject.id after packaging fails verification", () => {
    const tampered: VcInteropCredential = {
      ...validCredential,
      credentialSubject: {
        ...validCredential.credentialSubject,
        // Inject a different subject DID (adversarial substitution)
        id: "did:key:z6Mk-ATTACKER-substituted",
      },
    };

    const result = verifyVcInteropCredential(tampered, { allowedIssuers: ["did:web:ailss.edu.vn"] });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/PROOF_INVALID|SUBJECT_TAMPERED/iu);
  });

  it("tampered issuer: changing issuer DID to unlisted issuer fails verification", () => {
    const tampered: VcInteropCredential = {
      ...validCredential,
      issuer: "did:web:attacker.evil.com",
    };

    const result = verifyVcInteropCredential(tampered, { allowedIssuers: ["did:web:ailss.edu.vn"] });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/UNTRUSTED_ISSUER/iu);
  });

  it("expired credential: VC with validUntil in the past fails verification", () => {
    const expiredVc = packageVcInteropCredential({
      credentialId: "urn:uuid:expired-vc-001",
      issuerDid: "did:web:ailss.edu.vn",
      subjectDid: "did:key:z6Mk-student-expired",
      credentialData: { type: "CourseCompletion" },
      issuedAt: new Date("2025-01-01T00:00:00Z"),
      expiresAt: new Date("2025-06-01T00:00:00Z"), // in the past
    });

    const result = verifyVcInteropCredential(expiredVc, { allowedIssuers: ["did:web:ailss.edu.vn"] });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/EXPIRED/iu);
  });

  it("algorithm mismatch: VC with wrong cryptosuite fails verification", () => {
    const wrongAlgo: VcInteropCredential = {
      ...validCredential,
      proof: {
        ...validCredential.proof,
        cryptosuite: "ecdsa-rdfc-2022", // wrong — not what AILSS uses
      },
    };

    const result = verifyVcInteropCredential(wrongAlgo, { allowedIssuers: ["did:web:ailss.edu.vn"] });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/UNSUPPORTED_CRYPTOSUITE/iu);
  });

  // ── Bitstring Status List revocation ─────────────────────────────────────
  it("revoked credential: statusListIndex=0 with bit set returns revoked=true", () => {
    // 0x80 in base64url = bit 0 set (binary 10000000)
    const revokedBitstring = Buffer.from([0x80]).toString("base64url");

    const result = verifyBitstringStatusListByIndex({
      statusListIndex: 0,
      encodedList: revokedBitstring,
    });
    expect(result.revoked).toBe(true);
  });

  it("active credential: statusListIndex=0 with all-zero bitstring is not revoked", () => {
    const activeBitstring = Buffer.from([0x00, 0x00, 0x00]).toString("base64url");

    const result = verifyBitstringStatusListByIndex({
      statusListIndex: 0,
      encodedList: activeBitstring,
    });
    expect(result.revoked).toBe(false);
  });

  it("issuer allowlist enforced: VC from unlisted issuer rejected even if proof is internally valid", () => {
    const externalIssuerVc = packageVcInteropCredential({
      credentialId: "urn:uuid:external-issuer-vc",
      issuerDid: "did:web:foreign-university.edu",
      subjectDid: "did:key:z6Mk-foreign-student",
      credentialData: { type: "Degree" },
      issuedAt: new Date("2026-01-01T00:00:00Z"),
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    });

    // Verify only allowing AILSS issuers
    const result = verifyVcInteropCredential(externalIssuerVc, {
      allowedIssuers: ["did:web:ailss.edu.vn"],
    });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/UNTRUSTED_ISSUER/iu);
  });

  it("bit granularity: revocation at index 9 does not affect index 8", () => {
    // Index 9 is the second bit of the second byte (bit 6 of byte 1)
    // Byte 0: 0x00 (bits 0-7 all clear)
    // Byte 1: 0x40 (bit 9 = bit 6 of byte 1 = 0x40)
    const bitstring = Buffer.from([0x00, 0x40]).toString("base64url");

    const idx8 = verifyBitstringStatusListByIndex({ statusListIndex: 8, encodedList: bitstring });
    const idx9 = verifyBitstringStatusListByIndex({ statusListIndex: 9, encodedList: bitstring });

    expect(idx8.revoked).toBe(false);
    expect(idx9.revoked).toBe(true);
  });
});
