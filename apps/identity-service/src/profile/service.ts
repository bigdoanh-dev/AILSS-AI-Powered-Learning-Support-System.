import { randomUUID } from "node:crypto";
import { AppError } from "../../../../packages/http/src/index.js";
import { safeError } from "../../../../packages/logger/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import { isPubliclyEligible, type PublicLecturerProjection } from "../public-profile/model.js";
import { idempotencyKeyHash } from "../registration/model.js";
import type { IdempotencyRecord } from "../registration/repository.js";
import {
  PROFILE_IDEMPOTENCY_TTL_SECONDS,
  idempotencyRequestChecksum,
  parseProfileUpdateMetadata,
  profileUpdateFingerprint,
  profileUpdateScope,
  type ProfileUpdateMetadata,
  type ProfileUpdateRequest,
  type ProfileUpdateResult,
  type ProfileUser,
} from "./model.js";
import type { ProtectedIdentityRequestValidator } from "./validator.js";
import { identitySearchShard, type AdminProjectionRow } from "../admin/model.js";

export interface IdentityProfileStore {
  getUser(userId: string): Promise<ProfileUser | undefined>;
  updateProfile(input: { expected: ProfileUser; displayName: string; updatedAt: Date }): Promise<boolean>;
  getPublicProjection(lecturerId: string): Promise<PublicLecturerProjection | undefined>;
  insertPublicProjection(input: {
    lecturerId: string;
    displayName: string;
    profileVersion: number;
    updatedAt: Date;
  }): Promise<boolean>;
  updatePublicProjection(input: {
    lecturerId: string;
    expectedVersion: number;
    displayName: string;
    nextVersion: number;
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
    userId: string;
    requestChecksum: string;
    createdAt: Date;
    ttlSeconds: number;
  }): Promise<{ created: boolean; record: IdempotencyRecord }>;
  getIdempotency(
    scope: string,
    keyHash: number,
    idempotencyKey: string,
  ): Promise<IdempotencyRecord | undefined>;
  prepareIdempotency(input: {
    scope: string;
    keyHash: number;
    idempotencyKey: string;
    operationId: string;
    metadata: ProfileUpdateMetadata;
  }): Promise<boolean>;
  completeIdempotency(input: {
    scope: string;
    keyHash: number;
    idempotencyKey: string;
    operationId: string;
    metadata: ProfileUpdateMetadata;
  }): Promise<boolean>;
  transitionIdempotency(input: {
    scope: string;
    keyHash: number;
    idempotencyKey: string;
    operationId: string;
    expectedStatus: string;
    nextStatus: string;
    metadata: ProfileUpdateMetadata;
    resultCode?: number;
  }): Promise<boolean>;
  failIdempotency(input: {
    scope: string;
    keyHash: number;
    idempotencyKey: string;
    operationId: string;
    resultCode: number;
  }): Promise<void>;
}

