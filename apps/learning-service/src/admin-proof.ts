import type { CryptoKey } from "jose";
import {
  loadPublicKey,
  verifyStepUpProof,
  type ActorContext,
  type StepUpAction,
} from "../../../packages/security/src/index.js";

export class LearningAdminProofVerifier {
  public constructor(
    private readonly key: CryptoKey,
    private readonly kid: string,
  ) {}
  public async verify(input: {
    proof: string;
    actor: ActorContext;
    action: StepUpAction;
    resourceId: string;
  }) {
    const result = await verifyStepUpProof(input.proof, this.key, {
      issuer: "identity-service",
      audience: "learning-service",
      kid: this.kid,
      action: input.action,
      resourceId: input.resourceId,
      adminUserId: input.actor.userId,
    });
    if (
      result.sessionId !== input.actor.sessionId ||
      result.tokenVersion !== input.actor.tokenVersion ||
      !input.actor.roles.includes("ADMIN")
    )
      throw new Error("ADMIN_PROOF_ACTOR_MISMATCH");
    return result;
  }
}
export async function createLearningAdminProofVerifier(path: string, kid: string) {
  return new LearningAdminProofVerifier(await loadPublicKey(path), kid);
}
