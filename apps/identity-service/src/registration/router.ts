import { Router } from "express";
import { ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import { parseRegistrationRequest, validateIdempotencyKey } from "./model.js";
import type { RegistrationService } from "./service.js";

export function registrationRouter(
  service: RegistrationService,
  metrics: ReturnType<typeof createMetrics>,
): Router {
  const router = Router();
  router.post("/api/v1/auth/register", async (request, response, next): Promise<void> => {
    try {
      const context = currentRequestContext();
      if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
      let idempotencyKey: string;
      try {
        idempotencyKey = validateIdempotencyKey(request.header("idempotency-key"));
      } catch {
        metrics.identityRegistrations.inc({ outcome: "validation_failed" });
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
        body = parseRegistrationRequest(request.body);
      } catch (error) {
        if (!(error instanceof ZodError)) throw error;
        metrics.identityRegistrations.inc({ outcome: "validation_failed" });
        throw new AppError(
          "REGISTRATION_VALIDATION_FAILED",
          422,
          "Registration request validation failed",
          false,
          error.issues.map((issue) => ({
            field: issue.path.join(".") || "body",
            reason: issue.message,
          })),
        );
      }
      const result = await service.register({
        ...body,
        idempotencyKey,
        requestId: context.requestId,
        correlationId: context.correlationId,
      });
      response.status(201).json({
        data: {
          userId: result.account.userId,
          displayName: result.account.displayName,
          role: result.account.role,
          status: result.account.status,
          createdAt: result.account.createdAt,
        },
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
