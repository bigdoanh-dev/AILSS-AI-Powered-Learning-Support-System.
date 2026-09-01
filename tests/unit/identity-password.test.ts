import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ActorContext } from "../../packages/security/src/index.js";
import type { CanonicalLoginUser, LoginSession } from "../../apps/identity-service/src/login/model.js";
import {
  parsePasswordChangeRequest,
  passwordCommandFingerprint,
  type PasswordChangeMetadata,
  type PasswordCredential,
} from "../../apps/identity-service/src/password/model.js";
import {
  PasswordChangeService,
  type IdentityPasswordStore,
} from "../../apps/identity-service/src/password/service.js";
import { ProtectedIdentityRequestValidator } from "../../apps/identity-service/src/profile/validator.js";
import type { ProfileUser } from "../../apps/identity-service/src/profile/model.js";
import type { IdempotencyRecord } from "../../apps/identity-service/src/registration/repository.js";
import { createLogger } from "../../packages/logger/src/index.js";
import { createMetrics } from "../../packages/observability/src/index.js";

const now = new Date("2026-08-29T08:00:00.123Z");
const hmacKey = "p7.6-test-only-dedicated-hmac-key-material";
const currentPassword = "current-password-123";
const newPassword = "new-password-456";

describe("P7.6 password-change contract", () => {
  it("accepts only current/new password and uses a keyed stable fingerprint", () => {
    expect(parsePasswordChangeRequest({ currentPassword, newPassword })).toEqual({
      currentPassword,
      newPassword,
    });
    expect(() =>
      parsePasswordChangeRequest({ currentPassword, newPassword, userId: randomUUID() }),
    ).toThrow();
    expect(() => parsePasswordChangeRequest({ currentPassword, newPassword: "short" })).toThrow();
    const first = passwordCommandFingerprint(hmacKey, "user-a", { currentPassword, newPassword });
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(first).toBe(passwordCommandFingerprint(hmacKey, "user-a", { currentPassword, newPassword }));
    expect(first).not.toBe(
      passwordCommandFingerprint(`${hmacKey}-other`, "user-a", { currentPassword, newPassword }),
    );
  });

  it("advances credential/security versions once and revokes the authorizing session", async () => {
    const fixture = makeFixture();
    const result = await fixture.service.change(command(fixture));
    expect(result).toEqual({ userId: fixture.actor.userId, replayed: false });
    expect(fixture.store.user).toMatchObject({ tokenVersion: 2, credentialVersion: 2 });
    expect(fixture.store.credential).toMatchObject({
      credentialVersion: 2,
      passwordHash: `hash:${newPassword}`,
    });
    expect(fixture.store.session).toMatchObject({ state: "REVOKED", version: 2, authVersion: 1 });
    expect(fixture.store.idempotency?.status).toBe("COMPLETE");
  });

  it("replays an exact completed operation after the old actor became stale", async () => {
    const fixture = makeFixture();
    await fixture.service.change(command(fixture));
    const replay = await fixture.service.change(command(fixture));
    expect(replay.replayed).toBe(true);
    expect(fixture.store.user.tokenVersion).toBe(2);
    expect(fixture.store.credential.credentialVersion).toBe(2);
    expect(fixture.store.session.version).toBe(2);
  });

  it("rejects same key with a different password command without mutation", async () => {
    const fixture = makeFixture();
    await fixture.service.change(command(fixture));
    await expect(
      fixture.service.change({
        ...command(fixture),
        request: { currentPassword, newPassword: "another-password-789" },
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
    expect(fixture.store.user.tokenVersion).toBe(2);
  });

  it("denies wrong current password and same-password replacement before reservation", async () => {
    const wrong = makeFixture();
    await expect(
      wrong.service.change({
        ...command(wrong),
        request: { currentPassword: "wrong-password", newPassword },
      }),
    ).rejects.toMatchObject({ code: "INVALID_REAUTHENTICATION", status: 401 });
    expect(wrong.store.idempotency).toBeUndefined();
    expect(wrong.store.user.tokenVersion).toBe(1);

    const same = makeFixture();
    await expect(
      same.service.change({
        ...command(same),
        request: { currentPassword, newPassword: currentPassword },
      }),
    ).rejects.toMatchObject({ code: "PASSWORD_CHANGE_VALIDATION_FAILED", status: 422 });
    expect(same.store.idempotency).toBeUndefined();
  });

  it("recovers the same operation after the user epoch advanced but credential write failed", async () => {
    const fixture = makeFixture();
    fixture.store.failCredentialWriteOnce = true;
    await expect(fixture.service.change(command(fixture))).rejects.toMatchObject({
      code: "PASSWORD_CHANGE_UNAVAILABLE",
      status: 503,
    });
    expect(fixture.store.user).toMatchObject({ tokenVersion: 2, credentialVersion: 2 });
    expect(fixture.store.credential).toMatchObject({ credentialVersion: 1 });
    expect(fixture.store.idempotency?.status).toBe("USER_EPOCH_ADVANCED");

    const recovered = await fixture.service.change(command(fixture));
    expect(recovered.replayed).toBe(true);
    expect(fixture.store.credential).toMatchObject({ credentialVersion: 2 });
    expect(fixture.store.session.state).toBe("REVOKED");
    expect(fixture.store.idempotency?.status).toBe("COMPLETE");
  });

  it("serializes two different keys that share one security snapshot", async () => {
    const fixture = makeFixture();
    const [first, second] = await Promise.allSettled([
      fixture.service.change(command(fixture, "key-a")),
      fixture.service.change(command(fixture, "key-b")),
    ]);
    expect([first.status, second.status].sort()).toEqual(["fulfilled", "rejected"]);
    const rejected =
      first.status === "rejected" ? first.reason : second.status === "rejected" ? second.reason : undefined;
    expect(rejected).toMatchObject({ code: "PASSWORD_CHANGE_CONFLICT", status: 409 });
    expect(fixture.store.user).toMatchObject({ tokenVersion: 2, credentialVersion: 2 });
  });

  it("converges safely when logout revokes the current session during password change", async () => {
    const fixture = makeFixture();
    fixture.store.logoutAfterCredentialWrite = true;
    await expect(fixture.service.change(command(fixture))).resolves.toMatchObject({ replayed: false });
    expect(fixture.store.session).toMatchObject({ state: "REVOKED", version: 2 });
    expect(fixture.store.user).toMatchObject({ tokenVersion: 2, credentialVersion: 2 });
    expect(fixture.store.credential).toMatchObject({ credentialVersion: 2 });
    expect(fixture.store.idempotency?.status).toBe("COMPLETE");
  });
});

function command(fixture: ReturnType<typeof makeFixture>, idempotencyKey = "password-key") {
  return {
    actor: fixture.actor,
    request: { currentPassword, newPassword },
    idempotencyKey,
    requestId: randomUUID(),
  };
}

function makeFixture() {
  const userId = randomUUID();
  const sessionId = randomUUID();
  const user: CanonicalLoginUser = {
    userId,
    normalizedEmail: "learner@example.test",
    displayName: "Learner",
    role: "STUDENT",
    status: "ACTIVE",
    lecturerVerified: false,
    tokenVersion: 1,
    credentialVersion: 1,
    securityOperationId: null,
    profileVersion: 1,
    createdAt: new Date(now.getTime() - 60_000),
    updatedAt: new Date(now.getTime() - 60_000),
  };
  const session: LoginSession = {
    sessionId,
    userId,
    tokenFamilyId: randomUUID(),
    refreshFingerprint: "a".repeat(64),
    generation: 0,
    state: "ACTIVE",
    expiresAt: new Date(now.getTime() + 60_000),
    revokedAt: null,
    version: 1,
    authVersion: 1,
    createdAt: new Date(now.getTime() - 60_000),
  };
  const credential: PasswordCredential = {
    userId,
    passwordHash: `hash:${currentPassword}`,
    credentialVersion: 1,
    securityOperationId: null,
    status: "ACTIVE",
    updatedAt: new Date(now.getTime() - 60_000),
  };
  const actor: ActorContext = {
    userId,
    roles: ["STUDENT"],
    sessionId,
    tokenVersion: 1,
    correlationId: randomUUID(),
    issuedAt: Math.floor(now.getTime() / 1_000),
    expiresAt: Math.floor(now.getTime() / 1_000) + 30,
  };
  const store = new MemoryPasswordStore(user, credential, session);
  const metrics = createMetrics("identity-password-test");
  const validator = new ProtectedIdentityRequestValidator(
    {
      getSession: async (id) => (store.session.sessionId === id ? { ...store.session } : undefined),
      getUser: async (id): Promise<ProfileUser | undefined> =>
        store.user.userId === id
          ? {
              ...store.user,
              emailMasked: "l***@example.test",
            }
          : undefined,
    },
    metrics,
    createLogger({ service: "identity-service", environment: "test", level: "silent" }),
    () => new Date(now),
  );
  const verifier = async (hash: string, password: string) => hash === `hash:${password}`;
  const service = new PasswordChangeService(
    store,
    validator,
    hmacKey,
    metrics,
    createLogger({ service: "identity-service", environment: "test", level: "silent" }),
    verifier,
    async (password) => `hash:${password}`,
    () => new Date(now),
  );
  return { store, service, actor };
}

class MemoryPasswordStore implements IdentityPasswordStore {
  public readonly idempotencyByKey = new Map<string, IdempotencyRecord>();
  public failCredentialWriteOnce = false;
  public logoutAfterCredentialWrite = false;

  public get idempotency(): IdempotencyRecord | undefined {
    return this.idempotencyByKey.get("password-key") ?? this.idempotencyByKey.values().next().value;
  }

  public constructor(
    public user: CanonicalLoginUser,
    public credential: PasswordCredential,
    public session: LoginSession,
  ) {}

  public async getUser(userId: string) {
    return this.user.userId === userId ? { ...this.user } : undefined;
  }

  public async getCredential(normalizedEmail: string) {
    return normalizedEmail === this.user.normalizedEmail ? { ...this.credential } : undefined;
  }

  public async getSession(sessionId: string) {
    return this.session.sessionId === sessionId ? { ...this.session } : undefined;
  }

  public async revokeSession(sessionId: string, expectedVersion: number, revokedAt: Date) {
    if (
      this.session.sessionId !== sessionId ||
      this.session.state !== "ACTIVE" ||
      this.session.version !== expectedVersion
    ) {
      return false;
    }
    this.session = {
      ...this.session,
      state: "REVOKED",
      revokedAt,
      version: expectedVersion + 1,
    };
    return true;
  }

  public async advanceUserSecurityEpoch(input: {
    expected: CanonicalLoginUser;
    operationId: string;
    updatedAt: Date;
  }) {
    if (
      this.user.tokenVersion !== input.expected.tokenVersion ||
      this.user.credentialVersion !== input.expected.credentialVersion
    ) {
      return false;
    }
    this.user = {
      ...this.user,
      tokenVersion: this.user.tokenVersion + 1,
      credentialVersion: this.user.credentialVersion + 1,
      securityOperationId: input.operationId,
      updatedAt: input.updatedAt,
    };
    return true;
  }

  public async updateCredential(input: {
    expected: PasswordCredential;
    passwordHash: string;
    operationId: string;
    updatedAt: Date;
  }) {
    if (this.failCredentialWriteOnce) {
      this.failCredentialWriteOnce = false;
      throw new Error("timeout-before-commit");
    }
    if (this.credential.credentialVersion !== input.expected.credentialVersion) return false;
    this.credential = {
      ...this.credential,
      passwordHash: input.passwordHash,
      credentialVersion: this.credential.credentialVersion + 1,
      securityOperationId: input.operationId,
      updatedAt: input.updatedAt,
    };
    if (this.logoutAfterCredentialWrite && this.session.state === "ACTIVE") {
      this.session = {
        ...this.session,
        state: "REVOKED",
        revokedAt: input.updatedAt,
        version: this.session.version + 1,
      };
    }
    return true;
  }

  public async beginIdempotency(input: {
    idempotencyKey: string;
    operationId: string;
    userId: string;
    requestFingerprint: string;
    createdAt: Date;
  }) {
    const existing = this.idempotencyByKey.get(input.idempotencyKey);
    if (!existing) {
      const record = {
        operationId: input.operationId,
        resourceId: input.userId,
        resultCode: 0,
        status: "IN_PROGRESS",
        requestChecksum: input.requestFingerprint,
        createdAt: input.createdAt,
      };
      this.idempotencyByKey.set(input.idempotencyKey, record);
      return { created: true, record: { ...record } };
    }
    return { created: false, record: { ...existing } };
  }

  public async getIdempotency(_scope: string, _keyHash: number, idempotencyKey: string) {
    const record = this.idempotencyByKey.get(idempotencyKey);
    return record ? { ...record } : undefined;
  }

  public async transitionIdempotency(input: {
    idempotencyKey: string;
    operationId: string;
    expectedStatus: string;
    nextStatus: string;
    metadata: PasswordChangeMetadata;
    resultCode?: number;
  }) {
    const record = this.idempotencyByKey.get(input.idempotencyKey);
    if (!record || record.operationId !== input.operationId || record.status !== input.expectedStatus) {
      return false;
    }
    this.idempotencyByKey.set(input.idempotencyKey, {
      ...record,
      status: input.nextStatus,
      resultCode: input.resultCode ?? 0,
      requestChecksum: JSON.stringify(input.metadata),
    });
    return true;
  }
}
