import { createHmac } from "node:crypto";

export type LtiRole = "STUDENT" | "LECTURER" | "INSTITUTION_ADMIN";

export interface LtiLaunchClaims {
  readonly iss: string;
  readonly sub: string;
  readonly aud: string | readonly string[];
  readonly exp: number;
  readonly iat: number;
  readonly nonce: string;
  readonly "https://purl.imsglobal.org/spec/lti/claim/deployment_id": string;
  readonly "https://purl.imsglobal.org/spec/lti/claim/target_link_uri": string;
  readonly "https://purl.imsglobal.org/spec/lti/claim/roles": readonly string[];
  readonly "https://purl.imsglobal.org/spec/lti/claim/context"?: {
    readonly id: string;
    readonly title?: string;
  };
  readonly "https://purl.imsglobal.org/spec/lti/claim/resource_link"?: {
    readonly id: string;
    readonly title?: string;
  };
  readonly "https://purl.imsglobal.org/spec/lti/claim/custom"?: Record<string, string>;
}

export function mapLtiRoles(roles: readonly string[]): LtiRole {
  for (const role of roles) {
    if (
      role.includes("http://purl.imsglobal.org/vocab/lis/v2/membership#Administrator") ||
      role.includes("Administrator")
    ) {
      // Must map to INSTITUTION_ADMIN, never global PLATFORM_ADMIN
      return "INSTITUTION_ADMIN";
    }
    if (
      role.includes("http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor") ||
      role.includes("http://purl.imsglobal.org/vocab/lis/v2/institution/person#Instructor") ||
      role.includes("Instructor")
    ) {
      return "LECTURER";
    }
  }
  return "STUDENT";
}

export interface LtiDeploymentConfig {
  readonly organizationId: string;
  readonly deploymentId: string;
  readonly clientId: string;
  readonly issuer: string;
  readonly authLoginUrl?: string;
  readonly authTokenUrl?: string;
  readonly jwksUrl?: string;
  readonly status: "ACTIVE" | "SUSPENDED";
}

export interface LtiLaunchValidationOptions {
  readonly claims: LtiLaunchClaims;
  readonly trustedDeployments: readonly LtiDeploymentConfig[];
  readonly expectedState?: string;
  readonly actualState?: string;
  readonly consumedNonces?: { has: (nonce: string) => boolean; add: (nonce: string) => void } | Set<string>;
  readonly currentTimeSeconds?: number;
}

export type LtiErrorCode =
  | "UNKNOWN_ISSUER"
  | "UNKNOWN_CLIENT_OR_DEPLOYMENT"
  | "DEPLOYMENT_INACTIVE"
  | "INVALID_STATE"
  | "REPLAYED_NONCE"
  | "TOKEN_EXPIRED";

export interface LtiLaunchValidationResult {
  readonly valid: boolean;
  readonly role?: LtiRole;
  readonly organizationId?: string;
  readonly deployment?: LtiDeploymentConfig;
  readonly error?: string;
  readonly errorCode?: LtiErrorCode;
}

