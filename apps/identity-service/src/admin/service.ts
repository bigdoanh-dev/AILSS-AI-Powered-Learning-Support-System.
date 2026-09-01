import { randomUUID } from "node:crypto";
import type { EventEnvelope } from "../../../../packages/contracts/src/index.js";
import { AppError } from "../../../../packages/http/src/index.js";
import { safeError } from "../../../../packages/logger/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import type { PasswordCredential } from "../password/model.js";
import type { ProtectedIdentityRequestValidator } from "../profile/validator.js";
import { verifyPassword } from "../registration/password.js";
import { derivedEventId, idempotencyKeyHash } from "../registration/model.js";
import type { IdempotencyRecord, OutboxLocation } from "../registration/repository.js";
import {
  ADMIN_SHARD_COUNT,
  ADMIN_STATUS_IDEMPOTENCY_TTL_SECONDS,
  adminFiltersHash,
  decodeAdminCursor,
  encodeAdminCursor,
  identitySearchShard,
  parseStatusMetadata,
  statusChangeScope,
  statusCommandFingerprint,
  type AccountStatus,
  type AdminCursorPayload,
  type AdminProjectionRow,
  type AdminSearchQuery,
  type AdminStatusRequest,
  type AdminUser,
  type StatusChangeMetadata,
} from "./model.js";

const STATUS_STATE_ORDER = [
  "IN_PROGRESS",
  "PREPARED",
  "OLD_PROJECTION_REMOVED",
  "CANONICAL_UPDATED",
  "CREDENTIAL_MARKER_SYNCED",
  "NEW_PROJECTION_INSERTED",
  "EVENT_READY",
  "COMPLETE",
] as const;

export interface IdentityAdminStore {
  getUser(userId: string): Promise<AdminUser | undefined>;
  listShard(input: {
    role: AdminProjectionRow["role"];
    status: AccountStatus;
    shard: number;
    limit: number;
    position?: { updatedAt: string; userId: string };
  }): Promise<readonly AdminProjectionRow[]>;
  getProjection(input: {
    role: AdminProjectionRow["role"];
    status: AccountStatus;
    shard: number;
    updatedAt: Date;
    userId: string;
  }): Promise<AdminProjectionRow | undefined>;
  insertProjection(row: AdminProjectionRow): Promise<boolean>;
  removeProjection(row: AdminProjectionRow): Promise<boolean>;
  changeStatus(input: {
    expected: AdminUser;
    targetStatus: AccountStatus;
    operationId: string;
    updatedAt: Date;
  }): Promise<boolean>;
  getCredential(normalizedEmail: string): Promise<PasswordCredential | undefined>;
  synchronizeCredentialMarker(input: {
    normalizedEmail: string;
    userId: string;
    credentialVersion: number;
    expectedOperationId: string | null;
    operationId: string;
    updatedAt: Date;
  }): Promise<boolean>;
  beginIdempotency(input: {
    scope: string;
    keyHash: number;
    idempotencyKey: string;
    operationId: string;
    targetId: string;
    fingerprint: string;
    createdAt: Date;
    ttlSeconds: number;
  }): Promise<{ created: boolean; record: IdempotencyRecord }>;
  getIdempotency(
    scope: string,
    keyHash: number,
    idempotencyKey: string,
  ): Promise<IdempotencyRecord | undefined>;
  transitionIdempotency(input: {
    scope: string;
    keyHash: number;
    idempotencyKey: string;
    operationId: string;
    expectedStatus: string;
    nextStatus: string;
    metadata: StatusChangeMetadata;
    resultCode?: number;
  }): Promise<boolean>;
  prepareOutbox(event: EventEnvelope): Promise<OutboxLocation>;
  markOutboxReady(location: OutboxLocation): Promise<void>;
}

