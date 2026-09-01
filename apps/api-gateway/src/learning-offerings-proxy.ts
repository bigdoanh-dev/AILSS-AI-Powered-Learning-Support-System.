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

export async function learningOfferingsProxyFactory(
  config: AppConfig,
): Promise<
  Record<"catalog" | "detail" | "create" | "update" | "publish" | "course" | "owned", RequestHandler>
> {
  if (!config.JWT_PUBLIC_KEY_PATH || !config.ACTOR_CONTEXT_PRIVATE_KEY_PATH)
    throw new Error("Learning offerings proxy requires signing keys");
  const [jwtKey, actorKey] = await Promise.all([
    loadPublicKey(config.JWT_PUBLIC_KEY_PATH),
    loadPrivateKey(config.ACTOR_CONTEXT_PRIVATE_KEY_PATH),
  ]);
  const handler =
    (
      method: "GET" | "POST" | "PATCH",
      purpose: string,
      path: (r: Request) => string,
      optional: boolean,
      query = false,
    ): RequestHandler =>
    async (req, res, next) => {
      try {
        const c = currentRequestContext();
        if (!c) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
        let signed: string | undefined;
        const supplied = typeof req.header("authorization") === "string";
        if (supplied || !optional) {
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
          const now = Math.floor(Date.now() / 1000);
          signed = await signActorContext(
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
              correlationId: c.correlationId,
              issuedAt: now,
              expiresAt: now + config.ACTOR_CONTEXT_TTL_SECONDS,
            },
          );
        }
        const url = new URL(path(req), config.LEARNING_SERVICE_URL);
        if (query)
          for (const [key, value] of Object.entries(req.query)) {
            if (typeof value === "string") url.searchParams.set(key, value);
          }
        const idempotencyKey = req.header("idempotency-key");
        const upstream = await fetch(url, {
          method,
          headers: {
            ...(method !== "GET" ? { "content-type": "application/json" } : {}),
            "x-correlation-id": c.correlationId,
            ...(signed ? { "x-actor-context": signed } : {}),
            ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
          },
          ...(method !== "GET" ? { body: JSON.stringify(req.body) } : {}),
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
  return {
    catalog: handler("GET", "learning.offering.catalog", () => "/api/v1/offerings", true, true),
    detail: handler(
      "GET",
      "learning.offering.detail",
      (r) => `/api/v1/offerings/${enc(r.params.offeringId)}`,
      true,
    ),
    create: handler(
      "POST",
      "learning.offering.create",
      (r) => `/api/v1/courses/${enc(r.params.courseId)}/offerings`,
      false,
    ),
    update: handler(
      "PATCH",
      "learning.offering.update",
      (r) => `/api/v1/offerings/${enc(r.params.offeringId)}`,
      false,
    ),
    publish: handler(
      "POST",
      "learning.offering.publish",
      (r) => `/api/v1/offerings/${enc(r.params.offeringId)}/publish`,
      false,
    ),
    course: handler(
      "GET",
      "learning.offering.course-list",
      (r) => `/api/v1/courses/${enc(r.params.courseId)}/offerings`,
      true,
    ),
    owned: handler("GET", "learning.offering.owned", () => "/api/v1/me/owned-offerings", false),
  };
}
const enc = (v: unknown) => encodeURIComponent(String(v));
