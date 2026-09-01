import { Router, type Request } from "express";
import { ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import { parseAdminStepUpRequest } from "./model.js";
import type { AdminStepUpService } from "./service.js";

export function adminStepUpRouter(
  service: AdminStepUpService,
  verifyService: (token: string) => Promise<unknown>,
  verifyActor: (token: string) => Promise<ActorContext>,
): Router {
  const router = Router();
  router.post("/internal/v1/admin/step-up-authorizations", async (req, res, next) => {
    try {
      const ctx = currentRequestContext();
      if (!ctx) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
      const serviceClaims = await verifyService(serviceToken(req));
      if (
        !serviceClaims ||
        typeof serviceClaims !== "object" ||
        !("sub" in serviceClaims) ||
        (serviceClaims as { sub?: unknown }).sub !== "api-gateway"
      )
        throw new Error("GATEWAY_SERVICE_REQUIRED");
      const actor = await verifyActor(single(req, "x-actor-context", 4096));
      if (actor.correlationId !== ctx.correlationId) throw new Error("ACTOR_CONTEXT_CORRELATION_MISMATCH");
      let body;
      try {
        body = parseAdminStepUpRequest(req.body);
      } catch (error) {
        if (error instanceof ZodError)
          throw new AppError(
            "STEP_UP_VALIDATION_FAILED",
            422,
            "Step-up request validation failed",
            false,
            error.issues.map((i) => ({ field: i.path.join(".") || "body", reason: i.message })),
          );
        throw error;
      }
      const result = await service.authorize(actor, body);
      res
        .status(200)
        .json({ data: result, meta: { requestId: ctx.requestId, timestamp: new Date().toISOString() } });
    } catch (error) {
      next(
        error instanceof AppError
          ? error
          : new AppError("INVALID_INTERNAL_AUTHORIZATION", 401, "Invalid internal authorization"),
      );
    }
  });
  return router;
}
function serviceToken(req: Request) {
  const value = single(req, "authorization", 4096),
    match = /^Service ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u.exec(value);
  if (!match?.[1]) throw new Error("SERVICE_TOKEN_REJECTED");
  return match[1];
}
function single(req: Request, name: string, max: number) {
  const values: string[] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2)
    if (req.rawHeaders[i]?.toLowerCase() === name) values.push(req.rawHeaders[i + 1] ?? "");
  if (values.length !== 1 || !values[0] || values[0].length > max) throw new Error("HEADER_REJECTED");
  return values[0];
}
