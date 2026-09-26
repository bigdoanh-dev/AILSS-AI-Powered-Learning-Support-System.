import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
const scope = z.object({
  sub: z.string().uuid(),
  tenantId: z.string().uuid(),
  courseId: z.string().uuid(),
  lessonId: z.string().uuid(),
  mediaAssetId: z.string().uuid(),
  processingVersion: z.number().int().positive(),
  outputPrefix: z.string().regex(/^[a-f0-9/-]+$/),
  operation: z.literal("PLAYBACK"),
});
export type MediaPlaybackScope = z.infer<typeof scope>;
function key(secret: string) {
  if (Buffer.byteLength(secret) < 32) throw Error("MEDIA_PLAYBACK_SECRET_REQUIRED");
  return new TextEncoder().encode(secret);
}
export async function signMediaPlayback(value: MediaPlaybackScope, secret: string, ttl: number) {
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 300) throw Error("INVALID_MEDIA_PLAYBACK_TTL");
  const claims = scope.parse(value);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("ailss-media")
    .setAudience("media-delivery")
    .setIssuedAt()
    .setExpirationTime(`${String(ttl)}s`)
    .sign(key(secret));
}
export async function verifyMediaPlayback(
  token: string,
  secret: string,
  tenantId: string,
  mediaAssetId: string,
) {
  if (token.length > 4096) throw Error("MEDIA_TOKEN_REJECTED");
  const { payload } = await jwtVerify(token, key(secret), {
    issuer: "ailss-media",
    audience: "media-delivery",
    algorithms: ["HS256"],
    requiredClaims: ["exp", "iat", "sub"],
  });
  const claims = scope.parse(payload);
  if (
    claims.tenantId !== tenantId ||
    claims.mediaAssetId !== mediaAssetId ||
    !claims.outputPrefix.startsWith(`${tenantId}/${mediaAssetId}/`)
  )
    throw Error("MEDIA_TOKEN_SCOPE_REJECTED");
  return claims;
}
