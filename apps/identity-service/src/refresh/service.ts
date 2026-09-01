import { AppError } from "../../../../packages/http/src/index.js";
import { safeError } from "../../../../packages/logger/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import type { Logger } from "pino";
import type { CanonicalLoginUser, LoginSession } from "../login/model.js";
import {
  newRefreshCredential,
  refreshTokenMatchesFingerprint,
  type RefreshCredential,
} from "../login/tokens.js";
import type { RefreshCommand, RefreshResult } from "./model.js";

export interface IdentityRefreshStore {
  getSession(sessionId: string): Promise<LoginSession | undefined>;
  getUser(userId: string): Promise<CanonicalLoginUser | undefined>;
  rotateSession(input: { expected: LoginSession; nextRefreshFingerprint: string }): Promise<boolean>;
  revokeSession(sessionId: string, expectedVersion: number, revokedAt: Date): Promise<boolean>;
}

export interface RefreshAccessTokenInput {
  readonly subject: string;
  readonly roles: readonly string[];
  readonly sessionId: string;
  readonly tokenVersion: number;
  readonly issuedAtSeconds: number;
}

export interface RefreshServiceOptions {
  readonly store: IdentityRefreshStore;
  readonly logger: Logger;
  readonly metrics: ReturnType<typeof createMetrics>;
  readonly accessTokenTtlSeconds: number;
  readonly accessTokenSigner: (input: RefreshAccessTokenInput) => Promise<string>;
  readonly refreshCredentialFactory?: () => RefreshCredential;
  readonly now?: () => Date;
}

export class RefreshService {
  readonly #store: IdentityRefreshStore;
  readonly #logger: Logger;
  readonly #metrics: ReturnType<typeof createMetrics>;
  readonly #accessTokenTtlSeconds: number;
  readonly #accessTokenSigner: (input: RefreshAccessTokenInput) => Promise<string>;
  readonly #refreshCredentialFactory: () => RefreshCredential;
  readonly #now: () => Date;

  public constructor(options: RefreshServiceOptions) {
    this.#store = options.store;
    this.#logger = options.logger;
    this.#metrics = options.metrics;
    this.#accessTokenTtlSeconds = options.accessTokenTtlSeconds;
    this.#accessTokenSigner = options.accessTokenSigner;
    this.#refreshCredentialFactory = options.refreshCredentialFactory ?? newRefreshCredential;
    this.#now = options.now ?? (() => new Date());
  }