export interface AdminSearchResult {
  readonly items: readonly AdminProjectionRow[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export interface AdminStatusResult {
  readonly userId: string;
  readonly oldStatus: AccountStatus;
  readonly newStatus: AccountStatus;
  readonly tokenVersion: number;
  readonly eventId: string;
  readonly replayed: boolean;
}

export class IdentityAdminService {
  public constructor(
    private readonly store: IdentityAdminStore,
    private readonly validator: ProtectedIdentityRequestValidator,
    private readonly cursorSecret: string,
    private readonly idempotencySecret: string,
    private readonly metrics: ReturnType<typeof createMetrics>,
    private readonly logger: {
      info(input: object, message: string): void;
      error(input: object, message: string): void;
    },
    private readonly passwordVerifier: (hash: string, password: string) => Promise<boolean> = verifyPassword,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (Buffer.byteLength(cursorSecret, "utf8") < 32 || Buffer.byteLength(idempotencySecret, "utf8") < 32) {
      throw new Error("Admin cursor and idempotency secrets must contain at least 32 bytes");
    }
  }

  public async search(actor: ActorContext, query: AdminSearchQuery): Promise<AdminSearchResult> {
    const stop = this.metrics.identityAdminDuration.startTimer({ operation: "search" });
    try {
      await this.#requireAdmin(actor);
      let cursor: AdminCursorPayload | undefined;
      if (query.cursor) {
        try {
          cursor = decodeAdminCursor(
            this.cursorSecret,
            query.cursor,
            query,
            Math.floor(this.now().getTime() / 1_000),
          );
        } catch {
          this.metrics.identityAdminReads.inc({ operation: "search", outcome: "invalid_cursor" });
          throw new AppError("INVALID_CURSOR", 400, "The search cursor is invalid or expired");
        }
      }
      const perShardPositions = { ...(cursor?.perShardPositions ?? {}) };
      const pages = await Promise.all(
        Array.from({ length: ADMIN_SHARD_COUNT }, (_, shard) =>
          this.store.listShard({
            role: query.role,
            status: query.status,
            shard,
            limit: query.limit + 1,
            ...(perShardPositions[String(shard)] ? { position: perShardPositions[String(shard)] } : {}),
          }),
        ),
      );
      const candidates = pages.flat().sort(compareProjection);
      const items = candidates.slice(0, query.limit);
      for (const item of items) {
        perShardPositions[String(item.shard)] = {
          updatedAt: item.updatedAt.toISOString(),
          userId: item.userId,
        };
      }
      const hasMore = candidates.length > items.length;
      const nextCursor = hasMore
        ? encodeAdminCursor(this.cursorSecret, {
            v: 1,
            role: query.role,
            status: query.status,
            filtersHash: adminFiltersHash(query.role, query.status),
            direction: "forward",
            issuedAt: Math.floor(this.now().getTime() / 1_000),
            perShardPositions,
          })
        : null;
      this.metrics.identityAdminReads.inc({ operation: "search", outcome: "success" });
      return { items, nextCursor, hasMore };
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.metrics.identityAdminReads.inc({ operation: "search", outcome: "dependency_failure" });
      throw unavailable("ADMIN_SEARCH_UNAVAILABLE", "Admin user search is temporarily unavailable");
    } finally {
      stop();
    }
  }

  public async detail(actor: ActorContext, targetId: string): Promise<AdminUser> {
    const stop = this.metrics.identityAdminDuration.startTimer({ operation: "detail" });
    try {
      await this.#requireAdmin(actor);
      const target = await this.store.getUser(targetId);
      if (!target) throw new AppError("ADMIN_USER_NOT_FOUND", 404, "User was not found");
      this.metrics.identityAdminReads.inc({ operation: "detail", outcome: "success" });
      return target;
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.metrics.identityAdminReads.inc({ operation: "detail", outcome: "dependency_failure" });
      throw unavailable("ADMIN_DETAIL_UNAVAILABLE", "Admin user detail is temporarily unavailable");
    } finally {
      stop();
    }
  }

  public async changeStatus(input: {
    actor: ActorContext;
    targetId: string;
    request: AdminStatusRequest;
    idempotencyKey: string;
    requestId: string;
  }): Promise<AdminStatusResult> {
    const stop = this.metrics.identityAdminDuration.startTimer({ operation: "status_change" });
    const scope = statusChangeScope(input.actor.userId, input.targetId);
    const keyHash = idempotencyKeyHash(input.idempotencyKey);
    const fingerprint = statusCommandFingerprint(
      this.idempotencySecret,
      input.actor.userId,
      input.targetId,
      input.request,
    );
    try {
      const admin = await this.#requireAdmin(input.actor);
      if (admin.userId === input.targetId) throw forbidden("ADMIN_SELF_STATUS_CHANGE_FORBIDDEN");
      let record = await this.store.getIdempotency(scope, keyHash, input.idempotencyKey);
      let replayed = record !== undefined;
      if (record) {
        this.#requireMatching(record, input.targetId, fingerprint);
        if (record.status === "COMPLETE") return resultFrom(record, true);
        if (record.status === "FAILED") throw statusConflict();
      } else {
        const target = await this.#validateNewCommand(admin, input.targetId, input.request);
        const createdAt = this.now();
        const reservation = await this.store.beginIdempotency({
          scope,
          keyHash,
          idempotencyKey: input.idempotencyKey,
          operationId: randomUUID(),
          targetId: input.targetId,
          fingerprint,
          createdAt,
          ttlSeconds: ADMIN_STATUS_IDEMPOTENCY_TTL_SECONDS,
        });
        record = reservation.record;
        replayed = !reservation.created;
        this.#requireMatching(record, input.targetId, fingerprint);
        if (record.status === "IN_PROGRESS") {
          const metadata = metadataFrom(
            record.operationId,
            admin.userId,
            target,
            input.request,
            fingerprint,
            createdAt,
          );
          await this.#prepareEvents(input, metadata);
          record = await this.#transition(
            record,
            "IN_PROGRESS",
            "PREPARED",
            metadata,
            scope,
            keyHash,
            input.idempotencyKey,
          );
        }
      }
      if (record.status === "IN_PROGRESS")
        throw unavailable("ADMIN_STATUS_RECOVERY_PENDING", "Status change recovery is pending");
      const metadata = requireMetadata(record);
      record = await this.#removeOld(record, metadata, scope, keyHash, input.idempotencyKey);
      record = await this.#changeCanonical(record, metadata, scope, keyHash, input.idempotencyKey);
      record = await this.#syncCredential(record, metadata, scope, keyHash, input.idempotencyKey);
      record = await this.#insertNew(record, metadata, scope, keyHash, input.idempotencyKey);
      if (record.status === "NEW_PROJECTION_INSERTED") {
        const locations = await this.#prepareEvents(input, metadata);
        await Promise.all(locations.map((location) => this.store.markOutboxReady(location)));
        record = await this.#transition(
          record,
          "NEW_PROJECTION_INSERTED",
          "EVENT_READY",
          metadata,
          scope,
          keyHash,
          input.idempotencyKey,
        );
      }
      record = await this.#transition(
        record,
        "EVENT_READY",
        "COMPLETE",
        metadata,
        scope,
        keyHash,
        input.idempotencyKey,
        200,
      );
      if (record.status !== "COMPLETE") throw persistenceUnavailable();
      this.metrics.identityAdminStatusChanges.inc({ outcome: replayed ? "recovered" : "success" });
      this.logger.info(
        {
          operation: "identity.admin.user.status.change",
          requestId: input.requestId,
          correlationId: input.actor.correlationId,
          actorId: input.actor.userId,
          targetId: input.targetId,
          operationId: record.operationId,
          oldStatus: metadata.oldStatus,
          newStatus: metadata.newStatus,
          oldTokenVersion: metadata.expectedTokenVersion,
          newTokenVersion: metadata.nextTokenVersion,
          reasonClass: metadata.reasonClass,
          replayed,
        },
        "admin account status change completed",
      );
      return resultFrom(record, replayed);
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.metrics.identityAdminStatusChanges.inc({ outcome: "dependency_failure" });
      this.logger.error(
        {
          operation: "identity.admin.user.status.change",
          requestId: input.requestId,
          correlationId: input.actor.correlationId,
          actorId: input.actor.userId,
          targetId: input.targetId,
          errorCode: "ADMIN_STATUS_CHANGE_UNAVAILABLE",
          err: safeError(error),
        },
        "admin account status change failed",
      );
      throw persistenceUnavailable();
    } finally {
      stop();
    }
  }

  async #requireAdmin(actor: ActorContext): Promise<AdminUser> {
    const validated = await this.validator.validate(actor);
    if (validated.user.role !== "ADMIN") {
      this.metrics.identityAdminAuthorization.inc({ outcome: "role_denied" });
      throw forbidden("ADMIN_ROLE_REQUIRED");
    }
    const user = await this.store.getUser(actor.userId);
    if (
      !user ||
      user.role !== "ADMIN" ||
      user.status !== "ACTIVE" ||
      user.tokenVersion !== actor.tokenVersion
    ) {
      throw new AppError("INVALID_ACCESS_TOKEN", 401, "Invalid access token");
    }
    this.metrics.identityAdminAuthorization.inc({ outcome: "success" });
    return user;
  }

  async #validateNewCommand(
    admin: AdminUser,
    targetId: string,
    request: AdminStatusRequest,
  ): Promise<AdminUser> {
    const target = await this.store.getUser(targetId);
    if (!target) throw new AppError("ADMIN_USER_NOT_FOUND", 404, "User was not found");
    if (target.role === "ADMIN") throw forbidden("ADMIN_TARGET_STATUS_CHANGE_FORBIDDEN");
    if (target.status === request.status)
      throw new AppError("STATUS_UNCHANGED", 409, "Account already has that status");
    const credential = await this.store.getCredential(admin.normalizedEmail);
    if (
      !credential ||
      credential.userId !== admin.userId ||
      credential.status !== "ACTIVE" ||
      credential.credentialVersion !== admin.credentialVersion ||
      credential.securityOperationId !== admin.securityOperationId
    ) {
      throw stepUpFailed();
    }
    let valid = false;
    try {
      valid = await this.passwordVerifier(credential.passwordHash, request.currentPassword);
    } catch {
      throw persistenceUnavailable();
    }
    if (!valid) {
      this.metrics.identityAdminStatusChanges.inc({ outcome: "step_up_denied" });
      throw stepUpFailed();
    }
    return target;
  }

  async #removeOld(
    record: IdempotencyRecord,
    metadata: StatusChangeMetadata,
    scope: string,
    keyHash: number,
    key: string,
  ): Promise<IdempotencyRecord> {
    if (stateAtLeast(record.status, "OLD_PROJECTION_REMOVED")) return record;
    const oldRow = projectionFromMetadata(metadata, false);
    const current = await this.store.getProjection(oldRow);
    if (current) await this.store.removeProjection(oldRow);
    if (await this.store.getProjection(oldRow)) throw persistenceUnavailable();
    this.metrics.identityAdminProjectionMoves.inc({ stage: "old_removed", outcome: "success" });
    return this.#transition(record, "PREPARED", "OLD_PROJECTION_REMOVED", metadata, scope, keyHash, key);
  }

  async #changeCanonical(
    record: IdempotencyRecord,
    metadata: StatusChangeMetadata,
    scope: string,
    keyHash: number,
    key: string,
  ): Promise<IdempotencyRecord> {
    if (stateAtLeast(record.status, "CANONICAL_UPDATED")) return record;
    let target = await this.store.getUser(metadata.targetId);
    if (!target) throw persistenceUnavailable();
    if (!intendedCanonical(target, metadata, record.operationId)) {
      if (!expectedCanonical(target, metadata)) throw statusConflict();
      try {
        await this.store.changeStatus({
          expected: target,
          targetStatus: metadata.newStatus,
          operationId: record.operationId,
          updatedAt: new Date(metadata.newUpdatedAt),
        });
      } catch {
        // Exact read-back below resolves ambiguous LWT outcomes.
      }
      target = await this.store.getUser(metadata.targetId);
      if (!target || !intendedCanonical(target, metadata, record.operationId)) {
        if (target && !expectedCanonical(target, metadata)) throw statusConflict();
        throw persistenceUnavailable();
      }
    }
    return this.#transition(
      record,
      "OLD_PROJECTION_REMOVED",
      "CANONICAL_UPDATED",
      metadata,
      scope,
      keyHash,
      key,
    );
  }

  async #syncCredential(
    record: IdempotencyRecord,
    metadata: StatusChangeMetadata,
    scope: string,
    keyHash: number,
    key: string,
  ): Promise<IdempotencyRecord> {
    if (stateAtLeast(record.status, "CREDENTIAL_MARKER_SYNCED")) return record;
    const target = await this.store.getUser(metadata.targetId);
    if (!target || !intendedCanonical(target, metadata, record.operationId)) throw persistenceUnavailable();
    let credential = await this.store.getCredential(target.normalizedEmail);
    if (
      !credential ||
      credential.userId !== target.userId ||
      credential.credentialVersion !== target.credentialVersion
    ) {
      throw persistenceUnavailable();
    }
    if (credential.securityOperationId !== record.operationId) {
      await this.store.synchronizeCredentialMarker({
        normalizedEmail: target.normalizedEmail,
        userId: target.userId,
        credentialVersion: target.credentialVersion,
        expectedOperationId: metadata.previousSecurityOperationId,
        operationId: record.operationId,
        updatedAt: new Date(metadata.newUpdatedAt),
      });
      credential = await this.store.getCredential(target.normalizedEmail);
      if (!credential || credential.securityOperationId !== record.operationId)
        throw persistenceUnavailable();
    }
    return this.#transition(
      record,
      "CANONICAL_UPDATED",
      "CREDENTIAL_MARKER_SYNCED",
      metadata,
      scope,
      keyHash,
      key,
    );
  }

  async #insertNew(
    record: IdempotencyRecord,
    metadata: StatusChangeMetadata,
    scope: string,
    keyHash: number,
    key: string,
  ): Promise<IdempotencyRecord> {
    if (stateAtLeast(record.status, "NEW_PROJECTION_INSERTED")) return record;
    const newRow = projectionFromMetadata(metadata, true);
    let current = await this.store.getProjection(newRow);
    if (!sameProjection(current, newRow)) {
      if (current) throw persistenceUnavailable();
      await this.store.insertProjection(newRow);
      current = await this.store.getProjection(newRow);
      if (!sameProjection(current, newRow)) throw persistenceUnavailable();
    }
    this.metrics.identityAdminProjectionMoves.inc({ stage: "new_inserted", outcome: "success" });
    return this.#transition(
      record,
      "CREDENTIAL_MARKER_SYNCED",
      "NEW_PROJECTION_INSERTED",
      metadata,
      scope,
      keyHash,
      key,
    );
  }

  async #prepareEvents(
    input: { actor: ActorContext; targetId: string; request: AdminStatusRequest; requestId: string },
    metadata: StatusChangeMetadata,
  ): Promise<readonly OutboxLocation[]> {
    const common = {
      specVersion: "1.0" as const,
      occurredAt: metadata.newUpdatedAt,
      producer: "identity-service",
      correlationId: input.actor.correlationId,
      actor: { type: "USER" as const, id: input.actor.userId },
      aggregate: { type: "USER", id: metadata.targetId, version: metadata.nextTokenVersion },
    };
    const changed: EventEnvelope = {
      ...common,
      eventId: metadata.eventId,
      eventType: "identity.user.status_changed.v1",
      data: {
        userId: metadata.targetId,
        oldStatus: metadata.oldStatus,
        newStatus: metadata.newStatus,
        version: metadata.nextTokenVersion,
        occurredAt: metadata.newUpdatedAt,
      },
    };
    const audit: EventEnvelope = {
      ...common,
      eventId: metadata.auditEventId,
      eventType: "system.audit.requested.v1",
      causationId: metadata.eventId,
      data: {
        action: "USER_STATUS_CHANGED",
        actorType: "USER",
        actorId: metadata.actorId,
        targetType: "USER",
        targetId: metadata.targetId,
        oldStatus: metadata.oldStatus,
        newStatus: metadata.newStatus,
        reasonClass: metadata.reasonClass,
        outcome: "SUCCESS",
        requestId: input.requestId,
      },
    };
    return Promise.all([this.store.prepareOutbox(changed), this.store.prepareOutbox(audit)]);
  }

  async #transition(
    record: IdempotencyRecord,
    expectedStatus: string,
    nextStatus: string,
    metadata: StatusChangeMetadata,
    scope: string,
    keyHash: number,
    key: string,
    resultCode = 0,
  ): Promise<IdempotencyRecord> {
    if (stateAtLeast(record.status, nextStatus)) return record;
    await this.store.transitionIdempotency({
      scope,
      keyHash,
      idempotencyKey: key,
      operationId: record.operationId,
      expectedStatus,
      nextStatus,
      metadata,
      resultCode,
    });
    const current = await this.store.getIdempotency(scope, keyHash, key);
    if (!current || current.operationId !== record.operationId || !stateAtLeast(current.status, nextStatus)) {
      throw persistenceUnavailable();
    }
    return current;
  }

  #requireMatching(record: IdempotencyRecord, targetId: string, fingerprint: string): void {
    const stored = parseStatusMetadata(record.requestChecksum)?.requestFingerprint ?? record.requestChecksum;
    if (record.resourceId !== targetId || stored !== fingerprint) {
      throw new AppError("IDEMPOTENCY_CONFLICT", 409, "The Idempotency-Key was used for another command");
    }
  }
}

