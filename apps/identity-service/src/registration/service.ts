import type { EventEnvelope } from "../../../../packages/contracts/src/index.js";
import { AppError } from "../../../../packages/http/src/index.js";
import { safeError } from "../../../../packages/logger/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import type { Logger } from "pino";
import { hashPassword } from "./password.js";
import {
  REGISTRATION_SCOPE,
  derivedEventId,
  idempotencyKeyHash,
  maskEmail,
  newRegistrationIds,
  registrationFingerprint,
  type RegisteredAccount,
  type RegistrationCommand,
  type RegistrationResult,
} from "./model.js";
import type { CredentialReservation, IdempotencyRecord, OutboxLocation } from "./repository.js";

const IDEMPOTENCY_TTL_SECONDS = 86_400;

export interface IdentityRegistrationStore {
  beginIdempotency(input: {
    scope: string;
    keyHash: number;
    idempotencyKey: string;
    operationId: string;
    resourceId: string;
    requestChecksum: string;
    createdAt: Date;
    ttlSeconds: number;
  }): Promise<{ created: boolean; record: IdempotencyRecord }>;
  completeIdempotency(input: {
    scope: string;
    keyHash: number;
    idempotencyKey: string;
    operationId: string;
  }): Promise<void>;
  failIdempotency(input: {
    scope: string;
    keyHash: number;
    idempotencyKey: string;
    operationId: string;
    resultCode: number;
  }): Promise<void>;
  reserveCredential(input: {
    normalizedEmail: string;
    userId: string;
    passwordHash: string;
    createdAt: Date;
  }): Promise<{ created: boolean; reservation: CredentialReservation }>;
  getCredential(normalizedEmail: string): Promise<CredentialReservation | undefined>;
  activateCredential(normalizedEmail: string, userId: string, updatedAt: Date): Promise<void>;
  createUser(input: {
    account: RegisteredAccount;
    maskedEmail: string;
    normalizedEmail: string;
  }): Promise<void>;
  getUser(userId: string): Promise<RegisteredAccount | undefined>;
  getAdminProjection(account: RegisteredAccount): Promise<unknown>;
  insertAdminProjection(account: RegisteredAccount): Promise<boolean>;
  prepareOutbox(event: EventEnvelope): Promise<OutboxLocation>;
  markOutboxReady(location: OutboxLocation): Promise<void>;
}

export interface RegistrationServiceOptions {
  readonly store: IdentityRegistrationStore;
  readonly logger: Logger;
  readonly metrics: ReturnType<typeof createMetrics>;
  readonly passwordHasher?: (password: string) => Promise<string>;
  readonly now?: () => Date;
}

export class RegistrationService {
  readonly #store: IdentityRegistrationStore;
  readonly #logger: Logger;
  readonly #metrics: ReturnType<typeof createMetrics>;
  readonly #passwordHasher: (password: string) => Promise<string>;
  readonly #now: () => Date;

  public constructor(options: RegistrationServiceOptions) {
    this.#store = options.store;
    this.#logger = options.logger;
    this.#metrics = options.metrics;
    this.#passwordHasher = options.passwordHasher ?? hashPassword;
    this.#now = options.now ?? (() => new Date());
  }

  public async register(command: RegistrationCommand): Promise<RegistrationResult> {
    const stopTimer = this.#metrics.identityRegistrationDuration.startTimer();
    const checksum = registrationFingerprint(command);
    const keyHash = idempotencyKeyHash(command.idempotencyKey);
    const generated = newRegistrationIds();
    const startedAt = this.#now();

    try {
      const reservation = await this.#store.beginIdempotency({
        scope: REGISTRATION_SCOPE,
        keyHash,
        idempotencyKey: command.idempotencyKey,
        operationId: generated.operationId,
        resourceId: generated.userId,
        requestChecksum: checksum,
        createdAt: startedAt,
        ttlSeconds: IDEMPOTENCY_TTL_SECONDS,
      });
      const record = reservation.record;

      if (record.requestChecksum !== checksum) {
        this.#metrics.identityRegistrations.inc({ outcome: "idempotency_conflict" });
        throw new AppError(
          "IDEMPOTENCY_CONFLICT",
          409,
          "The Idempotency-Key was already used for a different registration request",
        );
      }
      if (record.status === "FAILED" && record.resultCode === 409) {
        this.#metrics.identityRegistrations.inc({ outcome: "email_conflict" });
        throw duplicateEmailError();
      }

      const existingUser = await this.#store.getUser(record.resourceId);
      if (existingUser) {
        await this.#finishCommit(command, record, existingUser, keyHash);
        this.#metrics.identityRegistrations.inc({ outcome: "success" });
        this.#metrics.identityIdempotencyReplays.inc();
        return {
          account: existingUser,
          replayed: true,
          eventId: derivedEventId(record.operationId, "registration"),
        };
      }

