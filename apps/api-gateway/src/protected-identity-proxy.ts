import { z } from "zod";
import { publicDecisionSchema } from "../../identity-service/src/lecturer-application/model.js";
import { AdminStepUpClientError, type AdminStepUpClient } from "./admin-step-up-client.js";
import type { Request, RequestHandler } from "express";
import type { AppConfig } from "../../../packages/config/src/index.js";
import { AppError, currentRequestContext } from "../../../packages/http/src/index.js";
import {
  loadPrivateKey,
  loadPublicKey,
  signActorContext,
  verifyAccessToken,
  type StepUpAction,
  type StepUpResourceType,
} from "../../../packages/security/src/index.js";

const MAX_AUTHORIZATION_LENGTH = 4_096;

export interface ProtectedIdentityRoute {
  readonly method: "GET" | "PATCH" | "POST";
  readonly path: string;
  readonly purpose: string;
  readonly upstreamPath?: (request: Request) => string;
  readonly forwardQuery?: boolean;
  readonly forwardBody?: boolean;
  readonly forwardIdempotencyKey?: boolean;
  readonly timeoutMs?: number;
  readonly onInvalidBearer: () => void;
}

export interface StepUpTarget {
  readonly action: StepUpAction;
  readonly resourceType: StepUpResourceType;
  readonly resourceId: string;
  readonly currentPassword: string;
  readonly forwardedBody?: unknown;
}

export function requiresStepUp(purpose: string): boolean {
  return (
    purpose === "identity.lecturer-application.decision" ||
    purpose === "identity.admin.user.status.change" ||
    purpose === "identity.admin.lecturer.verify"
  );
}

export function resolveStepUpTarget(route: ProtectedIdentityRoute, request: Request): StepUpTarget | null {
  if (!requiresStepUp(route.purpose)) return null;

  if (route.purpose === "identity.lecturer-application.decision") {
    const parsed = publicDecisionSchema.safeParse(request.body);
    const id = z.string().uuid().safeParse(request.params.applicationId);
    if (!parsed.success || !id.success || Object.keys(request.query).length) {
      throw new AppError("APPLICATION_INVALID_REQUEST", 422, "Invalid application decision");
    }
    return {
      action:
        parsed.data.decision === "APPROVE" ? "LECTURER_APPLICATION_APPROVE" : "LECTURER_APPLICATION_REJECT",
      resourceType: "LECTURER_APPLICATION",
      resourceId: id.data,
      currentPassword: parsed.data.currentPassword,
      forwardedBody: { decision: parsed.data.decision },
    };
  }

  if (route.purpose === "identity.admin.user.status.change") {
    const id = z.string().uuid().safeParse(request.params.userId);
    const bodySchema = z
      .object({
        status: z.enum(["ACTIVE", "SUSPENDED"]),
        currentPassword: z.string().min(1).max(128),
        reason: z.string().trim().min(1).max(200).optional(),
      })
      .strict();
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success || !id.success) {
      throw new AppError("ADMIN_STATUS_VALIDATION_FAILED", 422, "Invalid status change request");
    }
    return {
      action: "ADMIN_USER_STATUS_CHANGE",
      resourceType: "USER",
      resourceId: id.data,
      currentPassword: parsed.data.currentPassword,
      forwardedBody: {
        status: parsed.data.status,
        reason: parsed.data.reason,
        currentPassword: parsed.data.currentPassword,
      },
    };
  }

  if (route.purpose === "identity.admin.lecturer.verify") {
    const id = z.string().uuid().safeParse(request.params.userId);
    const bodySchema = z
      .object({
        currentPassword: z.string().min(1).max(128),
      })
      .strict();
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success || !id.success) {
      throw new AppError("LECTURER_VERIFY_VALIDATION_FAILED", 422, "Invalid lecturer verify request");
    }
    return {
      action: "ADMIN_LECTURER_VERIFY",
      resourceType: "USER",
      resourceId: id.data,
      currentPassword: parsed.data.currentPassword,
      forwardedBody: { currentPassword: parsed.data.currentPassword },
    };
  }

  return null;
}

