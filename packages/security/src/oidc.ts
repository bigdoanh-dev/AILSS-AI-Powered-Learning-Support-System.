import { jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { AppError } from "../../http/src/index.js";

export interface OidcVerificationConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly jwks: JWTVerifyGetKey;
  readonly clockToleranceSeconds?: number;
}

export interface OidcTokenVerificationInput {
  readonly idToken: string;
  readonly expectedNonce?: string;
  readonly state?: string;
  readonly expectedState?: string;
}

export interface VerifiedOidcIdentity {
  readonly sub: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly name?: string;
  readonly nonce?: string;
  readonly payload: JWTPayload;
}

/**
 * Enterprise OIDC ID Token validator with strict conformance checks:
 * - Signature & JWKS key ID resolution
 * - Expiration and clock skew bounds
 * - Issuer and Audience verification
 * - Nonce anti-replay verification
 * - State parameter CSRF protection
 */
export async function verifyOidcIdToken(
  input: OidcTokenVerificationInput,
  config: OidcVerificationConfig,
): Promise<VerifiedOidcIdentity> {
  // 1. Verify state if expected
  if (input.expectedState !== undefined) {
    if (!input.state || input.state !== input.expectedState) {
      throw new AppError("OIDC_STATE_MISMATCH", 400, "OIDC state parameter mismatch; possible CSRF detected");
    }
  }

  let payload: JWTPayload;
  try {
    const result = await jwtVerify(input.idToken, config.jwks, {
      issuer: config.issuer,
      audience: config.clientId,
      clockTolerance: config.clockToleranceSeconds ?? 5,
    });
    payload = result.payload;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "OIDC token verification failed";
    const errObj =
      typeof error === "object" && error !== null ? (error as Record<string, unknown>) : undefined;
    const errCode = typeof errObj?.code === "string" ? errObj.code : "";
    const claim = typeof errObj?.claim === "string" ? errObj.claim : "";

    if (errCode === "ERR_JWT_EXPIRED" || /"exp"|expired/iu.test(msg)) {
      throw new AppError("OIDC_TOKEN_EXPIRED", 401, "OIDC ID token has expired");
    }
    if (/kid/iu.test(msg) || /no applicable key/iu.test(msg) || /key not found/iu.test(msg)) {
      throw new AppError("OIDC_KEY_MISMATCH", 401, "No matching JWKS key found for token header kid");
    }
    if (claim === "iss" || /issuer|"iss"/iu.test(msg)) {
      throw new AppError("OIDC_ISSUER_MISMATCH", 401, "OIDC token issuer does not match configuration");
    }
    if (claim === "aud" || /audience|"aud"/iu.test(msg)) {
      throw new AppError(
        "OIDC_AUDIENCE_MISMATCH",
        401,
        "OIDC token audience does not match configured clientId",
      );
    }
    throw new AppError("OIDC_INVALID_TOKEN", 401, `Invalid OIDC token: ${msg}`);
  }

  // 2. Verify sub claim
  const sub = payload.sub;
  if (!sub || typeof sub !== "string" || sub.trim().length === 0) {
    throw new AppError("OIDC_INVALID_TOKEN", 401, "OIDC token is missing required sub claim");
  }

  // 3. Verify nonce claim if expected
  if (input.expectedNonce !== undefined) {
    const tokenNonce = typeof payload.nonce === "string" ? payload.nonce : undefined;
    if (!tokenNonce || tokenNonce !== input.expectedNonce) {
      throw new AppError(
        "OIDC_NONCE_MISMATCH",
        401,
        "OIDC nonce mismatch; replay attack or session desynchronization detected",
      );
    }
  }

  // 4. Verify email claim
  const email = typeof payload.email === "string" ? payload.email.toLowerCase().trim() : "";
  if (!email) {
    throw new AppError("OIDC_INVALID_TOKEN", 401, "OIDC token is missing required email claim");
  }

  const emailVerified = payload.email_verified === true || payload.email_verified === "true";

  const name = typeof payload.name === "string" ? payload.name.trim() : undefined;
  const nonce = typeof payload.nonce === "string" ? payload.nonce : undefined;

  return {
    sub,
    email,
    emailVerified,
    ...(name ? { name } : {}),
    ...(nonce ? { nonce } : {}),
    payload,
  };
}
