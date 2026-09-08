import { Router, type Request } from "express";
import { ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../packages/http/src/index.js";
import type { ActorContext } from "../../../packages/security/src/index.js";
import { notificationListSchema } from "./model.js";
import type { NotificationService } from "./service.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export function notificationRouter(
  service: NotificationService,
  verify: (token: string, purpose: string) => Promise<ActorContext>,
): Router {
  const router = Router();
  router.get("/api/v1/notifications", async (request, response, next) => {
    try {
      const context = requiredContext(),
        actor = await trustedActor(request, verify, "notification.list", context.correlationId);
      const input = notificationListSchema.parse(request.query),
        result = await service.list(actor.userId, input.month, input.limit, input.cursor);
      response.json({
        data: {
          items: result.items,
          page: { month: input.month, nextCursor: result.nextCursor ?? null },
        },
        meta: {
          requestId: context.requestId,
          timestamp: new Date().toISOString(),
          ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
        },
      });
    } catch (error) {
      next(validation(error));
    }
  });
  router.patch("/api/v1/notifications/:notificationId/read", async (request, response, next) => {
    try {
      const context = requiredContext(),
        actor = await trustedActor(request, verify, "notification.read", context.correlationId);
      const id = request.params.notificationId;
      if (!uuid.test(id))
        throw new AppError("INVALID_NOTIFICATION_ID", 400, "Invalid notification identifier");
      if (request.body && Object.keys(request.body as object).length > 0)
        throw new AppError("NOTIFICATION_BODY_NOT_ALLOWED", 400, "Request body is not allowed");
      const result = await service.markRead(actor.userId, id, one(request, "x-notification-locator", 4096));
      response.json({
        data: {
          notificationId: result.notificationId,
          state: "READ",
          readAt: result.readAt,
        },
        meta: { requestId: context.requestId, timestamp: new Date().toISOString() },
      });
    } catch (error) {
      next(validation(error));
    }
  });
  return router;
}
function requiredContext() {
  const value = currentRequestContext();
  if (!value) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
  return value;
}
function one(request: Request, name: string, max: number): string {
  const values: string[] = [];
  for (let i = 0; i < request.rawHeaders.length; i += 2)
    if (request.rawHeaders[i]?.toLowerCase() === name) values.push(request.rawHeaders[i + 1] ?? "");
  if (values.length !== 1 || !values[0] || values[0].length > max)
    throw new AppError("INVALID_REQUIRED_HEADER", 400, `A valid ${name} header is required`);
  return values[0];
}
async function trustedActor(
  request: Request,
  verify: (token: string, purpose: string) => Promise<ActorContext>,
  purpose: string,
  correlationId: string,
) {
  try {
    const actor = await verify(one(request, "x-actor-context", 4096), purpose);
    if (actor.correlationId !== correlationId) throw new Error();
    return actor;
  } catch {
    throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid trusted actor context");
  }
}
function validation(error: unknown) {
  return error instanceof ZodError
    ? new AppError(
        "NOTIFICATION_VALIDATION_FAILED",
        400,
        "Notification request validation failed",
        false,
        error.issues.map((issue) => ({ field: issue.path.join(".") || "query", reason: issue.message })),
      )
    : error;
}
