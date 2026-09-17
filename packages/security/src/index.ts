import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  SignJWT,
  exportJWK,
  importPKCS8,
  importSPKI,
  jwtVerify,
  type JWTPayload,
  type JWK,
  type CryptoKey,
} from "jose";
import { z } from "zod";

const ED_ALGORITHM = "EdDSA";

export interface JwtPolicy {
  readonly issuer: string;
  readonly audience: string;
  readonly kid: string;
  readonly clockToleranceSeconds?: number;
  readonly accessTokenTtlSeconds?: number;
}

export interface AccessTokenInput {
  readonly subject: string;
  readonly roles: readonly string[];
  readonly sessionId?: string;
  readonly tokenVersion: number;
}

export async function loadPrivateKey(path: string): Promise<CryptoKey> {
  return importPKCS8(await readFile(path, "utf8"), ED_ALGORITHM);
}

export async function loadPublicKey(path: string): Promise<CryptoKey> {
  return importSPKI(await readFile(path, "utf8"), ED_ALGORITHM);
}

export async function signAccessToken(
  key: CryptoKey,
  policy: JwtPolicy,
  input: AccessTokenInput,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  return new SignJWT({ roles: input.roles, sessionId: input.sessionId, tokenVersion: input.tokenVersion })
    .setProtectedHeader({ alg: ED_ALGORITHM, kid: policy.kid, typ: "JWT" })
    .setIssuer(policy.issuer)
    .setAudience(policy.audience)
    .setSubject(input.subject)
    .setIssuedAt(now)
    .setExpirationTime(now + (policy.accessTokenTtlSeconds ?? 15 * 60))
    .setJti(randomUUID())
    .sign(key);
}

export async function verifyJwt(token: string, key: CryptoKey, policy: JwtPolicy): Promise<JWTPayload> {
  const result = await jwtVerify(token, key, {
    algorithms: [ED_ALGORITHM],
    issuer: policy.issuer,
    audience: policy.audience,
    clockTolerance: policy.clockToleranceSeconds ?? 60,
    requiredClaims: ["sub", "iat", "exp", "jti"],
  });
  if (result.protectedHeader.kid !== policy.kid) throw new Error("JWT_KID_REJECTED");
  return result.payload;
}

const accessTokenClaimsSchema = z.object({
  iss: z.string().min(1),
  aud: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  sub: z.string().uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string().uuid(),
  roles: z.array(z.string().min(1)).min(1).max(20),
  sessionId: z.string().uuid(),
  tokenVersion: z.number().int().nonnegative(),
});

export interface VerifiedAccessToken {
  readonly userId: string;
  readonly roles: readonly string[];
  readonly sessionId: string;
  readonly tokenVersion: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly jti: string;
}

export async function verifyAccessToken(
  token: string,
  key: CryptoKey,
  policy: JwtPolicy,
): Promise<VerifiedAccessToken> {
  const result = await jwtVerify(token, key, {
    algorithms: [ED_ALGORITHM],
    issuer: policy.issuer,
    audience: policy.audience,
    clockTolerance: policy.clockToleranceSeconds ?? 60,
    requiredClaims: ["sub", "iat", "exp", "jti", "roles", "sessionId", "tokenVersion"],
  });
  if (
    result.protectedHeader.alg !== ED_ALGORITHM ||
    result.protectedHeader.kid !== policy.kid ||
    result.protectedHeader.typ !== "JWT"
  ) {
    throw new Error("ACCESS_TOKEN_HEADER_REJECTED");
  }
  const claims = accessTokenClaimsSchema.parse(result.payload);
  return {
    userId: claims.sub,
    roles: claims.roles,
    sessionId: claims.sessionId,
    tokenVersion: claims.tokenVersion,
    issuedAt: claims.iat,
    expiresAt: claims.exp,
    jti: claims.jti,
  };
}

export async function publicJwk(publicKey: CryptoKey, kid: string): Promise<JWK> {
  return { ...(await exportJWK(publicKey)), use: "sig", alg: ED_ALGORITHM, kid };
}