export class ProfileService {
  public constructor(
    private readonly store: IdentityProfileStore,
    private readonly validator: ProtectedIdentityRequestValidator,
    private readonly metrics: ReturnType<typeof createMetrics>,
    private readonly logger: {
      info(input: object, message: string): void;
      error(input: object, message: string): void;
    },
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async read(actor: ActorContext): Promise<ProfileUser> {
    const stopTimer = this.metrics.identityProfileDuration.startTimer({ operation: "read" });
    try {
      const validated = await this.validator.validate(actor);
      this.metrics.identityProfileReads.inc({ outcome: "success" });
      return validated.user;
    } catch (error) {
      this.metrics.identityProfileReads.inc({ outcome: "denied" });
      throw error;
    } finally {
      stopTimer();
    }
  }

  public async update(input: {
    actor: ActorContext;
    request: ProfileUpdateRequest;
    idempotencyKey: string;
    requestId: string;
  }): Promise<ProfileUpdateResult> {
    const stopTimer = this.metrics.identityProfileDuration.startTimer({ operation: "update" });
    const scope = profileUpdateScope(input.actor.userId);
    const keyHash = idempotencyKeyHash(input.idempotencyKey);
    const requestChecksum = profileUpdateFingerprint(input.actor.userId, input.request);
    try {
      const initial = await this.validator.validate(input.actor);
      const reservation = await this.store.beginIdempotency({
        scope,
        keyHash,
        idempotencyKey: input.idempotencyKey,
        operationId: randomUUID(),
        userId: input.actor.userId,
        requestChecksum,
        createdAt: this.now(),
        ttlSeconds: PROFILE_IDEMPOTENCY_TTL_SECONDS,
      });
      let record = reservation.record;
      this.requireMatchingIdempotency(record, input.actor.userId, requestChecksum);

      if (record.status === "COMPLETE") {
        const metadata = requireMetadata(record);
        this.metrics.identityProfileUpdates.inc({ outcome: "idempotent_replay" });
        return resultFromMetadata(input.actor.userId, metadata, true);
      }
      if (record.status === "FAILED") {
        this.metrics.identityProfileUpdates.inc({ outcome: "version_conflict" });
        throw versionConflict();
      }

      let metadata = parseProfileUpdateMetadata(record.requestChecksum);
      if (record.status === "IN_PROGRESS") {
        metadata = {
          schemaVersion: 3,
          requestChecksum,
          expectedVersion: initial.user.profileVersion,
          nextVersion:
            initial.user.displayName === input.request.displayName
              ? initial.user.profileVersion
              : initial.user.profileVersion + 1,
          updatedAt: this.now().toISOString(),
          noOp: initial.user.displayName === input.request.displayName,
          projectionRequired: isPubliclyEligible(initial.user),
          oldDisplayName: initial.user.displayName,
          oldUpdatedAt: initial.user.updatedAt.toISOString(),
          role: initial.user.role,
          status: initial.user.status,
          lecturerVerified: initial.user.lecturerVerified,
          shard: identitySearchShard(initial.user.userId),
        };
        const prepared = await this.store.prepareIdempotency({
          scope,
          keyHash,
          idempotencyKey: input.idempotencyKey,
          operationId: record.operationId,
          metadata,
        });
        record = await this.requireCurrentRecord(scope, keyHash, input.idempotencyKey);
        if (!prepared) {
          this.requireMatchingIdempotency(record, input.actor.userId, requestChecksum);
          if (record.status === "COMPLETE") {
            return resultFromMetadata(input.actor.userId, requireMetadata(record), true);
          }
          metadata = requireMetadata(record);
        }
      }
      if (!metadata || record.status === "FAILED") throw persistenceUnavailable();

      const result =
        metadata.schemaVersion === 1
          ? await this.#applyLegacyPreparedUpdate(input, record, metadata, scope, keyHash)
          : await this.#applyProjectionAwareUpdate(
              input,
              record,
              metadata,
              scope,
              keyHash,
              !reservation.created,
            );
      this.logger.info(
        {
          operation: "identity.profile.update",
          requestId: input.requestId,
          correlationId: input.actor.correlationId,
          userId: input.actor.userId,
          sessionId: input.actor.sessionId,
          oldVersion: metadata.expectedVersion,
          newVersion: metadata.nextVersion,
          replayed: result.replayed,
          outcome: "success",
        },
        "current-user profile update completed",
      );
      return result;
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.metrics.identityProfileUpdates.inc({ outcome: "persistence_failure" });
      this.metrics.dependencyErrors.inc({ dependency: "cassandra", code: "profile_update" });
      this.logger.error(
        {
          operation: "identity.profile.update",
          requestId: input.requestId,
          correlationId: input.actor.correlationId,
          userId: input.actor.userId,
          sessionId: input.actor.sessionId,
          errorCode: "PROFILE_PERSISTENCE_UNAVAILABLE",
          err: safeError(error),
        },
        "profile update persistence failed",
      );
      throw persistenceUnavailable();
    } finally {
      stopTimer();
    }
  }

