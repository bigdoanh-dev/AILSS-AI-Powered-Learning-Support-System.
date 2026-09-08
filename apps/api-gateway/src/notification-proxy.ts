import type { Request, RequestHandler } from "express";
import type { AppConfig } from "../../../packages/config/src/index.js";
import { AppError, currentRequestContext } from "../../../packages/http/src/index.js";
import {
  loadPrivateKey,
  loadPublicKey,
  signActorContext,
  verifyAccessToken,
} from "../../../packages/security/src/index.js";
import { parseBearerAuthorization } from "./protected-identity-proxy.js";

export async function notificationProxyFactory(
  config: AppConfig,
): Promise<{ list: RequestHandler; read: RequestHandler }> {
  if (!config.JWT_PUBLIC_KEY_PATH || !config.ACTOR_CONTEXT_PRIVATE_KEY_PATH)
    throw new Error("Notification proxy requires keys");
  const [jwtKey, actorKey] = await Promise.all([
    loadPublicKey(config.JWT_PUBLIC_KEY_PATH),
    loadPrivateKey(config.ACTOR_CONTEXT_PRIVATE_KEY_PATH),
  ]);
  const handler =
    (method: "GET" | "PATCH", purpose: string, path: (request: Request) => string): RequestHandler =>
    async (request, response, next) => {
      try {
        if (method === "PATCH" && request.body && Object.keys(request.body as object).length > 0)
          throw new AppError("NOTIFICATION_BODY_NOT_ALLOWED", 400, "Request body is not allowed");
        const context = currentRequestContext();
        if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
        let actor;
        try {
          actor = await verifyAccessToken(parseBearerAuthorization(request), jwtKey, {
            issuer: config.JWT_ISSUER,
            audience: config.JWT_AUDIENCE,
            kid: config.JWT_KID,
            clockToleranceSeconds: config.JWT_CLOCK_SKEW_SECONDS,
          });
        } catch {
          throw new AppError("INVALID_ACCESS_TOKEN", 401, "Invalid access token");
        }
        const now = Math.floor(Date.now() / 1000);
        const trusted = await signActorContext(
          actorKey,
          config.ACTOR_CONTEXT_KID,
          config.ACTOR_CONTEXT_ISSUER,
          "notification-worker",
          purpose,
          {
            userId: actor.userId,
            roles: [...actor.roles],
            sessionId: actor.sessionId,
            tokenVersion: actor.tokenVersion,
            correlationId: context.correlationId,
            issuedAt: now,
            expiresAt: now + config.ACTOR_CONTEXT_TTL_SECONDS,
          },
        );
        const locator = request.header("x-notification-locator");
        const upstream = await fetch(new URL(path(request), config.NOTIFICATION_SERVICE_URL), {
          method,
          headers: {
            "x-actor-context": trusted,
            "x-correlation-id": context.correlationId,
            ...(locator ? { "x-notification-locator": locator } : {}),
          },
          signal: AbortSignal.timeout(config.INTERNAL_HTTP_TIMEOUT_MS),
        });
        const type = upstream.headers.get("content-type");
        if (type) response.type(type);
        response.status(upstream.status).send(await upstream.text());
      } catch (error) {
        next(
          error instanceof AppError
            ? error
            : new AppError(
                "NOTIFICATION_SERVICE_UNAVAILABLE",
                503,
                "Notification service is temporarily unavailable",
                true,
              ),
        );
      }
    };
  return {
    list: handler(
      "GET",
      "notification.list",
      (request) =>
        `/api/v1/notifications${request.originalUrl.includes("?") ? request.originalUrl.slice(request.originalUrl.indexOf("?")) : ""}`,
    ),
    read: handler(
      "PATCH",
      "notification.read",
      (request) => `/api/v1/notifications/${encodeURIComponent(String(request.params.notificationId))}/read`,
    ),
  };
}
