import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface RefreshCredential {
  readonly rawToken: string;
  readonly fingerprint: string;
}

export function newRefreshCredential(): RefreshCredential {
  const rawToken = randomBytes(32).toString("base64url");
  return {
    rawToken,
    fingerprint: fingerprintRefreshToken(rawToken),
  };
}

export function fingerprintRefreshToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function refreshTokenMatchesFingerprint(rawToken: string, storedFingerprint: string): boolean {
  if (!/^[a-f0-9]{64}$/u.test(storedFingerprint)) return false;
  const submitted = Buffer.from(fingerprintRefreshToken(rawToken), "hex");
  const stored = Buffer.from(storedFingerprint, "hex");
  return submitted.length === stored.length && timingSafeEqual(submitted, stored);
}
