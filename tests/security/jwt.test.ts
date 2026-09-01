import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeProtectedHeader, importPKCS8, importSPKI, SignJWT } from "jose";
import {
  signAccessToken,
  signActorContext,
  signServiceToken,
  verifyAccessToken,
  verifyActorContext,
  verifyServiceToken,
  verifyJwt,
} from "../../packages/security/src/index.js";

async function keys() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: await importPKCS8(
      pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      "EdDSA",
    ),
    publicKey: await importSPKI(pair.publicKey.export({ type: "spki", format: "pem" }).toString(), "EdDSA"),
  };
}
const policy = {
  issuer: "https://identity.ailss.local",
  audience: "ailss-api",
  kid: "test",
  clockToleranceSeconds: 0,
};
describe("JWT policy", () => {
  it("issues exact EdDSA identity claims and configured expiration", async () => {
    const pair = await keys();
    const sessionId = crypto.randomUUID();
    const subject = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1_000);
    const token = await signAccessToken(
      pair.privateKey,
      { ...policy, accessTokenTtlSeconds: 120 },
      { subject, roles: ["STUDENT"], sessionId, tokenVersion: 7 },
      now,
    );
    const header = decodeProtectedHeader(token);
    const payload = await verifyJwt(token, pair.publicKey, {
      ...policy,
      accessTokenTtlSeconds: 120,
    });
    expect(header).toMatchObject({ alg: "EdDSA", kid: "test", typ: "JWT" });
    expect(payload).toMatchObject({
      iss: policy.issuer,
      aud: policy.audience,
      sub: subject,
      roles: ["STUDENT"],
      sessionId,
      tokenVersion: 7,
      iat: now,
      exp: now + 120,
    });
    expect(payload.jti).toMatch(/^[0-9a-f-]{36}$/iu);
  });

  it("rejects wrong signature, issuer, audience and expiry", async () => {
    const a = await keys();
    const b = await keys();
    const token = await signAccessToken(a.privateKey, policy, {
      subject: crypto.randomUUID(),
      roles: ["student"],
      tokenVersion: 1,
    });
    await expect(verifyJwt(token, b.publicKey, policy)).rejects.toThrow();
    await expect(
      verifyJwt(token, a.publicKey, { ...policy, issuer: "https://wrong.test" }),
    ).rejects.toThrow();
    await expect(verifyJwt(token, a.publicKey, { ...policy, audience: "wrong" })).rejects.toThrow();
    const expired = await signAccessToken(
      a.privateKey,
      policy,
      { subject: crypto.randomUUID(), roles: [], tokenVersion: 1 },
      Math.floor(Date.now() / 1000) - 1_000,
    );
    await expect(verifyJwt(expired, a.publicKey, policy)).rejects.toThrow();
  });
});

describe("P7.7 internal Service JWS policy", () => {
  const expected = {
    issuer: "ailss-internal",
    audience: "identity-service",
    purpose: "identity.public-profile.read",
    kid: "learning-test",
  };

  it("binds Ed25519 header, Learning identity, audience, purpose, jti, and <=60 second TTL", async () => {
    const pair = await keys();
    const token = await signServiceToken(pair.privateKey, {
      ...expected,
      serviceId: "learning-service",
      ttlSeconds: 60,
    });
    expect(decodeProtectedHeader(token)).toMatchObject({
      alg: "EdDSA",
      kid: "learning-test",
      typ: "service+jwt",
    });
    await expect(verifyServiceToken(token, pair.publicKey, expected)).resolves.toMatchObject({
      sub: "learning-service",
      purpose: expected.purpose,
    });
    const other = await keys();
    await expect(verifyServiceToken(token, other.publicKey, expected)).rejects.toThrow();
    await expect(
      verifyServiceToken(token, pair.publicKey, { ...expected, audience: "wrong-service" }),
    ).rejects.toThrow();
    await expect(
      verifyServiceToken(token, pair.publicKey, { ...expected, purpose: "wrong-purpose" }),
    ).rejects.toThrow();
    await expect(
      verifyServiceToken(token, pair.publicKey, { ...expected, kid: "wrong-kid" }),
    ).rejects.toThrow();
  });

  it("rejects expired, overlong, and wrong-typ service credentials", async () => {
    const pair = await keys();
    const now = Math.floor(Date.now() / 1_000);
    const make = (typ: string, issuedAt: number, expiresAt: number) =>
      new SignJWT({ purpose: expected.purpose })
        .setProtectedHeader({ alg: "EdDSA", kid: expected.kid, typ })
        .setIssuer(expected.issuer)
        .setSubject("learning-service")
        .setAudience(expected.audience)
        .setIssuedAt(issuedAt)
        .setExpirationTime(expiresAt)
        .setJti(crypto.randomUUID())
        .sign(pair.privateKey);
    await expect(
      verifyServiceToken(await make("service+jwt", now - 120, now - 60), pair.publicKey, expected),
    ).rejects.toThrow();
    await expect(
      verifyServiceToken(await make("service+jwt", now, now + 61), pair.publicKey, expected),
    ).rejects.toThrow();
    await expect(
      verifyServiceToken(await make("JWT", now, now + 60), pair.publicKey, expected),
    ).rejects.toThrow();
  });
});

