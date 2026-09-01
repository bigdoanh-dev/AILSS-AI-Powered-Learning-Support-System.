import { AppError } from "../../../../packages/http/src/index.js";
import { safeError } from "../../../../packages/logger/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import type { LoginSession } from "../login/model.js";
import type { ProfileUser } from "./model.js";

export interface ProtectedIdentityStore {
  getSession(sessionId: string): Promise<LoginSession | undefined>;
  getUser(userId: string): Promise<ProfileUser | undefined>;
}

export interface ValidatedProtectedIdentity {
  readonly actor: ActorContext;
  readonly session: LoginSession;
  readonly user: ProfileUser;
}

export class ProtectedIdentityRequestValidator {
  public constructor(
    private readonly store: ProtectedIdentityStore,
    private readonly metrics: ReturnType<typeof createMetrics>,
    private readonly logger: { error(input: object, message: string): void },
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async validate(actor: ActorContext): Promise<ValidatedProtectedIdentity> {
    let session: LoginSession | undefined;
    try {
      // Q-IDN-003: cross-cutting protected-request security dependency (ERRATA-P7-005-01).
      session = await this.store.getSession(actor.sessionId);
    } catch (error) {
      this.metrics.identityProtectedRequests.inc({ outcome: "session_dependency_failure" });
      this.metrics.dependencyErrors.inc({ dependency: "cassandra", code: "protected_session_read" });
      this.logger.error(
        {
          operation: "identity.protected.validate",
          correlationId: actor.correlationId,
          sessionId: actor.sessionId,
          errorCode: "PROTECTED_SESSION_LOOKUP_UNAVAILABLE",
          err: safeError(error),
        },
        "protected session lookup failed",
      );
      throw dependencyUnavailable();
    }
    if (
      !session ||
      session.sessionId !== actor.sessionId ||
      session.userId !== actor.userId ||
      session.state !== "ACTIVE" ||
      session.revokedAt !== null ||
      session.authVersion === null ||
      session.expiresAt.getTime() <= this.now().getTime()
    ) {
      this.metrics.identityProtectedRequests.inc({ outcome: "invalid_session" });
      throw invalidAccessToken();
    }

    let user: ProfileUser | undefined;
    try {
      // Q-IDN-001: canonical account, role, tokenVersion and private self-profile.
      user = await this.store.getUser(actor.userId);
    } catch (error) {
      this.metrics.identityProtectedRequests.inc({ outcome: "account_dependency_failure" });
      this.metrics.dependencyErrors.inc({ dependency: "cassandra", code: "protected_account_read" });
      this.logger.error(
        {
          operation: "identity.protected.validate",
          correlationId: actor.correlationId,
          sessionId: actor.sessionId,
          userId: actor.userId,
          errorCode: "PROTECTED_ACCOUNT_LOOKUP_UNAVAILABLE",
          err: safeError(error),
        },
        "protected canonical account lookup failed",
      );
      throw dependencyUnavailable();
    }
    if (
      !user ||
      user.userId !== actor.userId ||
      user.status !== "ACTIVE" ||
      user.tokenVersion !== actor.tokenVersion ||
      session.authVersion !== user.tokenVersion ||
      actor.roles.length !== 1 ||
      actor.roles[0] !== user.role
    ) {
      this.metrics.identityProtectedRequests.inc({ outcome: "account_denied" });
      throw invalidAccessToken();
    }
    this.metrics.identityProtectedRequests.inc({ outcome: "success" });
    return { actor, session, user };
  }
}

function invalidAccessToken(): AppError {
  return new AppError("INVALID_ACCESS_TOKEN", 401, "Invalid access token");
}

function dependencyUnavailable(): AppError {
  return new AppError(
    "IDENTITY_AUTHORIZATION_UNAVAILABLE",
    503,
    "Identity authorization is temporarily unavailable",
    true,
  );
}
