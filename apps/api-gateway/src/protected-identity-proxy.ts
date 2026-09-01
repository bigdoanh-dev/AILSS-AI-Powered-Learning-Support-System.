import type { Request, RequestHandler } from "express";
import type { AppConfig } from "../../../packages/config/src/index.js";
import { AppError, currentRequestContext } from "../../../packages/http/src/index.js";
import {
  loadPrivateKey,
  loadPublicKey,
  signActorContext,
  verifyAccessToken,
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

export async function protectedIdentityProxyFactory(config: AppConfig): Promise<{
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
              "x-correlation-id": context.correlationId,
              ...(route.forwardBody ? { "content-type": "application/json" } : {}),
              ...(route.forwardIdempotencyKey && idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
            },
            ...(route.forwardBody ? { body: JSON.stringify(request.body) } : {}),
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
