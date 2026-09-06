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

export async function aiDocumentProxyFactory(c: AppConfig): Promise<{
  intent: RequestHandler;
  complete: RequestHandler;
  read: RequestHandler;
  quizCreate: RequestHandler;
  jobRead: RequestHandler;
  jobList: RequestHandler;
  draftList: RequestHandler;
  cancel: RequestHandler;
  usage: RequestHandler;
}> {
  if (!c.JWT_PUBLIC_KEY_PATH || !c.ACTOR_CONTEXT_PRIVATE_KEY_PATH)
    throw new Error("AI document proxy requires keys");
  const [jwt, key] = await Promise.all([
    loadPublicKey(c.JWT_PUBLIC_KEY_PATH),
    loadPrivateKey(c.ACTOR_CONTEXT_PRIVATE_KEY_PATH),
  ]);
  const handler =
    (method: "GET" | "POST", path: (r: Request) => string): RequestHandler =>
    async (r, s, n) => {
      try {
        const ctx = currentRequestContext();
        if (!ctx) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
        let actor;
        try {
          actor = await verifyAccessToken(parseBearerAuthorization(r), jwt, {
            issuer: c.JWT_ISSUER,
            audience: c.JWT_AUDIENCE,
            kid: c.JWT_KID,
            clockToleranceSeconds: c.JWT_CLOCK_SKEW_SECONDS,
          });
        } catch {
          throw new AppError("INVALID_ACCESS_TOKEN", 401, "Invalid access token");
        }
        const now = Math.floor(Date.now() / 1000),
          trusted = await signActorContext(
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
          ),
          idem = r.header("idempotency-key"),
          up = await fetch(new URL(path(r), c.AI_SERVICE_URL), {
            method,
            headers: {
              "x-actor-context": trusted,
              "x-correlation-id": ctx.correlationId,
              ...(idem ? { "idempotency-key": idem } : {}),
              ...(method === "POST" ? { "content-type": "application/json" } : {}),
            },
            ...(method === "POST" ? { body: JSON.stringify(r.body) } : {}),
            signal: AbortSignal.timeout(c.INTERNAL_HTTP_TIMEOUT_MS),
          });
        const type = up.headers.get("content-type");
        if (type) s.type(type);
        s.status(up.status).send(await up.text());
      } catch (e) {
        n(
          e instanceof AppError
            ? e
            : new AppError("AI_SERVICE_UNAVAILABLE", 503, "AI service is temporarily unavailable", true),
        );
      }
    };
  return {
    intent: handler("POST", () => "/api/v1/ai/documents/upload-intents"),
    complete: handler(
      "POST",
      (r) => `/api/v1/ai/documents/${encodeURIComponent(String(r.params.documentId))}/complete`,
    ),
    read: handler("GET", (r) => `/api/v1/ai/documents/${encodeURIComponent(String(r.params.documentId))}`),
    quizCreate: handler("POST", () => "/api/v1/ai/quiz-jobs"),
    jobRead: handler("GET", (r) => `/api/v1/ai/jobs/${encodeURIComponent(String(r.params.jobId))}`),
    jobList: handler("GET", (r) => `/api/v1/ai/jobs${query(r)}`),
    draftList: handler("GET", (r) => `/api/v1/ai/jobs/${encodeURIComponent(String(r.params.jobId))}/drafts`),
    cancel: handler("POST", (r) => `/api/v1/ai/jobs/${encodeURIComponent(String(r.params.jobId))}/cancel`),
    usage: handler("GET", () => "/api/v1/ai/usage"),
  };
}

function query(request: Request): string {
  const index = request.originalUrl.indexOf("?");
  return index < 0 ? "" : request.originalUrl.slice(index);
}
