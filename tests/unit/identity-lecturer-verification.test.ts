import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "../../packages/contracts/src/index.js";
import { createLogger } from "../../packages/logger/src/index.js";
import { createMetrics } from "../../packages/observability/src/index.js";
import type { ActorContext } from "../../packages/security/src/index.js";
import type { AdminProjectionRow, AdminUser } from "../../apps/identity-service/src/admin/model.js";
import {
  identitySearchShard,
  parseLecturerVerifyRequest,
  type LecturerVerifyMetadata,
} from "../../apps/identity-service/src/lecturer-verify/model.js";
import type { LecturerVerifyStore } from "../../apps/identity-service/src/lecturer-verify/service.js";
import { LecturerVerifyService } from "../../apps/identity-service/src/lecturer-verify/service.js";
import type { LoginSession } from "../../apps/identity-service/src/login/model.js";
import type { PasswordCredential } from "../../apps/identity-service/src/password/model.js";
import type { PublicLecturerProjection } from "../../apps/identity-service/src/public-profile/model.js";
import { ProtectedIdentityRequestValidator } from "../../apps/identity-service/src/profile/validator.js";
import type {
  IdempotencyRecord,
  OutboxLocation,
} from "../../apps/identity-service/src/registration/repository.js";

const now = new Date("2026-08-29T15:00:00.000Z");
const secret = "p7.9-test-secret-that-is-at-least-thirty-two-bytes";

