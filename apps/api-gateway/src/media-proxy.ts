import type { RequestHandler } from "express";
import type { AppConfig } from "../../../packages/config/src/index.js";
import { AppError, currentRequestContext } from "../../../packages/http/src/index.js";
import {
  loadPrivateKey,
  loadPublicKey,
  signActorContext,
  verifyAccessToken,
} from "../../../packages/security/src/index.js";
import { parseBearerAuthorization } from "./protected-identity-proxy.js";
export async function mediaProxy(config: AppConfig): Promise<RequestHandler> {
  if (!config.JWT_PUBLIC_KEY_PATH || !config.ACTOR_CONTEXT_PRIVATE_KEY_PATH)
    throw Error("MEDIA_GATEWAY_KEYS_REQUIRED");
  const jwtKey = await loadPublicKey(config.JWT_PUBLIC_KEY_PATH),
    actorKey = await loadPrivateKey(config.ACTOR_CONTEXT_PRIVATE_KEY_PATH);
  return async (req, res, next) => {
    try {
      const c = currentRequestContext();
      if (!c) throw Error("REQUEST_CONTEXT_UNAVAILABLE");
      const hasAuth = Boolean(req.header("authorization"));
      let actor;
      if (hasAuth) {
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
      } else if (req.path.endsWith("/media-session") || req.path.includes("/trailer")) {
        actor = {
          userId: "00000000-0000-0000-0000-000000000000",
          roles: ["ANONYMOUS"],
          sessionId: "00000000-0000-0000-0000-000000000000",
          tokenVersion: 0,
        };
      } else {
        throw new AppError("UNAUTHORIZED", 401, "Authorization header required");
      }
      const purpose =
        req.path.endsWith("/media-session") || req.path.includes("/trailer")
          ? "learning.media.playback"
          : req.method === "GET" && !req.path.endsWith("/upload")
            ? "learning.media.read"
            : "learning.media.write";
      const issuedAt = Math.floor(Date.now() / 1000);
      const context = await signActorContext(
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
          issuedAt,
          expiresAt: issuedAt + config.ACTOR_CONTEXT_TTL_SECONDS,
        },
      );
      const idempotencyKey = req.header("idempotency-key");
      const upstream = await fetch(new URL(req.path, config.LEARNING_SERVICE_URL), {
        method: req.method,
        headers: {
          "content-type": "application/json",
          "x-actor-context": context,
          "x-correlation-id": c.correlationId,
          ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        },
        ...(req.method !== "GET" ? { body: JSON.stringify(req.body ?? {}) } : {}),
        signal: AbortSignal.timeout(config.INTERNAL_HTTP_TIMEOUT_MS),
      });
      res.setHeader("Cache-Control", "no-store");
      res
        .status(upstream.status)
        .type("application/json")
        .send(await upstream.text());
    } catch (e) {
      next(
        e instanceof AppError
          ? e
          : new AppError("MEDIA_SERVICE_UNAVAILABLE", 503, "Media service is unavailable", true),
      );
    }
  };
}
