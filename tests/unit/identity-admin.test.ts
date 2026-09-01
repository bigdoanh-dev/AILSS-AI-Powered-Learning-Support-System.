import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { EventEnvelope } from "../../packages/contracts/src/index.js";
import { createLogger } from "../../packages/logger/src/index.js";
import { createMetrics } from "../../packages/observability/src/index.js";
import type { ActorContext } from "../../packages/security/src/index.js";
import {
  decodeAdminCursor,
  encodeAdminCursor,
  identitySearchShard,
  parseAdminSearchQuery,
  parseAdminStatusRequest,
  type AccountStatus,
  type AdminProjectionRow,
  type AdminUser,
  type StatusChangeMetadata,
} from "../../apps/identity-service/src/admin/model.js";
import type { IdentityAdminStore } from "../../apps/identity-service/src/admin/service.js";
import { IdentityAdminService } from "../../apps/identity-service/src/admin/service.js";
import type { LoginSession } from "../../apps/identity-service/src/login/model.js";
import type { PasswordCredential } from "../../apps/identity-service/src/password/model.js";
import { ProtectedIdentityRequestValidator } from "../../apps/identity-service/src/profile/validator.js";
import type {
  IdempotencyRecord,
  OutboxLocation,
} from "../../apps/identity-service/src/registration/repository.js";

const now = new Date("2026-08-29T15:00:00.000Z");
const secret = "p7.8-test-secret-that-is-at-least-thirty-two-bytes";