export function validateLtiLaunch(options: LtiLaunchValidationOptions): LtiLaunchValidationResult {
  const { claims, trustedDeployments, expectedState, actualState, consumedNonces, currentTimeSeconds } = options;

  if (currentTimeSeconds !== undefined && claims.exp <= currentTimeSeconds) {
    return {
      valid: false,
      errorCode: "TOKEN_EXPIRED",
      error: `[TOKEN_EXPIRED] LTI launch token expired at ${String(claims.exp)}, current ${String(currentTimeSeconds)}`,
    };
  }

  if (expectedState !== undefined && actualState !== expectedState) {
    return {
      valid: false,
      errorCode: "INVALID_STATE",
      error: "[INVALID_STATE] State parameter mismatch in LTI launch verification",
    };
  }

  if (consumedNonces) {
    const hasNonce = "has" in consumedNonces ? consumedNonces.has(claims.nonce) : (consumedNonces as Set<string>).has(claims.nonce);
    if (hasNonce) {
      return {
        valid: false,
        errorCode: "REPLAYED_NONCE",
        error: `[REPLAYED_NONCE] Nonce ${claims.nonce} has already been consumed`,
      };
    }
  }

  const matchingIssuer = trustedDeployments.filter((d) => d.issuer === claims.iss);
  if (matchingIssuer.length === 0) {
    return {
      valid: false,
      errorCode: "UNKNOWN_ISSUER",
      error: `[UNKNOWN_ISSUER] Unrecognized LTI issuer: ${claims.iss}`,
    };
  }

  const deploymentId = claims["https://purl.imsglobal.org/spec/lti/claim/deployment_id"];
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];

  const matched = matchingIssuer.find(
    (d) => d.deploymentId === deploymentId && audiences.includes(d.clientId),
  );

  if (!matched) {
    return {
      valid: false,
      errorCode: "UNKNOWN_CLIENT_OR_DEPLOYMENT",
      error: `[UNKNOWN_CLIENT_OR_DEPLOYMENT] Deployment ${deploymentId} or client ID not registered for issuer ${claims.iss}`,
    };
  }

  if (matched.status !== "ACTIVE") {
    return {
      valid: false,
      errorCode: "DEPLOYMENT_INACTIVE",
      error: `[DEPLOYMENT_INACTIVE] LTI deployment ${deploymentId} is currently ${matched.status}`,
    };
  }

  const role = mapLtiRoles(claims["https://purl.imsglobal.org/spec/lti/claim/roles"]);

  if (consumedNonces) {
    if ("add" in consumedNonces) {
      consumedNonces.add(claims.nonce);
    }
  }

  return {
    valid: true,
    role,
    organizationId: matched.organizationId,
    deployment: matched,
  };
}

export interface LtiGradePassbackPayload {
  readonly userId: string;
  readonly scoreGiven: number;
  readonly scoreMaximum: number;
  readonly comment?: string;
  readonly timestamp: string;
  readonly activityProgress: "Initialized" | "Started" | "InProgress" | "Submitted" | "Completed";
  readonly gradingProgress: "FullyGraded" | "Pending" | "PendingManual" | "Failed" | "NotReady";
}

export interface XApiActor {
  readonly account?: {
    readonly homePage: string;
    readonly name: string;
  };
  readonly mbox?: string;
}

export interface XApiVerb {
  readonly id: string;
  readonly display: Record<string, string>;
}

export const XAPI_VERBS = {
  COMPLETED: {
    id: "http://adlnet.gov/expapi/verbs/completed",
    display: { "en-US": "completed", "vi-VN": "đã hoàn thành" },
  },
  PASSED: {
    id: "http://adlnet.gov/expapi/verbs/passed",
    display: { "en-US": "passed", "vi-VN": "đã vượt qua" },
  },
  FAILED: {
    id: "http://adlnet.gov/expapi/verbs/failed",
    display: { "en-US": "failed", "vi-VN": "không đạt" },
  },
  ATTEMPTED: {
    id: "http://adlnet.gov/expapi/verbs/attempted",
    display: { "en-US": "attempted", "vi-VN": "đã làm bài" },
  },
} as const;

export interface XApiStatement {
  readonly id: string;
  readonly actor: XApiActor;
  readonly verb: XApiVerb;
  readonly object: {
    readonly id: string;
    readonly definition: {
      readonly name: Record<string, string>;
      readonly type?: string;
    };
  };
  readonly result?: {
    readonly score?: {
      readonly scaled?: number;
      readonly raw?: number;
      readonly min?: number;
      readonly max?: number;
    };
    readonly success?: boolean;
    readonly completion?: boolean;
  };
  readonly timestamp: string;
  readonly context?: {
    readonly extensions?: Record<string, unknown>;
  };
}

export interface VerifiedCertificatePayload {
  readonly certificateId: string;
  readonly studentId: string;
  readonly courseId: string;
  readonly courseVersion: number;
  readonly organizationId: string;
  readonly issuedAt: string;
  readonly completionPercent: number;
  readonly grade: string;
}

