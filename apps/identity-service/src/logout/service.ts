import { AppError } from "../../../../packages/http/src/index.js";
import type { createLogger } from "../../../../packages/logger/src/index.js";
import { safeError } from "../../../../packages/logger/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import type { LoginSession } from "../login/model.js";
import type { LogoutCommand, LogoutResult } from "./model.js";

export interface IdentityLogoutStore {
  getSession(sessionId: string): Promise<LoginSession | undefined>;
  revokeSession(sessionId: string, expectedVersion: number, revokedAt: Date): Promise<boolean>;
}

export interface LogoutServiceOptions {
  readonly store: IdentityLogoutStore;
  readonly logger: ReturnType<typeof createLogger>;
  readonly metrics: ReturnType<typeof createMetrics>;
  readonly now?: () => Date;
}

export class LogoutService {
  readonly #store: IdentityLogoutStore;
  readonly #logger: ReturnType<typeof createLogger>;
  readonly #metrics: ReturnType<typeof createMetrics>;
  readonly #now: () => Date;

  public constructor(options: LogoutServiceOptions) {
    this.#store = options.store;
    this.#logger = options.logger;
    this.#metrics = options.metrics;
    this.#now = options.now ?? (() => new Date());
  }

  public async logout(command: LogoutCommand): Promise<LogoutResult> {
    const stopTimer = this.#metrics.identityLogoutDuration.startTimer();
    try {
      let current = await this.#readSession(command);
      this.#requireOwnership(current, command);
      if (!current) throw invalidAccessToken();

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const terminal = this.#terminalResult(current, command);
        if (terminal) return terminal;
        const revokedAt = this.#now();
        let applied: boolean;
        try {
          applied = await this.#store.revokeSession(current.sessionId, current.version, revokedAt);
        } catch (writeError) {
          const resolved = await this.#resolveAmbiguous(current, command, writeError);
          if (resolved.result) return resolved.result;
          if (!resolved.current || attempt === 1) throw persistenceUnavailable();
          current = resolved.current;
          continue;
        }
        if (applied) return this.#success("revoked", current, command, current.version + 1);

        const afterConflict = await this.#readSession(command);
        this.#requireOwnership(afterConflict, command);
        if (!afterConflict) throw invalidAccessToken();
        const terminalAfterConflict = this.#terminalResult(afterConflict, command);
        if (terminalAfterConflict) return terminalAfterConflict;
        this.#metrics.identityLogouts.inc({ outcome: "lwt_conflict" });
        if (attempt === 1) throw persistenceUnavailable();
        current = afterConflict;
      }
      throw persistenceUnavailable();
    } finally {
      stopTimer();
    }
  }

  async #readSession(command: LogoutCommand): Promise<LoginSession | undefined> {
    try {
      return await this.#store.getSession(command.sessionId);
    } catch (error) {
      this.#metrics.identityLogouts.inc({ outcome: "persistence_failure" });
      this.#metrics.dependencyErrors.inc({ dependency: "cassandra", code: "logout_session_read" });
      this.#logger.error(
        {
          operation: "identity.logout",
          requestId: command.requestId,
          correlationId: command.correlationId,
          sessionId: command.sessionId,
          errorCode: "SESSION_LOOKUP_UNAVAILABLE",
          err: safeError(error),
        },
        "logout session lookup failed",
      );
      throw persistenceUnavailable();
    }
  }

  #requireOwnership(session: LoginSession | undefined, command: LogoutCommand): void {
    if (!session) return;
    if (session.sessionId !== command.sessionId || session.userId !== command.userId) {
      this.#metrics.identityLogouts.inc({ outcome: "ownership_mismatch" });
      this.#logger.warn(
        {
          operation: "identity.logout",
          requestId: command.requestId,
          correlationId: command.correlationId,
          sessionId: command.sessionId,
          outcome: "ownership_mismatch",
        },
        "logout canonical session ownership check failed",
      );
      throw invalidAccessToken();
    }
  }

  #terminalResult(session: LoginSession, command: LogoutCommand): LogoutResult | undefined {
    if (session.state === "REVOKED") return this.#success("idempotent", session, command, session.version);
    if (session.state !== "ACTIVE") throw invalidAccessToken();
    if (session.expiresAt.getTime() <= this.#now().getTime()) {
      return this.#success("expired", session, command, session.version);
    }
    return undefined;
  }

  async #resolveAmbiguous(
    expected: LoginSession,
    command: LogoutCommand,
    writeError: unknown,
  ): Promise<{ readonly result?: LogoutResult; readonly current?: LoginSession }> {
    let current: LoginSession | undefined;
    try {
      current = await this.#store.getSession(expected.sessionId);
    } catch (readError) {
      this.#metrics.identityLogouts.inc({ outcome: "persistence_failure" });
      this.#logger.error(
        {
          operation: "identity.logout",
          requestId: command.requestId,
          correlationId: command.correlationId,
          sessionId: command.sessionId,
          errorCode: "LOGOUT_READBACK_UNAVAILABLE",
          err: safeError(readError),
        },
        "ambiguous logout mutation could not be read back",
      );
      throw persistenceUnavailable();
    }
    this.#requireOwnership(current, command);
    if (current?.state === "REVOKED") {
      this.#metrics.identityLogouts.inc({ outcome: "ambiguous_recovered" });
      return { result: this.#success("revoked", current, command, current.version) };
    }
    if (current?.state === "ACTIVE") return { current };
    this.#metrics.identityLogouts.inc({ outcome: "persistence_failure" });
    this.#logger.error(
      {
        operation: "identity.logout",
        requestId: command.requestId,
        correlationId: command.correlationId,
        sessionId: command.sessionId,
        errorCode: "LOGOUT_PERSISTENCE_UNAVAILABLE",
        err: safeError(writeError),
      },
      "ambiguous logout mutation outcome is unresolved",
    );
    return {};
  }

  #success(
    outcome: LogoutResult["outcome"],
    session: LoginSession,
    command: LogoutCommand,
    resultingVersion: number,
  ): LogoutResult {
    this.#metrics.identityLogouts.inc({ outcome });
    this.#logger.info(
      {
        operation: "identity.logout",
        requestId: command.requestId,
        correlationId: command.correlationId,
        userId: command.userId,
        sessionId: command.sessionId,
        oldVersion: session.version,
        newVersion: resultingVersion,
        outcome,
      },
      "current identity session logout completed",
    );
    return { outcome };
  }
}

function invalidAccessToken(): AppError {
  return new AppError("INVALID_ACCESS_TOKEN", 401, "Invalid access token");
}

function persistenceUnavailable(): AppError {
  return new AppError(
    "SESSION_PERSISTENCE_UNAVAILABLE",
    503,
    "Session persistence is temporarily unavailable",
    true,
  );
}
