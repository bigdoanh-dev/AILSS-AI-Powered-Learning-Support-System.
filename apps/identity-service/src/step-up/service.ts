import type { CryptoKey } from "jose";
import { AppError } from "../../../../packages/http/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import { signStepUpProof, type ActorContext } from "../../../../packages/security/src/index.js";
import type { PasswordCredential } from "../password/model.js";
import type { ValidatedProtectedIdentity } from "../profile/validator.js";
import { verifyPassword } from "../registration/password.js";
import type { AdminStepUpRequest } from "./model.js";

export interface AdminStepUpStore {
  getCredential(email: string): Promise<PasswordCredential | undefined>;
}
export interface AdminStepUpValidator {
  validate(actor: ActorContext): Promise<ValidatedProtectedIdentity>;
}
export class AdminStepUpService {
  public constructor(
    private readonly store: AdminStepUpStore,
    private readonly validator: AdminStepUpValidator,
    private readonly privateKey: CryptoKey,
    private readonly kid: string,
    private readonly metrics: ReturnType<typeof createMetrics>,
  ) {}
  public async authorize(
    actor: ActorContext,
    request: AdminStepUpRequest,
  ): Promise<{ proof: string; expiresIn: number; authMethod: "PASSWORD_REAUTH" }> {
    const validated = await this.validator.validate(actor);
    if (validated.user.role !== "ADMIN")
      throw new AppError("ADMIN_ROLE_REQUIRED", 403, "Active Admin authorization is required");
    // The protected validator has just read Q-IDN-003 and Q-IDN-001 and bound both
    // canonical records to the signed actor context/security epoch.
    const admin = validated.user;
    let credential: PasswordCredential | undefined;
    try {
      credential = await this.store.getCredential(admin.normalizedEmail);
    } catch {
      throw unavailable();
    }
    if (
      !credential ||
      credential.userId !== admin.userId ||
      credential.status !== "ACTIVE" ||
      credential.credentialVersion !== admin.credentialVersion ||
      credential.securityOperationId !== admin.securityOperationId
    )
      throw denied();
    let valid = false;
    try {
      valid = await verifyPassword(credential.passwordHash, request.currentPassword);
    } catch {
      throw unavailable();
    }
    if (!valid) {
      this.metrics.identityAdminAuthorization.inc({ outcome: "step_up_denied" });
      throw denied();
    }
    const proof = await signStepUpProof(
      this.privateKey,
      this.kid,
      "identity-service",
      request.resourceType === "LECTURER_APPLICATION" || request.resourceType === "USER"
        ? "identity-service"
        : request.resourceType === "REPORT"
          ? "interaction-service"
          : "learning-service",
      {
        adminUserId: admin.userId,
        sessionId: actor.sessionId,
        tokenVersion: admin.tokenVersion,
        action: request.action,
        resourceType: request.resourceType,
        resourceId: request.resourceId,
      },
    );
    this.metrics.identityAdminAuthorization.inc({ outcome: "step_up_proof_issued" });
    return { proof, expiresIn: 30, authMethod: "PASSWORD_REAUTH" };
  }
}
function denied() {
  return new AppError("ADMIN_STEP_UP_FAILED", 401, "Admin step-up authorization failed");
}
function unavailable() {
  return new AppError("ADMIN_STEP_UP_UNAVAILABLE", 503, "Admin step-up is temporarily unavailable", true);
}
