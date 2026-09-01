import type { createMetrics } from "../../../../packages/observability/src/index.js";
import { AppError } from "../../../../packages/http/src/index.js";
import { safeError } from "../../../../packages/logger/src/index.js";
import type { Logger } from "pino";
import { verifyPassword } from "../registration/password.js";
import {
  SESSION_INITIAL_STATE,
  type CanonicalLoginUser,
  type LoginCommand,
  type LoginCredential,
  type LoginResult,
  type LoginSession,
  newLoginIdentifiers,
} from "./model.js";
import { newRefreshCredential, type RefreshCredential } from "./tokens.js";

export interface IdentityLoginStore {
  getCredential(normalizedEmail: string): Promise<LoginCredential | undefined>;
  getUser(userId: string): Promise<CanonicalLoginUser | undefined>;
  insertSession(session: LoginSession): Promise<boolean>;
  getSession(sessionId: string): Promise<LoginSession | undefined>;
  revokeSession(sessionId: string, expectedVersion: number, revokedAt: Date): Promise<boolean>;
}

export interface LoginAccessTokenInput {
  readonly subject: string;
  readonly roles: readonly string[];
  readonly sessionId: string;
  readonly tokenVersion: number;
  readonly issuedAtSeconds: number;
}

export interface LoginServiceOptions {
  readonly store: IdentityLoginStore;
  readonly logger: Logger;
  readonly metrics: ReturnType<typeof createMetrics>;
  readonly dummyPasswordHash: string;
  readonly accessTokenTtlSeconds: number;
  readonly refreshTokenTtlSeconds: number;
  readonly accessTokenSigner: (input: LoginAccessTokenInput) => Promise<string>;
  readonly passwordVerifier?: (passwordHash: string, password: string) => Promise<boolean>;
  readonly refreshCredentialFactory?: () => RefreshCredential;
  readonly identifierFactory?: () => { sessionId: string; tokenFamilyId: string };
  readonly now?: () => Date;
}

export class LoginService {
  readonly #store: IdentityLoginStore;
  readonly #logger: Logger;
  readonly #metrics: ReturnType<typeof createMetrics>;
  readonly #dummyPasswordHash: string;
  readonly #accessTokenTtlSeconds: number;
  readonly #refreshTokenTtlSeconds: number;
  readonly #accessTokenSigner: (input: LoginAccessTokenInput) => Promise<string>;
  readonly #passwordVerifier: (passwordHash: string, password: string) => Promise<boolean>;
  readonly #refreshCredentialFactory: () => RefreshCredential;
  readonly #identifierFactory: () => { sessionId: string; tokenFamilyId: string };
  readonly #now: () => Date;

  public constructor(options: LoginServiceOptions) {
    this.#store = options.store;
    this.#logger = options.logger;
    this.#metrics = options.metrics;
    this.#dummyPasswordHash = options.dummyPasswordHash;
    this.#accessTokenTtlSeconds = options.accessTokenTtlSeconds;
    this.#refreshTokenTtlSeconds = options.refreshTokenTtlSeconds;
    this.#accessTokenSigner = options.accessTokenSigner;
    this.#passwordVerifier = options.passwordVerifier ?? verifyPassword;
    this.#refreshCredentialFactory = options.refreshCredentialFactory ?? newRefreshCredential;
    this.#identifierFactory = options.identifierFactory ?? newLoginIdentifiers;
    this.#now = options.now ?? (() => new Date());
  }

