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
import { AdminStepUpClientError, type AdminStepUpClient } from "./admin-step-up-client.js";
import { z } from "zod";
export async function interactionProxyFactory(
  c: AppConfig,
  stepUp: AdminStepUpClient,
  audit: (record: Record<string, unknown>) => void,
): Promise<
  Record<
    | "list"
    | "create"
    | "patch"
    | "remove"
    | "reviewList"
    | "reviewCreate"
    | "reviewPatch"
    | "reviewRemove"
    | "reportCreate"
    | "reportList"
    | "reportModerate",
    RequestHandler
  >
> {
  if (!c.JWT_PUBLIC_KEY_PATH || !c.ACTOR_CONTEXT_PRIVATE_KEY_PATH)
    throw new Error("Interaction proxy requires keys");
  const [jwt, key] = await Promise.all([
    loadPublicKey(c.JWT_PUBLIC_KEY_PATH),
    loadPrivateKey(c.ACTOR_CONTEXT_PRIVATE_KEY_PATH),
  ]);
  const handler =
    (
      method: "GET" | "POST" | "PATCH" | "DELETE",
      path: (r: Request) => string,
      optional = false,
      moderation = false,
    ): RequestHandler =>
    async (r, s, n) => {
      try {
        const x = currentRequestContext();
        if (!x) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
        let trusted: string | undefined,
          classroomTrusted: string | undefined,
          proof: string | undefined,
          forwardedBody: unknown = r.body;
        if (r.header("authorization") || !optional) {
          let a;
          try {
            a = await verifyAccessToken(parseBearerAuthorization(r), jwt, {
              issuer: c.JWT_ISSUER,
              audience: c.JWT_AUDIENCE,
              kid: c.JWT_KID,
              clockToleranceSeconds: c.JWT_CLOCK_SKEW_SECONDS,
            });
          } catch {
            throw new AppError("INVALID_ACCESS_TOKEN", 401, "Invalid access token");
          }
          const now = Math.floor(Date.now() / 1000);
          trusted = await signActorContext(
            key,
            c.ACTOR_CONTEXT_KID,
            c.ACTOR_CONTEXT_ISSUER,
            "interaction-service",
            "interaction.comment.eligibility",
            {
              userId: a.userId,
              roles: [...a.roles],
              sessionId: a.sessionId,
              tokenVersion: a.tokenVersion,
              correlationId: x.correlationId,
              issuedAt: now,
              expiresAt: now + c.ACTOR_CONTEXT_TTL_SECONDS,
            },
          );
          classroomTrusted = await signActorContext(
            key,
            c.ACTOR_CONTEXT_KID,
            c.ACTOR_CONTEXT_ISSUER,
            "classroom-service",
            "interaction.comment.eligibility",
            {
              userId: a.userId,
              roles: [...a.roles],
              sessionId: a.sessionId,
              tokenVersion: a.tokenVersion,
              correlationId: x.correlationId,
              issuedAt: now,
              expiresAt: now + c.ACTOR_CONTEXT_TTL_SECONDS,
            },
          );
          if (moderation) {
            const parsed = z
              .object({
                action: z.enum(["HIDE", "RESTORE", "DISMISS", "WARN"]),
                reason: z.string(),
                currentPassword: z.string().min(1).max(128),
              })
              .strict()
              .parse(r.body);
            proof = await stepUp.authorize({
              actor: a,
              correlationId: x.correlationId,
              currentPassword: parsed.currentPassword,
              action: "INTERACTION_REPORT_MODERATE",
              resourceType: "REPORT",
              resourceId: String(r.params.reportId),
            });
            forwardedBody = { action: parsed.action, reason: parsed.reason };
          }
        }
        const idem = r.header("idempotency-key"),
          pre = r.header("if-match"),
          u = new URL(path(r), c.INTERACTION_SERVICE_URL);
        if (method === "GET") u.search = r.url.includes("?") ? r.url.slice(r.url.indexOf("?")) : "";
        const up = await fetch(u, {
          method,
          headers: {
            "x-correlation-id": x.correlationId,
            ...(trusted ? { "x-actor-context": trusted } : {}),
            ...(classroomTrusted ? { "x-classroom-actor-context": classroomTrusted } : {}),
            ...(idem ? { "idempotency-key": idem } : {}),
            ...(pre ? { "if-match": pre } : {}),
            ...(proof ? { "x-admin-step-up-proof": proof } : {}),
            ...(method === "POST" || method === "PATCH" ? { "content-type": "application/json" } : {}),
          },
          ...(method === "POST" || method === "PATCH" ? { body: JSON.stringify(forwardedBody) } : {}),
          signal: AbortSignal.timeout(c.INTERNAL_HTTP_TIMEOUT_MS),
        });
        const t = up.headers.get("content-type");
        if (t) s.type(t);
        const etag = up.headers.get("etag");
        if (etag) s.set("etag", etag);
        s.status(up.status).send(await up.text());
      } catch (e) {
        if (moderation && e instanceof AdminStepUpClientError) {
          const context = currentRequestContext();
          audit({
            auditAction: "INTERACTION_REPORT_MODERATE",
            reportId: String(r.params.reportId ?? "unknown"),
            result: e.status === 403 ? "DENIED" : "FAILURE",
            ...(context ? { correlationId: context.correlationId } : {}),
          });
        }
        n(
          e instanceof AppError
            ? e
            : e instanceof AdminStepUpClientError
              ? new AppError(
                  "ADMIN_REAUTH_REJECTED",
                  e.status,
                  e.status === 403 ? "Admin reauthentication failed" : "Admin reauthentication unavailable",
                  e.status === 503,
                )
              : new AppError("INTERACTION_SERVICE_UNAVAILABLE", 503, "Interaction service unavailable", true),
        );
      }
    };
  return {
    list: handler(
      "GET",
      (r) =>
        `/api/v1/resources/${encodeURIComponent(String(r.params.resourceType))}/${encodeURIComponent(String(r.params.resourceId))}/comments`,
      true,
    ),
    create: handler(
      "POST",
      (r) =>
        `/api/v1/resources/${encodeURIComponent(String(r.params.resourceType))}/${encodeURIComponent(String(r.params.resourceId))}/comments`,
    ),
    patch: handler("PATCH", (r) => `/api/v1/comments/${encodeURIComponent(String(r.params.commentId))}`),
    remove: handler("DELETE", (r) => `/api/v1/comments/${encodeURIComponent(String(r.params.commentId))}`),
    reviewList: handler(
      "GET",
      (r) => `/api/v1/courses/${encodeURIComponent(String(r.params.courseId))}/reviews`,
      true,
    ),
    reviewCreate: handler(
      "POST",
      (r) => `/api/v1/courses/${encodeURIComponent(String(r.params.courseId))}/reviews`,
    ),
    reviewPatch: handler("PATCH", (r) => `/api/v1/reviews/${encodeURIComponent(String(r.params.reviewId))}`),
    reviewRemove: handler(
      "DELETE",
      (r) => `/api/v1/reviews/${encodeURIComponent(String(r.params.reviewId))}`,
    ),
    reportCreate: handler("POST", () => "/api/v1/reports"),
    reportList: handler("GET", () => "/api/v1/admin/reports"),
    reportModerate: handler(
      "POST",
      (r) => `/api/v1/admin/reports/${encodeURIComponent(String(r.params.reportId))}/moderate`,
      false,
      true,
    ),
  };
}
