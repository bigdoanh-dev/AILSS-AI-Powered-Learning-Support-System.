import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeJwt, importPKCS8, importSPKI } from "jose";
import { createLogger } from "../../packages/logger/src/index.js";
import { createMetrics } from "../../packages/observability/src/index.js";
import { verifyStepUpProof, type ActorContext } from "../../packages/security/src/index.js";
import type { AdminUser } from "../../apps/identity-service/src/admin/model.js";
import type { LoginSession } from "../../apps/identity-service/src/login/model.js";
import type { PasswordCredential } from "../../apps/identity-service/src/password/model.js";
import { ProtectedIdentityRequestValidator } from "../../apps/identity-service/src/profile/validator.js";
import { hashPassword } from "../../apps/identity-service/src/registration/password.js";
import { parseAdminStepUpRequest } from "../../apps/identity-service/src/step-up/model.js";
import { AdminStepUpService } from "../../apps/identity-service/src/step-up/service.js";
import { LearningAdminProofVerifier } from "../../apps/learning-service/src/admin-proof.js";

describe("P7.12A INT-IDN-02 Admin step-up", () => {
  it("issues an Ed25519 proof only for the exact ACTIVE Admin/password/action/resource", async () => {
    const fixture = await makeFixture();
    const resourceId = randomUUID();
    const result = await fixture.service.authorize(fixture.actor, {
      currentPassword: "correct horse battery staple",
      action: "COURSE_PUBLISH",
      resourceType: "COURSE",
      resourceId,
    });
    expect(result).toMatchObject({ expiresIn: 30, authMethod: "PASSWORD_REAUTH" });
    const proof = await verifyStepUpProof(result.proof, fixture.publicKey, {
      issuer: "identity-service",
      audience: "learning-service",
      kid: "identity-test",
      action: "COURSE_PUBLISH",
      resourceId,
      adminUserId: fixture.admin.userId,
    });
    expect(proof).toMatchObject({
      sub: fixture.admin.userId,
      sessionId: fixture.session.sessionId,
      tokenVersion: 7,
      action: "COURSE_PUBLISH",
      resourceType: "COURSE",
      resourceId,
      authMethod: "PASSWORD_REAUTH",
    });
    expect(proof.exp - proof.iat).toBe(30);
    expect(JSON.stringify(decodeJwt(result.proof))).not.toContain("correct horse battery staple");
    const learning = new LearningAdminProofVerifier(fixture.publicKey, "identity-test");
    await expect(
      learning.verify({
        proof: result.proof,
        actor: fixture.actor,
        action: "COURSE_PUBLISH",
        resourceId,
      }),
    ).resolves.toMatchObject({ sub: fixture.admin.userId });
    await expect(
      learning.verify({
        proof: result.proof,
        actor: { ...fixture.actor, sessionId: randomUUID() },
        action: "COURSE_PUBLISH",
        resourceId,
      }),
    ).rejects.toThrow("ADMIN_PROOF_ACTOR_MISMATCH");
  });

  it("denies Student/Lecturer, wrong password, inactive, revoked and stale-token identities", async () => {
    const fixture = await makeFixture();
    const request = {
      currentPassword: "wrong",
      action: "COURSE_ARCHIVE" as const,
      resourceType: "COURSE" as const,
      resourceId: randomUUID(),
    };
    await expect(fixture.service.authorize(fixture.actor, request)).rejects.toMatchObject({
      code: "ADMIN_STEP_UP_FAILED",
    });

    for (const role of ["STUDENT", "LECTURER"] as const) {
      fixture.admin.role = role;
      fixture.actor.roles = [role];
      await expect(
        fixture.service.authorize(fixture.actor, {
          ...request,
          currentPassword: "correct horse battery staple",
        }),
      ).rejects.toMatchObject({ code: "ADMIN_ROLE_REQUIRED", status: 403 });
    }
    fixture.admin.role = "ADMIN";
    fixture.actor.roles = ["ADMIN"];

    fixture.admin.status = "SUSPENDED";
    await expect(
      fixture.service.authorize(fixture.actor, {
        ...request,
        currentPassword: "correct horse battery staple",
      }),
    ).rejects.toMatchObject({ code: "INVALID_ACCESS_TOKEN" });
    fixture.admin.status = "ACTIVE";

    fixture.session.state = "REVOKED";
    fixture.session.revokedAt = new Date();
    await expect(
      fixture.service.authorize(fixture.actor, {
        ...request,
        currentPassword: "correct horse battery staple",
      }),
    ).rejects.toMatchObject({ code: "INVALID_ACCESS_TOKEN" });
    fixture.session.state = "ACTIVE";
    fixture.session.revokedAt = null;

    fixture.actor.tokenVersion = 6;
    await expect(
      fixture.service.authorize(fixture.actor, {
        ...request,
        currentPassword: "correct horse battery staple",
      }),
    ).rejects.toMatchObject({ code: "INVALID_ACCESS_TOKEN" });
  });

  it("strictly rejects mass assignment and action/resource-bound proof reuse or tampering", async () => {
    expect(() =>
      parseAdminStepUpRequest({
        currentPassword: "secret",
        action: "COURSE_PUBLISH",
        resourceType: "COURSE",
        resourceId: randomUUID(),
        mfa: true,
      }),
    ).toThrow();
    const fixture = await makeFixture();
    const resourceId = randomUUID();
    const result = await fixture.service.authorize(fixture.actor, {
      currentPassword: "correct horse battery staple",
      action: "COURSE_PUBLISH",
      resourceType: "COURSE",
      resourceId,
    });
    await expect(
      verifyStepUpProof(result.proof, fixture.publicKey, {
        issuer: "identity-service",
        audience: "learning-service",
        kid: "identity-test",
        action: "COURSE_ARCHIVE",
        resourceId,
      }),
    ).rejects.toThrow();
    await expect(
      verifyStepUpProof(result.proof, fixture.publicKey, {
        issuer: "identity-service",
        audience: "learning-service",
        kid: "identity-test",
        action: "COURSE_PUBLISH",
        resourceId: randomUUID(),
      }),
    ).rejects.toThrow();
    const changed = `${result.proof.slice(0, -1)}${result.proof.endsWith("a") ? "b" : "a"}`;
    await expect(
      verifyStepUpProof(changed, fixture.publicKey, {
        issuer: "identity-service",
        audience: "learning-service",
        kid: "identity-test",
        action: "COURSE_PUBLISH",
        resourceId,
      }),
    ).rejects.toThrow();
  });
});

