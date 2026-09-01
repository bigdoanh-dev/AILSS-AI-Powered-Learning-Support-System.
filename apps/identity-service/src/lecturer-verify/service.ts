import { randomUUID } from "node:crypto";
import type { EventEnvelope } from "../../../../packages/contracts/src/index.js";
import { AppError } from "../../../../packages/http/src/index.js";
import { safeError } from "../../../../packages/logger/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import type { AdminProjectionRow, AdminUser } from "../admin/model.js";
import type { PasswordCredential } from "../password/model.js";
import type { ProtectedIdentityRequestValidator } from "../profile/validator.js";
import type { PublicLecturerProjection } from "../public-profile/model.js";
import { verifyPassword } from "../registration/password.js";
import { derivedEventId, idempotencyKeyHash } from "../registration/model.js";
import type { IdempotencyRecord, OutboxLocation } from "../registration/repository.js";
import {
  LECTURER_VERIFY_IDEMPOTENCY_TTL_SECONDS,
  identitySearchShard,
  lecturerVerifyFingerprint,
  lecturerVerifyScope,
  parseLecturerVerifyMetadata,
  type LecturerVerifyMetadata,
  type LecturerVerifyRequest,
} from "./model.js";

const VERIFY_STATE_ORDER = [
  "IN_PROGRESS",
  "PREPARED",
  "CANONICAL_VERIFIED",
  "CREDENTIAL_MARKER_SYNCED",
  "PUBLIC_PROJECTION_SYNCED",
  "OLD_ADMIN_PROJECTION_REMOVED",
  "ADMIN_PROJECTION_SYNCED",
  "AUDIT_READY",
  "COMPLETE",
] as const;

export interface LecturerVerifyStore {
  getUser(userId: string): Promise<AdminUser | undefined>;
  getCredential(normalizedEmail: string): Promise<PasswordCredential | undefined>;
  verifyLecturer(input: { expected: AdminUser; operationId: string; updatedAt: Date }): Promise<boolean>;
  synchronizeCredentialMarker(input: {
    normalizedEmail: string;
    userId: string;
    credentialVersion: number;
    expectedOperationId: string | null;
    operationId: string;
    updatedAt: Date;
  }): Promise<boolean>;
  getPublicProjection(lecturerId: string): Promise<PublicLecturerProjection | undefined>;
  insertPublicProjection(input: {
    lecturerId: string;
    displayName: string;
    profileVersion: number;
    updatedAt: Date;
  }): Promise<boolean>;
  reconcilePublicProjection(input: {
    lecturerId: string;
    displayName: string;
    profileVersion: number;
    updatedAt: Date;
  }): Promise<boolean>;
  getAdminProjection(input: {
    role: string;
    status: string;
    shard: number;
    updatedAt: Date;
    userId: string;
  }): Promise<AdminProjectionRow | undefined>;
  insertAdminProjection(row: AdminProjectionRow): Promise<boolean>;
  removeAdminProjection(row: AdminProjectionRow): Promise<boolean>;
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
    metadata: LecturerVerifyMetadata;
    resultCode?: number;
  }): Promise<boolean>;
  prepareOutbox(event: EventEnvelope): Promise<OutboxLocation>;
  markOutboxReady(location: OutboxLocation): Promise<void>;
}

export interface LecturerVerifyResult {
  readonly userId: string;
  readonly lecturerVerified: true;
  readonly replayed: boolean;
}

export class LecturerVerifyService {
  public constructor(
    private readonly store: LecturerVerifyStore,
    private readonly validator: ProtectedIdentityRequestValidator,
    private readonly idempotencySecret: string,
    private readonly metrics: ReturnType<typeof createMetrics>,
    private readonly logger: {
      info(input: object, message: string): void;
      error(input: object, message: string): void;
    },
    private readonly passwordVerifier: (hash: string, password: string) => Promise<boolean> = verifyPassword,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (Buffer.byteLength(idempotencySecret, "utf8") < 32) {
      throw new Error("Lecturer verify idempotency secret must contain at least 32 bytes");
    }
  }

