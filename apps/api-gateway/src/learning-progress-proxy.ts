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

export async function learningProgressProxyFactory(
  config: AppConfig,
): Promise<{ read: RequestHandler; complete: RequestHandler }> {
  if (!config.JWT_PUBLIC_KEY_PATH || !config.ACTOR_CONTEXT_PRIVATE_KEY_PATH)
    throw new Error("Learning progress proxy requires signing keys");
  const [jwtKey, actorKey] = await Promise.all([
    loadPublicKey(config.JWT_PUBLIC_KEY_PATH),
    loadPrivateKey(config.ACTOR_CONTEXT_PRIVATE_KEY_PATH),
  ]);
  const handler =
    (method: "GET" | "PUT", purpose: string, path: (r: Request) => string): RequestHandler =>
    async (req, res, next) => {
      try {
        const c = currentRequestContext();
        if (!c) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
        const access = await verifyAccessToken(parseBearerAuthorization(req), jwtKey, {
          issuer: config.JWT_ISSUER,
          audience: config.JWT_AUDIENCE,
          kid: config.JWT_KID,
          clockToleranceSeconds: config.JWT_CLOCK_SKEW_SECONDS,
        });
        const now = Math.floor(Date.now() / 1000),
          token = await signActorContext(
            actorKey,
            config.ACTOR_CONTEXT_KID,
            config.ACTOR_CONTEXT_ISSUER,
            "learning-service",
            purpose,
            {
              userId: access.userId,
              roles: [...access.roles],
              sessionId: access.sessionId,
              tokenVersion: access.tokenVersion,
              correlationId: c.correlationId,
              issuedAt: now,
              expiresAt: now + config.ACTOR_CONTEXT_TTL_SECONDS,
            },
          );
        const idempotencyKey = req.header("idempotency-key");
        const upstream = await fetch(new URL(path(req), config.LEARNING_SERVICE_URL), {
          method,
          headers: {
            ...(method === "PUT" ? { "content-type": "application/json" } : {}),
            "x-correlation-id": c.correlationId,
            "x-actor-context": token,
            ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
          },
          ...(method === "PUT" ? { body: JSON.stringify(req.body) } : {}),
          signal: AbortSignal.timeout(config.INTERNAL_HTTP_TIMEOUT_MS),
        });
        const type = upstream.headers.get("content-type");
        if (type) res.type(type);
        res.status(upstream.status).send(await upstream.text());
      } catch (e) {
        next(
          e instanceof AppError
            ? e
            : new AppError(
                "LEARNING_SERVICE_UNAVAILABLE",
                503,
                "Learning service is temporarily unavailable",
                true,
              ),
        );
      }
    };
  const enc = (v: unknown) => encodeURIComponent(String(v));
  return {
    read: handler(
      "GET",
      "learning.progress.read",
      (r) => `/api/v1/courses/${enc(r.params.courseId)}/progress`,
    ),
    complete: handler(
      "PUT",
      "learning.progress.complete",
      (r) => `/api/v1/lessons/${enc(r.params.lessonId)}/completion`,
    ),
  };
}