export interface ServiceTokenInput {
  readonly issuer: string;
  readonly serviceId: string;
  readonly audience: string;
  readonly purpose: string;
  readonly kid: string;
  readonly ttlSeconds?: number;
}

export async function signServiceToken(key: CryptoKey, input: ServiceTokenInput): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.min(input.ttlSeconds ?? 60, 60);
  return new SignJWT({ purpose: input.purpose })
    .setProtectedHeader({ alg: ED_ALGORITHM, kid: input.kid, typ: "service+jwt" })
    .setIssuer(input.issuer)
    .setSubject(input.serviceId)
    .setAudience(input.audience)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .setJti(randomUUID())
    .sign(key);
}

export async function verifyServiceToken(
  token: string,
  key: CryptoKey,
  expected: {
    readonly issuer: string;
    readonly audience: string;
    readonly purpose: string;
    readonly kid: string;
  },
): Promise<JWTPayload> {
  const result = await jwtVerify(token, key, {
    algorithms: [ED_ALGORITHM],
    issuer: expected.issuer,
    audience: expected.audience,
    requiredClaims: ["sub", "purpose", "iat", "exp", "jti"],
    clockTolerance: 5,
  });
  if (
    result.protectedHeader.alg !== ED_ALGORITHM ||
    result.protectedHeader.kid !== expected.kid ||
    result.protectedHeader.typ !== "service+jwt" ||
    result.payload.purpose !== expected.purpose ||
    !z.string().uuid().safeParse(result.payload.jti).success
  ) {
    throw new Error("SERVICE_TOKEN_POLICY_REJECTED");
  }
  const issuedAt = result.payload.iat;
  const expiresAt = result.payload.exp;
  if (
    issuedAt === undefined ||
    expiresAt === undefined ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > 60 ||
    issuedAt > Math.floor(Date.now() / 1_000) + 5
  ) {
    throw new Error("SERVICE_TOKEN_TTL_REJECTED");
  }
  return result.payload;
}

export const stepUpActionSchema = z.enum([
  "COURSE_PUBLISH",
  "COURSE_ARCHIVE",
  "INTERACTION_REPORT_MODERATE",
  "LECTURER_APPLICATION_APPROVE",
  "LECTURER_APPLICATION_REJECT",
  "ADMIN_USER_STATUS_CHANGE",
  "ADMIN_LECTURER_VERIFY",
]);
export type StepUpAction = z.infer<typeof stepUpActionSchema>;
export const stepUpResourceTypeSchema = z.enum(["COURSE", "REPORT", "LECTURER_APPLICATION", "USER"]);
export type StepUpResourceType = z.infer<typeof stepUpResourceTypeSchema>;

export interface StepUpProofInput {
  readonly adminUserId: string;
  readonly sessionId: string;
  readonly tokenVersion: number;
  readonly action: StepUpAction;
  readonly resourceType: StepUpResourceType;
  readonly resourceId: string;
}

const stepUpProofSchema = z.object({
  iss: z.string().min(1),
  aud: z.union([z.string(), z.array(z.string())]),
  sub: z.string().uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string().uuid(),
  sessionId: z.string().uuid(),
  tokenVersion: z.number().int().nonnegative(),
  action: stepUpActionSchema,
  resourceType: stepUpResourceTypeSchema,
  resourceId: z.string().uuid(),
  authMethod: z.literal("PASSWORD_REAUTH"),
});
export type StepUpProof = z.infer<typeof stepUpProofSchema>;

