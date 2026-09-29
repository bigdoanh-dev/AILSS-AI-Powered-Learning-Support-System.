import { Router } from "express";
import { z } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import type { LearningFinanceService } from "./finance-service.js";

const bodySchema = z
  .object({ orderId: z.string().uuid(), reason: z.string().trim().min(10).max(500) })
  .strict();

export function learningFinanceRouter(
  service: LearningFinanceService,
  verify: (token: string) => Promise<ActorContext>,
): Router {
  const router = Router();
  router.post("/api/v1/learning/refunds", async (request, response, next) => {
    try {
      const context = currentRequestContext();
      if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
      const tokens = request.rawHeaders.flatMap((value, index, all) =>
        index % 2 === 0 && value.toLowerCase() === "x-actor-context" ? [all[index + 1] ?? ""] : [],
      );
      if (tokens.length !== 1)
        throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid trusted actor context");
      const token = tokens[0];
      if (!token) throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid trusted actor context");
      const actor = await verify(token);
      if (actor.correlationId !== context.correlationId)
        throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid trusted actor context");
      const key = request.header("idempotency-key");
      if (!key || key.length < 16 || key.length > 200)
        throw new AppError("INVALID_IDEMPOTENCY_KEY", 400, "A valid Idempotency-Key is required");
      const parsed = bodySchema.safeParse(request.body);
      if (!parsed.success) throw new AppError("REFUND_VALIDATION_FAILED", 422, "Refund request is invalid");
      response.status(200).json({
        data: await service.requestRefund({ actor, ...parsed.data, idempotencyKey: key }),
        meta: { requestId: context.requestId },
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
