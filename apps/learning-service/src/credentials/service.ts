import { randomUUID } from "node:crypto";
import { AppError } from "../../../../packages/http/src/index.js";
import {
  packageW3CVerifiableCredentialV2,
  signCertificatePayload,
  verifyCertificateSignature,
  verifyW3CCredentialV2,
  type CredentialPackagingFormat,
  type VerifiedCertificate,
  type VerifiedCertificatePayload,
  type W3CVerifiableCredentialV2,
} from "../../../../packages/contracts/src/interoperability.js";

export interface CredentialRepository {
  saveCertificate(cert: VerifiedCertificate): Promise<void>;
  findCertificateById(certificateId: string): Promise<VerifiedCertificate | null>;
  listCertificatesByStudent(studentId: string): Promise<readonly VerifiedCertificate[]>;
}

export class InMemoryCredentialRepository implements CredentialRepository {
  readonly #certs = new Map<string, VerifiedCertificate>();
  readonly #studentCerts = new Map<string, string[]>(); // studentId -> certificateIds

  public saveCertificate(cert: VerifiedCertificate): Promise<void> {
    this.#certs.set(cert.certificateId, cert);
    const list = this.#studentCerts.get(cert.studentId) ?? [];
    if (!list.includes(cert.certificateId)) {
      list.push(cert.certificateId);
      this.#studentCerts.set(cert.studentId, list);
    }
    return Promise.resolve();
  }

  public findCertificateById(certificateId: string): Promise<VerifiedCertificate | null> {
    return Promise.resolve(this.#certs.get(certificateId) ?? null);
  }

  public listCertificatesByStudent(studentId: string): Promise<readonly VerifiedCertificate[]> {
    const ids = this.#studentCerts.get(studentId) ?? [];
    const result: VerifiedCertificate[] = [];
    for (const id of ids) {
      const cert = this.#certs.get(id);
      if (cert) {
        result.push(cert);
      }
    }
    return Promise.resolve(result);
  }
}

export interface CredentialServiceOptions {
  readonly repository: CredentialRepository;
  readonly signingSecret: string;
  readonly now?: () => Date;
}

export type CredentialPrivacyLevel = "MINIMAL" | "STANDARD" | "FULL";

export interface VerifyCertificateResult {
  readonly valid: boolean;
  readonly status: "ACTIVE" | "REVOKED" | "INVALID_SIGNATURE" | "NOT_FOUND";
  readonly certificate?: Partial<VerifiedCertificate>;
  readonly reason?: string;
  readonly privacyLevel: CredentialPrivacyLevel;
}

export class CredentialService {
  readonly #repo: CredentialRepository;
  readonly #signingSecret: string;
  readonly #now: () => Date;

  public constructor(options: CredentialServiceOptions) {
    this.#repo = options.repository;
    this.#signingSecret = options.signingSecret;
    this.#now = options.now ?? (() => new Date());
  }

