import { Router, type Request } from "express";
import { ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import { validateIdempotencyKey } from "../documents/model.js";
import { createQuizJobSchema, listSchema } from "./model.js";
import type { AiQuizService } from "./service.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export function aiQuizRouter(
  service: AiQuizService,
  verify: (token: string) => Promise<ActorContext>,
): Router {
  const r = Router();
  r.post("/api/v1/ai/quiz-jobs", async (q, s, n) => {
    try {
      const c = ctx(),
        a = await actor(q, verify, c.correlationId),
        result = await service.create({
          actor: a,
          body: parse(() => createQuizJobSchema.parse(q.body)),
          key: idem(q),
          correlationId: c.correlationId,
        });
      s.status(202).json({ data: result.body, meta: meta(c.requestId, result.replayed) });
    } catch (e) {
      n(e);
    }
  });
  r.get("/api/v1/ai/jobs", async (q, s, n) => {
    try {
      const c = ctx(),
        a = await actor(q, verify, c.correlationId),
        v = parse(() => listSchema.parse(q.query)),
        result = await service.list(a, v.state, v.month, v.limit, v.cursor);
      s.json({
        data: result.items,
        meta: {
          ...meta(c.requestId, false),
          ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
        },
      });
    } catch (e) {
      n(e);
    }
  });
  r.get("/api/v1/ai/jobs/:jobId", async (q, s, n) => {
    try {
      const c = ctx(),
        a = await actor(q, verify, c.correlationId);
      s.json({ data: await service.get(a, id(q.params.jobId)), meta: meta(c.requestId, false) });
    } catch (e) {
      n(e);
    }
  });
  r.get("/api/v1/ai/jobs/:jobId/drafts", async (q, s, n) => {
    try {
      const c = ctx(),
        a = await actor(q, verify, c.correlationId);
      s.json({ data: await service.drafts(a, id(q.params.jobId)), meta: meta(c.requestId, false) });
    } catch (e) {
      n(e);
    }
  });
  r.post("/api/v1/ai/jobs/:jobId/cancel", async (q, s, n) => {
    try {
      const c = ctx(),
        a = await actor(q, verify, c.correlationId);
      s.json({ data: await service.cancel(a, id(q.params.jobId)), meta: meta(c.requestId, false) });
    } catch (e) {
      n(e);
    }
  });
  r.get("/api/v1/ai/usage", async (q, s, n) => {
    try {
      const c = ctx(),
        a = await actor(q, verify, c.correlationId);
      s.json({ data: await service.quota(a, c.correlationId), meta: meta(c.requestId, false) });
    } catch (e) {
      n(e);
    }
  });
  return r;
}
function ctx() {
  const c = currentRequestContext();
  if (!c) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
  return c;
}
function id(v: string) {
  if (!uuid.test(v)) throw new AppError("INVALID_AI_ID", 400, "Invalid identifier");
  return v;
}
function one(q: Request, name: string, max: number) {
  const v: string[] = [];
  for (let i = 0; i < q.rawHeaders.length; i += 2)
    if (q.rawHeaders[i]?.toLowerCase() === name) v.push(q.rawHeaders[i + 1] ?? "");
  if (v.length !== 1 || !v[0] || v[0].length > max) throw new Error();
  return v[0];
}
async function actor(q: Request, verify: (v: string) => Promise<ActorContext>, correlationId: string) {
  try {
    const a = await verify(one(q, "x-actor-context", 4096));
    if (a.correlationId !== correlationId) throw new Error();
    return a;
  } catch {
    throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid trusted actor context");
  }
}
function idem(q: Request) {
  try {
    return validateIdempotencyKey(one(q, "idempotency-key", 200));
  } catch {
    throw new AppError("INVALID_IDEMPOTENCY_KEY", 400, "A valid Idempotency-Key is required");
  }
}
function parse<T>(fn: () => T) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ZodError)
      throw new AppError(
        "AI_VALIDATION_FAILED",
        422,
        "AI request validation failed",
        false,
        e.issues.map((i) => ({ field: i.path.join(".") || "body", reason: i.message })),
      );
    throw e;
  }
}
function meta(requestId: string, replayed: boolean) {
  return { requestId, timestamp: new Date().toISOString(), replayed };
}
