import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { LoginSession } from "../../apps/identity-service/src/login/model.js";
import {
  parseProfileUpdateRequest,
  serializeProfileUpdateMetadata,
  type ProfileUpdateMetadata,
  type ProfileUser,
} from "../../apps/identity-service/src/profile/model.js";
import {
  ProfileService,
  type IdentityProfileStore,
} from "../../apps/identity-service/src/profile/service.js";
import { ProtectedIdentityRequestValidator } from "../../apps/identity-service/src/profile/validator.js";
import type { IdempotencyRecord } from "../../apps/identity-service/src/registration/repository.js";
import type { PublicLecturerProjection } from "../../apps/identity-service/src/public-profile/model.js";
import type { AdminProjectionRow } from "../../apps/identity-service/src/admin/model.js";
import { createLogger } from "../../packages/logger/src/index.js";
import { createMetrics } from "../../packages/observability/src/index.js";
import type { ActorContext } from "../../packages/security/src/index.js";

const now = new Date("2026-08-29T14:00:00.000Z");

describe("P7.5 profile input boundary", () => {
  it("normalizes only displayName and rejects empty, control, and mass-assignment input", () => {
    expect(parseProfileUpdateRequest({ displayName: "  Student B  " })).toEqual({
      displayName: "Student B",
    });
    for (const value of [
      {},
      { displayName: "A" },
      { displayName: "A\u0000B" },
      { displayName: "Student", role: "ADMIN" },
      { role: "ADMIN" },
      { status: "ACTIVE" },
      { lecturerVerified: true },
      { tokenVersion: 999 },
      { profileVersion: 999 },
      { emailMasked: "x***@example.test" },
      { password: "not-allowed" },
    ]) {
      expect(() => parseProfileUpdateRequest(value)).toThrow();
    }
  });
});

describe("P7.5 reusable protected Identity validator", () => {
  it("requires canonical ACTIVE owned session and matching ACTIVE account authorization", async () => {
    const fixture = profileFixture();
    await expect(fixture.validator.validate(fixture.actor)).resolves.toMatchObject({
      user: { userId: fixture.actor.userId, tokenVersion: 1, role: "STUDENT" },
      session: { sessionId: fixture.actor.sessionId, state: "ACTIVE" },
    });

    for (const mutate of [
      (store: MemoryProfileStore) => (store.session = undefined),
      (store: MemoryProfileStore) => {
        store.session = { ...requireSession(store), state: "REVOKED", revokedAt: new Date(now) };
      },
      (store: MemoryProfileStore) => {
        store.session = { ...requireSession(store), expiresAt: new Date(now) };
      },
      (store: MemoryProfileStore) => {
        store.session = { ...requireSession(store), userId: randomUUID() };
      },
      (store: MemoryProfileStore) => (store.user = { ...store.user, status: "SUSPENDED" }),
      (store: MemoryProfileStore) => (store.user = { ...store.user, tokenVersion: 2 }),
      (store: MemoryProfileStore) => (store.user = { ...store.user, role: "LECTURER" }),
    ]) {
      const denied = profileFixture();
      mutate(denied.store);
      await expect(denied.validator.validate(denied.actor)).rejects.toMatchObject({
        code: "INVALID_ACCESS_TOKEN",
        status: 401,
      });
    }
  });

  it("maps Q-IDN-003 and Q-IDN-001 dependency failures to safe 503", async () => {
    const sessionFailure = profileFixture();
    sessionFailure.store.failSessionRead = true;
    await expect(sessionFailure.validator.validate(sessionFailure.actor)).rejects.toMatchObject({
      code: "IDENTITY_AUTHORIZATION_UNAVAILABLE",
      status: 503,
    });
    const accountFailure = profileFixture();
    accountFailure.store.failUserRead = true;
    await expect(accountFailure.validator.validate(accountFailure.actor)).rejects.toMatchObject({
      code: "IDENTITY_AUTHORIZATION_UNAVAILABLE",
      status: 503,
    });
  });
});

