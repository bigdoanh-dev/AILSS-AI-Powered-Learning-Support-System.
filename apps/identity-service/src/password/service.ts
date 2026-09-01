import { randomUUID } from "node:crypto";
import { AppError } from "../../../../packages/http/src/index.js";
import { safeError } from "../../../../packages/logger/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import type { CanonicalLoginUser, LoginSession } from "../login/model.js";
import { hashPassword, verifyPassword } from "../registration/password.js";
import { idempotencyKeyHash } from "../registration/model.js";
import type { IdempotencyRecord } from "../registration/repository.js";
import type { ProtectedIdentityRequestValidator } from "../profile/validator.js";
import {
  PASSWORD_IDEMPOTENCY_TTL_SECONDS,
  parsePasswordMetadata,
  passwordChangeScope,
  passwordCommandFingerprint,
  passwordRecordFingerprint,
  type PasswordChangeMetadata,
  type PasswordChangeRequest,
  type PasswordChangeResult,
  type PasswordCredential,
} from "./model.js";

const STATE_ORDER = [
  "IN_PROGRESS",
  "PREPARED",
  "USER_EPOCH_ADVANCED",
  "CREDENTIAL_UPDATED",
  "SESSION_REVOKED",
  "COMPLETE",
] as const;

export interface IdentityPasswordStore {
  getUser(userId: string): Promise<CanonicalLoginUser | undefined>;
  getCredential(normalizedEmail: string): Promise<PasswordCredential | undefined>;
  getSession(sessionId: string): Promise<LoginSession | undefined>;
  revokeSession(sessionId: string, expectedVersion: number, revokedAt: Date): Promise<boolean>;
  advanceUserSecurityEpoch(input: {
    expected: CanonicalLoginUser;
    operationId: string;
    updatedAt: Date;
  }): Promise<boolean>;
  updateCredential(input: {
    normalizedEmail: string;
    expected: PasswordCredential;
    passwordHash: string;
    operationId: string;
    updatedAt: Date;
  }): Promise<boolean>;
  beginIdempotency(input: {
    scope: string;
    keyHash: number;
    idempotencyKey: string;
    operationId: string;
    userId: string;
    requestFingerprint: string;
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
    metadata: PasswordChangeMetadata;
    resultCode?: number;
  }): Promise<boolean>;
}

export class PasswordChangeService {
  public constructor(
    private readonly store: IdentityPasswordStore,
    private readonly validator: ProtectedIdentityRequestValidator,
    private readonly hmacKey: string,
    private readonly metrics: ReturnType<typeof createMetrics>,
    private readonly logger: {
      info(input: object, message: string): void;
      error(input: object, message: string): void;
    },
    private readonly passwordVerifier: (hash: string, password: string) => Promise<boolean> = verifyPassword,
    private readonly passwordHasher: (password: string) => Promise<string> = hashPassword,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (Buffer.byteLength(hmacKey, "utf8") < 32) {
      throw new Error("Password idempotency HMAC key must contain at least 32 bytes");
    }
  }

  public async change(input: {
    actor: ActorContext;
    request: PasswordChangeRequest;
    idempotencyKey: string;
    requestId: string;
  }): Promise<PasswordChangeResult> {
    const stopTimer = this.metrics.identityPasswordChangeDuration.startTimer();
    const scope = passwordChangeScope(input.actor.userId);
    const keyHash = idempotencyKeyHash(input.idempotencyKey);
    const requestFingerprint = passwordCommandFingerprint(this.hmacKey, input.actor.userId, input.request);
    try {
      let record = await this.store.getIdempotency(scope, keyHash, input.idempotencyKey);
      let replayed = record !== undefined;
      if (record) {
        this.#requireMatching(record, input.actor.userId, requestFingerprint);
        if (record.status === "COMPLETE") {
          this.metrics.identityPasswordChanges.inc({ outcome: "replay" });
          return { userId: input.actor.userId, replayed: true };
        }
        if (record.status === "FAILED") throw versionConflict();
      } else {
        const { user, credential } = await this.#reauthenticate(input.actor, input.request);
        const createdAt = this.now();
        const reservation = await this.store.beginIdempotency({
          scope,
          keyHash,
          idempotencyKey: input.idempotencyKey,
          operationId: randomUUID(),
          userId: input.actor.userId,
          requestFingerprint,
          createdAt,
          ttlSeconds: PASSWORD_IDEMPOTENCY_TTL_SECONDS,
        });
        record = reservation.record;
        replayed = !reservation.created;
        this.#requireMatching(record, input.actor.userId, requestFingerprint);
        if (record.status === "IN_PROGRESS") {
          const metadata = metadataFrom(user, requestFingerprint, createdAt);
          record = await this.#transition(
            record,
            "IN_PROGRESS",
            "PREPARED",
            metadata,
            scope,
            keyHash,
            input.idempotencyKey,
          );
          if (credential.credentialVersion !== metadata.expectedCredentialVersion) {
            throw versionConflict();
          }
        }
      }

      if (record.status === "IN_PROGRESS") {
        const { user } = await this.#reauthenticate(input.actor, input.request);
        record = await this.#transition(
          record,
          "IN_PROGRESS",
          "PREPARED",
          metadataFrom(user, requestFingerprint, this.now()),
          scope,
          keyHash,
          input.idempotencyKey,
        );
      }
      const metadata = requireMetadata(record);
      this.#requireMatching(record, input.actor.userId, requestFingerprint);

