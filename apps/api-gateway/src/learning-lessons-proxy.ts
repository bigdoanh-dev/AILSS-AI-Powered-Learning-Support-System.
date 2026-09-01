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

export async function learningLessonsProxyFactory(config: AppConfig): Promise<{
  list: RequestHandler;
  create: RequestHandler;
  read: RequestHandler;
  update: RequestHandler;
}> {
  if (!config.JWT_PUBLIC_KEY_PATH || !config.ACTOR_CONTEXT_PRIVATE_KEY_PATH)
    throw new Error("Learning lessons proxy requires signing keys");
  const [jwtKey, actorKey] = await Promise.all([
    loadPublicKey(config.JWT_PUBLIC_KEY_PATH),
    loadPrivateKey(config.ACTOR_CONTEXT_PRIVATE_KEY_PATH),
  ]);

  const handler =
    (
      method: "GET" | "POST" | "PATCH",
      purpose: string,
      path: (request: Request) => string,
      optional: boolean,
    ): RequestHandler =>
    async (request, response, next) => {
      try {
        const context = currentRequestContext();
        if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
        let actorContext: string | undefined;
        const supplied = typeof request.header("authorization") === "string";
        if (supplied || !optional) {
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
          const issuedAt = Math.floor(Date.now() / 1000);
          actorContext = await signActorContext(
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
        }
        const idempotencyKey = request.header("idempotency-key");
        const upstream = await fetch(new URL(path(request), config.LEARNING_SERVICE_URL), {
          method,
          headers: {
            ...(method !== "GET" ? { "content-type": "application/json" } : {}),
            "x-correlation-id": context.correlationId,
            ...(actorContext ? { "x-actor-context": actorContext } : {}),
            ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
          },
          ...(method !== "GET" ? { body: JSON.stringify(request.body) } : {}),
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
                "LEARNING_SERVICE_UNAVAILABLE",
                503,
                "Learning service is temporarily unavailable",
                true,
              ),
        );
      }
    };

  return {
    list: handler("GET", "learning.lesson.list", courseLessons, true),
    create: handler("POST", "learning.lesson.create", courseLessons, false),
    read: handler("GET", "learning.lesson.read", lessonDetail, false),
    update: handler("PATCH", "learning.lesson.update", lessonDetail, false),
  };
}

function courseLessons(request: Request) {
  return `/api/v1/courses/${encodeURIComponent(String(request.params.courseId))}/lessons`;
}
function lessonDetail(request: Request) {
  return `/api/v1/lessons/${encodeURIComponent(String(request.params.lessonId))}`;
}
