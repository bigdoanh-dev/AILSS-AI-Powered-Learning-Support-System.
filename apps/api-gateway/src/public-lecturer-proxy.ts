import type { Request, RequestHandler } from "express";
import { z } from "zod";
import type { AppConfig } from "../../../packages/config/src/index.js";
import { AppError, currentRequestContext } from "../../../packages/http/src/index.js";
import { loadPublicKey, verifyAccessToken } from "../../../packages/security/src/index.js";
import { parseBearerAuthorization } from "./protected-identity-proxy.js";

const uuidSchema = z.string().uuid();

export async function publicLecturerProxyFactory(config: AppConfig): Promise<RequestHandler> {
  if (!config.JWT_PUBLIC_KEY_PATH) throw new Error("Optional Bearer route requires JWT public key");
  const accessPublicKey = await loadPublicKey(config.JWT_PUBLIC_KEY_PATH);
  return async (request, response, next): Promise<void> => {
    try {
      const context = currentRequestContext();
      if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
      const lecturerId = parseUuid(request.params.lecturerId);
      if (hasAuthorization(request)) {
        try {
          await verifyAccessToken(parseBearerAuthorization(request), accessPublicKey, {
            issuer: config.JWT_ISSUER,
            audience: config.JWT_AUDIENCE,
            kid: config.JWT_KID,
            clockToleranceSeconds: config.JWT_CLOCK_SKEW_SECONDS,
          });
        } catch {
          throw new AppError("INVALID_ACCESS_TOKEN", 401, "Invalid access token");
        }
      }
      const upstream = await fetch(
        new URL(`/api/v1/lecturers/${encodeURIComponent(lecturerId)}`, config.IDENTITY_SERVICE_URL),
        {
          headers: { "x-correlation-id": context.correlationId },
          signal: AbortSignal.timeout(config.INTERNAL_HTTP_TIMEOUT_MS),
        },
      );
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
}

function parseUuid(value: string | string[] | undefined): string {
  const result = uuidSchema.safeParse(value);
  if (!result.success) throw new AppError("INVALID_RESOURCE_ID", 400, "Resource ID must be a UUID");
  return result.data;
}

function hasAuthorization(request: Request): boolean {
  return request.rawHeaders.some((_value, index) =>
    index % 2 === 0 ? request.rawHeaders[index]?.toLowerCase() === "authorization" : false,
  );
}