  async #applyLegacyPreparedUpdate(
    input: {
      actor: ActorContext;
      request: ProfileUpdateRequest;
      idempotencyKey: string;
      requestId: string;
    },
    record: IdempotencyRecord,
    metadata: ProfileUpdateMetadata,
    scope: string,
    keyHash: number,
  ): Promise<ProfileUpdateResult> {
    if (metadata.noOp) {
      await this.complete(scope, keyHash, input.idempotencyKey, record.operationId, metadata);
      this.metrics.identityProfileUpdates.inc({ outcome: "no_op" });
      return resultFromMetadata(input.actor.userId, metadata, true);
    }
    let validated = await this.validator.validate(input.actor);
    if (isIntendedState(validated.user, input.request.displayName, metadata)) {
      await this.complete(scope, keyHash, input.idempotencyKey, record.operationId, metadata);
      this.metrics.identityProfileUpdates.inc({ outcome: "ambiguous_recovered" });
      return resultFromMetadata(input.actor.userId, metadata, true);
    }
    if (validated.user.profileVersion !== metadata.expectedVersion) {
      await this.failVersion(scope, keyHash, input.idempotencyKey, record.operationId);
      throw versionConflict();
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let applied: boolean;
      try {
        applied = await this.store.updateProfile({
          expected: validated.user,
          displayName: input.request.displayName,
          updatedAt: new Date(metadata.updatedAt),
        });
      } catch {
        validated = await this.validator.validate(input.actor);
        if (isIntendedState(validated.user, input.request.displayName, metadata)) {
          await this.complete(scope, keyHash, input.idempotencyKey, record.operationId, metadata);
          this.metrics.identityProfileUpdates.inc({ outcome: "ambiguous_recovered" });
          return resultFromMetadata(input.actor.userId, metadata, true);
        }
        if (validated.user.profileVersion !== metadata.expectedVersion || attempt === 1) {
          throw persistenceUnavailable();
        }
        continue;
      }
      if (applied) {
        await this.complete(scope, keyHash, input.idempotencyKey, record.operationId, metadata);
        this.metrics.identityProfileUpdates.inc({ outcome: "success" });
        return resultFromMetadata(input.actor.userId, metadata, false);
      }
      validated = await this.validator.validate(input.actor);
      if (isIntendedState(validated.user, input.request.displayName, metadata)) {
        await this.complete(scope, keyHash, input.idempotencyKey, record.operationId, metadata);
        this.metrics.identityProfileUpdates.inc({ outcome: "ambiguous_recovered" });
        return resultFromMetadata(input.actor.userId, metadata, true);
      }
      await this.failVersion(scope, keyHash, input.idempotencyKey, record.operationId);
      this.metrics.identityProfileUpdates.inc({ outcome: "version_conflict" });
      throw versionConflict();
    }
    throw persistenceUnavailable();
  }

  async #applyProjectionAwareUpdate(
    input: {
      actor: ActorContext;
      request: ProfileUpdateRequest;
      idempotencyKey: string;
      requestId: string;
    },
    initialRecord: IdempotencyRecord,
    metadata: Exclude<ProfileUpdateMetadata, { schemaVersion: 1 }>,
    scope: string,
    keyHash: number,
    replayed: boolean,
  ): Promise<ProfileUpdateResult> {
    let record = initialRecord;
    if (record.status === "PREPARED") {
      if (!metadata.noOp) {
        let validated = await this.validator.validate(input.actor);
        if (!isIntendedState(validated.user, input.request.displayName, metadata)) {
          if (validated.user.profileVersion !== metadata.expectedVersion) {
            await this.failVersion(scope, keyHash, input.idempotencyKey, record.operationId);
            throw versionConflict();
          }
          let committed = false;
          for (let attempt = 0; attempt < 2 && !committed; attempt += 1) {
            try {
              committed = await this.store.updateProfile({
                expected: validated.user,
                displayName: input.request.displayName,
                updatedAt: new Date(metadata.updatedAt),
              });
            } catch {
              // Resolve below through exact Q-IDN-001 read-back.
            }
            validated = await this.validator.validate(input.actor);
            if (isIntendedState(validated.user, input.request.displayName, metadata)) {
              committed = true;
              break;
            }
            if (validated.user.profileVersion !== metadata.expectedVersion || attempt === 1) {
              if (validated.user.profileVersion !== metadata.expectedVersion) {
                await this.failVersion(scope, keyHash, input.idempotencyKey, record.operationId);
                throw versionConflict();
              }
              throw persistenceUnavailable();
            }
          }
          if (!committed) throw persistenceUnavailable();
        }
      }
      record = await this.#transition(
        record,
        "PREPARED",
        "CANONICAL_UPDATED",
        metadata,
        scope,
        keyHash,
        input.idempotencyKey,
      );
    }

    if (record.status === "CANONICAL_UPDATED") {
      if (metadata.projectionRequired) {
        const canonical = await this.store.getUser(input.actor.userId);
        if (!canonical || !isPubliclyEligible(canonical)) throw persistenceUnavailable();
        if (!isIntendedCanonical(canonical, input.request.displayName, metadata)) {
          throw persistenceUnavailable();
        }
        await this.#synchronizeProjection(canonical, metadata);
      }
      record = await this.#transition(
        record,
        "CANONICAL_UPDATED",
        "PUBLIC_PROJECTION_SYNCED",
        metadata,
        scope,
        keyHash,
        input.idempotencyKey,
      );
    }

    if (record.status === "PUBLIC_PROJECTION_SYNCED") {
      if (metadata.schemaVersion === 3) {
        await this.#synchronizeAdminProjection(input.actor.userId, input.request.displayName, metadata);
        record = await this.#transition(
          record,
          "PUBLIC_PROJECTION_SYNCED",
          "ADMIN_PROJECTION_SYNCED",
          metadata,
          scope,
          keyHash,
          input.idempotencyKey,
        );
      }
    }

    if (record.status === "PUBLIC_PROJECTION_SYNCED" && metadata.schemaVersion === 2) {
      record = await this.#transition(
        record,
        "PUBLIC_PROJECTION_SYNCED",
        "COMPLETE",
        metadata,
        scope,
        keyHash,
        input.idempotencyKey,
        200,
      );
    }
    if (record.status === "ADMIN_PROJECTION_SYNCED") {
      record = await this.#transition(
        record,
        "ADMIN_PROJECTION_SYNCED",
        "COMPLETE",
        metadata,
        scope,
        keyHash,
        input.idempotencyKey,
        200,
      );
    }
    if (record.status !== "COMPLETE") throw persistenceUnavailable();
    this.metrics.identityProfileUpdates.inc({
      outcome: metadata.noOp ? "no_op" : replayed ? "ambiguous_recovered" : "success",
    });
    return resultFromMetadata(input.actor.userId, metadata, replayed);
  }

  async #synchronizeProjection(
    canonical: ProfileUser,
    metadata: Exclude<ProfileUpdateMetadata, { schemaVersion: 1 }>,
  ): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let projection = await this.store.getPublicProjection(canonical.userId);
      if (isIntendedProjection(projection, canonical, metadata)) {
        this.metrics.identityProjectionSync.inc({ outcome: attempt === 0 ? "already_current" : "recovered" });
        return;
      }
      if (projection && projection.profileVersion > metadata.nextVersion) {
        this.metrics.identityProjectionDrift.inc({ kind: "ahead" });
        throw persistenceUnavailable();
      }
      if (projection && projection.profileVersion !== metadata.expectedVersion) {
        this.metrics.identityProjectionDrift.inc({ kind: "incompatible" });
        throw persistenceUnavailable();
      }
      try {
        if (projection) {
          await this.store.updatePublicProjection({
            lecturerId: canonical.userId,
            expectedVersion: projection.profileVersion,
            displayName: canonical.displayName,
            nextVersion: metadata.nextVersion,
            updatedAt: new Date(metadata.updatedAt),
          });
        } else {
          await this.store.insertPublicProjection({
            lecturerId: canonical.userId,
            displayName: canonical.displayName,
            profileVersion: metadata.nextVersion,
            updatedAt: new Date(metadata.updatedAt),
          });
        }
      } catch {
        // Resolve below through exact Q-IDN-006 read-back.
      }
      projection = await this.store.getPublicProjection(canonical.userId);
      if (isIntendedProjection(projection, canonical, metadata)) {
        this.metrics.identityProjectionSync.inc({ outcome: attempt === 0 ? "success" : "recovered" });
        return;
      }
    }
    this.metrics.identityProjectionSync.inc({ outcome: "failure" });
    throw persistenceUnavailable();
  }

  async #synchronizeAdminProjection(
    userId: string,
    displayName: string,
    metadata: Extract<ProfileUpdateMetadata, { schemaVersion: 3 }>,
  ): Promise<void> {
    const oldRow: AdminProjectionRow = {
      userId,
      displayName: metadata.oldDisplayName,
      role: metadata.role as AdminProjectionRow["role"],
      status: metadata.status as AdminProjectionRow["status"],
      lecturerVerified: metadata.lecturerVerified,
      profileVersion: metadata.expectedVersion,
      updatedAt: new Date(metadata.oldUpdatedAt),
      shard: metadata.shard,
    };
    const nextRow: AdminProjectionRow = {
      ...oldRow,
      displayName,
      profileVersion: metadata.nextVersion,
      updatedAt: new Date(metadata.noOp ? metadata.oldUpdatedAt : metadata.updatedAt),
    };
    let intended = await this.store.getAdminProjection(nextRow);
    if (sameAdminProjection(intended, nextRow)) return;
    if (!metadata.noOp) {
      const old = await this.store.getAdminProjection(oldRow);
      if (old) await this.store.removeAdminProjection(oldRow);
      if (await this.store.getAdminProjection(oldRow)) throw persistenceUnavailable();
    }
    await this.store.insertAdminProjection(nextRow);
    intended = await this.store.getAdminProjection(nextRow);
    if (!sameAdminProjection(intended, nextRow)) throw persistenceUnavailable();
  }

  async #transition(
    record: IdempotencyRecord,
    expectedStatus: string,
    nextStatus: string,
    metadata: ProfileUpdateMetadata,
    scope: string,
    keyHash: number,
    idempotencyKey: string,
    resultCode = 0,
  ): Promise<IdempotencyRecord> {
    await this.store.transitionIdempotency({
      scope,
      keyHash,
      idempotencyKey,
      operationId: record.operationId,
      expectedStatus,
      nextStatus,
      metadata,
      resultCode,
    });
    const current = await this.requireCurrentRecord(scope, keyHash, idempotencyKey);
    if (
      current.operationId !== record.operationId ||
      !profileStateAtLeast(current.status, nextStatus) ||
      parseProfileUpdateMetadata(current.requestChecksum)?.nextVersion !== metadata.nextVersion
    ) {
      throw persistenceUnavailable();
    }
    return current;
  }

  requireMatchingIdempotency(record: IdempotencyRecord, userId: string, requestChecksum: string): void {
    if (
      record.resourceId !== userId ||
      idempotencyRequestChecksum(record.requestChecksum) !== requestChecksum
    ) {
      this.metrics.identityProfileUpdates.inc({ outcome: "idempotency_conflict" });
      throw new AppError(
        "IDEMPOTENCY_CONFLICT",
        409,
        "The Idempotency-Key was already used for a different profile update",
      );
    }
  }

  async requireCurrentRecord(
    scope: string,
    keyHash: number,
    idempotencyKey: string,
  ): Promise<IdempotencyRecord> {
    const record = await this.store.getIdempotency(scope, keyHash, idempotencyKey);
    if (!record) throw persistenceUnavailable();
    return record;
  }

  async complete(
    scope: string,
    keyHash: number,
    idempotencyKey: string,
    operationId: string,
    metadata: ProfileUpdateMetadata,
  ): Promise<void> {
    const applied = await this.store.completeIdempotency({
      scope,
      keyHash,
      idempotencyKey,
      operationId,
      metadata,
    });
    if (applied) return;
    const current = await this.requireCurrentRecord(scope, keyHash, idempotencyKey);
    if (
      current.status !== "COMPLETE" ||
      current.operationId !== operationId ||
      parseProfileUpdateMetadata(current.requestChecksum)?.nextVersion !== metadata.nextVersion
    ) {
      throw persistenceUnavailable();
    }
  }

  async failVersion(
    scope: string,
    keyHash: number,
    idempotencyKey: string,
    operationId: string,
  ): Promise<void> {
    await this.store.failIdempotency({
      scope,
      keyHash,
      idempotencyKey,
      operationId,
      resultCode: 409,
    });
  }
}