async function makeFixture() {
  const pair = generateKeyPairSync("ed25519");
  const privateKey = await importPKCS8(
    pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    "EdDSA",
  );
  const publicKey = await importSPKI(
    pair.publicKey.export({ type: "spki", format: "pem" }).toString(),
    "EdDSA",
  );
  const now = new Date();
  const userId = randomUUID();
  const sessionId = randomUUID();
  const admin = {
    userId,
    emailMasked: "a***@example.test",
    normalizedEmail: "admin@example.test",
    displayName: "Admin User",
    role: "ADMIN",
    status: "ACTIVE",
    lecturerVerified: false,
    tokenVersion: 7,
    credentialVersion: 3,
    securityOperationId: null,
    profileVersion: 1,
    createdAt: new Date(now.getTime() - 60_000),
    updatedAt: now,
    shard: 0,
  } as Mutable<AdminUser>;
  const credential: PasswordCredential = {
    userId,
    passwordHash: await hashPassword("correct horse battery staple"),
    credentialVersion: 3,
    securityOperationId: null,
    status: "ACTIVE",
    updatedAt: now,
  };
  const session = {
    sessionId,
    userId,
    tokenFamilyId: randomUUID(),
    refreshFingerprint: "fingerprint",
    generation: 0,
    state: "ACTIVE",
    expiresAt: new Date(now.getTime() + 60_000),
    revokedAt: null,
    version: 1,
    authVersion: 7,
    createdAt: now,
  } as Mutable<LoginSession>;
  const actor = {
    userId,
    roles: ["ADMIN"],
    sessionId,
    tokenVersion: 7,
    correlationId: randomUUID(),
    issuedAt: Math.floor(now.getTime() / 1_000),
    expiresAt: Math.floor(now.getTime() / 1_000) + 30,
  } as Mutable<ActorContext>;
  const metrics = createMetrics(`step-up-${randomUUID().replaceAll("-", "")}`);
  const validator = new ProtectedIdentityRequestValidator(
    {
      getSession: async () => session,
      getUser: async () => admin,
    },
    metrics,
    createLogger({ service: "identity-service", environment: "test", level: "silent" }),
  );
  const service = new AdminStepUpService(
    { getCredential: async () => credential },
    validator,
    privateKey,
    "identity-test",
    metrics,
  );
  return { service, actor, admin, session, publicKey };
}

type Mutable<Value> = { -readonly [Key in keyof Value]: Value[Key] };
