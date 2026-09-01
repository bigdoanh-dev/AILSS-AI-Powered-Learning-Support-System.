import { Router, type Request } from "express";
import { ZodError, z } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import { validateIdempotencyKey } from "../authoring/model.js";
import { completionSchema } from "./model.js";
import type { LearningProgressService } from "./service.js";

export function learningProgressRouter(
  service: LearningProgressService,
  verify: Record<"read" | "complete", (token: string) => Promise<ActorContext>>,
): Router {
  const r = Router();
  r.get("/api/v1/courses/:courseId/progress", async (req, res, next) => {
    try {
      const c = context(),
        actor = await requiredActor(req, verify.read, c.correlationId);
      res
        .status(200)
        .json({ data: await service.read(id(req.params.courseId), actor), meta: meta(c.requestId) });
    } catch (e) {
      next(e);
    }
  });
  r.put("/api/v1/lessons/:lessonId/completion", async (req, res, next) => {
    try {
      const c = context(),
        a = await requiredActor(req, verify.complete, c.correlationId),
        result = await service.complete({
          lessonId: id(req.params.lessonId),
          request: completionSchema.parse(req.body),
          key: key(req),
          actor: a,
          correlationId: c.correlationId,
        });
      res.status(200).json({
        data: result.data,
        meta: { ...meta(c.requestId), replayed: result.replayed, noOp: result.noOp },
      });
    } catch (e) {
      next(
        e instanceof ZodError
          ? new AppError("PROGRESS_VALIDATION_FAILED", 422, "Progress request validation failed")
          : e,
      );
    }
  });
  return r;
}
const context = () => {
  const c = currentRequestContext();
  if (!c) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
  return c;
};
const id = (v: unknown) => {
  const p = z.string().uuid().safeParse(v);
  if (!p.success) throw new AppError("INVALID_RESOURCE_ID", 400, "Resource ID must be a UUID");
  return p.data;
};
async function requiredActor(
  req: Request,
  verify: (t: string) => Promise<ActorContext>,
  correlationId: string,
) {
  try {
    const values = headers(req, "x-actor-context");
    if (values.length !== 1 || !values[0]) throw new Error();
    const a = await verify(values[0]);
    if (a.correlationId !== correlationId) throw new Error();
    return a;
  } catch {
    throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid trusted actor context");
  }
}
const key = (req: Request) => {
  try {
    const v = headers(req, "idempotency-key");
    if (v.length !== 1) throw new Error();
    return validateIdempotencyKey(v[0]);
  } catch {
    throw new AppError("INVALID_IDEMPOTENCY_KEY", 400, "A valid Idempotency-Key header is required");
  }
};
const headers = (req: Request, n: string) =>
  req.rawHeaders.flatMap((v, i) =>
    i % 2 === 0 && v.toLowerCase() === n ? [req.rawHeaders[i + 1] ?? ""] : [],
  );
const meta = (requestId: string) => ({ requestId, timestamp: new Date().toISOString() });
