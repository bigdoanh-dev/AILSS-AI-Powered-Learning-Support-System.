import { Router, type Request } from "express";
import { ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import { validateIdempotencyKey } from "../registration/model.js";
import { parsePasswordChangeRequest } from "./model.js";
import type { PasswordChangeService } from "./service.js";

export type PasswordActorContextVerifier = (token: string) => Promise<ActorContext>;

export function passwordRouter(
  service: PasswordChangeService,
  verifyContext: PasswordActorContextVerifier,
  metrics: ReturnType<typeof createMetrics>,
): Router {
  const router = Router();
  router.post("/api/v1/me/password", async (request, response, next): Promise<void> => {
    try {
      const context = currentRequestContext();
      if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
      let actor: ActorContext;
      try {
        actor = await verifyContext(singleActorContextHeader(request));
        if (actor.correlationId !== context.correlationId) throw new Error("CORRELATION_MISMATCH");
      } catch {
        metrics.identityPasswordChanges.inc({ outcome: "context_failure" });
        throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid trusted actor context");
      }
      let idempotencyKey: string;
      try {
        idempotencyKey = validateIdempotencyKey(request.header("idempotency-key"));
      } catch {
        throw new AppError("INVALID_IDEMPOTENCY_KEY", 400, "A valid Idempotency-Key header is required");
      }
      let body;
      try {
        body = parsePasswordChangeRequest(request.body);
      } catch (error) {
        if (!(error instanceof ZodError)) throw error;
        throw new AppError(
          "PASSWORD_CHANGE_VALIDATION_FAILED",
          422,
          "Password change validation failed",
          false,
          error.issues.map((issue) => ({
            field: issue.path.join(".") || "body",
            reason: issue.message,
          })),
        );
      }
      const result = await service.change({
        actor,
        request: body,
        idempotencyKey,
        requestId: context.requestId,
      });
      response.status(200).json({
        data: { passwordChanged: true },
        meta: {
          requestId: context.requestId,
          timestamp: new Date().toISOString(),
          replayed: result.replayed,
        },
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
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