      record = await this.#advanceEpoch(input, record, metadata, scope, keyHash);
      record = await this.#updateCredential(input, record, metadata, scope, keyHash);
      record = await this.#revokeCurrentSession(input, record, metadata, scope, keyHash);
      record = await this.#transition(
        record,
        "SESSION_REVOKED",
        "COMPLETE",
        metadata,
        scope,
        keyHash,
        input.idempotencyKey,
        200,
      );
      if (record.status !== "COMPLETE") throw persistenceUnavailable();

      this.metrics.identityPasswordChanges.inc({ outcome: replayed ? "recovery" : "success" });
      this.logger.info(
        {
          operation: "identity.password.change",
          requestId: input.requestId,
          correlationId: input.actor.correlationId,
          userId: input.actor.userId,
          sessionId: input.actor.sessionId,
          operationId: record.operationId,
          oldTokenVersion: metadata.expectedTokenVersion,
          newTokenVersion: metadata.nextTokenVersion,
          outcome: replayed ? "recovered" : "success",
        },
        "password change completed",
      );
      return { userId: input.actor.userId, replayed };
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.metrics.identityPasswordChanges.inc({ outcome: "dependency_failure" });
      this.metrics.dependencyErrors.inc({ dependency: "cassandra", code: "password_change" });
      this.logger.error(
        {
          operation: "identity.password.change",
          requestId: input.requestId,
          correlationId: input.actor.correlationId,
          userId: input.actor.userId,
          sessionId: input.actor.sessionId,
          errorCode: "PASSWORD_CHANGE_UNAVAILABLE",
          err: safeError(error),
        },
        "password change failed",
      );
      throw persistenceUnavailable();
    } finally {
      stopTimer();
    }
  }

  async #reauthenticate(
    actor: ActorContext,
    request: PasswordChangeRequest,
  ): Promise<{ user: CanonicalLoginUser; credential: PasswordCredential }> {
    const validated = await this.validator.validate(actor);
    const user = await this.store.getUser(actor.userId);
    if (!user || user.userId !== validated.user.userId || user.normalizedEmail.length === 0) {
      throw invalidReauthentication();
    }
    const credential = await this.store.getCredential(user.normalizedEmail);
    if (
      !credential ||
      credential.userId !== actor.userId ||
      credential.status !== "ACTIVE" ||
      credential.credentialVersion !== user.credentialVersion
    ) {
      throw invalidReauthentication();
    }
    let currentValid: boolean;
    let sameAsCurrent: boolean;
    try {
      [currentValid, sameAsCurrent] = await Promise.all([
        this.passwordVerifier(credential.passwordHash, request.currentPassword),
        this.passwordVerifier(credential.passwordHash, request.newPassword),
      ]);
    } catch {
      throw persistenceUnavailable();
    }
    if (!currentValid) {
      this.metrics.identityPasswordChanges.inc({ outcome: "reauth_failed" });
      throw invalidReauthentication();
    }
    if (sameAsCurrent) {
      throw new AppError(
        "PASSWORD_CHANGE_VALIDATION_FAILED",
        422,
        "The new password does not satisfy the password change policy",
      );
    }
    return { user, credential };
  }

  async #advanceEpoch(
    input: {
      actor: ActorContext;
      request: PasswordChangeRequest;
      idempotencyKey: string;
    },
    record: IdempotencyRecord,
    metadata: PasswordChangeMetadata,
    scope: string,
    keyHash: number,
  ): Promise<IdempotencyRecord> {
    if (stateAtLeast(record.status, "USER_EPOCH_ADVANCED")) return record;
    if (record.status !== "PREPARED") throw persistenceUnavailable();
    let user = await this.store.getUser(input.actor.userId);
    if (user && intendedUserEpoch(user, metadata, record.operationId)) {
      return this.#transition(
        record,
        "PREPARED",
        "USER_EPOCH_ADVANCED",
        metadata,
        scope,
        keyHash,
        input.idempotencyKey,
      );
    }
    if (!user || !sameExpectedEpoch(user, metadata)) {
      await this.#failConflict(record, metadata, scope, keyHash, input.idempotencyKey);
      throw versionConflict();
    }
    const validated = await this.validator.validate(input.actor);
    user = await this.store.getUser(input.actor.userId);
    if (!user || !sameExpectedEpoch(user, metadata) || validated.user.role !== user.role) {
      await this.#failConflict(record, metadata, scope, keyHash, input.idempotencyKey);
      throw versionConflict();
    }
    let applied = false;
    try {
      applied = await this.store.advanceUserSecurityEpoch({
        expected: user,
        operationId: record.operationId,
        updatedAt: new Date(metadata.updatedAt),
      });
    } catch {
      // Resolve below through exact Q-IDN-001 read-back.
    }
    const after = await this.store.getUser(input.actor.userId);
    if (!after || (!applied && !intendedUserEpoch(after, metadata, record.operationId))) {
      await this.#failConflict(record, metadata, scope, keyHash, input.idempotencyKey);
      throw versionConflict();
    }
    if (!intendedUserEpoch(after, metadata, record.operationId)) throw persistenceUnavailable();
    return this.#transition(
      record,
      "PREPARED",
      "USER_EPOCH_ADVANCED",
      metadata,
      scope,
      keyHash,
      input.idempotencyKey,
    );
  }

  async #updateCredential(
    input: {
      actor: ActorContext;
      request: PasswordChangeRequest;
      idempotencyKey: string;
    },
    record: IdempotencyRecord,
    metadata: PasswordChangeMetadata,
    scope: string,
    keyHash: number,
  ): Promise<IdempotencyRecord> {
    if (stateAtLeast(record.status, "CREDENTIAL_UPDATED")) return record;
    if (record.status !== "USER_EPOCH_ADVANCED") throw persistenceUnavailable();
    const user = await this.store.getUser(input.actor.userId);
    if (!user || !intendedUserEpoch(user, metadata, record.operationId)) throw versionConflict();
    let credential = await this.store.getCredential(user.normalizedEmail);
    if (!credential || credential.userId !== input.actor.userId || credential.status !== "ACTIVE") {
      throw persistenceUnavailable();
    }
    if (
      credential.credentialVersion === metadata.nextCredentialVersion &&
      credential.securityOperationId === record.operationId
    ) {
      if (!(await this.passwordVerifier(credential.passwordHash, input.request.newPassword))) {
        throw versionConflict();
      }
      return this.#transition(
        record,
        "USER_EPOCH_ADVANCED",
        "CREDENTIAL_UPDATED",
        metadata,
        scope,
        keyHash,
        input.idempotencyKey,
      );
    }
    if (
      credential.credentialVersion !== metadata.expectedCredentialVersion ||
      !(await this.passwordVerifier(credential.passwordHash, input.request.currentPassword))
    ) {
      throw versionConflict();
    }
    const passwordHash = await this.passwordHasher(input.request.newPassword);
    try {
      await this.store.updateCredential({
        normalizedEmail: user.normalizedEmail,
        expected: credential,
        passwordHash,
        operationId: record.operationId,
        updatedAt: new Date(metadata.updatedAt),
      });
    } catch {
      // Resolve below through Q-IDN-002 read-back and password verification.
    }
    credential = await this.store.getCredential(user.normalizedEmail);
    if (
      !credential ||
      credential.credentialVersion !== metadata.nextCredentialVersion ||
      credential.securityOperationId !== record.operationId ||
      !(await this.passwordVerifier(credential.passwordHash, input.request.newPassword))
    ) {
      throw persistenceUnavailable();
    }
    return this.#transition(
      record,
      "USER_EPOCH_ADVANCED",
      "CREDENTIAL_UPDATED",
      metadata,
      scope,
      keyHash,
      input.idempotencyKey,
    );
  }

  async #revokeCurrentSession(
    input: { actor: ActorContext; idempotencyKey: string },
    record: IdempotencyRecord,
    metadata: PasswordChangeMetadata,
    scope: string,
    keyHash: number,
  ): Promise<IdempotencyRecord> {
    if (stateAtLeast(record.status, "SESSION_REVOKED")) return record;
    if (record.status !== "CREDENTIAL_UPDATED") throw persistenceUnavailable();
    let session = await this.store.getSession(input.actor.sessionId);
    if (!session || session.userId !== input.actor.userId) throw persistenceUnavailable();
    for (let attempt = 0; session.state === "ACTIVE" && attempt < 2; attempt += 1) {
      try {
        await this.store.revokeSession(session.sessionId, session.version, this.now());
      } catch {
        // Resolve with exact read-back.
      }
      session = await this.store.getSession(input.actor.sessionId);
      if (!session || session.userId !== input.actor.userId) throw persistenceUnavailable();
    }
    if (session.state !== "REVOKED") throw persistenceUnavailable();
    return this.#transition(
      record,
      "CREDENTIAL_UPDATED",
      "SESSION_REVOKED",
      metadata,
      scope,
      keyHash,
      input.idempotencyKey,
    );
  }

  async #transition(
    record: IdempotencyRecord,
    expectedStatus: string,
    nextStatus: string,
    metadata: PasswordChangeMetadata,
    scope: string,
    keyHash: number,
    idempotencyKey: string,
    resultCode = 0,
  ): Promise<IdempotencyRecord> {
    if (stateAtLeast(record.status, nextStatus)) return record;
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
    const current = await this.store.getIdempotency(scope, keyHash, idempotencyKey);
    if (
      !current ||
      current.operationId !== record.operationId ||
      !stateAtLeast(current.status, nextStatus) ||
      passwordRecordFingerprint(current.requestChecksum) !== metadata.requestFingerprint
    ) {
      throw persistenceUnavailable();
    }
    return current;
  }

  async #failConflict(
    record: IdempotencyRecord,
    metadata: PasswordChangeMetadata,
    scope: string,
    keyHash: number,
    idempotencyKey: string,
  ): Promise<void> {
    await this.store.transitionIdempotency({
      scope,
      keyHash,
      idempotencyKey,
      operationId: record.operationId,
      expectedStatus: record.status,
      nextStatus: "FAILED",
      metadata,
      resultCode: 409,
    });
  }

  #requireMatching(record: IdempotencyRecord, userId: string, fingerprint: string): void {
    if (record.resourceId !== userId || passwordRecordFingerprint(record.requestChecksum) !== fingerprint) {
      this.metrics.identityPasswordChanges.inc({ outcome: "idempotency_conflict" });
      throw new AppError(
        "IDEMPOTENCY_CONFLICT",
        409,
        "The Idempotency-Key was already used for a different password command",
      );
    }
  }
}

