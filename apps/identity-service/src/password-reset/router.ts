import { Router } from "express";
import { ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import {
  parsePasswordResetComplete,
  parsePasswordResetRequestCode,
  parsePasswordResetVerifyCode,
} from "./model.js";
import type { PasswordResetService } from "./service.js";

export function passwordResetRouter(service: PasswordResetService): Router {
  const router = Router();
  router.post("/api/v1/auth/password-reset/request", async (request, response, next): Promise<void> => {
    try {
      const context = currentRequestContext();
      if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
      const body = parseBody(
        () => parsePasswordResetRequestCode(request.body),
        "PASSWORD_RESET_VALIDATION_FAILED",
      );
      const result = await service.requestCode({ ...body, requestId: context.requestId });
      response.status(202).json({
        data: result,
        meta: { requestId: context.requestId, timestamp: new Date().toISOString() },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/v1/auth/password-reset/verify", async (request, response, next): Promise<void> => {
    try {
      const context = currentRequestContext();
      if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
      const body = parseBody(
        () => parsePasswordResetVerifyCode(request.body),
        "PASSWORD_RESET_VALIDATION_FAILED",
      );
      const result = await service.verifyCode(body);
      response.status(200).json({
        data: result,
        meta: { requestId: context.requestId, timestamp: new Date().toISOString() },
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/api/v1/auth/password-reset/complete", async (request, response, next): Promise<void> => {
    try {
      const context = currentRequestContext();
      if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
      const body = parseBody(
        () => parsePasswordResetComplete(request.body),
        "PASSWORD_RESET_VALIDATION_FAILED",
      );
      const result = await service.complete({
        email: body.email,
        resetToken: body.resetToken,
        newPassword: body.newPassword,
        requestId: context.requestId,
      });
      response.status(200).json({
        data: { passwordReset: result.passwordReset },
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

function parseBody<T>(parse: () => T, code: string): T {
  try {
    return parse();
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    throw new AppError(
      code,
      422,
      "Password reset request validation failed",
      false,
      error.issues.map((issue) => ({ field: issue.path.join(".") || "body", reason: issue.message })),
    );
  }
}