  public async verify(input: {
    actor: ActorContext;
    targetId: string;
    request: LecturerVerifyRequest;
    idempotencyKey: string;
    requestId: string;
  }): Promise<LecturerVerifyResult> {
    const stop = this.metrics.identityAdminDuration.startTimer({ operation: "lecturer_verify" });
    const scope = lecturerVerifyScope(input.actor.userId, input.targetId);
    const keyHash = idempotencyKeyHash(input.idempotencyKey);
    const fingerprint = lecturerVerifyFingerprint(
      this.idempotencySecret,
      input.actor.userId,
      input.targetId,
      input.request,
    );
    try {
      const admin = await this.#requireAdmin(input.actor);
      if (admin.userId === input.targetId) throw forbidden("ADMIN_SELF_VERIFY_FORBIDDEN");
      let record = await this.store.getIdempotency(scope, keyHash, input.idempotencyKey);
      let replayed = record !== undefined;
      if (record) {
        this.#requireMatching(record, input.targetId, fingerprint);
        if (record.status === "COMPLETE") return resultFrom(record, true);
        if (record.status === "FAILED") throw alreadyVerified();
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
          ttlSeconds: LECTURER_VERIFY_IDEMPOTENCY_TTL_SECONDS,
        });
        record = reservation.record;
        replayed = !reservation.created;
        this.#requireMatching(record, input.targetId, fingerprint);
        if (record.status === "IN_PROGRESS") {
          const metadata = metadataFrom(record.operationId, admin.userId, target, fingerprint, createdAt);
          await this.#prepareAudit(input, metadata);
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
        throw unavailable("LECTURER_VERIFY_RECOVERY_PENDING", "Lecturer verification recovery is pending");
      const metadata = requireMetadata(record);
      record = await this.#verifyCanonical(record, metadata, scope, keyHash, input.idempotencyKey);
      record = await this.#syncCredential(record, metadata, scope, keyHash, input.idempotencyKey);
      record = await this.#syncPublicProjection(record, metadata, scope, keyHash, input.idempotencyKey);
      record = await this.#removeOldAdminProjection(record, metadata, scope, keyHash, input.idempotencyKey);
      record = await this.#insertNewAdminProjection(record, metadata, scope, keyHash, input.idempotencyKey);
      if (record.status === "ADMIN_PROJECTION_SYNCED") {
        const location = await this.#prepareAudit(input, metadata);
        await this.store.markOutboxReady(location);
        record = await this.#transition(
          record,
          "ADMIN_PROJECTION_SYNCED",
          "AUDIT_READY",
          metadata,
          scope,
          keyHash,
          input.idempotencyKey,
        );
      }
      record = await this.#transition(
        record,
        "AUDIT_READY",
        "COMPLETE",
        metadata,
        scope,
        keyHash,
        input.idempotencyKey,
        200,
      );
      if (record.status !== "COMPLETE") throw persistenceUnavailable();
      this.metrics.identityLecturerVerifications.inc({ outcome: replayed ? "recovered" : "success" });
      this.logger.info(
        {
          operation: "identity.admin.lecturer.verify",
          requestId: input.requestId,
          correlationId: input.actor.correlationId,
          actorId: input.actor.userId,
          targetId: input.targetId,
          operationId: record.operationId,
          oldTokenVersion: metadata.expectedTokenVersion,
          newTokenVersion: metadata.nextTokenVersion,
          replayed,
        },
        "lecturer verification completed",
      );
      return resultFrom(record, replayed);
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.metrics.identityLecturerVerifications.inc({ outcome: "dependency_failure" });
      this.logger.error(
        {
          operation: "identity.admin.lecturer.verify",
          requestId: input.requestId,
          correlationId: input.actor.correlationId,
          actorId: input.actor.userId,
          targetId: input.targetId,
          errorCode: "LECTURER_VERIFY_UNAVAILABLE",
          err: safeError(error),
        },
        "lecturer verification failed",
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
    request: LecturerVerifyRequest,
  ): Promise<AdminUser> {
    const target = await this.store.getUser(targetId);
    if (!target) throw new AppError("LECTURER_VERIFY_TARGET_NOT_FOUND", 404, "User was not found");
    if (target.role !== "LECTURER" || target.status !== "ACTIVE")
      throw ineligible("LECTURER_VERIFY_TARGET_INELIGIBLE");
    if (target.lecturerVerified) throw alreadyVerified();
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
      this.metrics.identityLecturerVerifications.inc({ outcome: "step_up_denied" });
      throw stepUpFailed();
    }
    return target;
  }

  async #verifyCanonical(
    record: IdempotencyRecord,
    metadata: LecturerVerifyMetadata,
    scope: string,
    keyHash: number,
    key: string,
  ): Promise<IdempotencyRecord> {
    if (stateAtLeast(record.status, "CANONICAL_VERIFIED")) return record;
    let target = await this.store.getUser(metadata.targetId);
    if (!target) throw persistenceUnavailable();
    if (!intendedCanonical(target, metadata, record.operationId)) {
      if (!expectedCanonical(target, metadata)) {
        // A concurrent command (or prior operation) already advanced the target.
        throw alreadyVerified();
      }
      try {
        await this.store.verifyLecturer({
          expected: target,
          operationId: record.operationId,
          updatedAt: new Date(metadata.newUpdatedAt),
        });
      } catch {
        // Exact read-back below resolves ambiguous LWT outcomes.
      }
      target = await this.store.getUser(metadata.targetId);
      if (!target || !intendedCanonical(target, metadata, record.operationId)) {
        if (target && !expectedCanonical(target, metadata)) throw alreadyVerified();
        throw persistenceUnavailable();
      }
    }
    return this.#transition(record, "PREPARED", "CANONICAL_VERIFIED", metadata, scope, keyHash, key);
  }

  async #syncCredential(
    record: IdempotencyRecord,
    metadata: LecturerVerifyMetadata,
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
      "CANONICAL_VERIFIED",
      "CREDENTIAL_MARKER_SYNCED",
      metadata,
      scope,
      keyHash,
      key,
    );
  }

  async #syncPublicProjection(
    record: IdempotencyRecord,
    metadata: LecturerVerifyMetadata,
    scope: string,
    keyHash: number,
    key: string,
  ): Promise<IdempotencyRecord> {
    if (stateAtLeast(record.status, "PUBLIC_PROJECTION_SYNCED")) return record;
    const updatedAt = new Date(metadata.newUpdatedAt);
    let projection = await this.store.getPublicProjection(metadata.targetId);
    if (!projection) {
      await this.store.insertPublicProjection({
        lecturerId: metadata.targetId,
        displayName: metadata.displayName,
        profileVersion: metadata.profileVersion,
        updatedAt,
      });
      projection = await this.store.getPublicProjection(metadata.targetId);
    } else if (!intendedPublic(projection, metadata, updatedAt)) {
      await this.store.reconcilePublicProjection({
        lecturerId: metadata.targetId,
        displayName: metadata.displayName,
        profileVersion: metadata.profileVersion,
        updatedAt,
      });
      projection = await this.store.getPublicProjection(metadata.targetId);
    }
    if (!projection || !intendedPublic(projection, metadata, updatedAt)) throw persistenceUnavailable();
    return this.#transition(
      record,
      "CREDENTIAL_MARKER_SYNCED",
      "PUBLIC_PROJECTION_SYNCED",
      metadata,
      scope,
      keyHash,
      key,
    );
  }

  async #removeOldAdminProjection(
    record: IdempotencyRecord,
    metadata: LecturerVerifyMetadata,
    scope: string,
    keyHash: number,
    key: string,
  ): Promise<IdempotencyRecord> {
    if (stateAtLeast(record.status, "OLD_ADMIN_PROJECTION_REMOVED")) return record;
    const oldRow = adminProjectionFromMetadata(metadata, false);
    const current = await this.store.getAdminProjection({
      role: oldRow.role,
      status: oldRow.status,
      shard: oldRow.shard,
      updatedAt: oldRow.updatedAt,
      userId: oldRow.userId,
    });
    if (current) await this.store.removeAdminProjection(oldRow);
    if (
      await this.store.getAdminProjection({
        role: oldRow.role,
        status: oldRow.status,
        shard: oldRow.shard,
        updatedAt: oldRow.updatedAt,
        userId: oldRow.userId,
      })
    )
      throw persistenceUnavailable();
    return this.#transition(
      record,
      "PUBLIC_PROJECTION_SYNCED",
      "OLD_ADMIN_PROJECTION_REMOVED",
      metadata,
      scope,
      keyHash,
      key,
    );
  }

  async #insertNewAdminProjection(
    record: IdempotencyRecord,
    metadata: LecturerVerifyMetadata,
    scope: string,
    keyHash: number,
    key: string,
  ): Promise<IdempotencyRecord> {
    if (stateAtLeast(record.status, "ADMIN_PROJECTION_SYNCED")) return record;
    const newRow = adminProjectionFromMetadata(metadata, true);
    let current = await this.store.getAdminProjection({
      role: newRow.role,
      status: newRow.status,
      shard: newRow.shard,
      updatedAt: newRow.updatedAt,
      userId: newRow.userId,
    });
    if (!sameAdminProjection(current, newRow)) {
      if (current) throw persistenceUnavailable();
      await this.store.insertAdminProjection(newRow);
      current = await this.store.getAdminProjection({
        role: newRow.role,
        status: newRow.status,
        shard: newRow.shard,
        updatedAt: newRow.updatedAt,
        userId: newRow.userId,
      });
      if (!sameAdminProjection(current, newRow)) throw persistenceUnavailable();
    }
    return this.#transition(
      record,
      "OLD_ADMIN_PROJECTION_REMOVED",
      "ADMIN_PROJECTION_SYNCED",
      metadata,
      scope,
      keyHash,
      key,
    );
  }

  async #prepareAudit(
    input: { actor: ActorContext; targetId: string; requestId: string },
    metadata: LecturerVerifyMetadata,
  ): Promise<OutboxLocation> {
    const audit: EventEnvelope = {
      specVersion: "1.0",
      eventId: metadata.auditEventId,
      eventType: "system.audit.requested.v1",
      occurredAt: metadata.newUpdatedAt,
      producer: "identity-service",
      correlationId: input.actor.correlationId,
      actor: { type: "USER", id: input.actor.userId },
      aggregate: { type: "USER", id: metadata.targetId, version: metadata.nextTokenVersion },
      data: {
        action: "LECTURER_VERIFIED",
        actorType: "USER",
        actorId: metadata.actorId,
        targetType: "USER",
        targetId: metadata.targetId,
        outcome: "SUCCESS",
        requestId: input.requestId,
      },
    };
    return this.store.prepareOutbox(audit);
  }

  async #transition(
    record: IdempotencyRecord,
    expectedStatus: string,
    nextStatus: string,
    metadata: LecturerVerifyMetadata,
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
    const stored =
      parseLecturerVerifyMetadata(record.requestChecksum)?.requestFingerprint ?? record.requestChecksum;
    if (record.resourceId !== targetId || stored !== fingerprint) {
      throw new AppError("IDEMPOTENCY_CONFLICT", 409, "The Idempotency-Key was used for another command");
    }
  }
}

