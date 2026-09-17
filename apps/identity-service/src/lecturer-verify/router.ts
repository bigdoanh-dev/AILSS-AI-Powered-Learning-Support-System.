import { Router, type Request } from "express";
import { z, ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import { validateIdempotencyKey } from "../registration/model.js";
import { parseLecturerVerifyRequest } from "./model.js";
import type { LecturerVerifyService } from "./service.js";

export type LecturerVerifyActorContextVerifier = (token: string) => Promise<ActorContext>;

export function lecturerVerifyRouter(
  service: LecturerVerifyService,
  verifier: LecturerVerifyActorContextVerifier,
  metrics: ReturnType<typeof createMetrics>,
  verifyStepUp?: (token: string, actor: ActorContext, targetId: string) => Promise<void>,
): Router {
  const router = Router();
  router.post("/api/v1/admin/lecturers/:userId/verify", async (request, response, next): Promise<void> => {
    try {
      const { actor, requestId } = await verifiedActor(request, verifier, metrics);
      const targetId = parseUuid(request.params.userId);
      if (verifyStepUp) {
        try {
          await verifyStepUp(request.header("x-admin-step-up-proof") ?? "", actor, targetId);
        } catch {
          throw new AppError("ADMIN_STEP_UP_FAILED", 401, "Current-password reauthentication required");
        }
      }
      let idempotencyKey: string;
      try {
        idempotencyKey = validateIdempotencyKey(request.header("idempotency-key"));
      } catch {
        throw new AppError("INVALID_IDEMPOTENCY_KEY", 400, "A valid Idempotency-Key header is required");
      }
      let body;
      try {
        body = parseLecturerVerifyRequest(request.body);
      } catch (error) {
        throw validationError("LECTURER_VERIFY_VALIDATION_FAILED", "Verify command validation failed", error);
      }
      const result = await service.verify({ actor, targetId, request: body, idempotencyKey, requestId });
      response.status(200).json({
        data: { userId: result.userId, lecturerVerified: result.lecturerVerified },
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
  verifier: LecturerVerifyActorContextVerifier,
  metrics: ReturnType<typeof createMetrics>,
): Promise<{ actor: ActorContext; requestId: string }> {
  const context = currentRequestContext();
  if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
  try {
    const actor = await verifier(singleActorContextHeader(request));
    if (actor.correlationId !== context.correlationId) throw new Error("ACTOR_CONTEXT_CORRELATION_MISMATCH");
    return { actor, requestId: context.requestId };
  } catch {
    metrics.identityAdminAuthorization.inc({ outcome: "context_denied" });
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
  if (values.length !== 1 || !values[0] || values[0].length > 4_096)
    throw new Error("ACTOR_CONTEXT_REJECTED");
  return values[0];
}

function parseUuid(value: string | string[] | undefined): string {
  const result = z.string().uuid().safeParse(value);
  if (!result.success) throw new AppError("INVALID_USER_ID", 400, "User ID must be a UUID");
  return result.data;
}

function validationError(code: string, message: string, error: unknown): AppError {
  if (!(error instanceof ZodError)) throw error;
  return new AppError(
    code,
    422,
    message,
    false,
    error.issues.map((issue) => ({ field: issue.path.join(".") || "request", reason: issue.message })),
  );
}

function responseMeta(requestId: string) {
  return { requestId, timestamp: new Date().toISOString() };
}
