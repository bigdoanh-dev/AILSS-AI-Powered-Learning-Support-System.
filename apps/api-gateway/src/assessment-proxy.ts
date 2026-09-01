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

export async function assessmentProxyFactory(config: AppConfig): Promise<{
  create: RequestHandler;
  detail: RequestHandler;
  update: RequestHandler;
  publish: RequestHandler;
  list: RequestHandler;
  attemptStart: RequestHandler;
  attemptDetail: RequestHandler;
  submit: RequestHandler;
  result: RequestHandler;
  results: RequestHandler;
}> {
  if (!config.JWT_PUBLIC_KEY_PATH || !config.ACTOR_CONTEXT_PRIVATE_KEY_PATH)
    throw new Error("Assessment proxy requires signing keys");
  const [jwtKey, actorKey] = await Promise.all([
    loadPublicKey(config.JWT_PUBLIC_KEY_PATH),
    loadPrivateKey(config.ACTOR_CONTEXT_PRIVATE_KEY_PATH),
  ]);
  const handler =
    (method: "GET" | "POST" | "PATCH", purpose: string, path: (request: Request) => string) =>
    async (
      request: Request,
      response: Parameters<RequestHandler>[1],
      next: Parameters<RequestHandler>[2],
    ) => {
      try {
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
        const now = Math.floor(Date.now() / 1000),
          trusted = await signActorContext(
            actorKey,
            config.ACTOR_CONTEXT_KID,
            config.ACTOR_CONTEXT_ISSUER,
            "assessment-service",
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
          ),
          idempotencyKey = request.header("idempotency-key"),
          target = new URL(path(request), config.ASSESSMENT_SERVICE_URL),
          upstream = await fetch(target, {
            method,
            headers: {
              ...(method !== "GET" ? { "content-type": "application/json" } : {}),
              "x-correlation-id": context.correlationId,
              "x-actor-context": trusted,
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
                "ASSESSMENT_SERVICE_UNAVAILABLE",
                503,
                "Assessment service is temporarily unavailable",
                true,
              ),
        );
      }
    };
  return {
    create: handler("POST", "assessment.quiz.create", () => "/api/v1/quizzes"),
    detail: handler(
      "GET",
      "assessment.quiz.detail",
      (request) => `/api/v1/quizzes/${encodeURIComponent(String(request.params.quizId))}`,
    ),
    update: handler(
      "PATCH",
      "assessment.quiz.update",
      (request) => `/api/v1/quizzes/${encodeURIComponent(String(request.params.quizId))}`,
    ),
    publish: handler(
      "POST",
      "assessment.quiz.publish",
      (request) => `/api/v1/quizzes/${encodeURIComponent(String(request.params.quizId))}/publish`,
    ),
    list: handler(
      "GET",
      "assessment.quiz.list",
      (request) =>
        `/api/v1/targets/${encodeURIComponent(String(request.params.targetType))}/${encodeURIComponent(String(request.params.targetId))}/quizzes`,
    ),
    attemptStart: handler(
      "POST",
      "assessment.attempt.start",
      (request) => `/api/v1/quizzes/${encodeURIComponent(String(request.params.quizId))}/attempts`,
    ),
    attemptDetail: handler(
      "GET",
      "assessment.attempt.detail",
      (request) => `/api/v1/attempts/${encodeURIComponent(String(request.params.attemptId))}`,
    ),
    submit: handler(
      "POST",
      "assessment.attempt.submit",
      (request) => `/api/v1/attempts/${encodeURIComponent(String(request.params.attemptId))}/submit`,
    ),
    result: handler(
      "GET",
      "assessment.attempt.result",
      (request) => `/api/v1/attempts/${encodeURIComponent(String(request.params.attemptId))}/result`,
    ),
    results: handler("GET", "assessment.quiz.results", (request) => {
      const query = new URLSearchParams();
      for (const key of ["month", "limit", "cursor"])
        if (typeof request.query[key] === "string") query.set(key, request.query[key]);
      return `/api/v1/quizzes/${encodeURIComponent(String(request.params.quizId))}/results?${query.toString()}`;
    }),
  };
}