  public async login(command: LoginCommand): Promise<LoginResult> {
    const stopTimer = this.#metrics.identityLoginDuration.startTimer();
    try {
      const credential = await this.#readCredential(command);
      const passwordValid = await this.#verifyCredential(command, credential);
      if (!credential || credential.status !== "ACTIVE" || !passwordValid) {
        this.#metrics.identityLogins.inc({ outcome: "invalid_credentials" });
        throw invalidCredentialsError();
      }

      const user = await this.#readUser(credential.userId, command);
      if (!user) {
        this.#metrics.identityLogins.inc({ outcome: "invalid_credentials" });
        throw invalidCredentialsError();
      }
      if (user.status !== "ACTIVE") {
        this.#metrics.identityLogins.inc({ outcome: "account_denied" });
        throw accountDeniedError();
      }
      if (
        credential.userId !== user.userId ||
        credential.credentialVersion !== user.credentialVersion ||
        command.email !== user.normalizedEmail ||
        credential.securityOperationId !== user.securityOperationId
      ) {
        this.#metrics.identityLogins.inc({ outcome: "credential_version_mismatch" });
        throw invalidCredentialsError();
      }

      const createdAt = this.#now();
      const issuedAtSeconds = Math.floor(createdAt.getTime() / 1_000);
      const identifiers = this.#identifierFactory();
      const refresh = this.#refreshCredentialFactory();
      const accessExpiresAt = new Date((issuedAtSeconds + this.#accessTokenTtlSeconds) * 1_000);
      const refreshExpiresAt = new Date(createdAt.getTime() + this.#refreshTokenTtlSeconds * 1_000);

      let accessToken: string;
      try {
        accessToken = await this.#accessTokenSigner({
          subject: user.userId,
          roles: [user.role],
          sessionId: identifiers.sessionId,
          tokenVersion: user.tokenVersion,
          issuedAtSeconds,
        });
      } catch (error) {
        this.#metrics.identityLogins.inc({ outcome: "signing_failure" });
        this.#logger.error(
          {
            operation: "identity.login",
            requestId: command.requestId,
            correlationId: command.correlationId,
            errorCode: "TOKEN_SIGNING_UNAVAILABLE",
            err: safeError(error),
          },
          "identity login token signing failed",
        );
        throw new AppError(
          "TOKEN_SIGNING_UNAVAILABLE",
          503,
          "Token signing is temporarily unavailable",
          true,
        );
      }

      const session: LoginSession = {
        sessionId: identifiers.sessionId,
        userId: user.userId,
        tokenFamilyId: identifiers.tokenFamilyId,
        refreshFingerprint: refresh.fingerprint,
        generation: 0,
        state: SESSION_INITIAL_STATE,
        expiresAt: refreshExpiresAt,
        revokedAt: null,
        version: 1,
        authVersion: user.tokenVersion,
        createdAt,
      };
      await this.#persistSession(session, command);

      let revalidated: CanonicalLoginUser | undefined;
      try {
        revalidated = await this.#store.getUser(user.userId);
      } catch (error) {
        await this.#compensateSession(session, "revalidation_unavailable", command);
        this.#metrics.identityLogins.inc({ outcome: "account_revalidation_failure" });
        this.#logger.error(
          {
            operation: "identity.login",
            requestId: command.requestId,
            correlationId: command.correlationId,
            userId: user.userId,
            sessionId: session.sessionId,
            errorCode: "ACCOUNT_REVALIDATION_UNAVAILABLE",
            err: safeError(error),
          },
          "identity login account revalidation failed",
        );
        throw new AppError(
          "ACCOUNT_REVALIDATION_UNAVAILABLE",
          503,
          "Account authorization is temporarily unavailable",
          true,
        );
      }
      if (!revalidated || !sameAuthorizationSnapshot(user, revalidated)) {
        await this.#compensateSession(session, "account_changed", command);
        this.#metrics.identityLogins.inc({ outcome: "account_denied" });
        throw accountDeniedError();
      }

      this.#metrics.identityLogins.inc({ outcome: "success" });
      this.#logger.info(
        {
          operation: "identity.login",
          requestId: command.requestId,
          correlationId: command.correlationId,
          userId: user.userId,
          sessionId: session.sessionId,
          outcome: "success",
        },
        "identity login completed",
      );
      return {
        accessToken,
        refreshToken: refresh.rawToken,
        accessExpiresAt,
        refreshExpiresAt,
        session,
        user: revalidated,
      };
    } finally {
      stopTimer();
    }
  }

  async #readCredential(command: LoginCommand): Promise<LoginCredential | undefined> {
    try {
      return await this.#store.getCredential(command.email);
    } catch (error) {
      this.#metrics.identityLogins.inc({ outcome: "credential_read_failure" });
      this.#metrics.dependencyErrors.inc({ dependency: "cassandra", code: "login_credential_read" });
      this.#logger.error(
        {
          operation: "identity.login",
          requestId: command.requestId,
          correlationId: command.correlationId,
          errorCode: "CREDENTIAL_LOOKUP_UNAVAILABLE",
          err: safeError(error),
        },
        "identity login credential lookup failed",
      );
      throw new AppError(
        "IDENTITY_PERSISTENCE_UNAVAILABLE",
        503,
        "Identity persistence is temporarily unavailable",
        true,
      );
    }
  }

  async #verifyCredential(command: LoginCommand, credential: LoginCredential | undefined): Promise<boolean> {
    const stopTimer = this.#metrics.identityPasswordVerificationDuration.startTimer();
    try {
      try {
        return await this.#passwordVerifier(
          credential?.passwordHash ?? this.#dummyPasswordHash,
          command.password,
        );
      } catch (error) {
        if (credential) {
          this.#logger.warn(
            {
              operation: "identity.login",
              requestId: command.requestId,
              correlationId: command.correlationId,
              errorCode: "STORED_PASSWORD_PHC_REJECTED",
              err: safeError(error),
            },
            "stored password verifier input was rejected",
          );
        }
        try {
          await this.#passwordVerifier(this.#dummyPasswordHash, command.password);
          return false;
        } catch (fallbackError) {
          this.#metrics.identityLogins.inc({ outcome: "password_verifier_failure" });
          this.#logger.error(
            {
              operation: "identity.login",
              requestId: command.requestId,
              correlationId: command.correlationId,
              errorCode: "PASSWORD_VERIFICATION_UNAVAILABLE",
              err: safeError(fallbackError),
            },
            "identity password verification failed",
          );
          throw new AppError(
            "PASSWORD_VERIFICATION_UNAVAILABLE",
            503,
            "Password verification is temporarily unavailable",
            true,
          );
        }
      }
    } finally {
      stopTimer();
    }
  }

  async #readUser(userId: string, command: LoginCommand): Promise<CanonicalLoginUser | undefined> {
    try {
      return await this.#store.getUser(userId);
    } catch (error) {
      this.#metrics.identityLogins.inc({ outcome: "user_read_failure" });
      this.#metrics.dependencyErrors.inc({ dependency: "cassandra", code: "login_user_read" });
      this.#logger.error(
        {
          operation: "identity.login",
          requestId: command.requestId,
          correlationId: command.correlationId,
          userId,
          errorCode: "USER_LOOKUP_UNAVAILABLE",
          err: safeError(error),
        },
        "identity login canonical user lookup failed",
      );
      throw new AppError(
        "IDENTITY_PERSISTENCE_UNAVAILABLE",
        503,
        "Identity persistence is temporarily unavailable",
        true,
      );
    }
  }

  async #persistSession(session: LoginSession, command: LoginCommand): Promise<void> {
    try {
      const applied = await this.#store.insertSession(session);
      if (applied) return;
      const existing = await this.#store.getSession(session.sessionId);
      if (existing && sameSessionIntent(session, existing)) return;
      throw new Error("SESSION_IDENTIFIER_COLLISION");
    } catch (error) {
      try {
        const existing = await this.#store.getSession(session.sessionId);
        if (existing && sameSessionIntent(session, existing)) return;
      } catch (readBackError) {
        this.#logger.error(
          {
            operation: "identity.login",
            requestId: command.requestId,
            correlationId: command.correlationId,
            sessionId: session.sessionId,
            errorCode: "SESSION_READBACK_UNAVAILABLE",
            err: safeError(readBackError),
          },
          "ambiguous login session could not be resolved",
        );
      }
      this.#metrics.identityLogins.inc({ outcome: "session_persist_failure" });
      this.#metrics.dependencyErrors.inc({ dependency: "cassandra", code: "login_session_write" });
      this.#logger.error(
        {
          operation: "identity.login",
          requestId: command.requestId,
          correlationId: command.correlationId,
          sessionId: session.sessionId,
          errorCode: "SESSION_PERSISTENCE_UNAVAILABLE",
          err: safeError(error),
        },
        "identity login session persistence failed",
      );
      throw new AppError(
        "SESSION_PERSISTENCE_UNAVAILABLE",
        503,
        "Session persistence is temporarily unavailable",
        true,
      );
    }
  }

  async #compensateSession(
    session: LoginSession,
    reason: "account_changed" | "revalidation_unavailable",
    command: LoginCommand,
  ): Promise<void> {
    try {
      const revoked = await this.#store.revokeSession(session.sessionId, session.version, this.#now());
      if (!revoked) {
        const current = await this.#store.getSession(session.sessionId);
        if (current?.state === SESSION_INITIAL_STATE) throw new Error("SESSION_COMPENSATION_NOT_APPLIED");
      }
      this.#metrics.identityLoginCompensations.inc({ reason });
    } catch (error) {
      this.#metrics.dependencyErrors.inc({ dependency: "cassandra", code: "login_session_compensation" });
      this.#logger.error(
        {
          operation: "identity.login",
          requestId: command.requestId,
          correlationId: command.correlationId,
          userId: session.userId,
          sessionId: session.sessionId,
          errorCode: "SESSION_COMPENSATION_FAILED",
          err: safeError(error),
        },
        "login session compensation failed before fail-closed response",
      );
    }
  }
}