  public async refresh(command: RefreshCommand): Promise<RefreshResult> {
    const stopTimer = this.#metrics.identityRefreshDuration.startTimer();
    try {
      const session = await this.#readSession(command.sessionId, command);
      if (!session || !isRefreshable(session, this.#now())) {
        this.#metrics.identityRefreshes.inc({ outcome: "invalid_refresh" });
        throw invalidRefreshError();
      }
      if (!refreshTokenMatchesFingerprint(command.refreshToken, session.refreshFingerprint)) {
        await this.#revokeFamily(session, "suspected_reuse", command);
        this.#metrics.identityRefreshes.inc({ outcome: "suspected_reuse" });
        this.#logger.warn(
          {
            operation: "identity.refresh",
            requestId: command.requestId,
            correlationId: command.correlationId,
            sessionId: session.sessionId,
            userId: session.userId,
            outcome: "suspected_reuse",
          },
          "refresh fingerprint mismatch revoked the active session family",
        );
        throw invalidRefreshError();
      }

      const user = await this.#readUser(session.userId, command);
      if (!user || user.status !== "ACTIVE") {
        await this.#revokeFamily(session, "account_denied", command);
        this.#metrics.identityRefreshes.inc({ outcome: "account_denied" });
        throw invalidRefreshError();
      }
      if (session.authVersion === null || session.authVersion !== user.tokenVersion) {
        await this.#revokeFamily(session, "auth_version_mismatch", command);
        this.#metrics.identityRefreshes.inc({ outcome: "auth_version_mismatch" });
        throw invalidRefreshError();
      }

      const issuedAt = this.#now();
      if (!isRefreshable(session, issuedAt)) {
        this.#metrics.identityRefreshes.inc({ outcome: "invalid_refresh" });
        throw invalidRefreshError();
      }
      const issuedAtSeconds = Math.floor(issuedAt.getTime() / 1_000);
      const nextCredential = this.#refreshCredentialFactory();
      const nextSession: LoginSession = {
        ...session,
        refreshFingerprint: nextCredential.fingerprint,
        generation: session.generation + 1,
        version: session.version + 1,
      };

      let accessToken: string;
      try {
        accessToken = await this.#accessTokenSigner({
          subject: user.userId,
          roles: [user.role],
          sessionId: session.sessionId,
          tokenVersion: user.tokenVersion,
          issuedAtSeconds,
        });
      } catch (error) {
        this.#metrics.identityRefreshes.inc({ outcome: "signing_failure" });
        this.#logger.error(
          {
            operation: "identity.refresh",
            requestId: command.requestId,
            correlationId: command.correlationId,
            sessionId: session.sessionId,
            userId: session.userId,
            errorCode: "TOKEN_SIGNING_UNAVAILABLE",
            err: safeError(error),
          },
          "refresh access-token signing failed before session rotation",
        );
        throw new AppError(
          "TOKEN_SIGNING_UNAVAILABLE",
          503,
          "Token signing is temporarily unavailable",
          true,
        );
      }

      const confirmed = await this.#rotateSession(session, nextSession, command);
      if (!isRefreshable(confirmed, this.#now())) {
        await this.#revokeFamily(confirmed, "expired_during_rotation", command);
        this.#metrics.identityRefreshes.inc({ outcome: "invalid_refresh" });
        throw invalidRefreshError();
      }

      let revalidated: CanonicalLoginUser | undefined;
      try {
        revalidated = await this.#store.getUser(user.userId);
      } catch (error) {
        await this.#revokeFamily(confirmed, "revalidation_unavailable", command);
        this.#metrics.identityRefreshes.inc({ outcome: "account_revalidation_failure" });
        this.#logger.error(
          {
            operation: "identity.refresh",
            requestId: command.requestId,
            correlationId: command.correlationId,
            sessionId: session.sessionId,
            userId: session.userId,
            errorCode: "ACCOUNT_REVALIDATION_UNAVAILABLE",
            err: safeError(error),
          },
          "refresh account revalidation failed after rotation",
        );
        throw new AppError(
          "ACCOUNT_REVALIDATION_UNAVAILABLE",
          503,
          "Account authorization is temporarily unavailable",
          true,
        );
      }
      if (!revalidated || !sameAuthorizationSnapshot(user, revalidated)) {
        await this.#revokeFamily(confirmed, "account_changed", command);
        this.#metrics.identityRefreshes.inc({ outcome: "account_denied" });
        throw invalidRefreshError();
      }

      this.#metrics.identityRefreshes.inc({ outcome: "success" });
      this.#logger.info(
        {
          operation: "identity.refresh",
          requestId: command.requestId,
          correlationId: command.correlationId,
          userId: user.userId,
          sessionId: session.sessionId,
          generationFrom: session.generation,
          generationTo: confirmed.generation,
          outcome: "success",
        },
        "refresh token rotated",
      );
      return {
        accessToken,
        refreshToken: nextCredential.rawToken,
        accessExpiresAt: new Date((issuedAtSeconds + this.#accessTokenTtlSeconds) * 1_000),
        session: confirmed,
        user: revalidated,
      };
    } finally {
      stopTimer();
    }
  }

  async #readSession(sessionId: string, command: RefreshCommand): Promise<LoginSession | undefined> {
    try {
      return await this.#store.getSession(sessionId);
    } catch (error) {
      this.#metrics.identityRefreshes.inc({ outcome: "session_read_failure" });
      this.#metrics.dependencyErrors.inc({ dependency: "cassandra", code: "refresh_session_read" });
      this.#logger.error(
        {
          operation: "identity.refresh",
          requestId: command.requestId,
          correlationId: command.correlationId,
          sessionId,
          errorCode: "SESSION_LOOKUP_UNAVAILABLE",
          err: safeError(error),
        },
        "refresh session lookup failed",
      );
      throw new AppError(
        "SESSION_PERSISTENCE_UNAVAILABLE",
        503,
        "Session persistence is temporarily unavailable",
        true,
      );
    }
  }

  async #readUser(userId: string, command: RefreshCommand): Promise<CanonicalLoginUser | undefined> {
    try {
      return await this.#store.getUser(userId);
    } catch (error) {
      this.#metrics.identityRefreshes.inc({ outcome: "user_read_failure" });
      this.#metrics.dependencyErrors.inc({ dependency: "cassandra", code: "refresh_user_read" });
      this.#logger.error(
        {
          operation: "identity.refresh",
          requestId: command.requestId,
          correlationId: command.correlationId,
          sessionId: command.sessionId,
          userId,
          errorCode: "USER_LOOKUP_UNAVAILABLE",
          err: safeError(error),
        },
        "refresh canonical user lookup failed",
      );
      throw new AppError(
        "IDENTITY_PERSISTENCE_UNAVAILABLE",
        503,
        "Identity persistence is temporarily unavailable",
        true,
      );
    }
  }

  async #rotateSession(
    expected: LoginSession,
    next: LoginSession,
    command: RefreshCommand,
  ): Promise<LoginSession> {
    let applied: boolean;
    try {
      applied = await this.#store.rotateSession({
        expected,
        nextRefreshFingerprint: next.refreshFingerprint,
      });
    } catch (error) {
      return this.#resolveAmbiguousRotation(expected, next, command, error);
    }
    if (applied) return next;
    return this.#resolveRotationConflict(expected, next, command);
  }

  async #resolveRotationConflict(
    expected: LoginSession,
    next: LoginSession,
    command: RefreshCommand,
  ): Promise<LoginSession> {
    const current = await this.#readSession(expected.sessionId, command);
    if (current && sameRotationIntent(next, current)) return current;
    if (current && sameRotationIntent(expected, current) && isRefreshable(current, this.#now())) {
      try {
        const applied = await this.#store.rotateSession({
          expected,
          nextRefreshFingerprint: next.refreshFingerprint,
        });
        if (applied) return next;
      } catch (error) {
        return this.#resolveAmbiguousRotation(expected, next, command, error);
      }
      const afterRetry = await this.#readSession(expected.sessionId, command);
      if (afterRetry && sameRotationIntent(next, afterRetry)) return afterRetry;
      if (afterRetry?.state === "ACTIVE") {
        await this.#revokeFamily(afterRetry, "concurrent_reuse", command);
      }
      this.#metrics.identityRefreshes.inc({ outcome: "rotation_conflict" });
      throw invalidRefreshError();
    }
    if (current?.state === "ACTIVE") {
      await this.#revokeFamily(current, "concurrent_reuse", command);
    }
    this.#metrics.identityRefreshes.inc({ outcome: "rotation_conflict" });
    throw invalidRefreshError();
  }

  async #resolveAmbiguousRotation(
    expected: LoginSession,
    next: LoginSession,
    command: RefreshCommand,
    writeError: unknown,
  ): Promise<LoginSession> {
    try {
      const current = await this.#store.getSession(expected.sessionId);
      if (current && sameRotationIntent(next, current)) {
        this.#metrics.identityRefreshes.inc({ outcome: "ambiguous_recovered" });
        return current;
      }
    } catch (readBackError) {
      this.#logger.error(
        {
          operation: "identity.refresh",
          requestId: command.requestId,
          correlationId: command.correlationId,
          sessionId: expected.sessionId,
          errorCode: "ROTATION_READBACK_UNAVAILABLE",
          err: safeError(readBackError),
        },
        "ambiguous refresh rotation could not be read back",
      );
    }
    this.#metrics.identityRefreshes.inc({ outcome: "rotation_persist_failure" });
    this.#metrics.dependencyErrors.inc({ dependency: "cassandra", code: "refresh_rotation_write" });
    this.#logger.error(
      {
        operation: "identity.refresh",
        requestId: command.requestId,
        correlationId: command.correlationId,
        sessionId: expected.sessionId,
        errorCode: "ROTATION_PERSISTENCE_UNAVAILABLE",
        err: safeError(writeError),
      },
      "refresh rotation outcome is unresolved",
    );
    throw new AppError(
      "ROTATION_PERSISTENCE_UNAVAILABLE",
      503,
      "Refresh rotation persistence is temporarily unavailable",
      true,
    );
  }

  async #revokeFamily(
    observed: LoginSession,
    reason:
      | "suspected_reuse"
      | "concurrent_reuse"
      | "account_denied"
      | "account_changed"
      | "revalidation_unavailable"
      | "expired_during_rotation"
      | "auth_version_mismatch",
    command: RefreshCommand,
  ): Promise<void> {
    if (observed.state !== "ACTIVE") return;
    try {
      let current = observed;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const revoked = await this.#store.revokeSession(current.sessionId, current.version, this.#now());
        if (revoked) {
          this.#metrics.identityRefreshCompensations.inc({ reason });
          return;
        }
        const reread = await this.#store.getSession(current.sessionId);
        if (!reread || reread.state !== "ACTIVE") return;
        current = reread;
      }
      throw new Error("REFRESH_FAMILY_REVOCATION_NOT_APPLIED");
    } catch (error) {
      this.#metrics.dependencyErrors.inc({ dependency: "cassandra", code: "refresh_family_revoke" });
      this.#logger.error(
        {
          operation: "identity.refresh",
          requestId: command.requestId,
          correlationId: command.correlationId,
          sessionId: observed.sessionId,
          userId: observed.userId,
          errorCode: "REFRESH_FAMILY_REVOCATION_FAILED",
          err: safeError(error),
        },
        "refresh family revocation failed before fail-closed response",
      );
    }
  }
}

