import { Router, type Request } from "express";
import { z, ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import { validateIdempotencyKey } from "../authoring/model.js";
import { parseCreateLesson, parsePatchLesson } from "./model.js";
import type { LearningLessonService } from "./service.js";

const uuid = z.string().uuid();

export function learningLessonRouter(
  service: LearningLessonService,
  verify: Readonly<Record<"list" | "read" | "create" | "update", (token: string) => Promise<ActorContext>>>,
  metrics: ReturnType<typeof createMetrics>,
): Router {
  const router = Router();
  router.get("/api/v1/courses/:courseId/lessons", async (req, res, next) => {
    try {
      const context = requireContext();
      const actor = await optionalActor(req, verify.list, context.correlationId);
      const result = await service.list({
        courseId: identifier(req.params.courseId, "INVALID_COURSE_ID"),
        ...(actor ? { actor } : {}),
        requestId: context.requestId,
      });
      res.status(200).json({ data: result.lessons, meta: meta(context.requestId, result.contentVersion) });
      void metrics;
    } catch (error) {
      next(error);
    }
  });
  router.post("/api/v1/courses/:courseId/lessons", async (req, res, next) => {
    try {
      const context = requireContext();
      const actor = await requiredActor(req, verify.create, context.correlationId);
      const result = await service.create({
        courseId: identifier(req.params.courseId, "INVALID_COURSE_ID"),
        actor,
        request: body(() => parseCreateLesson(req.body)),
        idempotencyKey: idempotency(req),
        requestId: context.requestId,
      });
      res
        .status(201)
        .json({ data: result.lesson, meta: { ...meta(context.requestId), replayed: result.replayed } });
    } catch (error) {
      next(error);
    }
  });
  router.get("/api/v1/lessons/:lessonId", async (req, res, next) => {
    try {
      const context = requireContext();
      const actor = await requiredActor(req, verify.read, context.correlationId);
      const result = await service.get({
        lessonId: identifier(req.params.lessonId, "INVALID_LESSON_ID"),
        actor,
      });
      res.status(200).json({ data: result, meta: meta(context.requestId) });
    } catch (error) {
      next(error);
    }
  });
  router.patch("/api/v1/lessons/:lessonId", async (req, res, next) => {
    try {
      const context = requireContext();
      const actor = await requiredActor(req, verify.update, context.correlationId);
      const result = await service.patch({
        lessonId: identifier(req.params.lessonId, "INVALID_LESSON_ID"),
        actor,
        request: body(() => parsePatchLesson(req.body)),
        idempotencyKey: idempotency(req),
        requestId: context.requestId,
      });
      res
        .status(200)
        .json({ data: result.lesson, meta: { ...meta(context.requestId), replayed: result.replayed } });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

function requireContext() {
  const context = currentRequestContext();
  if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
  return context;
}
function identifier(value: unknown, code: string) {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new AppError(code, 400, "Resource ID must be a UUID");
  return parsed.data;
}
async function optionalActor(
  req: Request,
  verify: (token: string) => Promise<ActorContext>,
  correlationId: string,
) {
  if (!req.header("x-actor-context")) return undefined;
  return requiredActor(req, verify, correlationId);
}
async function requiredActor(
  req: Request,
  verify: (token: string) => Promise<ActorContext>,
  correlationId: string,
) {
  try {
    const values = req.rawHeaders
      .map((value, index) => ({ value, index }))
      .filter(({ value, index }) => index % 2 === 0 && value.toLowerCase() === "x-actor-context");
    if (values.length !== 1) throw new Error("HEADER_REJECTED");
    const header = values[0];
    if (!header) throw new Error("HEADER_REJECTED");
    const token = req.rawHeaders[header.index + 1] ?? "";
    if (!token || token.length > 4096) throw new Error("HEADER_REJECTED");
    const actor = await verify(token);
    if (actor.correlationId !== correlationId) throw new Error("MISMATCH");
    return actor;
  } catch {
    throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid trusted actor context");
  }
}
function idempotency(req: Request) {
  try {
    const values: string[] = [];
    for (let index = 0; index < req.rawHeaders.length; index += 2)
      if (req.rawHeaders[index]?.toLowerCase() === "idempotency-key")
        values.push(req.rawHeaders[index + 1] ?? "");
    if (values.length !== 1) throw new Error("HEADER_REJECTED");
    return validateIdempotencyKey(values[0]);
  } catch {
    throw new AppError("INVALID_IDEMPOTENCY_KEY", 400, "A valid Idempotency-Key header is required");
  }
}
function body<T>(parse: () => T) {
  try {
    return parse();
  } catch (error) {
    if (error instanceof ZodError)
      throw new AppError(
        "LESSON_VALIDATION_FAILED",
        422,
        "Lesson request validation failed",
        false,
        error.issues.map((issue) => ({ field: issue.path.join(".") || "body", reason: issue.message })),
      );
    throw error;
  }
}
function meta(requestId: string, contentVersion?: number) {
  return { requestId, timestamp: new Date().toISOString(), ...(contentVersion ? { contentVersion } : {}) };
}
