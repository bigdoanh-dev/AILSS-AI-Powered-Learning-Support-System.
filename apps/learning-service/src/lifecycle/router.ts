import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import { validateIdempotencyKey } from "../authoring/model.js";
import type { LearningLifecycleService } from "./service.js";

export function learningLifecycleRouter(
  service: LearningLifecycleService,
  verify: Readonly<
    Record<"submit" | "publish" | "archive" | "retire", (token: string) => Promise<ActorContext>>
  >,
  metrics: ReturnType<typeof createMetrics>,
): Router {
  const router = Router();
  router.post("/api/v1/courses/:courseId/submit-review", handler("submit", 202));
  router.post("/api/v1/admin/courses/:courseId/publish", handler("publish", 200));
  router.post("/api/v1/admin/courses/:courseId/archive", handler("archive", 202));
  router.post("/api/v1/courses/:courseId/retire", handler("retire", 200));

  function handler(operation: "submit" | "publish" | "archive" | "retire", status: 200 | 202) {
    return async (req: Request, res: Response, next: NextFunction) => {
      const stop = metrics.learningCourseAuthoringLatency.startTimer({ operation });
      try {
        const context = currentRequestContext();
        if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
        const courseId = String(req.params.courseId);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(courseId))
          throw new AppError("INVALID_COURSE_ID", 400, "Invalid courseId");
        const actor = await verified(req, verify[operation], context.correlationId);
        const idempotencyKey = idempotency(req);
        const retireBody =
          operation === "retire"
            ? z
                .object({ mode: z.enum(["LOCK", "DELETE"]) })
                .strict()
                .safeParse(req.body)
            : undefined;
        if (retireBody && !retireBody.success)
          throw new AppError("COURSE_RETIRE_VALIDATION_FAILED", 422, "mode must be LOCK or DELETE");
        const result =
          operation === "submit"
            ? await service.submitReview({ actor, courseId, idempotencyKey, requestId: context.requestId })
            : operation === "retire" && retireBody?.success
              ? await service.retire({
                  actor,
                  courseId,
                  mode: retireBody.data.mode,
                  idempotencyKey,
                  requestId: context.requestId,
                })
              : operation === "publish"
                ? await service.publish({
                    actor,
                    proof: single(req, "x-admin-step-up-proof", 8192),
                    courseId,
                    idempotencyKey,
                    requestId: context.requestId,
                  })
                : await service.archive({
                    actor,
                    proof: single(req, "x-admin-step-up-proof", 8192),
                    courseId,
                    idempotencyKey,
                    requestId: context.requestId,
                  });
        res.status(status).json({
          data: result.course,
          meta: {
            requestId: context.requestId,
            timestamp: new Date().toISOString(),
            replayed: result.replayed,
          },
        });
        metrics.learningCourseAuthoring.inc({ operation, outcome: result.replayed ? "replayed" : "success" });
      } catch (error) {
        metrics.learningCourseAuthoring.inc({
          operation,
          outcome: error instanceof AppError ? error.code : "internal_error",
        });
        next(error);
      } finally {
        stop();
      }
    };
  }
  return router;
}

async function verified(
  req: Request,
  verifier: (token: string) => Promise<ActorContext>,
  correlationId: string,
) {
  try {
    const actor = await verifier(single(req, "x-actor-context", 4096));
    if (actor.correlationId !== correlationId) throw new Error("MISMATCH");
    return actor;
  } catch {
    throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid trusted actor context");
  }
}
function idempotency(req: Request) {
  try {
    return validateIdempotencyKey(single(req, "idempotency-key", 200));
  } catch {
    throw new AppError("INVALID_IDEMPOTENCY_KEY", 400, "A valid Idempotency-Key header is required");
  }
}
function single(req: Request, name: string, max: number) {
  const values: string[] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2)
    if (req.rawHeaders[i]?.toLowerCase() === name) values.push(req.rawHeaders[i + 1] ?? "");
  if (values.length !== 1 || !values[0] || values[0].length > max) throw new Error("HEADER_REJECTED");
  return values[0];
}
