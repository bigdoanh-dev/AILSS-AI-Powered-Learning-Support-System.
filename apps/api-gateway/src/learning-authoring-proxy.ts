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

export async function learningAuthoringProxyFactory(
  config: AppConfig,
): Promise<{ create: RequestHandler; update: RequestHandler }> {
  if (!config.JWT_PUBLIC_KEY_PATH || !config.ACTOR_CONTEXT_PRIVATE_KEY_PATH)
    throw new Error("Learning authoring proxy requires signing keys");
  const [jwtKey, actorKey] = await Promise.all([
    loadPublicKey(config.JWT_PUBLIC_KEY_PATH),
    loadPrivateKey(config.ACTOR_CONTEXT_PRIVATE_KEY_PATH),
  ]);
  const handler =
    (method: "POST" | "PATCH", purpose: string, path: (r: Request) => string): RequestHandler =>
    async (req, res, next) => {
      try {
        const context = currentRequestContext();
        if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
        let actor;
        try {
          actor = await verifyAccessToken(parseBearerAuthorization(req), jwtKey, {
            issuer: config.JWT_ISSUER,
            audience: config.JWT_AUDIENCE,
            kid: config.JWT_KID,
            clockToleranceSeconds: config.JWT_CLOCK_SKEW_SECONDS,
          });
        } catch {
          throw new AppError("INVALID_ACCESS_TOKEN", 401, "Invalid access token");
        }
        const issuedAt = Math.floor(Date.now() / 1000);
        const token = await signActorContext(
          actorKey,
          config.ACTOR_CONTEXT_KID,
          config.ACTOR_CONTEXT_ISSUER,
          "learning-service",
          purpose,
          {
            userId: actor.userId,
            roles: [...actor.roles],
            sessionId: actor.sessionId,
            tokenVersion: actor.tokenVersion,
            correlationId: context.correlationId,
            issuedAt,
            expiresAt: issuedAt + config.ACTOR_CONTEXT_TTL_SECONDS,
          },
        );
        const idempotencyKey = req.header("idempotency-key");
        const upstream = await fetch(new URL(path(req), config.LEARNING_SERVICE_URL), {
          method,
          headers: {
            "content-type": "application/json",
            "x-actor-context": token,
            "x-correlation-id": context.correlationId,
            ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
          },
          body: JSON.stringify(req.body),
          signal: AbortSignal.timeout(config.INTERNAL_HTTP_TIMEOUT_MS),
        });
        const type = upstream.headers.get("content-type");
        if (type) res.type(type);
        res.status(upstream.status).send(await upstream.text());
      } catch (error) {
        next(
          error instanceof AppError
            ? error
            : new AppError(
                "LEARNING_SERVICE_UNAVAILABLE",
                503,
                "Learning service is temporarily unavailable",
                true,
              ),
        );
      }
    };
  return {
    create: handler("POST", "learning.course.create", () => "/api/v1/courses"),
    update: handler(
      "PATCH",
      "learning.course.update",
      (r) => `/api/v1/courses/${encodeURIComponent(String(r.params.courseId))}`,
    ),
  };
}