function metadataFrom(
  operationId: string,
  actorId: string,
  target: AdminUser,
  fingerprint: string,
  now: Date,
): LecturerVerifyMetadata {
  return {
    schemaVersion: 1,
    requestFingerprint: fingerprint,
    actorId,
    targetId: target.userId,
    displayName: target.displayName,
    profileVersion: target.profileVersion,
    shard: identitySearchShard(target.userId),
    oldUpdatedAt: target.updatedAt.toISOString(),
    newUpdatedAt: now.toISOString(),
    expectedTokenVersion: target.tokenVersion,
    nextTokenVersion: target.tokenVersion + 1,
    previousSecurityOperationId: target.securityOperationId,
    auditEventId: derivedEventId(operationId, "audit:lecturer-verified"),
  };
}

function adminProjectionFromMetadata(
  metadata: LecturerVerifyMetadata,
  verified: boolean,
): AdminProjectionRow {
  return {
    userId: metadata.targetId,
    displayName: metadata.displayName,
    role: "LECTURER",
    status: "ACTIVE",
    lecturerVerified: verified,
    profileVersion: metadata.profileVersion,
    updatedAt: new Date(verified ? metadata.newUpdatedAt : metadata.oldUpdatedAt),
    shard: metadata.shard,
  };
}

function sameAdminProjection(actual: AdminProjectionRow | undefined, expected: AdminProjectionRow): boolean {
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

function intendedPublic(
  projection: PublicLecturerProjection,
  metadata: LecturerVerifyMetadata,
  updatedAt: Date,
): boolean {
  return (
    projection.verified &&
    projection.displayName === metadata.displayName &&
    projection.profileVersion === metadata.profileVersion &&
    projection.updatedAt.getTime() === updatedAt.getTime()
  );
}

function expectedCanonical(user: AdminUser, metadata: LecturerVerifyMetadata): boolean {
  return (
    user.role === "LECTURER" &&
    user.status === "ACTIVE" &&
    !user.lecturerVerified &&
    user.tokenVersion === metadata.expectedTokenVersion &&
    user.updatedAt.toISOString() === metadata.oldUpdatedAt
  );
}

function intendedCanonical(user: AdminUser, metadata: LecturerVerifyMetadata, operationId: string): boolean {
  return (
    user.role === "LECTURER" &&
    user.status === "ACTIVE" &&
    user.lecturerVerified &&
    user.tokenVersion === metadata.nextTokenVersion &&
    user.securityOperationId === operationId &&
    user.updatedAt.toISOString() === metadata.newUpdatedAt
  );
}

function stateAtLeast(current: string, expected: string): boolean {
  return (
    VERIFY_STATE_ORDER.indexOf(current as (typeof VERIFY_STATE_ORDER)[number]) >=
    VERIFY_STATE_ORDER.indexOf(expected as (typeof VERIFY_STATE_ORDER)[number])
  );
}

function requireMetadata(record: IdempotencyRecord): LecturerVerifyMetadata {
  const metadata = parseLecturerVerifyMetadata(record.requestChecksum);
  if (!metadata) throw persistenceUnavailable();
  return metadata;
}

function resultFrom(record: IdempotencyRecord, replayed: boolean): LecturerVerifyResult {
  const metadata = requireMetadata(record);
  return { userId: metadata.targetId, lecturerVerified: true, replayed };
}

function stepUpFailed(): AppError {
  return new AppError("ADMIN_STEP_UP_FAILED", 401, "Admin step-up reauthentication failed");
}

function forbidden(code: string): AppError {
  return new AppError(code, 403, "Admin action is not permitted");
}

function ineligible(code: string): AppError {
  return new AppError(code, 422, "The target account is not eligible for lecturer verification");
}

function alreadyVerified(): AppError {
  return new AppError("LECTURER_ALREADY_VERIFIED", 409, "The lecturer is already verified");
}

function unavailable(code: string, message: string): AppError {
  return new AppError(code, 503, message, true);
}

function persistenceUnavailable(): AppError {
  return unavailable("LECTURER_VERIFY_UNAVAILABLE", "Lecturer verification is temporarily unavailable");
}
