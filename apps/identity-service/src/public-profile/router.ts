import { Router, type Request } from "express";
import { z } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { JWTPayload } from "jose";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import type { PublicProfileService } from "./service.js";

const uuidSchema = z.string().uuid();
const MAX_SERVICE_TOKEN_LENGTH = 4_096;

export type ServiceTokenVerifier = (token: string) => Promise<JWTPayload>;

export function publicProfileRouter(
  service: PublicProfileService,
  verifyAllowedToken: ServiceTokenVerifier,
  metrics?: ReturnType<typeof createMetrics>,
): Router {
  const router = Router();
  router.get("/api/v1/lecturers/:lecturerId", async (request, response, next): Promise<void> => {
    try {
      const context = currentRequestContext();
      if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
      const lecturerId = parseUuid(request.params.lecturerId);
      const profile = await service.readPublic(lecturerId, context.requestId);
      response.status(200).json({ data: profile, meta: responseMeta(context.requestId) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/internal/v1/users/:id/public-profile", async (request, response, next): Promise<void> => {
    try {
      const context = currentRequestContext();
      if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
      let claims: JWTPayload;
      try {
        claims = await verifyAllowedToken(singleServiceToken(request));
      } catch {
        metrics?.internalPublicProfiles.inc({ outcome: "authentication_denied" });
        throw new AppError("INVALID_SERVICE_CREDENTIALS", 401, "Invalid service credentials");
      }
      if (
        !claims.sub ||
        !["learning-service", "classroom-service", "assessment-service", "ai-service"].includes(claims.sub)
      ) {
        metrics?.internalPublicProfiles.inc({ outcome: "caller_denied" });
        throw new AppError("SERVICE_CALLER_NOT_ALLOWED", 403, "Service caller is not allowed");
      }
      const userId = parseUuid(request.params.id);
      const profile = await service.readInternal(userId, context.requestId);
      metrics?.internalPublicProfiles.inc({ outcome: "success" });
      response.status(200).json({ data: profile, meta: responseMeta(context.requestId) });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

function parseUuid(value: string | string[] | undefined): string {
  const result = uuidSchema.safeParse(value);
  if (!result.success) throw new AppError("INVALID_RESOURCE_ID", 400, "Resource ID must be a UUID");
  return result.data;
}

function singleServiceToken(request: Request): string {
  return parseServiceAuthorization({ rawHeaders: request.rawHeaders });
}

export function parseServiceAuthorization(request: { readonly rawHeaders: readonly string[] }): string {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === "authorization") {
      values.push(request.rawHeaders[index + 1] ?? "");
    }
  }
  const value = values[0];
  if (values.length !== 1 || !value || value.length > MAX_SERVICE_TOKEN_LENGTH) {
    throw new Error("SERVICE_AUTHORIZATION_HEADER_REJECTED");
  }
  const token = /^Service ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u.exec(value)?.[1];
  if (!token) throw new Error("SERVICE_AUTHORIZATION_SCHEME_REJECTED");
  return token;
}

function responseMeta(requestId: string) {
  return { requestId, timestamp: new Date().toISOString() };
}