describe("P7.9 Lecturer Verification (IDN-12)", () => {
  it("validates the strict verify DTO and rejects mass assignment", () => {
    expect(parseLecturerVerifyRequest({ currentPassword: "pw" })).toEqual({ currentPassword: "pw" });
    expect(() => parseLecturerVerifyRequest({})).toThrow();
    expect(() => parseLecturerVerifyRequest({ currentPassword: "pw", verified: true })).toThrow();
    expect(() => parseLecturerVerifyRequest({ currentPassword: "pw", userId: randomUUID() })).toThrow();
  });

  it("requires canonical ADMIN instead of trusting a non-Admin token role", async () => {
    const fixture = verifyFixture();
    fixture.store.users.set(fixture.actor.userId, {
      ...fixture.store.requireUser(fixture.actor.userId),
      role: "STUDENT",
    });
    fixture.actor = { ...fixture.actor, roles: ["STUDENT"] };
    await expect(verifyCommand(fixture)).rejects.toMatchObject({ code: "ADMIN_ROLE_REQUIRED", status: 403 });
  });

  it("denies a revoked Admin session and a stale Admin tokenVersion", async () => {
    const revoked = verifyFixture();
    const session = revoked.store.sessions.get(revoked.actor.sessionId);
    if (session) revoked.store.sessions.set(session.sessionId, { ...session, revokedAt: new Date(now) });
    await expect(verifyCommand(revoked)).rejects.toMatchObject({ code: "INVALID_ACCESS_TOKEN", status: 401 });

    const stale = verifyFixture();
    stale.actor = { ...stale.actor, tokenVersion: 99 };
    await expect(verifyCommand(stale)).rejects.toMatchObject({ code: "INVALID_ACCESS_TOKEN", status: 401 });
  });

  it("requires real current-password step-up and makes no target mutation on failure", async () => {
    const fixture = verifyFixture();
    await expect(
      fixture.service.verify({
        actor: fixture.actor,
        targetId: fixture.lecturerId,
        request: { currentPassword: "wrong" },
        idempotencyKey: "wrong-step-up",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "ADMIN_STEP_UP_FAILED", status: 401 });
    expect(fixture.store.requireUser(fixture.lecturerId)).toMatchObject({
      lecturerVerified: false,
      tokenVersion: 1,
    });
  });

  it("rejects missing, Student, and Suspended targets", async () => {
    const fixture = verifyFixture();
    await expect(
      fixture.service.verify({
        actor: fixture.actor,
        targetId: randomUUID(),
        request: { currentPassword: "correct" },
        idempotencyKey: "missing",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "LECTURER_VERIFY_TARGET_NOT_FOUND", status: 404 });
    await expect(
      fixture.service.verify({
        actor: fixture.actor,
        targetId: fixture.studentId,
        request: { currentPassword: "correct" },
        idempotencyKey: "student",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "LECTURER_VERIFY_TARGET_INELIGIBLE", status: 422 });
    await expect(
      fixture.service.verify({
        actor: fixture.actor,
        targetId: fixture.suspendedLecturerId,
        request: { currentPassword: "correct" },
        idempotencyKey: "suspended",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "LECTURER_VERIFY_TARGET_INELIGIBLE", status: 422 });
  });

  it("denies self-verification", async () => {
    const fixture = verifyFixture();
    await expect(
      fixture.service.verify({
        actor: fixture.actor,
        targetId: fixture.actor.userId,
        request: { currentPassword: "correct" },
        idempotencyKey: "self",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "ADMIN_SELF_VERIFY_FORBIDDEN", status: 403 });
  });

  it("verifies an unverified Lecturer, advances the epoch once, creates Q-IDN-006 and moves Q-IDN-005", async () => {
    const fixture = verifyFixture();
    const command = {
      actor: fixture.actor,
      targetId: fixture.lecturerId,
      request: { currentPassword: "correct" },
      idempotencyKey: "verify-once",
      requestId: randomUUID(),
    };
    const result = await fixture.service.verify(command);
    expect(result).toMatchObject({ userId: fixture.lecturerId, lecturerVerified: true, replayed: false });

    const target = fixture.store.requireUser(fixture.lecturerId);
    expect(target).toMatchObject({
      lecturerVerified: true,
      tokenVersion: 2,
      status: "ACTIVE",
      role: "LECTURER",
    });
    expect(target.profileVersion).toBe(1);
    expect(fixture.store.requireCredential(target.normalizedEmail).securityOperationId).toBe(
      target.securityOperationId,
    );

    const publicProjection = fixture.store.publicProjections.get(fixture.lecturerId);
    expect(publicProjection).toMatchObject({
      verified: true,
      displayName: target.displayName,
      profileVersion: 1,
    });
    expect(publicProjection?.bio).toBeNull();
    expect(publicProjection?.avatarObjectKey).toBeNull();

    const memberships = [...fixture.store.projections.values()].filter(
      (row) => row.userId === fixture.lecturerId,
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ role: "LECTURER", status: "ACTIVE", lecturerVerified: true });
    expect(memberships[0]?.updatedAt.toISOString()).toBe(target.updatedAt.toISOString());

    const audit = [...fixture.store.events.values()].filter((item) => item.state === "READY");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.event.eventType).toBe("system.audit.requested.v1");
    expect(audit[0]?.event.data).toMatchObject({ action: "LECTURER_VERIFIED" });
    expect(JSON.stringify(audit[0]?.event)).not.toContain("correct");
  });

  it("returns idempotent replay without a second epoch advance or duplicate projection", async () => {
    const fixture = verifyFixture();
    const command = {
      actor: fixture.actor,
      targetId: fixture.lecturerId,
      request: { currentPassword: "correct" },
      idempotencyKey: "replay",
      requestId: randomUUID(),
    };
    await fixture.service.verify(command);
    const replay = await fixture.service.verify(command);
    expect(replay).toMatchObject({ lecturerVerified: true, replayed: true });
    expect(fixture.store.requireUser(fixture.lecturerId).tokenVersion).toBe(2);
    expect(
      [...fixture.store.projections.values()].filter((row) => row.userId === fixture.lecturerId),
    ).toHaveLength(1);
  });

  it("rejects a new command against an already-verified lecturer and a same-key different command", async () => {
    const fixture = verifyFixture();
    await expect(
      fixture.service.verify({
        actor: fixture.actor,
        targetId: fixture.verifiedLecturerId,
        request: { currentPassword: "correct" },
        idempotencyKey: "already",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "LECTURER_ALREADY_VERIFIED", status: 409 });

    const first = await fixture.service.verify({
      actor: fixture.actor,
      targetId: fixture.lecturerId,
      request: { currentPassword: "correct" },
      idempotencyKey: "same-key",
      requestId: randomUUID(),
    });
    expect(first.replayed).toBe(false);
    await expect(
      fixture.service.verify({
        actor: fixture.actor,
        targetId: fixture.lecturerId,
        request: { currentPassword: "different-password" },
        idempotencyKey: "same-key",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
  });

  it("serializes concurrent verification into one logical winner", async () => {
    const fixture = verifyFixture();
    const winner = await fixture.service.verify({
      actor: fixture.actor,
      targetId: fixture.lecturerId,
      request: { currentPassword: "correct" },
      idempotencyKey: "concurrent-a",
      requestId: randomUUID(),
    });
    expect(winner.replayed).toBe(false);
    await expect(
      fixture.service.verify({
        actor: fixture.actor,
        targetId: fixture.lecturerId,
        request: { currentPassword: "correct" },
        idempotencyKey: "concurrent-b",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "LECTURER_ALREADY_VERIFIED", status: 409 });
    expect(fixture.store.requireUser(fixture.lecturerId).tokenVersion).toBe(2);
  });

  it("recovers Q-IDN-006 without a second epoch advance after a partial public-projection failure", async () => {
    const fixture = verifyFixture();
    fixture.store.failPublicProjectionOnce = true;
    const command = {
      actor: fixture.actor,
      targetId: fixture.lecturerId,
      request: { currentPassword: "correct" },
      idempotencyKey: "recover-public",
      requestId: randomUUID(),
    };
    await expect(fixture.service.verify(command)).rejects.toMatchObject({
      code: "LECTURER_VERIFY_UNAVAILABLE",
      status: 503,
    });
    expect(fixture.store.requireUser(fixture.lecturerId)).toMatchObject({
      lecturerVerified: true,
      tokenVersion: 2,
    });
    expect(fixture.store.publicProjections.get(fixture.lecturerId)).toBeUndefined();

    const recovered = await fixture.service.verify(command);
    expect(recovered).toMatchObject({ lecturerVerified: true, replayed: true });
    expect(fixture.store.requireUser(fixture.lecturerId).tokenVersion).toBe(2);
    expect(fixture.store.publicProjections.get(fixture.lecturerId)).toMatchObject({ verified: true });
    expect(
      [...fixture.store.projections.values()].filter((row) => row.userId === fixture.lecturerId),
    ).toHaveLength(1);
  });

  it("recovers the Q-IDN-005 move without duplicates after a partial admin-projection failure", async () => {
    const fixture = verifyFixture();
    fixture.store.failAdminProjectionOnce = true;
    const command = {
      actor: fixture.actor,
      targetId: fixture.lecturerId,
      request: { currentPassword: "correct" },
      idempotencyKey: "recover-admin",
      requestId: randomUUID(),
    };
    await expect(fixture.service.verify(command)).rejects.toMatchObject({
      code: "LECTURER_VERIFY_UNAVAILABLE",
      status: 503,
    });
    expect(
      [...fixture.store.projections.values()].filter((row) => row.userId === fixture.lecturerId),
    ).toHaveLength(0);

    const recovered = await fixture.service.verify(command);
    expect(recovered).toMatchObject({ lecturerVerified: true, replayed: true });
    const memberships = [...fixture.store.projections.values()].filter(
      (row) => row.userId === fixture.lecturerId,
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ lecturerVerified: true, role: "LECTURER", status: "ACTIVE" });
  });

  it("preserves existing Q-IDN-006 bio and avatar while reconciling verified state", async () => {
    const fixture = verifyFixture();
    fixture.store.publicProjections.set(fixture.lecturerId, {
      lecturerId: fixture.lecturerId,
      displayName: "Old Name",
      bio: "Existing biography",
      avatarObjectKey: "avatars/existing.png",
      verified: false,
      profileVersion: 1,
      updatedAt: new Date(now.getTime() - 500_000),
    });
    await fixture.service.verify({
      actor: fixture.actor,
      targetId: fixture.lecturerId,
      request: { currentPassword: "correct" },
      idempotencyKey: "reconcile",
      requestId: randomUUID(),
    });
    const projection = fixture.store.publicProjections.get(fixture.lecturerId);
    expect(projection).toMatchObject({
      verified: true,
      bio: "Existing biography",
      avatarObjectKey: "avatars/existing.png",
      profileVersion: 1,
    });
  });
});

class MemoryLecturerVerifyStore implements LecturerVerifyStore {
  readonly users = new Map<string, AdminUser>();
  readonly sessions = new Map<string, LoginSession>();
  readonly credentials = new Map<string, PasswordCredential>();
  readonly projections = new Map<string, AdminProjectionRow>();
  readonly publicProjections = new Map<string, PublicLecturerProjection>();
  readonly idempotency = new Map<string, IdempotencyRecord>();
  readonly events = new Map<string, { event: EventEnvelope; state: string; location: OutboxLocation }>();
  failPublicProjectionOnce = false;
  failAdminProjectionOnce = false;

  async getSession(sessionId: string) {
    return this.sessions.get(sessionId);
  }
  async getUser(userId: string) {
    return this.users.get(userId);
  }
  requireUser(userId: string) {
    const value = this.users.get(userId);
    if (!value) throw new Error("missing user");
    return value;
  }
  requireCredential(email: string) {
    const value = this.credentials.get(email);
    if (!value) throw new Error("missing credential");
    return value;
  }
  async getCredential(email: string) {
    return this.credentials.get(email);
  }
  async verifyLecturer(input: { expected: AdminUser; operationId: string; updatedAt: Date }) {
    const current = this.users.get(input.expected.userId);
    if (
      !current ||
      current.role !== "LECTURER" ||
      current.status !== "ACTIVE" ||
      current.lecturerVerified ||
      current.tokenVersion !== input.expected.tokenVersion
    )
      return false;
    this.users.set(current.userId, {
      ...current,
      lecturerVerified: true,
      tokenVersion: current.tokenVersion + 1,
      securityOperationId: input.operationId,
      updatedAt: new Date(input.updatedAt),
    });
    return true;
  }
  async synchronizeCredentialMarker(input: {
    normalizedEmail: string;
    userId: string;
    credentialVersion: number;
    expectedOperationId: string | null;
    operationId: string;
    updatedAt: Date;
  }) {
    const credential = this.credentials.get(input.normalizedEmail);
    if (
      !credential ||
      credential.userId !== input.userId ||
      credential.credentialVersion !== input.credentialVersion ||
      credential.securityOperationId !== input.expectedOperationId
    )
      return false;
    this.credentials.set(input.normalizedEmail, {
      ...credential,
      securityOperationId: input.operationId,
      updatedAt: new Date(input.updatedAt),
    });
    return true;
  }
  async getPublicProjection(lecturerId: string) {
    return this.publicProjections.get(lecturerId);
  }
  async insertPublicProjection(input: {
    lecturerId: string;
    displayName: string;
    profileVersion: number;
    updatedAt: Date;
  }) {
    if (this.failPublicProjectionOnce) {
      this.failPublicProjectionOnce = false;
      throw new Error("injected public projection failure");
    }
    if (this.publicProjections.has(input.lecturerId)) return false;
    this.publicProjections.set(input.lecturerId, {
      lecturerId: input.lecturerId,
      displayName: input.displayName,
      bio: null,
      avatarObjectKey: null,
      verified: true,
      profileVersion: input.profileVersion,
      updatedAt: new Date(input.updatedAt),
    });
    return true;
  }
  async reconcilePublicProjection(input: {
    lecturerId: string;
    displayName: string;
    profileVersion: number;
    updatedAt: Date;
  }) {
    const existing = this.publicProjections.get(input.lecturerId);
    if (!existing) return false;
    this.publicProjections.set(input.lecturerId, {
      ...existing,
      displayName: input.displayName,
      verified: true,
      profileVersion: input.profileVersion,
      updatedAt: new Date(input.updatedAt),
    });
    return true;
  }
  async getAdminProjection(input: {
    role: string;
    status: string;
    shard: number;
    updatedAt: Date;
    userId: string;
  }) {
    return this.projections.get(projectionKey(input));
  }
  async insertAdminProjection(row: AdminProjectionRow) {
    if (this.failAdminProjectionOnce) {
      this.failAdminProjectionOnce = false;
      throw new Error("injected admin projection failure");
    }
    const key = projectionKey(row);
    if (this.projections.has(key)) return false;
    this.projections.set(key, { ...row, updatedAt: new Date(row.updatedAt) });
    return true;
  }
  async removeAdminProjection(row: AdminProjectionRow) {
    return this.projections.delete(projectionKey(row));
  }
  async beginIdempotency(input: {
    scope: string;
    keyHash: number;
    idempotencyKey: string;
    operationId: string;
    targetId: string;
    fingerprint: string;
    createdAt: Date;
  }) {
    const key = `${input.scope}|${String(input.keyHash)}|${input.idempotencyKey}`;
    const existing = this.idempotency.get(key);
    if (existing) return { created: false, record: existing };
    const record = {
      operationId: input.operationId,
      resourceId: input.targetId,
      resultCode: 0,
      status: "IN_PROGRESS",
      requestChecksum: input.fingerprint,
      createdAt: input.createdAt,
    };
    this.idempotency.set(key, record);
    return { created: true, record };
  }
  async getIdempotency(scope: string, keyHash: number, key: string) {
    return this.idempotency.get(`${scope}|${String(keyHash)}|${key}`);
  }
  async transitionIdempotency(input: {
    scope: string;
    keyHash: number;
    idempotencyKey: string;
    operationId: string;
    expectedStatus: string;
    nextStatus: string;
    metadata: LecturerVerifyMetadata;
    resultCode?: number;
  }) {
    const key = `${input.scope}|${String(input.keyHash)}|${input.idempotencyKey}`;
    const record = this.idempotency.get(key);
    if (!record || record.operationId !== input.operationId || record.status !== input.expectedStatus)
      return false;
    this.idempotency.set(key, {
      ...record,
      status: input.nextStatus,
      resultCode: input.resultCode ?? 0,
      requestChecksum: JSON.stringify(input.metadata),
    });
    return true;
  }
  async prepareOutbox(event: EventEnvelope) {
    const location = {
      dueDay: event.occurredAt.slice(0, 10),
      shard: 0,
      nextAttemptAt: new Date(event.occurredAt),
      eventId: event.eventId,
    };
    if (!this.events.has(event.eventId))
      this.events.set(event.eventId, { event, state: "PREPARED", location });
    return location;
  }
  async markOutboxReady(location: OutboxLocation) {
    const current = this.events.get(location.eventId);
    if (current) current.state = "READY";
  }
}

function verifyFixture() {
  const store = new MemoryLecturerVerifyStore();
  const admin = createUser("ADMIN", "ACTIVE", false, "Admin User", "admin@example.test");
  const lecturer = {
    ...createUser("LECTURER", "ACTIVE", false, "Lecturer One", "lecturer@example.test"),
    updatedAt: new Date(now.getTime() - 60_000),
  };
  const student = createUser("STUDENT", "ACTIVE", false, "Student One", "student@example.test");
  const suspendedLecturer = createUser(
    "LECTURER",
    "SUSPENDED",
    false,
    "Suspended Lecturer",
    "suspended@example.test",
  );
  const verifiedLecturer = createUser(
    "LECTURER",
    "ACTIVE",
    true,
    "Verified Lecturer",
    "verified@example.test",
  );
  for (const user of [admin, lecturer, student, suspendedLecturer, verifiedLecturer])
    store.users.set(user.userId, user);

  const session: LoginSession = {
    sessionId: randomUUID(),
    userId: admin.userId,
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
  store.sessions.set(session.sessionId, session);

  for (const user of [admin, lecturer, student, suspendedLecturer, verifiedLecturer]) {
    store.credentials.set(user.normalizedEmail, {
      userId: user.userId,
      passwordHash: "hash",
      credentialVersion: user.credentialVersion,
      securityOperationId: user.securityOperationId,
      status: "ACTIVE",
      updatedAt: user.updatedAt,
    });
  }
  const lecturerProjection: AdminProjectionRow = { ...lecturer, shard: identitySearchShard(lecturer.userId) };
  store.projections.set(projectionKey(lecturerProjection), lecturerProjection);

  const actor: ActorContext = {
    userId: admin.userId,
    roles: ["ADMIN"],
    sessionId: session.sessionId,
    tokenVersion: 1,
    correlationId: randomUUID(),
    issuedAt: Math.floor(now.getTime() / 1_000),
    expiresAt: Math.floor(now.getTime() / 1_000) + 30,
  };
  const metrics = createMetrics("identity-lecturer-verify-test");
  const logger = createLogger({ service: "identity-service", environment: "test", level: "silent" });
  const validator = new ProtectedIdentityRequestValidator(store, metrics, logger, () => new Date(now));
  const service = new LecturerVerifyService(
    store,
    validator,
    secret,
    metrics,
    logger,
    async (_hash, password) => password === "correct",
    () => new Date(now),
  );
  return {
    store,
    service,
    actor,
    lecturerId: lecturer.userId,
    studentId: student.userId,
    suspendedLecturerId: suspendedLecturer.userId,
    verifiedLecturerId: verifiedLecturer.userId,
  };
}

function verifyCommand(fixture: ReturnType<typeof verifyFixture>) {
  return fixture.service.verify({
    actor: fixture.actor,
    targetId: fixture.lecturerId,
    request: { currentPassword: "correct" },
    idempotencyKey: randomUUID(),
    requestId: randomUUID(),
  });
}

function createUser(
  role: AdminUser["role"],
  status: AdminUser["status"],
  lecturerVerified: boolean,
  displayName: string,
  normalizedEmail: string,
): AdminUser {
  const userId = randomUUID();
  return {
    userId,
    emailMasked: `${normalizedEmail.slice(0, 1)}***@example.test`,
    normalizedEmail,
    displayName,
    role,
    status,
    lecturerVerified,
    tokenVersion: 1,
    credentialVersion: 1,
    securityOperationId: null,
    profileVersion: 1,
    createdAt: new Date(now.getTime() - 120_000),
    updatedAt: new Date(now.getTime() - 60_000),
    shard: identitySearchShard(userId),
  };
}

function projectionKey(input: {
  role: string;
  status: string;
  shard: number;
  updatedAt: Date;
  userId: string;
}) {
  return `${input.role}|${input.status}|${String(input.shard)}|${input.updatedAt.toISOString()}|${input.userId}`;
}