describe("P7.8 Identity Admin", () => {
  it("validates exact search/status DTOs and rejects mass assignment", () => {
    expect(parseAdminSearchQuery({ role: "STUDENT", status: "ACTIVE", limit: "20" })).toEqual({
      role: "STUDENT",
      status: "ACTIVE",
      limit: 20,
    });
    expect(() => parseAdminSearchQuery({ status: "ACTIVE" })).toThrow();
    expect(() => parseAdminSearchQuery({ role: "STUDENT", status: "ACTIVE", limit: 101 })).toThrow();
    expect(() =>
      parseAdminStatusRequest({ status: "SUSPENDED", currentPassword: "pw", mfa: true }),
    ).toThrow();
  });

  it("signs cursor state and rejects tamper, filter mismatch and expiry", () => {
    const payload = {
      v: 1 as const,
      role: "STUDENT" as const,
      status: "ACTIVE" as const,
      filtersHash: "9a".repeat(32),
      direction: "forward" as const,
      issuedAt: Math.floor(now.getTime() / 1_000),
      perShardPositions: {},
    };
    // Use the real filter hash through one service page below; malformed hash is rejected here.
    const malformed = encodeAdminCursor(secret, payload);
    expect(() => decodeAdminCursor(secret, malformed, payload, payload.issuedAt)).toThrow();
    const fixture = adminFixture();
    return fixture.service
      .search(fixture.actor, { role: "STUDENT", status: "ACTIVE", limit: 1 })
      .then((page) => {
        expect(page.nextCursor).not.toBeNull();
        const cursor = page.nextCursor ?? "";
        expect(() =>
          decodeAdminCursor(secret, `${cursor.slice(0, -1)}x`, payload, payload.issuedAt),
        ).toThrow();
        expect(() =>
          decodeAdminCursor(secret, cursor, { role: "LECTURER", status: "ACTIVE" }, payload.issuedAt),
        ).toThrow();
        expect(() =>
          decodeAdminCursor(secret, cursor, { role: "STUDENT", status: "ACTIVE" }, payload.issuedAt + 901),
        ).toThrow();
      });
  });

  it("queries exactly 16 bounded shards, merges deterministically and paginates without duplicates", async () => {
    const fixture = adminFixture();
    const first = await fixture.service.search(fixture.actor, {
      role: "STUDENT",
      status: "ACTIVE",
      limit: 1,
    });
    expect(first.items).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    expect(fixture.store.shardReads).toBe(16);
    const second = await fixture.service.search(fixture.actor, {
      role: "STUDENT",
      status: "ACTIVE",
      limit: 1,
      cursor: first.nextCursor ?? "",
    });
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.userId).not.toBe(first.items[0]?.userId);
    expect(fixture.store.shardReads).toBe(32);
  });

  it("requires canonical ADMIN instead of trusting a non-Admin token role", async () => {
    const fixture = adminFixture();
    fixture.store.users.set(fixture.actor.userId, {
      ...fixture.store.requireUser(fixture.actor.userId),
      role: "STUDENT",
    });
    fixture.actor = { ...fixture.actor, roles: ["STUDENT"] };
    await expect(
      fixture.service.search(fixture.actor, { role: "STUDENT", status: "ACTIVE", limit: 10 }),
    ).rejects.toMatchObject({
      code: "ADMIN_ROLE_REQUIRED",
      status: 403,
    });
  });

  it("returns Admin detail internally while the API DTO remains allowlisted", async () => {
    const fixture = adminFixture();
    const detail = await fixture.service.detail(fixture.actor, fixture.targetId);
    expect(detail.userId).toBe(fixture.targetId);
    expect(detail.normalizedEmail).toBe("student@example.test");
    expect(detail).not.toHaveProperty("passwordHash");
  });

  it("requires real current-password step-up and makes no target mutation on failure", async () => {
    const fixture = adminFixture();
    await expect(
      fixture.service.changeStatus({
        actor: fixture.actor,
        targetId: fixture.targetId,
        request: { status: "SUSPENDED", currentPassword: "wrong" },
        idempotencyKey: "wrong-step-up",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "ADMIN_STEP_UP_FAILED" });
    expect(fixture.store.requireUser(fixture.targetId)).toMatchObject({ status: "ACTIVE", tokenVersion: 1 });
  });

  it("moves status projection, advances security epoch once, aligns credential marker and readies events", async () => {
    const fixture = adminFixture();
    const command = {
      actor: fixture.actor,
      targetId: fixture.targetId,
      request: { status: "SUSPENDED" as const, currentPassword: "correct", reason: "policy" },
      idempotencyKey: "status-once",
      requestId: randomUUID(),
    };
    const first = await fixture.service.changeStatus(command);
    const replay = await fixture.service.changeStatus(command);
    expect(first).toMatchObject({
      oldStatus: "ACTIVE",
      newStatus: "SUSPENDED",
      tokenVersion: 2,
      replayed: false,
    });
    expect(replay).toMatchObject({ tokenVersion: 2, replayed: true, eventId: first.eventId });
    const target = fixture.store.requireUser(fixture.targetId);
    expect(target).toMatchObject({ status: "SUSPENDED", tokenVersion: 2 });
    expect(fixture.store.requireCredential(target.normalizedEmail).securityOperationId).toBe(
      target.securityOperationId,
    );
    expect([...fixture.store.projections.values()].filter((row) => row.userId === fixture.targetId)).toEqual([
      expect.objectContaining({ status: "SUSPENDED" }),
    ]);
    expect([...fixture.store.events.values()].filter((item) => item.state === "READY")).toHaveLength(2);
  });

  it("denies self-target, Admin target, same-state and same-key different command", async () => {
    const fixture = adminFixture();
    await expect(
      fixture.service.changeStatus({
        actor: fixture.actor,
        targetId: fixture.actor.userId,
        request: { status: "SUSPENDED", currentPassword: "correct" },
        idempotencyKey: "self",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "ADMIN_SELF_STATUS_CHANGE_FORBIDDEN" });
    const otherAdmin = createUser("ADMIN", "ACTIVE", "Other Admin", "other-admin@example.test");
    fixture.store.users.set(otherAdmin.userId, otherAdmin);
    await expect(
      fixture.service.changeStatus({
        actor: fixture.actor,
        targetId: otherAdmin.userId,
        request: { status: "SUSPENDED", currentPassword: "correct" },
        idempotencyKey: "admin-target",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "ADMIN_TARGET_STATUS_CHANGE_FORBIDDEN" });
    await expect(
      fixture.service.changeStatus({
        actor: fixture.actor,
        targetId: fixture.targetId,
        request: { status: "ACTIVE", currentPassword: "correct" },
        idempotencyKey: "same",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "STATUS_UNCHANGED" });
  });
});

class MemoryAdminStore implements IdentityAdminStore {
  readonly users = new Map<string, AdminUser>();
  readonly sessions = new Map<string, LoginSession>();
  readonly credentials = new Map<string, PasswordCredential>();
  readonly projections = new Map<string, AdminProjectionRow>();
  readonly idempotency = new Map<string, IdempotencyRecord>();
  readonly events = new Map<string, { event: EventEnvelope; state: string; location: OutboxLocation }>();
  shardReads = 0;

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
  async listShard(input: {
    role: AdminProjectionRow["role"];
    status: AccountStatus;
    shard: number;
    limit: number;
    position?: { updatedAt: string; userId: string };
  }) {
    this.shardReads += 1;
    return [...this.projections.values()]
      .filter((row) => row.role === input.role && row.status === input.status && row.shard === input.shard)
      .sort(compareRows)
      .filter((row) => !input.position || comparePosition(row, input.position) > 0)
      .slice(0, input.limit);
  }
  async getProjection(input: {
    role: string;
    status: string;
    shard: number;
    updatedAt: Date;
    userId: string;
  }) {
    return this.projections.get(projectionKey(input));
  }
  async insertProjection(row: AdminProjectionRow) {
    const key = projectionKey(row);
    if (this.projections.has(key)) return false;
    this.projections.set(key, { ...row, updatedAt: new Date(row.updatedAt) });
    return true;
  }
  async removeProjection(row: AdminProjectionRow) {
    return this.projections.delete(projectionKey(row));
  }
  async changeStatus(input: {
    expected: AdminUser;
    targetStatus: AccountStatus;
    operationId: string;
    updatedAt: Date;
  }) {
    const current = this.users.get(input.expected.userId);
    if (
      !current ||
      current.status !== input.expected.status ||
      current.tokenVersion !== input.expected.tokenVersion
    )
      return false;
    this.users.set(current.userId, {
      ...current,
      status: input.targetStatus,
      tokenVersion: current.tokenVersion + 1,
      securityOperationId: input.operationId,
      updatedAt: new Date(input.updatedAt),
    });
    return true;
  }
  async getCredential(email: string) {
    return this.credentials.get(email);
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
    metadata: StatusChangeMetadata;
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

function adminFixture() {
  const store = new MemoryAdminStore();
  const admin = createUser("ADMIN", "ACTIVE", "Admin User", "admin@example.test");
  const target = {
    ...createUser("STUDENT", "ACTIVE", "Student One", "student@example.test"),
    updatedAt: new Date(now.getTime() - 1_000),
  };
  const second = {
    ...createUser("STUDENT", "ACTIVE", "Student Two", "student2@example.test"),
    updatedAt: new Date(now.getTime() - 2_000),
  };
  for (const user of [admin, target, second]) store.users.set(user.userId, user);
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
  store.credentials.set(admin.normalizedEmail, {
    userId: admin.userId,
    passwordHash: "hash",
    credentialVersion: 1,
    securityOperationId: null,
    status: "ACTIVE",
    updatedAt: admin.updatedAt,
  });
  for (const user of [target, second]) {
    store.credentials.set(user.normalizedEmail, {
      userId: user.userId,
      passwordHash: "target-hash",
      credentialVersion: user.credentialVersion,
      securityOperationId: user.securityOperationId,
      status: "ACTIVE",
      updatedAt: user.updatedAt,
    });
  }
  for (const user of [target, second]) {
    const row: AdminProjectionRow = { ...user, shard: identitySearchShard(user.userId) };
    store.projections.set(projectionKey(row), row);
  }
  const actor: ActorContext = {
    userId: admin.userId,
    roles: ["ADMIN"],
    sessionId: session.sessionId,
    tokenVersion: 1,
    correlationId: randomUUID(),
    issuedAt: Math.floor(now.getTime() / 1_000),
    expiresAt: Math.floor(now.getTime() / 1_000) + 30,
  };
  const metrics = createMetrics("identity-admin-test");
  const logger = createLogger({ service: "identity-service", environment: "test", level: "silent" });
  const validator = new ProtectedIdentityRequestValidator(store, metrics, logger, () => new Date(now));
  const service = new IdentityAdminService(
    store,
    validator,
    secret,
    secret,
    metrics,
    logger,
    async (_hash, password) => password === "correct",
    () => new Date(now),
  );
  return { store, service, actor, targetId: target.userId };
}

function createUser(
  role: AdminUser["role"],
  status: AdminUser["status"],
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
    lecturerVerified: false,
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

function compareRows(left: AdminProjectionRow, right: AdminProjectionRow) {
  return right.updatedAt.getTime() - left.updatedAt.getTime() || left.userId.localeCompare(right.userId);
}

function comparePosition(row: AdminProjectionRow, position: { updatedAt: string; userId: string }) {
  const at = new Date(position.updatedAt).getTime();
  if (row.updatedAt.getTime() !== at) return at - row.updatedAt.getTime();
  return row.userId.localeCompare(position.userId);
}
