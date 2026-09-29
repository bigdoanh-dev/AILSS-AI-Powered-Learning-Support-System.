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

type Name =
  | "enroll"
  | "myCourses"
  | "roster"
  | "orderCreate"
  | "orderRead"
  | "payment"
  | "refund"
  | "dashboardRevenue"
  | "lecturerRevenue"
  | "payoutAccountRead"
  | "payoutAccountSave"
  | "adminPayouts"
  | "preparePayouts"
  | "lecturerCommission"
  | "adminCommissionRead"
  | "adminCommissionSave";
export async function learningCommerceProxyFactory(config: AppConfig): Promise<Record<Name, RequestHandler>> {
  if (!config.JWT_PUBLIC_KEY_PATH || !config.ACTOR_CONTEXT_PRIVATE_KEY_PATH)
    throw new Error("Learning commerce proxy requires signing keys");
  const [jwtKey, actorKey] = await Promise.all([
    loadPublicKey(config.JWT_PUBLIC_KEY_PATH),
    loadPrivateKey(config.ACTOR_CONTEXT_PRIVATE_KEY_PATH),
  ]);
  const handler =
    (
      method: "GET" | "POST",
      purpose: string,
      path: (request: Request) => string,
      classroom = false,
    ): RequestHandler =>
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
        const now = Math.floor(Date.now() / 1000),
          claims = {
            userId: actor.userId,
            roles: [...actor.roles],
            sessionId: actor.sessionId,
            tokenVersion: actor.tokenVersion,
            correlationId: context.correlationId,
            issuedAt: now,
            expiresAt: now + config.ACTOR_CONTEXT_TTL_SECONDS,
          };
        const learningToken = await signActorContext(
          actorKey,
          config.ACTOR_CONTEXT_KID,
          config.ACTOR_CONTEXT_ISSUER,
          "learning-service",
          purpose,
          claims,
        );
        const classroomToken = classroom
          ? await signActorContext(
              actorKey,
              config.ACTOR_CONTEXT_KID,
              config.ACTOR_CONTEXT_ISSUER,
              "classroom-service",
              "classroom.schedule.reserve",
              claims,
            )
          : undefined;
        const idempotencyKey = req.header("idempotency-key");
        const upstream = await fetch(new URL(path(req), config.LEARNING_SERVICE_URL), {
          method,
          headers: {
            ...(method === "POST" ? { "content-type": "application/json" } : {}),
            "x-correlation-id": context.correlationId,
            "x-actor-context": learningToken,
            ...(classroomToken ? { "x-classroom-actor-context": classroomToken } : {}),
            ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
          },
          ...(method === "POST" ? { body: JSON.stringify(req.body) } : {}),
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
  const enc = (v: unknown) => encodeURIComponent(String(v));
  return {
    enroll: handler(
      "POST",
      "learning.enrollment.create",
      (r) => `/api/v1/courses/${enc(r.params.courseId)}/enrollments`,
    ),
    myCourses: handler("GET", "learning.enrollment.my-courses", () => "/api/v1/me/courses"),
    roster: handler(
      "GET",
      "learning.enrollment.roster",
      (r) => `/api/v1/courses/${enc(r.params.courseId)}/roster`,
    ),
    orderCreate: handler("POST", "learning.order.create", () => "/api/v1/orders", true),
    orderRead: handler("GET", "learning.order.read", (r) => `/api/v1/orders/${enc(r.params.orderId)}`),
    payment: handler(
      "POST",
      "learning.order.payment",
      (r) => `/api/v1/orders/${enc(r.params.orderId)}/simulate-payment`,
      true,
    ),
    refund: handler("POST", "learning.refund.create", () => "/api/v1/learning/refunds"),
    dashboardRevenue: handler(
      "GET",
      "learning.admin.dashboard.revenue",
      (r) => `/api/v1/admin/dashboard/revenue${r.url.includes("?") ? r.url.slice(r.url.indexOf("?")) : ""}`,
    ),
    lecturerRevenue: handler(
      "GET",
      "learning.lecturer.dashboard.revenue",
      (r) => `/api/v1/me/dashboard/revenue${r.url.includes("?") ? r.url.slice(r.url.indexOf("?")) : ""}`,
    ),
    payoutAccountRead: handler("GET", "learning.lecturer.payout-account", () => "/api/v1/me/payout-account"),
    payoutAccountSave: handler("POST", "learning.lecturer.payout-account", () => "/api/v1/me/payout-account"),
    adminPayouts: handler("GET", "learning.admin.payouts", () => "/api/v1/admin/payouts"),
    preparePayouts: handler("POST", "learning.admin.payouts", () => "/api/v1/admin/payouts/prepare"),
    lecturerCommission: handler("GET", "learning.lecturer.commission", () => "/api/v1/me/commission"),
    adminCommissionRead: handler("GET", "learning.admin.commission", () => "/api/v1/admin/commission"),
    adminCommissionSave: handler("POST", "learning.admin.commission", () => "/api/v1/admin/commission"),
  };
}
