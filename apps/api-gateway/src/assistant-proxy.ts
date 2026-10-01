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

export async function assistantProxyFactory(c: AppConfig): Promise<{
  chat: RequestHandler;
  adminStatus: RequestHandler;
  conversationsList: RequestHandler;
  conversationDetail: RequestHandler;
}> {
  if (!c.JWT_PUBLIC_KEY_PATH || !c.ACTOR_CONTEXT_PRIVATE_KEY_PATH) {
    throw new Error("Assistant proxy requires JWT public key and Actor Context private key");
  }

  const [jwt, key] = await Promise.all([
    loadPublicKey(c.JWT_PUBLIC_KEY_PATH),
    loadPrivateKey(c.ACTOR_CONTEXT_PRIVATE_KEY_PATH),
  ]);

  const handler =
    (method: "GET" | "POST", path: (r: Request) => string): RequestHandler =>
    async (req, res, next) => {
      try {
        const ctx = currentRequestContext();
        if (!ctx) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");

        let actor;
        try {
          actor = await verifyAccessToken(parseBearerAuthorization(req), jwt, {
            issuer: c.JWT_ISSUER,
            audience: c.JWT_AUDIENCE,
            kid: c.JWT_KID,
            clockToleranceSeconds: c.JWT_CLOCK_SKEW_SECONDS,
          });
        } catch {
          throw new AppError("INVALID_ACCESS_TOKEN", 401, "Invalid access token");
        }

        const now = Math.floor(Date.now() / 1000);
        const trusted = await signActorContext(
          key,
          c.ACTOR_CONTEXT_KID,
          c.ACTOR_CONTEXT_ISSUER,
          "ai-service",
          "ai.document.access",
          {
            userId: actor.userId,
            roles: [...actor.roles],
            sessionId: actor.sessionId,
            tokenVersion: actor.tokenVersion,
            correlationId: ctx.correlationId,
            issuedAt: now,
            expiresAt: now + c.ACTOR_CONTEXT_TTL_SECONDS,
          },
        );

        const upstream = await fetch(new URL(path(req), c.AI_SERVICE_URL), {
          method,
          headers: {
            "x-actor-context": trusted,
            "x-correlation-id": ctx.correlationId,
            ...(method === "POST" ? { "content-type": "application/json" } : {}),
          },
          ...(method === "POST" ? { body: JSON.stringify(req.body) } : {}),
          // The AI service needs time to finish persistence after its provider deadline.
          signal: AbortSignal.timeout(c.AI_PROVIDER_TIMEOUT_MS + 10_000),
        });

        const type = upstream.headers.get("content-type");
        if (type) res.type(type);
        res.status(upstream.status).send(await upstream.text());
      } catch (e) {
        next(
          e instanceof AppError
            ? e
            : new AppError("AI_ASSISTANT_UNAVAILABLE", 503, "AI assistant is temporarily unavailable", true),
        );
      }
    };

  return {
    adminStatus: handler("GET", () => "/api/v1/assistant/admin-status"),
    chat: handler("POST", () => "/api/v1/assistant/chat"),
    conversationsList: handler("GET", () => "/api/v1/assistant/conversations"),
    conversationDetail: handler(
      "GET",
      (r) => `/api/v1/assistant/conversations/${encodeURIComponent(String(r.params.id))}`,
    ),
  };
}