const PROFILE_STATE_ORDER = [
  "IN_PROGRESS",
  "PREPARED",
  "CANONICAL_UPDATED",
  "PUBLIC_PROJECTION_SYNCED",
  "ADMIN_PROJECTION_SYNCED",
  "COMPLETE",
] as const;

function profileStateAtLeast(actual: string, expected: string): boolean {
  const actualIndex = PROFILE_STATE_ORDER.indexOf(actual as (typeof PROFILE_STATE_ORDER)[number]);
  const expectedIndex = PROFILE_STATE_ORDER.indexOf(expected as (typeof PROFILE_STATE_ORDER)[number]);
  return actualIndex >= 0 && expectedIndex >= 0 && actualIndex >= expectedIndex;
}

function isIntendedState(user: ProfileUser, displayName: string, metadata: ProfileUpdateMetadata): boolean {
  return (
    user.profileVersion === metadata.nextVersion &&
    user.displayName === displayName &&
    user.updatedAt.getTime() === new Date(metadata.updatedAt).getTime()
  );
}

function isIntendedCanonical(
  user: ProfileUser,
  displayName: string,
  metadata: ProfileUpdateMetadata,
): boolean {
  return metadata.noOp
    ? user.profileVersion === metadata.nextVersion && user.displayName === displayName
    : isIntendedState(user, displayName, metadata);
}

