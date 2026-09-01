import { Router, type Request } from "express";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import type { LogoutService } from "./service.js";

export type ActorContextVerifier = (token: string) => Promise<ActorContext>;

export function logoutRouter(
  service: LogoutService,
  verifyContext: ActorContextVerifier,
  metrics: ReturnType<typeof createMetrics>,
): Router {
  const router = Router();
  router.post("/api/v1/auth/logout", async (request, response, next): Promise<void> => {
    try {
      const context = currentRequestContext();
      if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
      if (hasRequestBody(request)) {
        throw new AppError("LOGOUT_BODY_NOT_ALLOWED", 422, "Logout request body is not allowed");
      }
      const token = singleActorContextHeader(request);
      let actor: ActorContext;
      try {
        actor = await verifyContext(token);
      } catch {
        metrics.identityLogouts.inc({ outcome: "context_failure" });
        throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid trusted actor context");
      }
      if (actor.correlationId !== context.correlationId) {
        metrics.identityLogouts.inc({ outcome: "context_failure" });
        throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid trusted actor context");
      }
      await service.logout({ ...actor, requestId: context.requestId });
      response.status(200).json({
        data: { loggedOut: true },
        meta: { requestId: context.requestId, timestamp: new Date().toISOString() },
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

function singleActorContextHeader(request: Request): string {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === "x-actor-context") {
      values.push(request.rawHeaders[index + 1] ?? "");
    }
  }
  if (values.length !== 1 || !values[0] || values[0].length > 4_096) {
    throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid trusted actor context");
  }
  return values[0];
}

function hasRequestBody(request: Request): boolean {
  const contentLength = request.header("content-length");
  return (
    request.header("transfer-encoding") !== undefined ||
    (contentLength !== undefined && contentLength !== "0")
  );
}
