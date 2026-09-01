import { Router } from "express";
import { ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import { parseRefreshRequest } from "./model.js";
import type { RefreshService } from "./service.js";

export function refreshRouter(service: RefreshService, metrics: ReturnType<typeof createMetrics>): Router {
  const router = Router();
  router.post("/api/v1/auth/refresh", async (request, response, next): Promise<void> => {
    try {
      const context = currentRequestContext();
      if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
      let body;
      try {
        body = parseRefreshRequest(request.body);
      } catch (error) {
        if (!(error instanceof ZodError)) throw error;
        metrics.identityRefreshes.inc({ outcome: "validation_failed" });
        throw new AppError(
          "REFRESH_VALIDATION_FAILED",
          422,
          "Refresh request validation failed",
          false,
          error.issues.map((issue) => ({
            field: issue.path.join(".") || "body",
            reason: issue.message,
          })),
        );
      }
      const result = await service.refresh({
        ...body,
        requestId: context.requestId,
        correlationId: context.correlationId,
      });
      response.status(200).json({
        data: {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          tokenType: "Bearer",
          accessExpiresAt: result.accessExpiresAt.toISOString(),
          refreshExpiresAt: result.session.expiresAt.toISOString(),
          sessionId: result.session.sessionId,
          generation: result.session.generation,
        },
        meta: {
          requestId: context.requestId,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