function invalidCredentialsError(): AppError {
  return new AppError("INVALID_CREDENTIALS", 401, "Invalid email or password");
}

function accountDeniedError(): AppError {
  return new AppError("LOGIN_NOT_ALLOWED", 403, "This account cannot sign in");
}

function sameAuthorizationSnapshot(before: CanonicalLoginUser, after: CanonicalLoginUser): boolean {
  return (
    after.userId === before.userId &&
    after.status === "ACTIVE" &&
    after.status === before.status &&
    after.role === before.role &&
    after.tokenVersion === before.tokenVersion &&
    after.credentialVersion === before.credentialVersion &&
    after.normalizedEmail === before.normalizedEmail &&
    after.securityOperationId === before.securityOperationId
  );
}

function sameSessionIntent(expected: LoginSession, actual: LoginSession): boolean {
  return (
    actual.sessionId === expected.sessionId &&
    actual.userId === expected.userId &&
    actual.tokenFamilyId === expected.tokenFamilyId &&
    actual.refreshFingerprint === expected.refreshFingerprint &&
    actual.generation === expected.generation &&
    actual.state === expected.state &&
    actual.expiresAt.getTime() === expected.expiresAt.getTime() &&
    actual.revokedAt === null &&
    actual.version === expected.version &&
    actual.authVersion === expected.authVersion &&
    actual.createdAt.getTime() === expected.createdAt.getTime()
  );
}
