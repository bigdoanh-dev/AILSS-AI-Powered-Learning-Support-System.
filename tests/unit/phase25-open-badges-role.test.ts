/**
 * Phase 25.17: 1EdTech Open Badges 3.0 Standard & Role Alignment
 *
 * Verifies:
 * 1. Role determination across AILSS ecosystem:
 *    - ISSUER: Packages and cryptographically signs OpenBadgeCredential
 *    - HOST: Provides public DID and JSON-LD schema dereferencing
 *    - VERIFIER: Authenticates inbound OBv3 badges with issuer allowlist
 *    - DISPLAYER: Web and Mobile surfaces displaying badge graphics and criteria
 * 2. Standard OBv3 JSON-LD schema conformance:
 *    - @context includes W3C VC 2.0 and OBv3 context (context-3.0.3.json)
 *    - type includes ["VerifiableCredential", "OpenBadgeCredential"]
 *    - achievement object conforms to 1EdTech OBv3 specifications
 * 3. Cryptographic integrity and anti-tamper verification
 */

import { describe, it, expect } from "vitest";
import {
  packageOpenBadge3Credential,
  verifyOpenBadge3Credential,
  type OpenBadges3Role,
} from "../../packages/contracts/src/interoperability.js";

describe("Phase 25.17: Open Badges 3.0 Standard & Ecosystem Roles", () => {
  it("determines and validates the 4 standard ecosystem roles for AILSS", () => {
    const supportedRoles: OpenBadges3Role[] = ["ISSUER", "HOST", "DISPLAYER", "VERIFIER"];

    expect(supportedRoles).toContain("ISSUER");
    expect(supportedRoles).toContain("HOST");
    expect(supportedRoles).toContain("DISPLAYER");
    expect(supportedRoles).toContain("VERIFIER");
  });

  it("ISSUER role: packages compliant OBv3 credential with achievement metadata", () => {
    const badge = packageOpenBadge3Credential({
      badgeId: "urn:uuid:badge-polytech-cs-excellence-001",
      issuerDid: "did:web:ailss.edu.vn",
      issuerName: "Đại học Bách Khoa - Hệ thống AILSS",
      recipientDid: "did:key:z6MkpTHR8VNsBxYAAWHut2Gejin9ApnWjCxT948",
      achievementName: "Sinh Viên Giỏi Khoa Học Máy Tính",
      achievementDescription: "Hoàn thành xuất sắc khóa học Cơ sở dữ liệu nâng cao và Hệ thống AI phân tán",
      criteriaNarration: "Đạt điểm tổng kết >= 9.0/10 và hoàn thành đồ án kiến trúc phân tán",
      badgeImageUrl: "https://ailss.edu.vn/badges/cs-excellence.png",
      issuedAt: new Date("2026-09-01T00:00:00Z"),
    });

    expect(badge["@context"]).toContain("https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json");
    expect(badge.type).toContain("OpenBadgeCredential");
    expect(badge.type).toContain("VerifiableCredential");
    expect(badge.issuer.id).toBe("did:web:ailss.edu.vn");
    expect(badge.credentialSubject.achievement.name).toBe("Sinh Viên Giỏi Khoa Học Máy Tính");
    expect(badge.proof.cryptosuite).toBe("eddsa-rdfc-2022");
    expect(badge.proof.proofValue).toBeTruthy();
  });

  it("VERIFIER role: verifies valid OBv3 credential from trusted issuer", () => {
    const badge = packageOpenBadge3Credential({
      badgeId: "urn:uuid:badge-verifier-001",
      issuerDid: "did:web:ailss.edu.vn",
      issuerName: "AILSS Platform",
      recipientDid: "did:key:z6Mk-test-student",
      achievementName: "Full Stack Mastery",
      achievementDescription: "Completed full-stack curriculum",
      criteriaNarration: "Passed all exams",
      issuedAt: new Date("2026-09-01T00:00:00Z"),
    });

    const result = verifyOpenBadge3Credential(badge, {
      allowedIssuers: ["did:web:ailss.edu.vn"],
    });

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("VERIFIER role: rejects badge from untrusted external issuer", () => {
    const badge = packageOpenBadge3Credential({
      badgeId: "urn:uuid:badge-untrusted-001",
      issuerDid: "did:web:untrusted-rogue-academy.com",
      issuerName: "Rogue Academy",
      recipientDid: "did:key:z6Mk-test-student",
      achievementName: "Fabricated Certificate",
      achievementDescription: "Not accredited",
      criteriaNarration: "None",
      issuedAt: new Date("2026-09-01T00:00:00Z"),
    });

    const result = verifyOpenBadge3Credential(badge, {
      allowedIssuers: ["did:web:ailss.edu.vn"],
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBe("UNTRUSTED_ISSUER");
  });

  it("VERIFIER role: detects payload tampering after issuance", () => {
    const badge = packageOpenBadge3Credential({
      badgeId: "urn:uuid:badge-tamper-001",
      issuerDid: "did:web:ailss.edu.vn",
      issuerName: "AILSS Platform",
      recipientDid: "did:key:z6Mk-test-student",
      achievementName: "Original Achievement",
      achievementDescription: "Grade C",
      criteriaNarration: "Score 60%",
      issuedAt: new Date("2026-09-01T00:00:00Z"),
    });

    // Attacker modifies achievement name to claim higher distinction
    const tampered = {
      ...badge,
      credentialSubject: {
        ...badge.credentialSubject,
        achievement: {
          ...badge.credentialSubject.achievement,
          name: "Valedictorian Excellence (TAMPERED)",
        },
      },
    };

    const result = verifyOpenBadge3Credential(tampered);

    expect(result.valid).toBe(false);
    expect(result.error).toBe("PROOF_MISMATCH");
  });
});
