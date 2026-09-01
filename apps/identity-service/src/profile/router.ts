import { Router, type Request } from "express";
import { ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import { validateIdempotencyKey } from "../registration/model.js";
import { parseProfileUpdateRequest, type ProfileUser } from "./model.js";
import type { ProfileService } from "./service.js";

export type ProfileActorContextVerifier = (token: string) => Promise<ActorContext>;

export function profileRouter(
  service: ProfileService,
  verifyReadContext: ProfileActorContextVerifier,
  verifyUpdateContext: ProfileActorContextVerifier,
  metrics: ReturnType<typeof createMetrics>,
): Router {
  const router = Router();
  router.get("/api/v1/me", async (request, response, next): Promise<void> => {
    try {
      if (hasRequestBody(request)) {
        throw new AppError("PROFILE_BODY_NOT_ALLOWED", 422, "Profile read request body is not allowed");
      }
      const { actor, requestId } = await verifiedActor(request, verifyReadContext, metrics);
      const profile = await service.read(actor);
      response.status(200).json({ data: profileDto(profile), meta: responseMeta(requestId) });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/api/v1/me", async (request, response, next): Promise<void> => {
    try {
      const { actor, requestId } = await verifiedActor(request, verifyUpdateContext, metrics);
      let idempotencyKey: string;
      try {
        idempotencyKey = validateIdempotencyKey(request.header("idempotency-key"));
      } catch {
        metrics.identityProfileUpdates.inc({ outcome: "validation_failed" });
        throw new AppError(
          "INVALID_IDEMPOTENCY_KEY",
          400,
          "A valid Idempotency-Key header is required",
          false,
          [{ field: "Idempotency-Key", reason: "Required printable ASCII value of at most 200 characters" }],
        );
      }
      let body;
      try {
        body = parseProfileUpdateRequest(request.body);
      } catch (error) {
        if (!(error instanceof ZodError)) throw error;
        metrics.identityProfileUpdates.inc({ outcome: "validation_failed" });
        throw new AppError(
          "PROFILE_VALIDATION_FAILED",
          422,
          "Profile update validation failed",
          false,
          error.issues.map((issue) => ({
            field: issue.path.join(".") || "body",
            reason: issue.message,
          })),
        );
      }
      const result = await service.update({ actor, request: body, idempotencyKey, requestId });
      response.status(200).json({
        data: {
          userId: result.userId,
          profileVersion: result.profileVersion,
          updated: true,
          noOp: result.noOp,
        },
        meta: { ...responseMeta(requestId), replayed: result.replayed },
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

async function verifiedActor(
  request: Request,
  verifier: ProfileActorContextVerifier,
  metrics: ReturnType<typeof createMetrics>,
): Promise<{ actor: ActorContext; requestId: string }> {
  const context = currentRequestContext();
  if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
  try {
    const actor = await verifier(singleActorContextHeader(request));
    if (actor.correlationId !== context.correlationId) throw new Error("ACTOR_CONTEXT_CORRELATION_MISMATCH");
    return { actor, requestId: context.requestId };
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

function hasRequestBody(request: Request): boolean {
  const contentLength = request.header("content-length");
  return (
    request.header("transfer-encoding") !== undefined ||
    (contentLength !== undefined && contentLength !== "0")
  );
}

function profileDto(profile: ProfileUser) {
  return {
    userId: profile.userId,
    displayName: profile.displayName,
    emailMasked: profile.emailMasked,
    role: profile.role,
    status: profile.status,
    lecturerVerified: profile.lecturerVerified,
    profileVersion: profile.profileVersion,
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

function responseMeta(requestId: string) {
  return { requestId, timestamp: new Date().toISOString() };
}
