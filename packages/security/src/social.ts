import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

export type SocialProvider = "GOOGLE" | "APPLE";

export interface VerifiedSocialIdentity {
  readonly provider: SocialProvider;
  readonly providerSubject: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly displayName?: string;
  readonly givenName?: string;
  readonly familyName?: string;
  readonly isPrivateRelay?: boolean;
}

export interface SocialVerificationConfig {
  readonly googleClientIds: readonly string[];
  readonly appleClientIds: readonly string[];
  readonly clockToleranceSeconds?: number;
  readonly customGoogleJwks?: JWTVerifyGetKey;
  readonly customAppleJwks?: JWTVerifyGetKey;
}

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const APPLE_ISSUER = "https://appleid.apple.com";

let defaultGoogleJwks: JWTVerifyGetKey | null = null;
let defaultAppleJwks: JWTVerifyGetKey | null = null;

function isProviderNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? String(error.code) : "";
  if (
    ["ERR_JWKS_TIMEOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT"].includes(
      code,
    ) ||
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    (error instanceof TypeError && error.message === "fetch failed") ||
    /(?:Expected 200 OK|Failed to parse).*JSON Web Key Set HTTP response/.test(error.message)
  ) {
    return true;
  }
  return isProviderNetworkError(error.cause);
}

function getGoogleJwks(): JWTVerifyGetKey {
  if (!defaultGoogleJwks) {
    defaultGoogleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
  }
  return defaultGoogleJwks;
}

function getAppleJwks(): JWTVerifyGetKey {
  if (!defaultAppleJwks) {
    defaultAppleJwks = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"));
  }
  return defaultAppleJwks;
}

export class SocialAuthError extends Error {
  public constructor(
    public readonly code:
      | "INVALID_TOKEN"
      | "EXPIRED_TOKEN"
      | "UNTRUSTED_ISSUER"
      | "AUDIENCE_MISMATCH"
      | "PROVIDER_NOT_CONFIGURED"
      | "UNVERIFIED_EMAIL"
      | "MISSING_SUBJECT"
      | "NETWORK_ERROR",
    message: string,
  ) {
    super(message);
    this.name = "SocialAuthError";
  }
}

export async function verifyGoogleIdToken(
  token: string,
  config: SocialVerificationConfig,
): Promise<VerifiedSocialIdentity> {
  if (!config.googleClientIds.length)
    throw new SocialAuthError("PROVIDER_NOT_CONFIGURED", "Google sign-in is not configured");
  const getKey = config.customGoogleJwks ?? getGoogleJwks();
  let payload: JWTPayload;

  try {
    const result = await jwtVerify(token, getKey, {
      issuer: GOOGLE_ISSUERS,
      clockTolerance: config.clockToleranceSeconds ?? 5,
    });
    payload = result.payload;
  } catch (error: unknown) {
    if (isProviderNetworkError(error)) {
      throw new SocialAuthError("NETWORK_ERROR", "Google verification service is temporarily unavailable");
    }
    const msg = error instanceof Error ? error.message : "Token verification failed";
    if (/expired/i.test(msg)) throw new SocialAuthError("EXPIRED_TOKEN", "Google ID token has expired");
    if (/issuer/i.test(msg)) throw new SocialAuthError("UNTRUSTED_ISSUER", "Untrusted Google token issuer");
    throw new SocialAuthError("INVALID_TOKEN", `Invalid Google token: ${msg}`);
  }

  // Verify audience matches configured client IDs
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const matchedAud = config.googleClientIds.some((id) => aud.includes(id));
  if (!matchedAud) {
    throw new SocialAuthError(
      "AUDIENCE_MISMATCH",
      "Google token audience does not match configured client IDs",
    );
  }

  const sub = payload.sub;
  if (!sub || typeof sub !== "string") {
    throw new SocialAuthError("MISSING_SUBJECT", "Google token missing subject identifier");
  }

  const email = typeof payload.email === "string" ? payload.email.toLowerCase().trim() : "";
  if (!email) {
    throw new SocialAuthError("INVALID_TOKEN", "Google token missing email claim");
  }

  const emailVerified = payload.email_verified === true || payload.email_verified === "true";
  if (!emailVerified) {
    throw new SocialAuthError("UNVERIFIED_EMAIL", "Google email is not verified");
  }

  const displayName = typeof payload.name === "string" ? payload.name.trim() : undefined;
  const givenName = typeof payload.given_name === "string" ? payload.given_name.trim() : undefined;
  const familyName = typeof payload.family_name === "string" ? payload.family_name.trim() : undefined;

  return {
    provider: "GOOGLE",
    providerSubject: sub,
    email,
    emailVerified,
    ...(displayName ? { displayName } : {}),
    ...(givenName ? { givenName } : {}),
    ...(familyName ? { familyName } : {}),
  };
}

export async function verifyAppleIdToken(
  token: string,
  config: SocialVerificationConfig,
  clientProfile?: { readonly firstName?: string; readonly lastName?: string },
): Promise<VerifiedSocialIdentity> {
  if (!config.appleClientIds.length)
    throw new SocialAuthError("PROVIDER_NOT_CONFIGURED", "Apple sign-in is not configured");
  const getKey = config.customAppleJwks ?? getAppleJwks();
  let payload: JWTPayload;

  try {
    const result = await jwtVerify(token, getKey, {
      issuer: APPLE_ISSUER,
      clockTolerance: config.clockToleranceSeconds ?? 5,
    });
    payload = result.payload;
  } catch (error: unknown) {
    if (isProviderNetworkError(error)) {
      throw new SocialAuthError("NETWORK_ERROR", "Apple verification service is temporarily unavailable");
    }
    const msg = error instanceof Error ? error.message : "Token verification failed";
    if (/expired/i.test(msg)) throw new SocialAuthError("EXPIRED_TOKEN", "Apple ID token has expired");
    if (/issuer/i.test(msg)) throw new SocialAuthError("UNTRUSTED_ISSUER", "Untrusted Apple token issuer");
    throw new SocialAuthError("INVALID_TOKEN", `Invalid Apple token: ${msg}`);
  }

  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const matchedAud = config.appleClientIds.some((id) => aud.includes(id));
  if (!matchedAud) {
    throw new SocialAuthError(
      "AUDIENCE_MISMATCH",
      "Apple token audience does not match configured client IDs",
    );
  }

  const sub = payload.sub;
  if (!sub || typeof sub !== "string") {
    throw new SocialAuthError("MISSING_SUBJECT", "Apple token missing subject identifier");
  }

  const email = typeof payload.email === "string" ? payload.email.toLowerCase().trim() : "";
  const isPrivateRelay =
    email.endsWith("@privaterelay.appleid.com") ||
    payload.is_private_email === true ||
    payload.is_private_email === "true";

  const emailVerified =
    payload.email_verified === true || payload.email_verified === "true" || isPrivateRelay;

  // Derive display name from clientProfile captured during initial authorization
  const firstName = clientProfile?.firstName?.trim();
  const lastName = clientProfile?.lastName?.trim();
  const displayName = firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || undefined;

  return {
    provider: "APPLE",
    providerSubject: sub,
    email: email || `apple_${sub}@privaterelay.appleid.com`,
    emailVerified,
    isPrivateRelay,
    ...(displayName ? { displayName } : {}),
    ...(firstName ? { givenName: firstName } : {}),
    ...(lastName ? { familyName: lastName } : {}),
  };
}