function metadataFrom(
  operationId: string,
  actorId: string,
  target: AdminUser,
  request: AdminStatusRequest,
  fingerprint: string,
  now: Date,
): StatusChangeMetadata {
  return {
    schemaVersion: 1,
    requestFingerprint: fingerprint,
    actorId,
    targetId: target.userId,
    role: target.role as "STUDENT" | "LECTURER",
    displayName: target.displayName,
    lecturerVerified: target.lecturerVerified,
    profileVersion: target.profileVersion,
    oldStatus: target.status,
    newStatus: request.status,
    shard: identitySearchShard(target.userId),
    oldUpdatedAt: target.updatedAt.toISOString(),
    newUpdatedAt: now.toISOString(),
    expectedTokenVersion: target.tokenVersion,
    nextTokenVersion: target.tokenVersion + 1,
    previousSecurityOperationId: target.securityOperationId,
    eventId: derivedEventId(operationId, "status-changed"),
    auditEventId: derivedEventId(operationId, "audit:status-changed"),
    reasonClass: request.reason ? "PROVIDED" : "UNSPECIFIED",
  };
}

function projectionFromMetadata(metadata: StatusChangeMetadata, next: boolean): AdminProjectionRow {
  return {
    userId: metadata.targetId,
    displayName: metadata.displayName,
    role: metadata.role,
    status: next ? metadata.newStatus : metadata.oldStatus,
    lecturerVerified: metadata.lecturerVerified,
    profileVersion: metadata.profileVersion,
    updatedAt: new Date(next ? metadata.newUpdatedAt : metadata.oldUpdatedAt),
    shard: metadata.shard,
  };
}

