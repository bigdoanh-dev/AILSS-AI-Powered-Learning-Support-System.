import { z } from "zod";
import type { AppConfig } from "../../../packages/config/src/index.js";
import {
  loadPrivateKey,
  signActorContext,
  signServiceToken,
  type StepUpAction,
  type StepUpResourceType,
  type VerifiedAccessToken,
} from "../../../packages/security/src/index.js";

const responseSchema = z
  .object({
    data: z
      .object({
        proof: z.string().min(64),
        expiresIn: z.literal(30),
        authMethod: z.literal("PASSWORD_REAUTH"),
      })
      .strict(),
    meta: z.object({ requestId: z.string().uuid(), timestamp: z.string().datetime() }).strict(),
  })
  .strict();
export interface AdminStepUpClient {
  authorize(input: {
    actor: VerifiedAccessToken;
    correlationId: string;
    currentPassword: string;
    action: StepUpAction;
    resourceId: string;
    resourceType?: StepUpResourceType;
  }): Promise<string>;
}
export class AdminStepUpClientError extends Error {
  public constructor(public readonly status: 403 | 503) {
    super("ADMIN_STEP_UP_REJECTED");
  }
}
export async function createAdminStepUpClient(config: AppConfig): Promise<AdminStepUpClient> {
  if (!config.ACTOR_CONTEXT_PRIVATE_KEY_PATH)
    throw new Error("Gateway Admin step-up requires its private signing key");
  const key = await loadPrivateKey(config.ACTOR_CONTEXT_PRIVATE_KEY_PATH);
  return {
    async authorize(input) {
      const now = Math.floor(Date.now() / 1000);
      const [serviceToken, actorContext] = await Promise.all([
        signServiceToken(key, {
          issuer: "api-gateway",
          serviceId: "api-gateway",
          audience: "identity-service",
          purpose: "identity.admin.step-up.authorize",
          kid: config.ACTOR_CONTEXT_KID,
          ttlSeconds: 30,
        }),
        signActorContext(
          key,
          config.ACTOR_CONTEXT_KID,
          config.ACTOR_CONTEXT_ISSUER,
          "identity-service",
          "identity.admin.step-up.authorize",
          {
            userId: input.actor.userId,
            roles: [...input.actor.roles],
            sessionId: input.actor.sessionId,
            tokenVersion: input.actor.tokenVersion,
            correlationId: input.correlationId,
            issuedAt: now,
            expiresAt: now + 30,
          },
        ),
      ]);
      const response = await fetch(
        new URL("/internal/v1/admin/step-up-authorizations", config.IDENTITY_SERVICE_URL),
        {
          method: "POST",
          headers: {
            authorization: `Service ${serviceToken}`,
            "x-actor-context": actorContext,
            "x-correlation-id": input.correlationId,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            currentPassword: input.currentPassword,
            action: input.action,
            resourceType: input.resourceType ?? "COURSE",
            resourceId: input.resourceId,
          }),
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!response.ok)
        throw new AdminStepUpClientError(response.status === 401 || response.status === 403 ? 403 : 503);
      return responseSchema.parse(await response.json()).data.proof;
    },
  };
}
