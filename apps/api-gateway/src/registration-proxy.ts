import type { RequestHandler } from "express";
import type { AppConfig } from "../../../packages/config/src/index.js";
import { AppError, currentRequestContext } from "../../../packages/http/src/index.js";

export function registrationProxy(config: AppConfig): RequestHandler {
  return identityPostProxy(config, "/api/v1/auth/register", true);
}

export function loginProxy(config: AppConfig): RequestHandler {
  return identityPostProxy(config, "/api/v1/auth/login", false);
}

export function refreshProxy(config: AppConfig): RequestHandler {
  return identityPostProxy(config, "/api/v1/auth/refresh", false);
}

export function passwordResetProxy(
  config: AppConfig,
  operation: "request" | "verify" | "complete",
): RequestHandler {
  return identityPostProxy(config, `/api/v1/auth/password-reset/${operation}`, false);
}

export function socialLoginProxy(config: AppConfig): RequestHandler {
  return async (request, response, next): Promise<void> => {
    try {
      const context = currentRequestContext();
      const provider = encodeURIComponent(String(request.params.provider));
      const upstream = await fetch(new URL(`/api/v1/auth/social/${provider}`, config.IDENTITY_SERVICE_URL), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(context ? { "x-correlation-id": context.correlationId } : {}),
        },
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(config.INTERNAL_HTTP_TIMEOUT_MS),
      });
      const contentType = upstream.headers.get("content-type");
      if (contentType) response.type(contentType);
      response.status(upstream.status).send(await upstream.text());
    } catch (error) {
      next(
        error instanceof AppError
          ? error
          : new AppError(
              "IDENTITY_SERVICE_UNAVAILABLE",
              503,
              "Identity service is temporarily unavailable",
              true,
            ),
      );
    }
  };
}

function identityPostProxy(config: AppConfig, path: string, forwardIdempotencyKey: boolean): RequestHandler {
  return async (request, response, next): Promise<void> => {
    try {
      const context = currentRequestContext();
      const idempotencyKey = request.header("idempotency-key");
      const upstream = await fetch(new URL(path, config.IDENTITY_SERVICE_URL), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(forwardIdempotencyKey && idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
          ...(context ? { "x-correlation-id": context.correlationId } : {}),
        },
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(config.INTERNAL_HTTP_TIMEOUT_MS),
      });
      const contentType = upstream.headers.get("content-type");
      if (contentType) response.type(contentType);
      response.status(upstream.status).send(await upstream.text());
    } catch (error) {
      next(
        error instanceof AppError
          ? error
          : new AppError(
              "IDENTITY_SERVICE_UNAVAILABLE",
              503,
              "Identity service is temporarily unavailable",
              true,
            ),
      );
    }
  };
}