export type CredentialPackagingFormat =
  | "AILSS_CREDENTIAL_V1"
  | "AILSS_VC_V2_LEGACY"
  | "AILSS_VC_V2"
  | "AILSS_VC_V3";

export interface VerifiedCertificate extends VerifiedCertificatePayload {
  readonly status: "ACTIVE" | "REVOKED";
  readonly format?: CredentialPackagingFormat;
  readonly revokedAt?: string;
  readonly revokedBy?: string;
  readonly revocationReason?: string;
  readonly signature: string;
}

export interface W3CVerifiableCredentialV2 {
  readonly "@context": readonly string[];
  readonly id: string;
  readonly type: readonly string[];
  readonly issuer: string;
  readonly issuanceDate: string;
  readonly format: "AILSS_VC_V2";
  readonly credentialSubject: {
    readonly id: string;
    readonly studentId: string;
    readonly courseId: string;
    readonly courseVersion: number;
    readonly organizationId: string;
    readonly completionPercent: number;
    readonly grade: string;
  };
  readonly proof: {
    readonly type: string;
    readonly created: string;
    readonly proofPurpose: string;
    readonly verificationMethod: string;
    readonly jws: string;
  };
}

export function canonicalizeCertificatePayload(payload: VerifiedCertificatePayload): string {
  return [
    payload.certificateId,
    payload.studentId,
    payload.courseId,
    payload.courseVersion.toString(),
    payload.organizationId,
    payload.issuedAt,
    payload.completionPercent.toString(),
    payload.grade,
  ].join("|");
}

export function signCertificatePayload(
  payload: VerifiedCertificatePayload,
  signingKey: string,
): string {
  const canonical = canonicalizeCertificatePayload(payload);
  return createHmac("sha256", signingKey).update(canonical).digest("hex");
}

export function verifyCertificateSignature(
  payload: VerifiedCertificatePayload,
  signature: string,
  signingKey: string,
): boolean {
  const expected = signCertificatePayload(payload, signingKey);
  return expected === signature;
}

export function packageW3CVerifiableCredentialV2(
  cert: VerifiedCertificate,
): W3CVerifiableCredentialV2 {
  return {
    "@context": [
      "https://www.w3.org/2018/credentials/v1",
      "https://w3id.org/security/suites/ed25519-2020/v1",
    ],
    id: `urn:uuid:${cert.certificateId}`,
    type: ["VerifiableCredential", "CourseCompletionCredential"],
    issuer: `urn:ailss:org:${cert.organizationId}`,
    issuanceDate: cert.issuedAt,
    format: "AILSS_VC_V2",
    credentialSubject: {
      id: `urn:ailss:student:${cert.studentId}`,
      studentId: cert.studentId,
      courseId: cert.courseId,
      courseVersion: cert.courseVersion,
      organizationId: cert.organizationId,
      completionPercent: cert.completionPercent,
      grade: cert.grade,
    },
    proof: {
      type: "JsonWebSignature2020",
      created: cert.issuedAt,
      proofPurpose: "assertionMethod",
      verificationMethod: `urn:ailss:org:${cert.organizationId}#key-1`,
      jws: cert.signature,
    },
  };
}

export function verifyW3CCredentialV2(
  vc: W3CVerifiableCredentialV2,
  signingKey: string,
): boolean {
  const certificateId = vc.id.replace(/^urn:uuid:/iu, "");
  const payload: VerifiedCertificatePayload = {
    certificateId,
    studentId: vc.credentialSubject.studentId,
    courseId: vc.credentialSubject.courseId,
    courseVersion: vc.credentialSubject.courseVersion,
    organizationId: vc.credentialSubject.organizationId,
    issuedAt: vc.issuanceDate,
    completionPercent: vc.credentialSubject.completionPercent,
    grade: vc.credentialSubject.grade,
  };
  return verifyCertificateSignature(payload, vc.proof.jws, signingKey);
}

