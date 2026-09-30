import type { RequestHandler } from "express";
import type { AppConfig } from "../../../packages/config/src/index.js";
import { AppError, currentRequestContext } from "../../../packages/http/src/index.js";

export function federationProxy(
  config: AppConfig,
  upstreamPath: (request: Parameters<RequestHandler>[0]) => string,
  method: "GET" | "POST",
): RequestHandler {
  return async (request, response, next) => {
    try {
      const url = new URL(upstreamPath(request), config.IDENTITY_SERVICE_URL);
      if (method === "GET")
        for (const [key, value] of Object.entries(request.query)) {
          if (typeof value === "string") url.searchParams.set(key, value);
        }
      const context = currentRequestContext();
      const upstream = await fetch(url, {
        method,
        redirect: "manual",
        signal: AbortSignal.timeout(config.INTERNAL_HTTP_TIMEOUT_MS),
        headers: {
          ...(context ? { "x-correlation-id": context.correlationId } : {}),
          ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        },
        ...(method === "POST"
          ? {
              body: new URLSearchParams(
                Object.entries(request.body as Record<string, unknown>).filter(
                  (entry): entry is [string, string] => typeof entry[1] === "string",
                ),
              ),
            }
          : {}),
      });
      const location = upstream.headers.get("location");
      if (location && upstream.status >= 300 && upstream.status < 400) {
        response.redirect(upstream.status, location);
        return;
      }
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