function metadataFrom(
  user: CanonicalLoginUser,
  requestFingerprint: string,
  updatedAt: Date,
): PasswordChangeMetadata {
  return {
    schemaVersion: 1,
    requestFingerprint,
    expectedTokenVersion: user.tokenVersion,
    nextTokenVersion: user.tokenVersion + 1,
    expectedCredentialVersion: user.credentialVersion,
    nextCredentialVersion: user.credentialVersion + 1,
    updatedAt: updatedAt.toISOString(),
  };
}

function requireMetadata(record: IdempotencyRecord): PasswordChangeMetadata {
  const metadata = parsePasswordMetadata(record.requestChecksum);
  if (!metadata) throw persistenceUnavailable();
  return metadata;
}

function sameExpectedEpoch(user: CanonicalLoginUser, metadata: PasswordChangeMetadata): boolean {
  return (
    user.status === "ACTIVE" &&
    user.tokenVersion === metadata.expectedTokenVersion &&
    user.credentialVersion === metadata.expectedCredentialVersion
  );
}

function intendedUserEpoch(
  user: CanonicalLoginUser,
  metadata: PasswordChangeMetadata,
  operationId: string,
): boolean {
  return (
    user.status === "ACTIVE" &&
    user.tokenVersion === metadata.nextTokenVersion &&
    user.credentialVersion === metadata.nextCredentialVersion &&
    user.securityOperationId === operationId &&
    user.updatedAt.getTime() === new Date(metadata.updatedAt).getTime()
  );
}

function stateAtLeast(actual: string, expected: string): boolean {
  if (actual === "FAILED") return false;
  return (
    STATE_ORDER.indexOf(actual as (typeof STATE_ORDER)[number]) >=
    STATE_ORDER.indexOf(expected as (typeof STATE_ORDER)[number])
  );
}

function invalidReauthentication(): AppError {
  return new AppError("INVALID_REAUTHENTICATION", 401, "Authentication could not be confirmed");
}

function versionConflict(): AppError {
  return new AppError(
    "PASSWORD_CHANGE_CONFLICT",
    409,
    "The account security state changed before the password command completed",
  );
}

function persistenceUnavailable(): AppError {
  return new AppError("PASSWORD_CHANGE_UNAVAILABLE", 503, "Password change is temporarily unavailable", true);
}