  public async issueCertificate(input: {
    readonly studentId: string;
    readonly courseId: string;
    readonly courseVersion: number;
    readonly organizationId: string;
    readonly completionPercent: number;
    readonly grade: string;
  }): Promise<VerifiedCertificate> {
    if (input.completionPercent < 80) {
      throw new AppError(
        "CERTIFICATE_CRITERIA_NOT_MET",
        400,
        `[CERTIFICATE_CRITERIA_NOT_MET] Completion percentage ${String(input.completionPercent)}% is below required threshold (80%)`,
      );
    }

    const certificateId = randomUUID();
    const issuedAt = this.#now().toISOString();

    const payload: VerifiedCertificatePayload = {
      certificateId,
      studentId: input.studentId,
      courseId: input.courseId,
      courseVersion: input.courseVersion,
      organizationId: input.organizationId,
      issuedAt,
      completionPercent: input.completionPercent,
      grade: input.grade,
    };

    const signature = signCertificatePayload(payload, this.#signingSecret);

    const certificate: VerifiedCertificate = {
      ...payload,
      status: "ACTIVE",
      format: "AILSS_CREDENTIAL_V1",
      signature,
    };

    await this.#repo.saveCertificate(certificate);
    return certificate;
  }

  public async verifyCertificate(
    certificateId: string,
    options?: { readonly privacyLevel?: CredentialPrivacyLevel },
  ): Promise<VerifyCertificateResult> {
    const privacyLevel = options?.privacyLevel ?? "FULL";
    const cert = await this.#repo.findCertificateById(certificateId);
    if (!cert) {
      return { valid: false, status: "NOT_FOUND", reason: "Certificate ID does not exist", privacyLevel };
    }

    const payload: VerifiedCertificatePayload = {
      certificateId: cert.certificateId,
      studentId: cert.studentId,
      courseId: cert.courseId,
      courseVersion: cert.courseVersion,
      organizationId: cert.organizationId,
      issuedAt: cert.issuedAt,
      completionPercent: cert.completionPercent,
      grade: cert.grade,
    };

    const isValidSig = verifyCertificateSignature(payload, cert.signature, this.#signingSecret);
    if (!isValidSig) {
      return {
        valid: false,
        status: "INVALID_SIGNATURE",
        certificate: this.#filterByPrivacy(cert, privacyLevel),
        reason: "Cryptographic signature tampering detected",
        privacyLevel,
      };
    }

    if (cert.status === "REVOKED") {
      const reason =
        privacyLevel === "FULL"
          ? (cert.revocationReason ?? "Certificate was revoked by issuer")
          : "Certificate was revoked by issuer";

      return {
        valid: false,
        status: "REVOKED",
        certificate: this.#filterByPrivacy(cert, privacyLevel),
        reason,
        privacyLevel,
      };
    }

    return {
      valid: true,
      status: "ACTIVE",
      certificate: this.#filterByPrivacy(cert, privacyLevel),
      privacyLevel,
    };
  }

  #filterByPrivacy(cert: VerifiedCertificate, level: CredentialPrivacyLevel): Partial<VerifiedCertificate> {
    if (level === "FULL") {
      return cert;
    }
    if (level === "STANDARD") {
      return {
        certificateId: cert.certificateId,
        organizationId: cert.organizationId,
        courseId: cert.courseId,
        courseVersion: cert.courseVersion,
        issuedAt: cert.issuedAt,
        status: cert.status,
        completionPercent: cert.completionPercent,
        grade: cert.grade,
        signature: cert.signature,
      };
    }
    // MINIMAL
    return {
      certificateId: cert.certificateId,
      organizationId: cert.organizationId,
      courseId: cert.courseId,
      courseVersion: cert.courseVersion,
      issuedAt: cert.issuedAt,
      status: cert.status,
      signature: cert.signature,
    };
  }

  public async revokeCertificate(input: {
    readonly certificateId: string;
    readonly revokedBy: string;
    readonly reason: string;
  }): Promise<VerifiedCertificate> {
    const cert = await this.#repo.findCertificateById(input.certificateId);
    if (!cert) {
      throw new AppError("CERTIFICATE_NOT_FOUND", 404, `Certificate ${input.certificateId} not found`);
    }

    if (cert.status === "REVOKED") {
      return cert;
    }

    const updated: VerifiedCertificate = {
      ...cert,
      status: "REVOKED",
      revokedAt: this.#now().toISOString(),
      revokedBy: input.revokedBy,
      revocationReason: input.reason,
    };

    await this.#repo.saveCertificate(updated);
    return updated;
  }

  public async listStudentCertificates(studentId: string): Promise<readonly VerifiedCertificate[]> {
    return this.#repo.listCertificatesByStudent(studentId);
  }

  public async issueW3CCredential(input: {
    readonly studentId: string;
    readonly courseId: string;
    readonly courseVersion: number;
    readonly organizationId: string;
    readonly completionPercent: number;
    readonly grade: string;
  }): Promise<W3CVerifiableCredentialV2> {
    const cert = await this.issueCertificate(input);
    return packageW3CVerifiableCredentialV2(cert);
  }

  public async exportCredential(
    certificateId: string,
    format: CredentialPackagingFormat = "AILSS_CREDENTIAL_V1",
  ): Promise<VerifiedCertificate | W3CVerifiableCredentialV2> {
    const cert = await this.#repo.findCertificateById(certificateId);
    if (!cert) {
      throw new AppError("CERTIFICATE_NOT_FOUND", 404, `Certificate ${certificateId} not found`);
    }

    if (format === "AILSS_VC_V2") {
      return packageW3CVerifiableCredentialV2(cert);
    }
    return cert;
  }

  public verifyW3CCredential(
    vc: W3CVerifiableCredentialV2,
    options?: { readonly privacyLevel?: CredentialPrivacyLevel },
  ): Promise<VerifyCertificateResult> {
    const certificateId = vc.id.replace(/^urn:uuid:/iu, "");
    const isValidSig = verifyW3CCredentialV2(vc, this.#signingSecret);
    const privacyLevel = options?.privacyLevel ?? "FULL";

    if (!isValidSig) {
      return Promise.resolve({
        valid: false,
        status: "INVALID_SIGNATURE",
        reason: "Cryptographic signature tampering detected in W3C VC proof",
        privacyLevel,
      });
    }

    return this.verifyCertificate(certificateId, options);
  }
}