// --- W3C Verifiable Credentials 2.0 Recommendation (Data Integrity Proof with eddsa-rdfc-2022) ---

export interface W3CVerifiableCredentialV3 {
  readonly "@context": readonly string[];
  readonly id: string;
  readonly type: readonly string[];
  readonly issuer: {
    readonly id: string;
    readonly name?: string;
  };
  readonly validFrom: string; // W3C VC 2.0 replacing issuanceDate
  readonly format: "AILSS_VC_V3";
  readonly credentialSubject: {
    readonly id: string;
    readonly studentId: string;
    readonly courseId: string;
    readonly courseVersion: number;
    readonly organizationId: string;
    readonly completionPercent: number;
    readonly grade: string;
  };
  readonly credentialStatus?: {
    readonly id: string;
    readonly type: "BitstringStatusListEntry";
    readonly statusPurpose: "revocation" | "suspension";
    readonly statusListIndex: string;
    readonly statusListCredential: string;
  };
  readonly proof: {
    readonly type: "DataIntegrityProof";
    readonly cryptosuite: "eddsa-rdfc-2022";
    readonly created: string;
    readonly proofPurpose: "assertionMethod";
    readonly verificationMethod: string;
    readonly proofValue: string;
  };
}

export function packageW3CVerifiableCredentialV3(
  cert: VerifiedCertificate,
  options?: {
    readonly statusListEntry?: BitstringStatusListEntry;
    readonly issuerName?: string;
  },
): W3CVerifiableCredentialV3 {
  const credentialStatus = options?.statusListEntry
    ? {
        id: options.statusListEntry.id,
        type: "BitstringStatusListEntry" as const,
        statusPurpose: options.statusListEntry.statusPurpose,
        statusListIndex: options.statusListEntry.statusListIndex,
        statusListCredential: options.statusListEntry.statusListCredential,
      }
    : undefined;

  return {
    "@context": [
      "https://www.w3.org/ns/credentials/v2",
      "https://w3id.org/security/data-integrity/v1",
    ],
    id: `urn:uuid:${cert.certificateId}`,
    type: ["VerifiableCredential", "CourseCompletionCredential"],
    issuer: {
      id: `urn:ailss:org:${cert.organizationId}`,
      name: options?.issuerName ?? `AILSS Organization ${cert.organizationId}`,
    },
    validFrom: cert.issuedAt,
    format: "AILSS_VC_V3",
    credentialSubject: {
      id: `urn:ailss:student:${cert.studentId}`,
      studentId: cert.studentId,
      courseId: cert.courseId,
      courseVersion: cert.courseVersion,
      organizationId: cert.organizationId,
      completionPercent: cert.completionPercent,
      grade: cert.grade,
    },
    ...(credentialStatus ? { credentialStatus } : {}),
    proof: {
      type: "DataIntegrityProof",
      cryptosuite: "eddsa-rdfc-2022",
      created: cert.issuedAt,
      proofPurpose: "assertionMethod",
      verificationMethod: `urn:ailss:org:${cert.organizationId}#key-1`,
      proofValue: cert.signature,
    },
  };
}

export function verifyW3CCredentialV3(
  vc: W3CVerifiableCredentialV3,
  signingKey: string,
): boolean {
  const certificateId = vc.id.replace(/^urn:uuid:/iu, "");
  const payload: VerifiedCertificatePayload = {
    certificateId,
    studentId: vc.credentialSubject.studentId,
    courseId: vc.credentialSubject.courseId,
    courseVersion: vc.credentialSubject.courseVersion,
    organizationId: vc.credentialSubject.organizationId,
    issuedAt: vc.validFrom,
    completionPercent: vc.credentialSubject.completionPercent,
    grade: vc.credentialSubject.grade,
  };
  return verifyCertificateSignature(payload, vc.proof.proofValue, signingKey);
}

// --- LTI 1.3 Advantage Extensions ---

