import { Router, type Request } from "express";
import { z, ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import { validateIdempotencyKey } from "../registration/model.js";
import {
  parseAdminSearchQuery,
  parseAdminStatusRequest,
  type AdminProjectionRow,
  type AdminUser,
} from "./model.js";
import type { IdentityAdminService } from "./service.js";

export type AdminActorContextVerifier = (token: string) => Promise<ActorContext>;

export function adminRouter(
  service: IdentityAdminService,
  verifiers: {
    search(token: string): Promise<ActorContext>;
    detail(token: string): Promise<ActorContext>;
    statusChange(token: string): Promise<ActorContext>;
  },
  metrics: ReturnType<typeof createMetrics>,
): Router {
  const router = Router();
  router.get("/api/v1/admin/users", async (request, response, next): Promise<void> => {
    try {
      if (hasRequestBody(request))
        throw new AppError("ADMIN_SEARCH_BODY_NOT_ALLOWED", 422, "Request body is not allowed");
      const { actor, requestId } = await verifiedActor(request, (token) => verifiers.search(token), metrics);
      let query;
      try {
        query = parseAdminSearchQuery(request.query);
      } catch (error) {
        throw validationError("ADMIN_SEARCH_VALIDATION_FAILED", "Admin search validation failed", error);
      }
      const result = await service.search(actor, query);
      response.status(200).json({
        data: result.items.map(searchDto),
        meta: {
          ...responseMeta(requestId),
          pagination: { limit: query.limit, hasMore: result.hasMore, nextCursor: result.nextCursor },
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/api/v1/admin/users/:userId", async (request, response, next): Promise<void> => {
    try {
      if (hasRequestBody(request))
        throw new AppError("ADMIN_DETAIL_BODY_NOT_ALLOWED", 422, "Request body is not allowed");
      const { actor, requestId } = await verifiedActor(request, (token) => verifiers.detail(token), metrics);
      const userId = parseUuid(request.params.userId);
      const target = await service.detail(actor, userId);
      response.status(200).json({ data: detailDto(target), meta: responseMeta(requestId) });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/api/v1/admin/users/:userId/status", async (request, response, next): Promise<void> => {
    try {
      const { actor, requestId } = await verifiedActor(
        request,
        (token) => verifiers.statusChange(token),
        metrics,
      );
      const targetId = parseUuid(request.params.userId);
      let idempotencyKey: string;
      try {
        idempotencyKey = validateIdempotencyKey(request.header("idempotency-key"));
      } catch {
        throw new AppError("INVALID_IDEMPOTENCY_KEY", 400, "A valid Idempotency-Key header is required");
      }
      let body;
      try {
        body = parseAdminStatusRequest(request.body);
      } catch (error) {
        throw validationError("ADMIN_STATUS_VALIDATION_FAILED", "Status command validation failed", error);
      }
      const result = await service.changeStatus({
        actor,
        targetId,
        request: body,
        idempotencyKey,
        requestId,
      });
      response.status(200).json({
        data: { userId: result.userId, oldStatus: result.oldStatus, status: result.newStatus },
        meta: { ...responseMeta(requestId), replayed: result.replayed },
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

async function verifiedActor(
  request: Request,
  verifier: AdminActorContextVerifier,
  metrics: ReturnType<typeof createMetrics>,
): Promise<{ actor: ActorContext; requestId: string }> {
  const context = currentRequestContext();
  if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
  try {
    const actor = await verifier(singleActorContextHeader(request));
    if (actor.correlationId !== context.correlationId) throw new Error("ACTOR_CONTEXT_CORRELATION_MISMATCH");
    return { actor, requestId: context.requestId };
  } catch {
    metrics.identityAdminAuthorization.inc({ outcome: "context_denied" });
    throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid trusted actor context");
  }
}

function singleActorContextHeader(request: Request): string {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === "x-actor-context") {
      values.push(request.rawHeaders[index + 1] ?? "");
    }
  }
  if (values.length !== 1 || !values[0] || values[0].length > 4_096)
    throw new Error("ACTOR_CONTEXT_REJECTED");
  return values[0];
}

function parseUuid(value: string | string[] | undefined): string {
  const result = z.string().uuid().safeParse(value);
  if (!result.success) throw new AppError("INVALID_USER_ID", 400, "User ID must be a UUID");
  return result.data;
}

function validationError(code: string, message: string, error: unknown): AppError {
  if (!(error instanceof ZodError)) throw error;
  return new AppError(
    code,
    422,
    message,
    false,
    error.issues.map((issue) => ({ field: issue.path.join(".") || "request", reason: issue.message })),
  );
}

function searchDto(row: AdminProjectionRow) {
  return {
    userId: row.userId,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    lecturerVerified: row.lecturerVerified,
    profileVersion: row.profileVersion,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function detailDto(user: AdminUser) {
  return {
    userId: user.userId,
    displayName: user.displayName,
    emailMasked: user.emailMasked,
    role: user.role,
    status: user.status,
    lecturerVerified: user.lecturerVerified,
    profileVersion: user.profileVersion,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function hasRequestBody(request: Request): boolean {
  const contentLength = request.header("content-length");
  return (
    request.header("transfer-encoding") !== undefined ||
    (contentLength !== undefined && contentLength !== "0")
  );
}

function responseMeta(requestId: string) {
  return { requestId, timestamp: new Date().toISOString() };
}