function compareProjection(left: AdminProjectionRow, right: AdminProjectionRow): number {
  const time = right.updatedAt.getTime() - left.updatedAt.getTime();
  return time === 0 ? left.userId.localeCompare(right.userId) : time;
}

function sameProjection(actual: AdminProjectionRow | undefined, expected: AdminProjectionRow): boolean {
  return Boolean(
    actual &&
    actual.userId === expected.userId &&
    actual.role === expected.role &&
    actual.status === expected.status &&
    actual.displayName === expected.displayName &&
    actual.lecturerVerified === expected.lecturerVerified &&
    actual.profileVersion === expected.profileVersion &&
    actual.updatedAt.getTime() === expected.updatedAt.getTime(),
  );
}

function expectedCanonical(user: AdminUser, metadata: StatusChangeMetadata): boolean {
  return (
    user.role === metadata.role &&
    user.status === metadata.oldStatus &&
    user.tokenVersion === metadata.expectedTokenVersion &&
    user.updatedAt.toISOString() === metadata.oldUpdatedAt
  );
}

function intendedCanonical(user: AdminUser, metadata: StatusChangeMetadata, operationId: string): boolean {
  return (
    user.role === metadata.role &&
    user.status === metadata.newStatus &&
    user.tokenVersion === metadata.nextTokenVersion &&
    user.securityOperationId === operationId &&
    user.updatedAt.toISOString() === metadata.newUpdatedAt
  );
}