describe("P7.5 profile read/update orchestration", () => {
  it("reads a canonical profile and conditionally updates only display name/version/timestamp", async () => {
    const fixture = profileFixture();
    const before = { ...fixture.store.user };
    await expect(fixture.service.read(fixture.actor)).resolves.toMatchObject({
      displayName: "Student A",
      profileVersion: 1,
    });
    const result = await fixture.service.update({
      actor: fixture.actor,
      request: { displayName: "Student B" },
      idempotencyKey: "update-1",
      requestId: randomUUID(),
    });
    expect(result).toEqual({
      userId: fixture.actor.userId,
      profileVersion: 2,
      replayed: false,
      noOp: false,
    });
    expect(fixture.store.user).toMatchObject({
      displayName: "Student B",
      profileVersion: 2,
      userId: before.userId,
      emailMasked: before.emailMasked,
      role: before.role,
      status: before.status,
      lecturerVerified: before.lecturerVerified,
      tokenVersion: before.tokenVersion,
      createdAt: before.createdAt,
      updatedAt: now,
    });
  });

  it("replays the same key exactly, rejects a different payload, and keeps no-op version stable", async () => {
    const fixture = profileFixture();
    const command = {
      actor: fixture.actor,
      request: { displayName: "Student B" },
      idempotencyKey: "update-replay",
      requestId: randomUUID(),
    };
    const first = await fixture.service.update(command);
    const replay = await fixture.service.update(command);
    expect(replay).toEqual({ ...first, replayed: true });
    expect(fixture.store.user.profileVersion).toBe(2);
    await expect(
      fixture.service.update({ ...command, request: { displayName: "Student C" } }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
    expect(fixture.store.user.profileVersion).toBe(2);

    const noOp = await fixture.service.update({
      ...command,
      idempotencyKey: "update-no-op",
      request: { displayName: "Student B" },
    });
    expect(noOp).toMatchObject({ profileVersion: 2, noOp: true });
    expect(fixture.store.user.profileVersion).toBe(2);
  });

  it("recovers an ambiguous committed LWT without a second increment", async () => {
    const fixture = profileFixture();
    fixture.store.throwAfterProfileCommit = true;
    await expect(
      fixture.service.update({
        actor: fixture.actor,
        request: { displayName: "Recovered" },
        idempotencyKey: "ambiguous-profile",
        requestId: randomUUID(),
      }),
    ).resolves.toMatchObject({ profileVersion: 2 });
    expect(fixture.store.user).toMatchObject({ displayName: "Recovered", profileVersion: 2 });
    expect(fixture.store.profileUpdateAttempts).toBe(1);
  });

  it("allows at most one update from the same observed profile version", async () => {
    const fixture = profileFixture();
    fixture.store.blockInitialUserReads = 2;
    const results = await Promise.allSettled([
      fixture.service.update({
        actor: fixture.actor,
        request: { displayName: "Concurrent A" },
        idempotencyKey: "concurrent-a",
        requestId: randomUUID(),
      }),
      fixture.service.update({
        actor: fixture.actor,
        request: { displayName: "Concurrent B" },
        idempotencyKey: "concurrent-b",
        requestId: randomUUID(),
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: { code: "VERSION_CONFLICT", status: 409 } });
    expect(fixture.store.user.profileVersion).toBe(2);
  });

  it("does not reserve idempotency or mutate when protected validation fails", async () => {
    const fixture = profileFixture();
    fixture.store.session = { ...requireSession(fixture.store), state: "REVOKED", revokedAt: now };
    await expect(
      fixture.service.update({
        actor: fixture.actor,
        request: { displayName: "Denied" },
        idempotencyKey: "denied",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "INVALID_ACCESS_TOKEN" });
    expect(fixture.store.idempotency.size).toBe(0);
    expect(fixture.store.user).toMatchObject({ displayName: "Student A", profileVersion: 1 });
  });

  it("synchronizes a verified Lecturer projection and replays without double increment", async () => {
    const fixture = profileFixture();
    fixture.store.user = { ...fixture.store.user, role: "LECTURER", lecturerVerified: true };
    fixture.store.projection = projectionFrom(fixture.store.user);
    const actor = { ...fixture.actor, roles: ["LECTURER"] };
    const command = {
      actor,
      request: { displayName: "Lecturer B" },
      idempotencyKey: "lecturer-sync",
      requestId: randomUUID(),
    };
    const first = await fixture.service.update(command);
    const replay = await fixture.service.update(command);
    expect(first).toMatchObject({ profileVersion: 2, replayed: false });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(fixture.store.user).toMatchObject({ displayName: "Lecturer B", profileVersion: 2 });
    expect(fixture.store.projection).toMatchObject({
      displayName: "Lecturer B",
      profileVersion: 2,
      verified: true,
    });
    expect(fixture.store.projectionWriteAttempts).toBe(1);
  });

  it("recovers projection failure with the same key without a second canonical update", async () => {
    const fixture = profileFixture();
    fixture.store.user = { ...fixture.store.user, role: "LECTURER", lecturerVerified: true };
    fixture.store.projection = projectionFrom(fixture.store.user);
    fixture.store.projectionWriteFailures = 2;
    const command = {
      actor: { ...fixture.actor, roles: ["LECTURER"] },
      request: { displayName: "Recovered Lecturer" },
      idempotencyKey: "projection-recovery",
      requestId: randomUUID(),
    };
    await expect(fixture.service.update(command)).rejects.toMatchObject({
      code: "PROFILE_PERSISTENCE_UNAVAILABLE",
      status: 503,
    });
    expect(fixture.store.user).toMatchObject({ displayName: "Recovered Lecturer", profileVersion: 2 });
    expect(fixture.store.projection).toMatchObject({ profileVersion: 1 });
    expect(fixture.store.profileUpdateAttempts).toBe(1);

    await expect(fixture.service.update(command)).resolves.toMatchObject({
      profileVersion: 2,
      replayed: true,
    });
    expect(fixture.store.profileUpdateAttempts).toBe(1);
    expect(fixture.store.projection).toMatchObject({
      displayName: "Recovered Lecturer",
      profileVersion: 2,
    });
  });

  it("does not create a public projection for a Student update", async () => {
    const fixture = profileFixture();
    await fixture.service.update({
      actor: fixture.actor,
      request: { displayName: "Private Student" },
      idempotencyKey: "student-private",
      requestId: randomUUID(),
    });
    expect(fixture.store.projection).toBeUndefined();
    expect(fixture.store.projectionWriteAttempts).toBe(0);
  });
});

class MemoryProfileStore implements IdentityProfileStore {
  public readonly idempotency = new Map<string, IdempotencyRecord>();
  public session: LoginSession | undefined;
  public user: ProfileUser;
  public failSessionRead = false;
  public failUserRead = false;
  public throwAfterProfileCommit = false;
  public profileUpdateAttempts = 0;
  public blockInitialUserReads = 0;
  public projection: PublicLecturerProjection | undefined;
  public projectionWriteFailures = 0;
  public projectionWriteAttempts = 0;
  public adminProjection: AdminProjectionRow | undefined;
  #blockedUserReads = 0;
  #releaseUserReads: (() => void) | undefined;

  public constructor(user: ProfileUser, session: LoginSession) {
    this.user = cloneUser(user);
    this.session = cloneSession(session);
  }

  public async getSession(): Promise<LoginSession | undefined> {
    if (this.failSessionRead) throw new Error("session-read-failure");
    return this.session ? cloneSession(this.session) : undefined;
  }

  public async getUser(): Promise<ProfileUser | undefined> {
    if (this.failUserRead) throw new Error("user-read-failure");
    const snapshot = cloneUser(this.user);
    if (this.blockInitialUserReads > 0 && this.#blockedUserReads < this.blockInitialUserReads) {
      this.#blockedUserReads += 1;
      if (this.#blockedUserReads === this.blockInitialUserReads) this.#releaseUserReads?.();
      else await new Promise<void>((resolve) => (this.#releaseUserReads = resolve));
    }
    return snapshot;
  }

  public async updateProfile(input: {
    expected: ProfileUser;
    displayName: string;
    updatedAt: Date;
  }): Promise<boolean> {
    this.profileUpdateAttempts += 1;
    if (
      this.user.profileVersion !== input.expected.profileVersion ||
      this.user.status !== "ACTIVE" ||
      this.user.tokenVersion !== input.expected.tokenVersion ||
      this.user.role !== input.expected.role
    ) {
      return false;
    }
    this.user = {
      ...this.user,
      displayName: input.displayName,
      profileVersion: this.user.profileVersion + 1,
      updatedAt: new Date(input.updatedAt),
    };
    if (this.throwAfterProfileCommit) {
      this.throwAfterProfileCommit = false;
      throw new Error("ambiguous-after-commit");
    }
    return true;
  }

  public async getPublicProjection(): Promise<PublicLecturerProjection | undefined> {
    return this.projection
      ? { ...this.projection, updatedAt: new Date(this.projection.updatedAt) }
      : undefined;
  }

  public async insertPublicProjection(input: {
    lecturerId: string;
    displayName: string;
    profileVersion: number;
    updatedAt: Date;
  }): Promise<boolean> {
    this.projectionWriteAttempts += 1;
    if (this.projectionWriteFailures > 0) {
      this.projectionWriteFailures -= 1;
      throw new Error("projection-write-failure");
    }
    if (this.projection) return false;
    this.projection = {
      lecturerId: input.lecturerId,
      displayName: input.displayName,
      bio: null,
      avatarObjectKey: null,
      verified: true,
      profileVersion: input.profileVersion,
      updatedAt: new Date(input.updatedAt),
    };
    return true;
  }

  public async updatePublicProjection(input: {
    lecturerId: string;
    expectedVersion: number;
    displayName: string;
    nextVersion: number;
    updatedAt: Date;
  }): Promise<boolean> {
    this.projectionWriteAttempts += 1;
    if (this.projectionWriteFailures > 0) {
      this.projectionWriteFailures -= 1;
      throw new Error("projection-write-failure");
    }
    if (
      !this.projection ||
      this.projection.lecturerId !== input.lecturerId ||
      this.projection.profileVersion !== input.expectedVersion ||
      !this.projection.verified
    ) {
      return false;
    }
    this.projection = {
      ...this.projection,
      displayName: input.displayName,
      profileVersion: input.nextVersion,
      updatedAt: new Date(input.updatedAt),
    };
    return true;
  }

  public async getAdminProjection(): Promise<AdminProjectionRow | undefined> {
    return this.adminProjection
      ? { ...this.adminProjection, updatedAt: new Date(this.adminProjection.updatedAt) }
      : undefined;
  }

  public async insertAdminProjection(row: AdminProjectionRow): Promise<boolean> {
    if (this.adminProjection) return false;
    this.adminProjection = { ...row, updatedAt: new Date(row.updatedAt) };
    return true;
  }

  public async removeAdminProjection(row: AdminProjectionRow): Promise<boolean> {
    if (!this.adminProjection || this.adminProjection.userId !== row.userId) return false;
    this.adminProjection = undefined;
    return true;
  }

  public async beginIdempotency(input: {
    scope: string;
    keyHash: number;
    idempotencyKey: string;
    operationId: string;
    userId: string;
    requestChecksum: string;
    createdAt: Date;
  }): Promise<{ created: boolean; record: IdempotencyRecord }> {
    const key = recordKey(input.scope, input.keyHash, input.idempotencyKey);
    const existing = this.idempotency.get(key);
    if (existing) return { created: false, record: { ...existing } };
    const record: IdempotencyRecord = {
      operationId: input.operationId,
      resourceId: input.userId,
      resultCode: 0,
      status: "IN_PROGRESS",
      requestChecksum: input.requestChecksum,
      createdAt: new Date(input.createdAt),
    };
    this.idempotency.set(key, record);
    return { created: true, record: { ...record } };
  }

  public async getIdempotency(scope: string, keyHash: number, idempotencyKey: string) {
    const value = this.idempotency.get(recordKey(scope, keyHash, idempotencyKey));
    return value ? { ...value } : undefined;
  }

  public async prepareIdempotency(input: {
    scope: string;
    keyHash: number;
    idempotencyKey: string;
    operationId: string;
    metadata: ProfileUpdateMetadata;
  }): Promise<boolean> {
    const key = recordKey(input.scope, input.keyHash, input.idempotencyKey);
    const record = this.idempotency.get(key);
    if (!record || record.operationId !== input.operationId || record.status !== "IN_PROGRESS") return false;
    this.idempotency.set(key, {
      ...record,
      status: "PREPARED",
      requestChecksum: serializeProfileUpdateMetadata(input.metadata),
    });
    return true;
  }

  public async completeIdempotency(input: {
    scope: string;
    keyHash: number;
    idempotencyKey: string;
    operationId: string;
    metadata: ProfileUpdateMetadata;
  }): Promise<boolean> {
    const key = recordKey(input.scope, input.keyHash, input.idempotencyKey);
    const record = this.idempotency.get(key);
    if (!record || record.operationId !== input.operationId || record.status !== "PREPARED") return false;
    this.idempotency.set(key, {
      ...record,
      status: "COMPLETE",
      resultCode: 200,
      requestChecksum: serializeProfileUpdateMetadata(input.metadata),
    });
    return true;
  }

  public async transitionIdempotency(input: {
    scope: string;
    keyHash: number;
    idempotencyKey: string;
    operationId: string;
    expectedStatus: string;
    nextStatus: string;
    metadata: ProfileUpdateMetadata;
    resultCode?: number;
  }): Promise<boolean> {
    const key = recordKey(input.scope, input.keyHash, input.idempotencyKey);
    const record = this.idempotency.get(key);
    if (!record || record.operationId !== input.operationId || record.status !== input.expectedStatus)
      return false;
    this.idempotency.set(key, {
      ...record,
      status: input.nextStatus,
      resultCode: input.resultCode ?? 0,
      requestChecksum: serializeProfileUpdateMetadata(input.metadata),
    });
    return true;
  }

  public async failIdempotency(input: {
    scope: string;
    keyHash: number;
    idempotencyKey: string;
    operationId: string;
    resultCode: number;
  }): Promise<void> {
    const key = recordKey(input.scope, input.keyHash, input.idempotencyKey);
    const record = this.idempotency.get(key);
    if (record?.operationId === input.operationId) {
      this.idempotency.set(key, { ...record, status: "FAILED", resultCode: input.resultCode });
    }
  }
}

function profileFixture() {
  const userId = randomUUID();
  const sessionId = randomUUID();
  const user: ProfileUser = {
    userId,
    emailMasked: "s***@example.test",
    displayName: "Student A",
    role: "STUDENT",
    status: "ACTIVE",
    lecturerVerified: false,
    tokenVersion: 1,
    credentialVersion: 1,
    normalizedEmail: "student@example.test",
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
  const actor: ActorContext = {
    userId,
    roles: ["STUDENT"],
    sessionId,
    tokenVersion: 1,
    correlationId: randomUUID(),
    issuedAt: Math.floor(now.getTime() / 1_000),
    expiresAt: Math.floor(now.getTime() / 1_000) + 30,
  };
  const store = new MemoryProfileStore(user, session);
  const metrics = createMetrics("identity-profile-test");
  const logger = createLogger({ service: "identity-service", environment: "test", level: "silent" });
  const validator = new ProtectedIdentityRequestValidator(store, metrics, logger, () => new Date(now));
  const service = new ProfileService(store, validator, metrics, logger, () => new Date(now));
  return { actor, store, validator, service };
}

function requireSession(store: MemoryProfileStore): LoginSession {
  if (!store.session) throw new Error("Test session is unavailable");
  return store.session;
}

function recordKey(scope: string, keyHash: number, idempotencyKey: string): string {
  return `${scope}|${String(keyHash)}|${idempotencyKey}`;
}

function cloneUser(value: ProfileUser): ProfileUser {
  return { ...value, createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt) };
}

function cloneSession(value: LoginSession): LoginSession {
  return {
    ...value,
    expiresAt: new Date(value.expiresAt),
    revokedAt: value.revokedAt ? new Date(value.revokedAt) : null,
    createdAt: new Date(value.createdAt),
  };
}

function projectionFrom(user: ProfileUser): PublicLecturerProjection {
  return {
    lecturerId: user.userId,
    displayName: user.displayName,
    bio: "Public bio",
    avatarObjectKey: "private/avatar-key",
    verified: true,
    profileVersion: user.profileVersion,
    updatedAt: new Date(user.updatedAt),
  };
}