      const credential = await this.#store.getCredential(command.email);
      if (credential && credential.userId !== record.resourceId) {
        await this.#markDuplicate(command.idempotencyKey, keyHash, record.operationId);
        throw duplicateEmailError();
      }
      if (!credential) {
        const passwordHash = await this.#passwordHasher(command.password);
        const claim = await this.#store.reserveCredential({
          normalizedEmail: command.email,
          userId: record.resourceId,
          passwordHash,
          createdAt: record.createdAt,
        });
        if (claim.reservation.userId !== record.resourceId) {
          await this.#markDuplicate(command.idempotencyKey, keyHash, record.operationId);
          throw duplicateEmailError();
        }
      }

      const account: RegisteredAccount = {
        userId: record.resourceId,
        displayName: command.displayName,
        role: command.role ?? "STUDENT",
        status: "ACTIVE",
        lecturerVerified: false,
        profileVersion: 1,
        createdAt: record.createdAt.toISOString(),
      };
      const locations = await this.#prepareIntents(command, record, account);
      await this.#store.createUser({
        account,
        maskedEmail: maskEmail(command.email),
        normalizedEmail: command.email,
      });
      await this.#ensureAdminProjection(account);
      await this.#store.activateCredential(command.email, account.userId, this.#now());
      await Promise.all(locations.map((location) => this.#store.markOutboxReady(location)));
      await this.#store.completeIdempotency({
        scope: REGISTRATION_SCOPE,
        keyHash,
        idempotencyKey: command.idempotencyKey,
        operationId: record.operationId,
      });

      const replayed = !reservation.created;
      this.#metrics.identityRegistrations.inc({ outcome: "success" });
      if (replayed) this.#metrics.identityIdempotencyReplays.inc();
      this.#logger.info(
        {
          operation: "identity.register",
          userId: account.userId,
          requestId: command.requestId,
          correlationId: command.correlationId,
          replayed,
          status: "success",
        },
        "identity registration completed",
      );
      return {
        account,
        replayed,
        eventId: derivedEventId(record.operationId, "registration"),
      };
    } catch (error) {
      if (!(error instanceof AppError)) {
        this.#metrics.identityRegistrations.inc({ outcome: "dependency_error" });
        this.#metrics.dependencyErrors.inc({ dependency: "cassandra", code: "registration_failed" });
        this.#logger.error(
          {
            operation: "identity.register",
            requestId: command.requestId,
            correlationId: command.correlationId,
            err: safeError(error),
          },
          "identity registration persistence failed",
        );
        throw new AppError(
          "IDENTITY_PERSISTENCE_UNAVAILABLE",
          503,
          "Registration persistence is temporarily unavailable",
          true,
        );
      }
      throw error;
    } finally {
      stopTimer();
    }
  }

  async #finishCommit(
    command: RegistrationCommand,
    record: IdempotencyRecord,
    account: RegisteredAccount,
    keyHash: number,
  ): Promise<void> {
    const credential = await this.#store.getCredential(command.email);
    if (!credential || credential.userId !== account.userId) throw new Error("CREDENTIAL_RECOVERY_MISMATCH");
    const locations = await this.#prepareIntents(command, record, account);
    await this.#ensureAdminProjection(account);
    await this.#store.activateCredential(command.email, account.userId, this.#now());
    await Promise.all(locations.map((location) => this.#store.markOutboxReady(location)));
    await this.#store.completeIdempotency({
      scope: REGISTRATION_SCOPE,
      keyHash,
      idempotencyKey: command.idempotencyKey,
      operationId: record.operationId,
    });
  }

  async #ensureAdminProjection(account: RegisteredAccount): Promise<void> {
    let row = await this.#store.getAdminProjection(account);
    if (!row) {
      await this.#store.insertAdminProjection(account);
      row = await this.#store.getAdminProjection(account);
    }
    if (!row) throw new Error("ADMIN_SEARCH_PROJECTION_MISSING");
  }

  async #prepareIntents(
    command: RegistrationCommand,
    record: IdempotencyRecord,
    account: RegisteredAccount,
  ): Promise<readonly OutboxLocation[]> {
    const registeredEventId = derivedEventId(record.operationId, "registration");
    const correlationId = record.operationId;
    const common = {
      specVersion: "1.0" as const,
      occurredAt: account.createdAt,
      producer: "identity-service",
      correlationId,
      actor: { type: "SYSTEM" as const, id: "anonymous-self-registration" },
      aggregate: { type: "USER", id: account.userId, version: account.profileVersion },
    };
    const registered: EventEnvelope = {
      ...common,
      eventId: registeredEventId,
      eventType: "identity.user.registered.v1",
      data: {
        userId: account.userId,
        role: account.role,
        status: account.status,
        profileVersion: account.profileVersion,
      },
    };
    const audit: EventEnvelope = {
      ...common,
      eventId: derivedEventId(record.operationId, "audit:user-registered"),
      eventType: "system.audit.requested.v1",
      causationId: registeredEventId,
      data: {
        action: "USER_REGISTERED",
        actorType: "ANONYMOUS",
        targetType: "USER",
        targetId: account.userId,
        outcome: "SUCCESS",
        requestId: command.requestId,
      },
    };
    return Promise.all([this.#store.prepareOutbox(registered), this.#store.prepareOutbox(audit)]);
  }

  async #markDuplicate(idempotencyKey: string, keyHash: number, operationId: string): Promise<void> {
    await this.#store.failIdempotency({
      scope: REGISTRATION_SCOPE,
      keyHash,
      idempotencyKey,
      operationId,
      resultCode: 409,
    });
    this.#metrics.identityRegistrations.inc({ outcome: "email_conflict" });
  }
}

function duplicateEmailError(): AppError {
  return new AppError("EMAIL_ALREADY_REGISTERED", 409, "An account already exists for this email");
}
