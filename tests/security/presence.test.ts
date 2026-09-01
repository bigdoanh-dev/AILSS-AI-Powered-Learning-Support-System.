import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeProtectedHeader, importPKCS8, importSPKI } from "jose";
import { signPresenceTicket, verifyPresenceTicket } from "../../packages/security/src/index.js";

async function pair() {
  const keys = generateKeyPairSync("ed25519");
  return {
    privateKey: await importPKCS8(
      keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      "EdDSA",
    ),
    publicKey: await importSPKI(keys.publicKey.export({ type: "spki", format: "pem" }).toString(), "EdDSA"),
  };
}

describe("P7.18 presence ticket", () => {
  it("binds the exact presence claims and thirty-second TTL", async () => {
    const keys = await pair();
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      sub: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      actorKind: "STUDENT" as const,
      authSessionId: crypto.randomUUID(),
      tokenVersion: 4,
      roles: ["STUDENT"],
    };
    const token = await signPresenceTicket(
      keys.privateKey,
      "classroom-kid",
      { ...claims, ttlSeconds: 30 },
      now,
    );
    expect(decodeProtectedHeader(token)).toMatchObject({
      alg: "EdDSA",
      kid: "classroom-kid",
      typ: "presence+jwt",
    });
    await expect(
      verifyPresenceTicket(token, keys.publicKey, { kid: "classroom-kid", sessionId: claims.sessionId }),
    ).resolves.toMatchObject({
      ...claims,
      purpose: "CLASS_PRESENCE",
      iat: now,
      exp: now + 30,
    });
  });

  it("rejects wrong session, key, purpose/typ and overlong TTL", async () => {
    const keys = await pair();
    const claims = {
      sub: crypto.randomUUID(),
      sessionId: crypto.randomUUID(),
      actorKind: "LECTURER" as const,
      authSessionId: crypto.randomUUID(),
      tokenVersion: 1,
      roles: ["LECTURER"],
    };
    const token = await signPresenceTicket(keys.privateKey, "classroom-kid", { ...claims, ttlSeconds: 60 });
    await expect(
      verifyPresenceTicket(token, keys.publicKey, { kid: "classroom-kid", sessionId: crypto.randomUUID() }),
    ).rejects.toThrow();
    await expect(
      verifyPresenceTicket(token, (await pair()).publicKey, {
        kid: "classroom-kid",
        sessionId: claims.sessionId,
      }),
    ).rejects.toThrow();
    await expect(
      verifyPresenceTicket(token, keys.publicKey, { kid: "wrong", sessionId: claims.sessionId }),
    ).rejects.toThrow();
  });
});
