import type { Request, RequestHandler } from "express";
import { z } from "zod";
import type { AppConfig } from "../../../packages/config/src/index.js";
import { AppError, currentRequestContext } from "../../../packages/http/src/index.js";
import {
  loadPrivateKey,
  loadPublicKey,
  signActorContext,
  verifyAccessToken,
  type VerifiedAccessToken,
} from "../../../packages/security/src/index.js";
import { parseBearerAuthorization } from "./protected-identity-proxy.js";
import { AdminStepUpClientError, type AdminStepUpClient } from "./admin-step-up-client.js";

const adminBody = z.object({ currentPassword: z.string().min(1).max(1024) }).strict();

export async function learningLifecycleProxyFactory(
  config: AppConfig,
  stepUp: AdminStepUpClient,
): Promise<{
  submit: RequestHandler;
  publish: RequestHandler;
  archive: RequestHandler;
  retire: RequestHandler;
}> {
  if (!config.JWT_PUBLIC_KEY_PATH || !config.ACTOR_CONTEXT_PRIVATE_KEY_PATH)
    throw new Error("Learning lifecycle proxy requires signing keys");
  const [jwtKey, actorKey] = await Promise.all([
    loadPublicKey(config.JWT_PUBLIC_KEY_PATH),
    loadPrivateKey(config.ACTOR_CONTEXT_PRIVATE_KEY_PATH),
  ]);

  async function actor(req: Request): Promise<VerifiedAccessToken> {
    try {
      return await verifyAccessToken(parseBearerAuthorization(req), jwtKey, {
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
        kid: config.JWT_KID,
        clockToleranceSeconds: config.JWT_CLOCK_SKEW_SECONDS,
      });
    } catch {
      throw new AppError("INVALID_ACCESS_TOKEN", 401, "Invalid access token");
    }
  }

  const handler =
    (kind: "submit" | "publish" | "archive" | "retire"): RequestHandler =>
    async (req, res, next) => {
      try {
        const context = currentRequestContext();
        if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
        const courseId = String(req.params.courseId);
        const verified = await actor(req);
        const isAdmin = kind === "publish" || kind === "archive";
        if (!verified.roles.includes(isAdmin ? "ADMIN" : "LECTURER"))
          throw new AppError(
            isAdmin ? "ADMIN_REQUIRED" : "LECTURER_REQUIRED",
            403,
            "Role authorization is required",
          );
        const retireBody =
          kind === "retire"
            ? z
                .object({ mode: z.enum(["LOCK", "DELETE"]) })
                .strict()
                .safeParse(req.body)
            : undefined;
        if (retireBody && !retireBody.success)
          throw new AppError("COURSE_RETIRE_VALIDATION_FAILED", 422, "mode must be LOCK or DELETE");
        let proof: string | undefined;
        if (isAdmin) {
          const parsed = adminBody.safeParse(req.body);
          if (!parsed.success)
            throw new AppError("ADMIN_REAUTH_VALIDATION_FAILED", 422, "currentPassword is required");
          proof = await stepUp.authorize({
            actor: verified,
            correlationId: context.correlationId,
            currentPassword: parsed.data.currentPassword,
            action: kind === "publish" ? "COURSE_PUBLISH" : "COURSE_ARCHIVE",
            resourceId: courseId,
          });
        }
        const now = Math.floor(Date.now() / 1000);
        const actorContext = await signActorContext(
          actorKey,
          config.ACTOR_CONTEXT_KID,
          config.ACTOR_CONTEXT_ISSUER,
          "learning-service",
          `learning.course.${kind}`,
          {
            userId: verified.userId,
            roles: [...verified.roles],
            sessionId: verified.sessionId,
            tokenVersion: verified.tokenVersion,
            correlationId: context.correlationId,
            issuedAt: now,
            expiresAt: now + config.ACTOR_CONTEXT_TTL_SECONDS,
          },
        );
        const idempotencyKey = req.header("idempotency-key");
        const upstream = await fetch(
          new URL(
            kind === "submit"
              ? `/api/v1/courses/${encodeURIComponent(courseId)}/submit-review`
              : kind === "retire"
                ? `/api/v1/courses/${encodeURIComponent(courseId)}/retire`
                : `/api/v1/admin/courses/${encodeURIComponent(courseId)}/${kind}`,
            config.LEARNING_SERVICE_URL,
          ),
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-actor-context": actorContext,
              "x-correlation-id": context.correlationId,
              ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
              ...(proof ? { "x-admin-step-up-proof": proof } : {}),
            },
            body: retireBody?.success ? JSON.stringify(retireBody.data) : "{}",
            signal: AbortSignal.timeout(config.INTERNAL_HTTP_TIMEOUT_MS),
          },
        );
        const type = upstream.headers.get("content-type");
        if (type) res.type(type);
        res.status(upstream.status).send(await upstream.text());
      } catch (error) {
        next(
          error instanceof AppError
            ? error
            : error instanceof AdminStepUpClientError
              ? new AppError(
                  "ADMIN_REAUTH_REJECTED",
                  error.status,
                  "Admin password reauthorization failed",
                  error.status === 503,
                )
              : new AppError(
                  "LEARNING_LIFECYCLE_UNAVAILABLE",
                  503,
                  "Learning lifecycle is temporarily unavailable",
                  true,
                ),
        );
      }
    };
  return {
    submit: handler("submit"),
    publish: handler("publish"),
    archive: handler("archive"),
    retire: handler("retire"),
  };
}