export async function protectedIdentityProxyFactory(
  config: AppConfig,
  stepUp?: AdminStepUpClient,
): Promise<{
  handler(route: ProtectedIdentityRoute): RequestHandler;
}> {
  if (!config.JWT_PUBLIC_KEY_PATH || !config.ACTOR_CONTEXT_PRIVATE_KEY_PATH) {
    throw new Error("Protected Gateway routes require JWT public and actor-context private keys");
  }
  const [accessPublicKey, actorPrivateKey] = await Promise.all([
    loadPublicKey(config.JWT_PUBLIC_KEY_PATH),
    loadPrivateKey(config.ACTOR_CONTEXT_PRIVATE_KEY_PATH),
  ]);

  return {
    handler(route): RequestHandler {
      return async (request, response, next): Promise<void> => {
        try {
          if (route.method === "GET" && route.path === "/api/v1/me" && hasRequestBody(request)) {
            throw new AppError("PROFILE_BODY_NOT_ALLOWED", 422, "Profile read request body is not allowed");
          }
          const context = currentRequestContext();
          if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
          let actor;
          try {
            const bearer = parseBearerAuthorization(request);
            actor = await verifyAccessToken(bearer, accessPublicKey, {
              issuer: config.JWT_ISSUER,
              audience: config.JWT_AUDIENCE,
              kid: config.JWT_KID,
              clockToleranceSeconds: config.JWT_CLOCK_SKEW_SECONDS,
            });
          } catch {
            route.onInvalidBearer();
            throw invalidAccessToken();
          }
          let decisionBody: unknown;
          let stepUpProof: string | undefined;
          const stepUpTarget = resolveStepUpTarget(route, request);
          if (stepUpTarget) {
            if (!stepUp) throw new AppError("APPLICATION_UNAVAILABLE", 503, "Reauthentication unavailable");
            try {
              stepUpProof = await stepUp.authorize({
                actor,
                correlationId: context.correlationId,
                currentPassword: stepUpTarget.currentPassword,
                action: stepUpTarget.action,
                resourceType: stepUpTarget.resourceType,
                resourceId: stepUpTarget.resourceId,
              });
            } catch (error) {
              throw new AppError(
                error instanceof AdminStepUpClientError && error.status === 403
                  ? "ADMIN_STEP_UP_FAILED"
                  : "APPLICATION_UNAVAILABLE",
                error instanceof AdminStepUpClientError && error.status === 403 ? 401 : 503,
                "Application reauthentication failed",
              );
            }
            if (stepUpTarget.forwardedBody !== undefined) {
              decisionBody = stepUpTarget.forwardedBody;
            }
          }
          const issuedAt = Math.floor(Date.now() / 1_000);
          const actorContext = await signActorContext(
            actorPrivateKey,
            config.ACTOR_CONTEXT_KID,
            config.ACTOR_CONTEXT_ISSUER,
            config.ACTOR_CONTEXT_AUDIENCE,
            route.purpose,
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
          const idempotencyKey = request.header("idempotency-key");
          const upstreamUrl = new URL(
            route.upstreamPath?.(request) ?? route.path,
            config.IDENTITY_SERVICE_URL,
          );
          if (route.forwardQuery)
            upstreamUrl.search = request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : "";
          const upstream = await fetch(upstreamUrl, {
            method: route.method,
            headers: {
              "x-actor-context": actorContext,
              ...(stepUpProof ? { "x-admin-step-up-proof": stepUpProof } : {}),
              "x-correlation-id": context.correlationId,
              ...(route.forwardBody ? { "content-type": "application/json" } : {}),
              ...(route.forwardIdempotencyKey && idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
            },
            ...(route.forwardBody ? { body: JSON.stringify(decisionBody ?? request.body) } : {}),
            signal: AbortSignal.timeout(route.timeoutMs ?? config.INTERNAL_HTTP_TIMEOUT_MS),
          });
          const contentType = upstream.headers.get("content-type");
          if (contentType) response.type(contentType);
          response.status(upstream.status).send(await upstream.text());
        } catch (error) {
          next(
            error instanceof AppError
              ? error
              : new AppError(
                  "IDENTITY_SERVICE_UNAVAILABLE",
                  503,
                  "Identity service is temporarily unavailable",
                  true,
                ),
          );
        }
      };
    },
  };
}

function hasRequestBody(request: Request): boolean {
  const contentLength = request.header("content-length");
  return (
    request.header("transfer-encoding") !== undefined ||
    (contentLength !== undefined && contentLength !== "0")
  );
}

export function parseBearerAuthorization(request: Pick<Request, "rawHeaders">): string {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === "authorization") {
      values.push(request.rawHeaders[index + 1] ?? "");
    }
  }
  if (values.length !== 1) throw invalidAccessToken();
  const value = values[0];
  if (!value || value.length > MAX_AUTHORIZATION_LENGTH) throw invalidAccessToken();
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u.exec(value);
  const token = match?.[1];
  if (!token) throw invalidAccessToken();
  return token;
}

function invalidAccessToken(): AppError {
  return new AppError("INVALID_ACCESS_TOKEN", 401, "Invalid access token");
}
