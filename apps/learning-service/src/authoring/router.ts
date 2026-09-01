import { Router, type Request } from "express";
import { ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import { parseCreateCourse, parsePatchCourse, validateIdempotencyKey } from "./model.js";
import type { LearningAuthoringService } from "./service.js";

export function learningAuthoringRouter(
  service: LearningAuthoringService,
  verifyCreate: (t: string) => Promise<ActorContext>,
  verifyUpdate: (t: string) => Promise<ActorContext>,
  metrics: ReturnType<typeof createMetrics>,
): Router {
  const router = Router();
  router.post("/api/v1/courses", async (req, res, next) => {
    const stop = metrics.learningCourseAuthoringLatency.startTimer({ operation: "create" });
    try {
      const ctx = context();
      const actor = await verified(req, verifyCreate, ctx.correlationId);
      const key = idempotency(req);
      const body = parseBody(() => parseCreateCourse(req.body));
      const result = await service.create({
        actor,
        request: body,
        idempotencyKey: key,
        requestId: ctx.requestId,
      });
      res.status(201).json({ data: result.course, meta: meta(ctx.requestId, result.replayed, result.noOp) });
      metrics.learningCourseAuthoring.inc({
        operation: "create",
        outcome: result.replayed ? "replayed" : "success",
      });
    } catch (e) {
      metrics.learningCourseAuthoring.inc({ operation: "create", outcome: errorOutcome(e) });
      next(e);
    } finally {
      stop();
    }
  });
  router.patch("/api/v1/courses/:courseId", async (req, res, next) => {
    const stop = metrics.learningCourseAuthoringLatency.startTimer({ operation: "update" });
    try {
      const ctx = context();
      const actor = await verified(req, verifyUpdate, ctx.correlationId);
      const courseId = req.params.courseId;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(courseId))
        throw new AppError("INVALID_COURSE_ID", 400, "Invalid courseId");
      const key = idempotency(req);
      const body = parseBody(() => parsePatchCourse(req.body));
      const result = await service.update({
        actor,
        courseId,
        request: body,
        idempotencyKey: key,
        requestId: ctx.requestId,
      });
      res.status(200).json({ data: result.course, meta: meta(ctx.requestId, result.replayed, result.noOp) });
      metrics.learningCourseAuthoring.inc({
        operation: "update",
        outcome: result.noOp ? "no_op" : result.replayed ? "replayed" : "success",
      });
    } catch (e) {
      metrics.learningCourseAuthoring.inc({ operation: "update", outcome: errorOutcome(e) });
      next(e);
    } finally {
      stop();
    }
  });
  return router;
}
function context() {
  const c = currentRequestContext();
  if (!c) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
  return c;
}
async function verified(req: Request, v: (t: string) => Promise<ActorContext>, correlationId: string) {
  try {
    const a = await v(singleHeader(req, "x-actor-context", 4096));
    if (a.correlationId !== correlationId) throw new Error("MISMATCH");
    return a;
  } catch {
    throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid trusted actor context");
  }
}
function idempotency(req: Request) {
  try {
    return validateIdempotencyKey(singleHeader(req, "idempotency-key", 200));
  } catch {
    throw new AppError("INVALID_IDEMPOTENCY_KEY", 400, "A valid Idempotency-Key header is required");
  }
}
function singleHeader(req: Request, name: string, max: number) {
  const values: string[] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2)
    if (req.rawHeaders[i]?.toLowerCase() === name) values.push(req.rawHeaders[i + 1] ?? "");
  if (values.length !== 1 || !values[0] || values[0].length > max) throw new Error("HEADER_REJECTED");
  return values[0];
}
function parseBody<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ZodError)
      throw new AppError(
        "COURSE_VALIDATION_FAILED",
        422,
        "Course request validation failed",
        false,
        e.issues.map((i) => ({ field: i.path.join(".") || "body", reason: i.message })),
      );
    throw e;
  }
}
function meta(requestId: string, replayed: boolean, noOp: boolean) {
  return { requestId, timestamp: new Date().toISOString(), replayed, noOp };
}
function errorOutcome(error: unknown): string {
  return error instanceof AppError ? error.code : "internal_error";
}