function isIntendedProjection(
  projection: PublicLecturerProjection | undefined,
  canonical: ProfileUser,
  metadata: ProfileUpdateMetadata,
): boolean {
  return Boolean(
    projection &&
    projection.lecturerId === canonical.userId &&
    projection.displayName === canonical.displayName &&
    projection.verified &&
    projection.profileVersion === metadata.nextVersion &&
    (metadata.noOp || projection.updatedAt.getTime() === new Date(metadata.updatedAt).getTime()),
  );
}

function sameAdminProjection(actual: AdminProjectionRow | undefined, expected: AdminProjectionRow): boolean {
  return Boolean(
    actual &&
    actual.userId === expected.userId &&
    actual.displayName === expected.displayName &&
    actual.role === expected.role &&
    actual.status === expected.status &&
    actual.lecturerVerified === expected.lecturerVerified &&
    actual.profileVersion === expected.profileVersion &&
    actual.updatedAt.getTime() === expected.updatedAt.getTime() &&
    actual.shard === expected.shard,
  );
}

function requireMetadata(record: IdempotencyRecord): ProfileUpdateMetadata {
  const metadata = parseProfileUpdateMetadata(record.requestChecksum);
  if (!metadata) throw persistenceUnavailable();
  return metadata;
}

function resultFromMetadata(
  userId: string,
  metadata: ProfileUpdateMetadata,
  replayed: boolean,
): ProfileUpdateResult {
  return { userId, profileVersion: metadata.nextVersion, replayed, noOp: metadata.noOp };
}

function versionConflict(): AppError {
  return new AppError("VERSION_CONFLICT", 409, "The profile changed before this update could be applied");
}

function persistenceUnavailable(): AppError {
  return new AppError(
    "PROFILE_PERSISTENCE_UNAVAILABLE",
    503,
    "Profile persistence is temporarily unavailable",
    true,
  );
}