export async function signStepUpProof(
  key: CryptoKey,
  kid: string,
  issuer: string,
  audience: string,
  input: StepUpProofInput,
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  return new SignJWT({
    sessionId: input.sessionId,
    tokenVersion: input.tokenVersion,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    authMethod: "PASSWORD_REAUTH",
  })
    .setProtectedHeader({ alg: ED_ALGORITHM, kid, typ: "step-up+jwt" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(input.adminUserId)
    .setIssuedAt(now)
    .setExpirationTime(now + 30)
    .setJti(randomUUID())
    .sign(key);
}

export async function verifyStepUpProof(
  token: string,
  key: CryptoKey,
  expected: {
    issuer: string;
    audience: string;
    kid: string;
    action: StepUpAction;
    resourceId: string;
    resourceType?: StepUpResourceType;
    adminUserId?: string;
  },
): Promise<StepUpProof> {
  const segments = token.split(".");
  if (
    segments.length !== 3 ||
    segments.some((segment) => Buffer.from(segment, "base64url").toString("base64url") !== segment)
  )
    throw new Error("STEP_UP_PROOF_ENCODING_REJECTED");
  const result = await jwtVerify(token, key, {
    algorithms: [ED_ALGORITHM],
    issuer: expected.issuer,
    audience: expected.audience,
    requiredClaims: [
      "sub",
      "iat",
      "exp",
      "jti",
      "sessionId",
      "tokenVersion",
      "action",
      "resourceType",
      "resourceId",
      "authMethod",
    ],
    clockTolerance: 5,
  });
  if (
    result.protectedHeader.alg !== ED_ALGORITHM ||
    result.protectedHeader.kid !== expected.kid ||
    result.protectedHeader.typ !== "step-up+jwt"
  )
    throw new Error("STEP_UP_PROOF_HEADER_REJECTED");
  const proof = stepUpProofSchema.parse(result.payload);
  if (
    proof.exp - proof.iat > 30 ||
    proof.exp <= proof.iat ||
    proof.action !== expected.action ||
    (expected.resourceType && proof.resourceType !== expected.resourceType) ||
    proof.resourceId !== expected.resourceId ||
    (expected.adminUserId && proof.sub !== expected.adminUserId)
  )
    throw new Error("STEP_UP_PROOF_POLICY_REJECTED");
  return proof;
}

export const actorContextSchema = z
  .object({
    userId: z.string().uuid(),
    roles: z.array(z.string().min(1)).min(1).max(20),
    sessionId: z.string().uuid(),
    tokenVersion: z.number().int().nonnegative(),
    correlationId: z.string().uuid(),
    issuedAt: z.number().int(),
    expiresAt: z.number().int(),
  })
  .refine((value) => value.expiresAt > value.issuedAt && value.expiresAt - value.issuedAt <= 60, {
    message: "Actor context lifetime must be positive and at most 60 seconds",
  });

export type ActorContext = z.infer<typeof actorContextSchema>;

export async function signActorContext(
  key: CryptoKey,
  kid: string,
  issuer: string,
  audience: string,
  purpose: string,
  actor: ActorContext,
): Promise<string> {
  actorContextSchema.parse(actor);
  return new SignJWT({
    roles: actor.roles,
    sessionId: actor.sessionId,
    tokenVersion: actor.tokenVersion,
    correlationId: actor.correlationId,
    purpose,
  })
    .setProtectedHeader({ alg: ED_ALGORITHM, kid, typ: "actor-context+jwt" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(actor.userId)
    .setIssuedAt(actor.issuedAt)
    .setExpirationTime(actor.expiresAt)
    .setJti(randomUUID())
    .sign(key);
}

export async function verifyActorContext(
  token: string,
  key: CryptoKey,
  expected: {
    readonly issuer: string;
    readonly audience: string;
    readonly purpose: string;
    readonly kid: string;
    readonly clockToleranceSeconds?: number;
  },
): Promise<ActorContext> {
  const result = await jwtVerify(token, key, {
    algorithms: [ED_ALGORITHM],
    issuer: expected.issuer,
    audience: expected.audience,
    requiredClaims: [
      "sub",
      "roles",
      "sessionId",
      "tokenVersion",
      "correlationId",
      "purpose",
      "iat",
      "exp",
      "jti",
    ],
    clockTolerance: expected.clockToleranceSeconds ?? 5,
  });
  if (
    result.protectedHeader.alg !== ED_ALGORITHM ||
    result.protectedHeader.kid !== expected.kid ||
    result.protectedHeader.typ !== "actor-context+jwt" ||
    result.payload.purpose !== expected.purpose ||
    !z.string().uuid().safeParse(result.payload.jti).success
  ) {
    throw new Error("ACTOR_CONTEXT_POLICY_REJECTED");
  }
  const issuedAt = result.payload.iat;
  const expiresAt = result.payload.exp;
  if (
    issuedAt === undefined ||
    expiresAt === undefined ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > 60 ||
    issuedAt > Math.floor(Date.now() / 1_000) + (expected.clockToleranceSeconds ?? 5)
  ) {
    throw new Error("ACTOR_CONTEXT_TTL_REJECTED");
  }
  return actorContextSchema.parse({
    userId: result.payload.sub,
    roles: result.payload.roles,
    sessionId: result.payload.sessionId,
    tokenVersion: result.payload.tokenVersion,
    correlationId: result.payload.correlationId,
    issuedAt,
    expiresAt,
  });
}

export const presenceTicketActorKindSchema = z.enum(["STUDENT", "LECTURER"]);
export const presenceTicketSchema = z.object({
  iss: z.literal("classroom-service"),
  aud: z.union([z.literal("classroom-service"), z.array(z.literal("classroom-service")).min(1)]),
  sub: z.string().uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string().uuid(),
  sessionId: z.string().uuid(),
  actorKind: presenceTicketActorKindSchema,
  purpose: z.literal("CLASS_PRESENCE"),
  authSessionId: z.string().uuid(),
  tokenVersion: z.number().int().nonnegative(),
  roles: z.array(z.string().min(1)).min(1).max(20),
});
export type PresenceTicketClaims = z.infer<typeof presenceTicketSchema>;

export async function signPresenceTicket(
  key: CryptoKey,
  kid: string,
  input: Omit<PresenceTicketClaims, "iss" | "aud" | "iat" | "exp" | "jti" | "purpose"> & {
    readonly ttlSeconds?: number;
  },
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  const ttl = Math.min(Math.max(input.ttlSeconds ?? 30, 1), 30);
  return new SignJWT({
    sessionId: input.sessionId,
    actorKind: input.actorKind,
    purpose: "CLASS_PRESENCE",
    authSessionId: input.authSessionId,
    tokenVersion: input.tokenVersion,
    roles: input.roles,
  })
    .setProtectedHeader({ alg: ED_ALGORITHM, kid, typ: "presence+jwt" })
    .setIssuer("classroom-service")
    .setAudience("classroom-service")
    .setSubject(input.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .setJti(randomUUID())
    .sign(key);
}

export async function verifyPresenceTicket(
  token: string,
  key: CryptoKey,
  expected: { readonly kid: string; readonly sessionId?: string },
): Promise<PresenceTicketClaims> {
  const result = await jwtVerify(token, key, {
    algorithms: [ED_ALGORITHM],
    issuer: "classroom-service",
    audience: "classroom-service",
    requiredClaims: [
      "sub",
      "iat",
      "exp",
      "jti",
      "sessionId",
      "actorKind",
      "purpose",
      "authSessionId",
      "tokenVersion",
      "roles",
    ],
    clockTolerance: 5,
  });
  if (
    result.protectedHeader.alg !== ED_ALGORITHM ||
    result.protectedHeader.kid !== expected.kid ||
    result.protectedHeader.typ !== "presence+jwt"
  )
    throw new Error("PRESENCE_TICKET_HEADER_REJECTED");
  const claims = presenceTicketSchema.parse(result.payload);
  if (
    claims.exp <= claims.iat ||
    claims.exp - claims.iat > 30 ||
    claims.iat > Math.floor(Date.now() / 1_000) + 5 ||
    (expected.sessionId !== undefined && claims.sessionId !== expected.sessionId)
  )
    throw new Error("PRESENCE_TICKET_POLICY_REJECTED");
  return claims;
}

export * from "./social.js";
export * from "./scorm.js";
export * from "./secret-provider.js";
export * from "./oidc.js";
export * from "./retention.js";
export * from "./saml.js";

