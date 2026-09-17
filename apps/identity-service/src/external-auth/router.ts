import { Router, type Request } from "express";
import { ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import {
  linkSocialRequestSchema,
  socialLoginRequestSchema,
  type SocialLoginRequest,
} from "./model.js";
import type { IdentityExternalAuthService } from "./service.js";

export type ActorContextVerifier = (token: string) => Promise<ActorContext>;

export function externalAuthRouter(
  service: IdentityExternalAuthService,
  verifyActorContext: ActorContextVerifier,
  metrics: ReturnType<typeof createMetrics>,
): Router {
  const router = Router();

  // 1. Social login or signup (Public / Gateway rate-limited)
  router.post("/api/v1/auth/social/:provider", async (req, res, next): Promise<void> => {
    try {
      const context = currentRequestContext();
      const rawProvider = req.params.provider.toUpperCase();
      if (rawProvider !== "GOOGLE" && rawProvider !== "APPLE") {
        throw new AppError("INVALID_PROVIDER", 400, "Provider must be google or apple");
      }

      let body: SocialLoginRequest;
      try {
        body = socialLoginRequestSchema.parse(req.body);
      } catch (error) {
        if (!(error instanceof ZodError)) throw error;
        throw new AppError(
          "VALIDATION_FAILED",
          422,
          "Invalid social login request",
          false,
          error.issues.map((i) => ({ field: i.path.join(".") || "body", reason: i.message })),
        );
      }

      const clientProfile = body.clientProfile
        ? {
            ...(body.clientProfile.firstName ? { firstName: body.clientProfile.firstName } : {}),
            ...(body.clientProfile.lastName ? { lastName: body.clientProfile.lastName } : {}),
          }
        : undefined;

      const result = await service.socialLogin(rawProvider, body.idToken, clientProfile);
      res.status(result.isNewUser ? 201 : 200).json({
        data: result,
        meta: { requestId: context?.requestId ?? "", timestamp: new Date().toISOString() },
      });
    } catch (error) {
      next(error);
    }
  });

  // 2. List linked identities for current user (Authenticated)
  router.get("/api/v1/auth/identities", async (req, res, next): Promise<void> => {
    try {
      const { actor, requestId } = await verifiedActor(req, verifyActorContext, metrics);
      const identities = await service.listIdentities(actor.userId);
      res.status(200).json({
        data: identities,
        meta: { requestId, timestamp: new Date().toISOString() },
      });
    } catch (error) {
      next(error);
    }
  });

  // 3. Link an additional social provider (Authenticated)
  router.post("/api/v1/auth/identities/link", async (req, res, next): Promise<void> => {
    try {
      const { actor, requestId } = await verifiedActor(req, verifyActorContext, metrics);
      let body;
      try {
        body = linkSocialRequestSchema.parse(req.body);
      } catch (error) {
        if (!(error instanceof ZodError)) throw error;
        throw new AppError(
          "VALIDATION_FAILED",
          422,
          "Invalid link identity request",
          false,
          error.issues.map((i) => ({ field: i.path.join(".") || "body", reason: i.message })),
        );
      }

      const result = await service.linkIdentity(actor.userId, body.provider, body.idToken);
      res.status(200).json({
        data: result,
        meta: { requestId, timestamp: new Date().toISOString() },
      });
    } catch (error) {
      next(error);
    }
  });

  // 4. Unlink a social provider (Authenticated)
  router.post("/api/v1/auth/identities/:provider/unlink", async (req, res, next): Promise<void> => {
    try {
      const { actor, requestId } = await verifiedActor(req, verifyActorContext, metrics);
      const rawProvider = req.params.provider.toUpperCase();
      if (rawProvider !== "GOOGLE" && rawProvider !== "APPLE") {
        throw new AppError("INVALID_PROVIDER", 400, "Provider must be google or apple");
      }

      const result = await service.unlinkIdentity(actor.userId, rawProvider);
      res.status(200).json({
        data: result,
        meta: { requestId, timestamp: new Date().toISOString() },
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

async function verifiedActor(
  request: Request,
  verifier: ActorContextVerifier,
  metrics: ReturnType<typeof createMetrics>,
): Promise<{ actor: ActorContext; requestId: string }> {
  const context = currentRequestContext();
  try {
    const actor = await verifier(singleActorContextHeader(request));
    if (context && actor.correlationId !== context.correlationId) {
      throw new Error("ACTOR_CONTEXT_CORRELATION_MISMATCH");
    }
    return { actor, requestId: context?.requestId ?? actor.correlationId };
  } catch {
    metrics.identityProtectedRequests.inc({ outcome: "context_failure" });
    throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid trusted actor context");
  }
}

function singleActorContextHeader(request: Request): string {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === "x-actor-context") {
      values.push(request.rawHeaders[index + 1] ?? "");
    }
  }
  if (values.length !== 1 || !values[0] || values[0].length > 4_096) {
    throw new Error("ACTOR_CONTEXT_HEADER_REJECTED");
  }
  return values[0];
}
