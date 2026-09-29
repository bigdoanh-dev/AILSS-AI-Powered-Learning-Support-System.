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

export async function adaptiveLearningProxyFactory(
  config: AppConfig,
): Promise<
  Record<
    "mastery" | "courseMastery" | "outcome" | "generate" | "current" | "updateItem" | "itemAction",
    RequestHandler
  >
> {
  if (!config.JWT_PUBLIC_KEY_PATH || !config.ACTOR_CONTEXT_PRIVATE_KEY_PATH)
    throw new Error("Adaptive learning proxy requires signing keys");
  const [jwtKey, actorKey] = await Promise.all([
    loadPublicKey(config.JWT_PUBLIC_KEY_PATH),
    loadPrivateKey(config.ACTOR_CONTEXT_PRIVATE_KEY_PATH),
  ]);
  const handler =
    (method: "GET" | "POST" | "PATCH", path: (request: Request) => string): RequestHandler =>
    async (req, res, next) => {
      try {
        const context = currentRequestContext();
        if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
        const access = await verifyAccessToken(parseBearerAuthorization(req), jwtKey, {
          issuer: config.JWT_ISSUER,
          audience: config.JWT_AUDIENCE,
          kid: config.JWT_KID,
          clockToleranceSeconds: config.JWT_CLOCK_SKEW_SECONDS,
        });
        const now = Math.floor(Date.now() / 1000);
        const actor = await signActorContext(
          actorKey,
          config.ACTOR_CONTEXT_KID,
          config.ACTOR_CONTEXT_ISSUER,
          "learning-service",
          "learning.adaptive.student",
          {
            userId: access.userId,
            roles: [...access.roles],
            sessionId: access.sessionId,
            tokenVersion: access.tokenVersion,
            correlationId: context.correlationId,
            issuedAt: now,
            expiresAt: now + config.ACTOR_CONTEXT_TTL_SECONDS,
          },
        );
        const url = new URL(path(req), config.LEARNING_SERVICE_URL);
        for (const [key, value] of Object.entries(req.query))
          if (typeof value === "string") url.searchParams.set(key, value);
        const upstream = await fetch(url, {
          method,
          headers: {
            ...(method === "GET" ? {} : { "content-type": "application/json" }),
            "x-correlation-id": context.correlationId,
            "x-actor-context": actor,
          },
          ...(method === "GET" ? {} : { body: JSON.stringify(req.body) }),
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
  const enc = (value: unknown) => encodeURIComponent(String(value));
  return {
    mastery: handler("GET", () => "/api/v1/mastery/me"),
    courseMastery: handler("GET", (request) => `/api/v1/mastery/courses/${enc(request.params.courseId)}`),
    outcome: handler("GET", (request) => `/api/v1/mastery/outcomes/${enc(request.params.outcomeId)}`),
    generate: handler("POST", () => "/api/v1/study-plan/generate"),
    current: handler("GET", () => "/api/v1/study-plan/current"),
    updateItem: handler("PATCH", (request) => `/api/v1/study-plan/items/${enc(request.params.itemId)}`),
    itemAction: handler(
      "POST",
      (request) => `/api/v1/study-plan/items/${enc(request.params.itemId)}/${enc(request.params.action)}`,
    ),
  };
}