describe("P7.4 bearer and actor-context trust boundary", () => {
  it("strictly verifies required access-token identity/session claims", async () => {
    const pair = await keys();
    const userId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const token = await signAccessToken(pair.privateKey, policy, {
      subject: userId,
      roles: ["STUDENT"],
      sessionId,
      tokenVersion: 9,
    });
    await expect(verifyAccessToken(token, pair.publicKey, policy)).resolves.toMatchObject({
      userId,
      roles: ["STUDENT"],
      sessionId,
      tokenVersion: 9,
    });
    const withoutSession = await signAccessToken(pair.privateKey, policy, {
      subject: userId,
      roles: ["STUDENT"],
      tokenVersion: 9,
    });
    await expect(verifyAccessToken(withoutSession, pair.publicKey, policy)).rejects.toThrow();
    await expect(verifyAccessToken(token, pair.publicKey, { ...policy, kid: "wrong-kid" })).rejects.toThrow();
  });

  it("binds signed actor context to issuer, audience, purpose, TTL and exact claims", async () => {
    const pair = await keys();
    const issuedAt = Math.floor(Date.now() / 1_000);
    const actor = {
      userId: crypto.randomUUID(),
      roles: ["STUDENT"],
      sessionId: crypto.randomUUID(),
      tokenVersion: 3,
      correlationId: crypto.randomUUID(),
      issuedAt,
      expiresAt: issuedAt + 30,
    };
    const token = await signActorContext(
      pair.privateKey,
      "gateway-kid",
      "api-gateway",
      "identity-service",
      "identity.logout",
      actor,
    );
    const expected = {
      issuer: "api-gateway",
      audience: "identity-service",
      purpose: "identity.logout",
      kid: "gateway-kid",
      clockToleranceSeconds: 0,
    };
    await expect(verifyActorContext(token, pair.publicKey, expected)).resolves.toEqual(actor);
    await expect(
      verifyActorContext(token, pair.publicKey, { ...expected, purpose: "identity.profile" }),
    ).rejects.toThrow();
    await expect(
      verifyActorContext(token, pair.publicKey, { ...expected, audience: "learning-service" }),
    ).rejects.toThrow();
    const otherPair = await keys();
    await expect(verifyActorContext(token, otherPair.publicKey, expected)).rejects.toThrow();
  });
});

describe("P7.12A Gateway to INT-IDN-02 trust boundary", () => {
  it("rejects wrong Gateway service identity and wrong actor issuer/audience/purpose", async () => {
    const pair = await keys();
    const servicePolicy = {
      issuer: "api-gateway",
      audience: "identity-service",
      purpose: "identity.admin.step-up.authorize",
      kid: "gateway-kid",
    };
    const service = await signServiceToken(pair.privateKey, {
      ...servicePolicy,
      serviceId: "not-api-gateway",
      ttlSeconds: 30,
    });
    const claims = await verifyServiceToken(service, pair.publicKey, servicePolicy);
    expect(claims.sub).not.toBe("api-gateway");
    await expect(
      verifyServiceToken(service, pair.publicKey, { ...servicePolicy, issuer: "wrong-gateway" }),
    ).rejects.toThrow();

    const issuedAt = Math.floor(Date.now() / 1_000);
    const actor = await signActorContext(
      pair.privateKey,
      "gateway-kid",
      "api-gateway",
      "identity-service",
      "identity.admin.step-up.authorize",
      {
        userId: crypto.randomUUID(),
        roles: ["ADMIN"],
        sessionId: crypto.randomUUID(),
        tokenVersion: 1,
        correlationId: crypto.randomUUID(),
        issuedAt,
        expiresAt: issuedAt + 30,
      },
    );
    const expected = { ...servicePolicy, clockToleranceSeconds: 0 };
    await expect(verifyActorContext(actor, pair.publicKey, expected)).resolves.toMatchObject({
      roles: ["ADMIN"],
    });
    await expect(
      verifyActorContext(actor, pair.publicKey, { ...expected, issuer: "learning-service" }),
    ).rejects.toThrow();
    await expect(
      verifyActorContext(actor, pair.publicKey, { ...expected, audience: "learning-service" }),
    ).rejects.toThrow();
    await expect(
      verifyActorContext(actor, pair.publicKey, { ...expected, purpose: "identity.profile.read" }),
    ).rejects.toThrow();
  });
});