export interface LtiContentItem {
  readonly type: "ltiResourceLink";
  readonly title: string;
  readonly text?: string;
  readonly url: string;
  readonly custom?: Record<string, string>;
  readonly lineItem?: {
    readonly scoreMaximum: number;
    readonly label: string;
    readonly resourceId?: string;
  };
}

export interface LtiDeepLinkingResponse {
  readonly "https://purl.imsglobal.org/spec/lti-dl/claim/content_items": readonly LtiContentItem[];
  readonly "https://purl.imsglobal.org/spec/lti-dl/claim/data"?: string;
  readonly "https://purl.imsglobal.org/spec/lti-dl/claim/msg"?: string;
  readonly "https://purl.imsglobal.org/spec/lti-dl/claim/error_msg"?: string;
}

export interface LtiAgsScore {
  readonly userId: string;
  readonly scoreGiven: number;
  readonly scoreMaximum: number;
  readonly comment?: string;
  readonly timestamp: string;
  readonly activityProgress: "Initialized" | "Started" | "InProgress" | "Submitted" | "Completed";
  readonly gradingProgress: "FullyGraded" | "Pending" | "PendingManual" | "Failed" | "NotReady";
}

export interface LtiAgsLineItem {
  readonly id: string;
  readonly scoreMaximum: number;
  readonly label: string;
  readonly resourceId?: string;
  readonly tag?: string;
}

export interface LtiNrpsMember {
  readonly status: "Active" | "Inactive";
  readonly name?: string;
  readonly picture?: string;
  readonly given_name?: string;
  readonly family_name?: string;
  readonly email?: string;
  readonly user_id: string;
  readonly roles: readonly string[];
}

export interface LtiNrpsMembership {
  readonly id: string;
  readonly context: {
    readonly id: string;
    readonly label?: string;
    readonly title?: string;
  };
  readonly members: readonly LtiNrpsMember[];
}

// --- Bitstring Status List 2020 / StatusList2021 Portable Credential Revocation ---

export interface BitstringStatusListEntry {
  readonly id: string;
  readonly type: "BitstringStatusListEntry";
  readonly statusPurpose: "revocation" | "suspension";
  readonly statusListIndex: string; // decimal integer string
  readonly statusListCredential: string; // URL
}

/**
 * Checks whether an index is marked as revoked/suspended in a bitstring buffer.
 * Supports compact bit representation: 1 bit per credential.
 */
export function checkBitstringStatus(bitstring: Uint8Array, bitIndex: number): boolean {
  const byteIndex = Math.floor(bitIndex / 8);
  const bitOffset = 7 - (bitIndex % 8);
  if (byteIndex >= bitstring.length) return false;
  const targetByte = bitstring[byteIndex] ?? 0;
  return ((targetByte >> bitOffset) & 1) === 1;
}

/**
 * Sets the revocation/suspension status bit for a credential index in the bitstring.
 */
export function setBitstringStatus(bitstring: Uint8Array, bitIndex: number, status: boolean): void {
  const byteIndex = Math.floor(bitIndex / 8);
  const bitOffset = 7 - (bitIndex % 8);
  if (byteIndex >= bitstring.length) return;
  const currentByte = bitstring[byteIndex] ?? 0;
  if (status) {
    bitstring[byteIndex] = currentByte | (1 << bitOffset);
  } else {
    bitstring[byteIndex] = currentByte & ~(1 << bitOffset);
  }
}

/**
 * Verifies a W3C Bitstring Status List v1.0 entry against an unpacked status list bitstring.
 */
export function verifyBitstringStatusListEntry(
  entry: BitstringStatusListEntry,
  statusListBitstring: Uint8Array,
): { valid: boolean; revoked: boolean; index: number } {
  const index = parseInt(entry.statusListIndex, 10);
  if (Number.isNaN(index) || index < 0) {
    return { valid: false, revoked: false, index: -1 };
  }
  const isMarked = checkBitstringStatus(statusListBitstring, index);
  return {
    valid: true,
    revoked: isMarked,
    index,
  };
}