function stateAtLeast(current: string, expected: string): boolean {
  return (
    STATUS_STATE_ORDER.indexOf(current as (typeof STATUS_STATE_ORDER)[number]) >=
    STATUS_STATE_ORDER.indexOf(expected as (typeof STATUS_STATE_ORDER)[number])
  );
}

function requireMetadata(record: IdempotencyRecord): StatusChangeMetadata {
  const metadata = parseStatusMetadata(record.requestChecksum);
  if (!metadata) throw persistenceUnavailable();
  return metadata;
}

function resultFrom(record: IdempotencyRecord, replayed: boolean): AdminStatusResult {
  const metadata = requireMetadata(record);
  return {
    userId: metadata.targetId,
    oldStatus: metadata.oldStatus,
    newStatus: metadata.newStatus,
    tokenVersion: metadata.nextTokenVersion,
    eventId: metadata.eventId,
    replayed,
  };
}

function stepUpFailed(): AppError {
  return new AppError("ADMIN_STEP_UP_FAILED", 401, "Admin step-up reauthentication failed");
}

function forbidden(code: string): AppError {
  return new AppError(code, 403, "Admin action is not permitted");
}

function statusConflict(): AppError {
  return new AppError("STATUS_TRANSITION_CONFLICT", 409, "Account status changed concurrently");
}

function unavailable(code: string, message: string): AppError {
  return new AppError(code, 503, message, true);
}

function persistenceUnavailable(): AppError {
  return unavailable("ADMIN_STATUS_CHANGE_UNAVAILABLE", "Account status change is temporarily unavailable");
}