function invalidRefreshError(): AppError {
  return new AppError("INVALID_REFRESH_CREDENTIALS", 401, "Invalid refresh credentials");
}

function isRefreshable(session: LoginSession, now: Date): boolean {
  return (
    session.state === "ACTIVE" && session.revokedAt === null && session.expiresAt.getTime() > now.getTime()
  );
}

function sameAuthorizationSnapshot(before: CanonicalLoginUser, after: CanonicalLoginUser): boolean {
  return (
    after.userId === before.userId &&
    after.status === "ACTIVE" &&
    after.status === before.status &&
    after.role === before.role &&
    after.tokenVersion === before.tokenVersion &&
    after.credentialVersion === before.credentialVersion
  );
}

function sameRotationIntent(expected: LoginSession, actual: LoginSession): boolean {
  return (
    actual.sessionId === expected.sessionId &&
    actual.userId === expected.userId &&
    actual.tokenFamilyId === expected.tokenFamilyId &&
    actual.refreshFingerprint === expected.refreshFingerprint &&
    actual.generation === expected.generation &&
    actual.state === expected.state &&
    actual.expiresAt.getTime() === expected.expiresAt.getTime() &&
    actual.revokedAt?.getTime() === expected.revokedAt?.getTime() &&
    actual.version === expected.version &&
    actual.authVersion === expected.authVersion &&
    actual.createdAt.getTime() === expected.createdAt.getTime()
  );
}
