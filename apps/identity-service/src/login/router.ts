import { Router } from "express";
import { ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import { parseLoginRequest } from "./model.js";
import type { LoginService } from "./service.js";

export function loginRouter(service: LoginService, metrics: ReturnType<typeof createMetrics>): Router {
  const router = Router();
  router.post("/api/v1/auth/login", async (request, response, next): Promise<void> => {
    try {
      const context = currentRequestContext();
      if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
      let body;
      try {
        body = parseLoginRequest(request.body);
      } catch (error) {
        if (!(error instanceof ZodError)) throw error;
        metrics.identityLogins.inc({ outcome: "validation_failed" });
        throw new AppError(
          "LOGIN_VALIDATION_FAILED",
          422,
          "Login request validation failed",
          false,
          error.issues.map((issue) => ({
            field: issue.path.join(".") || "body",
            reason: issue.message,
          })),
        );
      }
      const result = await service.login({
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
          refreshExpiresAt: result.refreshExpiresAt.toISOString(),
          sessionId: result.session.sessionId,
          user: {
            userId: result.user.userId,
            displayName: result.user.displayName,
            role: result.user.role,
            status: result.user.status,
            lecturerVerified: result.user.lecturerVerified,
          },
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
