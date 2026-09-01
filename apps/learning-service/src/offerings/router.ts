import { Router, type Request } from "express";
import { z, ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import { validateIdempotencyKey } from "../authoring/model.js";
import { offeringTypes, parseOfferingPatch, parseOfferingWrite } from "./model.js";
import type { LearningOfferingService } from "./service.js";

const id = z.string().uuid();
export function learningOfferingRouter(
  service: LearningOfferingService,
  verify: Record<
    "catalog" | "detail" | "create" | "update" | "publish" | "course" | "owned",
    (token: string) => Promise<ActorContext>
  >,
): Router {
  const r = Router();
  r.get("/api/v1/offerings", async (req, res, next) => {
    try {
      const c = context();
      await optionalActor(req, verify.catalog, c.correlationId);
      const type = z.enum(offeringTypes).safeParse(req.query.type);
      if (!type.success)
        throw new AppError("OFFERING_TYPE_REQUIRED", 400, "A valid type query parameter is required");
      const limit = bounded(req.query.limit);
      const result = await service.catalog({
        type: type.data,
        limit,
        ...(typeof req.query.cursor === "string" ? { cursor: req.query.cursor } : {}),
      });
      res.status(200).json({ data: result.items, meta: meta(c.requestId, result.nextCursor) });
    } catch (e) {
      next(e);
    }
  });
  r.get("/api/v1/offerings/:offeringId", async (req, res, next) => {
    try {
      const c = context();
      await optionalActor(req, verify.detail, c.correlationId);
      res
        .status(200)
        .json({ data: await service.detail(identifier(req.params.offeringId)), meta: meta(c.requestId) });
    } catch (e) {
      next(e);
    }
  });
  r.post("/api/v1/courses/:courseId/offerings", async (req, res, next) => {
    try {
      const c = context(),
        actor = await requiredActor(req, verify.create, c.correlationId);
      const result = await service.create({
        courseId: identifier(req.params.courseId),
        actor,
        request: body(() => parseOfferingWrite(req.body)),
        idempotencyKey: idempotency(req),
        requestId: c.requestId,
      });
      res
        .status(201)
        .json({ data: result.offering, meta: { ...meta(c.requestId), replayed: result.replayed } });
    } catch (e) {
      next(e);
    }
  });
  r.patch("/api/v1/offerings/:offeringId", async (req, res, next) => {
    try {
      const c = context(),
        actor = await requiredActor(req, verify.update, c.correlationId);
      const result = await service.patch({
        offeringId: identifier(req.params.offeringId),
        actor,
        request: body(() => parseOfferingPatch(req.body)),
        idempotencyKey: idempotency(req),
        requestId: c.requestId,
      });
      res.status(200).json({
        data: result.offering,
        meta: { ...meta(c.requestId), replayed: result.replayed, noOp: result.noOp },
      });
    } catch (e) {
      next(e);
    }
  });
  r.post("/api/v1/offerings/:offeringId/publish", async (req, res, next) => {
    try {
      const c = context(),
        actor = await requiredActor(req, verify.publish, c.correlationId);
      strictEmpty(req.body);
      const result = await service.publish({
        offeringId: identifier(req.params.offeringId),
        actor,
        idempotencyKey: idempotency(req),
        requestId: c.requestId,
      });
      res
        .status(200)
        .json({ data: result.offering, meta: { ...meta(c.requestId), replayed: result.replayed } });
    } catch (e) {
      next(e);
    }
  });
  r.get("/api/v1/courses/:courseId/offerings", async (req, res, next) => {
    try {
      const c = context(),
        actor = await optionalActor(req, verify.course, c.correlationId);
      const items = await service.byCourse({
        courseId: identifier(req.params.courseId),
        ...(actor ? { actor } : {}),
        requestId: c.requestId,
      });
      res.status(200).json({ data: items, meta: meta(c.requestId) });
    } catch (e) {
      next(e);
    }
  });
  r.get("/api/v1/me/owned-offerings", async (req, res, next) => {
    try {
      const c = context(),
        actor = await requiredActor(req, verify.owned, c.correlationId);
      res
        .status(200)
        .json({ data: await service.owned({ actor, requestId: c.requestId }), meta: meta(c.requestId) });
    } catch (e) {
      next(e);
    }
  });
  return r;
}
function context() {
  const c = currentRequestContext();
  if (!c) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
  return c;
}
function identifier(v: unknown) {
  const p = id.safeParse(v);
  if (!p.success) throw new AppError("INVALID_OFFERING_ID", 400, "Resource ID must be a UUID");
  return p.data;
}
async function optionalActor(
  req: Request,
  verify: (t: string) => Promise<ActorContext>,
  correlationId: string,
) {
  return req.header("x-actor-context") ? requiredActor(req, verify, correlationId) : undefined;
}
async function requiredActor(
  req: Request,
  verify: (t: string) => Promise<ActorContext>,
  correlationId: string,
) {
  try {
    const values: string[] = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2)
      if (req.rawHeaders[i]?.toLowerCase() === "x-actor-context") values.push(req.rawHeaders[i + 1] ?? "");
    if (values.length !== 1 || !values[0] || values[0].length > 4096) throw new Error();
    const actor = await verify(values[0]);
    if (actor.correlationId !== correlationId) throw new Error();
    return actor;
  } catch {
    throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid trusted actor context");
  }
}
function idempotency(req: Request) {
  try {
    const values: string[] = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2)
      if (req.rawHeaders[i]?.toLowerCase() === "idempotency-key") values.push(req.rawHeaders[i + 1] ?? "");
    if (values.length !== 1) throw new Error();
    return validateIdempotencyKey(values[0]);
  } catch {
    throw new AppError("INVALID_IDEMPOTENCY_KEY", 400, "A valid Idempotency-Key header is required");
  }
}
function body<T>(fn: () => T) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ZodError)
      throw new AppError(
        "OFFERING_VALIDATION_FAILED",
        422,
        "Offering request validation failed",
        false,
        e.issues.map((i) => ({ field: i.path.join(".") || "body", reason: i.message })),
      );
    if (e instanceof Error && e.message === "INVALID_SALES_WINDOW")
      throw new AppError("OFFERING_VALIDATION_FAILED", 422, "salesStartAt must be before salesEndAt");
    throw e;
  }
}
function strictEmpty(v: unknown) {
  if (v === undefined) return;
  if (v === null || typeof v !== "object" || Array.isArray(v) || Object.keys(v).length)
    throw new AppError("OFFERING_VALIDATION_FAILED", 422, "Request body must be an empty object");
}
function bounded(v: unknown) {
  if (v === undefined) return 20;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 50)
    throw new AppError("INVALID_LIMIT", 400, "limit must be between 1 and 50");
  return n;
}
function meta(requestId: string, nextCursor?: string) {
  return { requestId, timestamp: new Date().toISOString(), ...(nextCursor ? { nextCursor } : {}) };
}
