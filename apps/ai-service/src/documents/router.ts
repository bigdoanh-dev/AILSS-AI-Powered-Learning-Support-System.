import { Router, type Request } from "express";
import { ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import { completeSchema, intentSchema, validateIdempotencyKey } from "./model.js";
import type { AiDocumentService } from "./service.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export function aiDocumentRouter(
  service: AiDocumentService,
  verify: (token: string) => Promise<ActorContext>,
): Router {
  const router = Router();
  router.post("/api/v1/ai/documents/upload-intents", async (req, res, next) => {
    try {
      const ctx = context(),
        actor = await actorFrom(req, verify, ctx.correlationId),
        key = idem(req);
      const result = await service.intent({
        actor,
        body: parse(() => intentSchema.parse(req.body)),
        key,
        correlationId: ctx.correlationId,
      });
      res.status(201).json({ data: result.body, meta: meta(ctx.requestId, result.replayed) });
    } catch (e) {
      next(e);
    }
  });
  router.post("/api/v1/ai/documents/:documentId/complete", async (req, res, next) => {
    try {
      const ctx = context(),
        actor = await actorFrom(req, verify, ctx.correlationId),
        documentId = req.params.documentId;
      if (!uuid.test(documentId)) throw new AppError("INVALID_DOCUMENT_ID", 400, "Invalid documentId");
      const result = await service.complete({
        actor,
        documentId,
        body: parse(() => completeSchema.parse(req.body)),
        key: idem(req),
        correlationId: ctx.correlationId,
      });
      res.status(202).json({ data: result.body, meta: meta(ctx.requestId, result.replayed) });
    } catch (e) {
      next(e);
    }
  });
  router.get("/api/v1/ai/documents/:documentId", async (req, res, next) => {
    try {
      const ctx = context(),
        actor = await actorFrom(req, verify, ctx.correlationId),
        documentId = req.params.documentId;
      if (!uuid.test(documentId)) throw new AppError("INVALID_DOCUMENT_ID", 400, "Invalid documentId");
      res.status(200).json({ data: await service.read(actor, documentId), meta: meta(ctx.requestId, false) });
    } catch (e) {
      next(e);
    }
  });
  return router;
}
function context() {
  const c = currentRequestContext();
  if (!c) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
  return c;
}
async function actorFrom(
  req: Request,
  verify: (token: string) => Promise<ActorContext>,
  correlationId: string,
) {
  try {
    const a = await verify(single(req, "x-actor-context", 4096));
    if (a.correlationId !== correlationId) throw new Error();
    return a;
  } catch {
    throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid trusted actor context");
  }
}
function idem(req: Request) {
  try {
    return validateIdempotencyKey(single(req, "idempotency-key", 200));
  } catch {
    throw new AppError("INVALID_IDEMPOTENCY_KEY", 400, "A valid Idempotency-Key is required");
  }
}
function single(req: Request, name: string, max: number) {
  const values: string[] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2)
    if (req.rawHeaders[i]?.toLowerCase() === name) values.push(req.rawHeaders[i + 1] ?? "");
  if (values.length !== 1 || !values[0] || values[0].length > max) throw new Error();
  return values[0];
}
function parse<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof ZodError)
      throw new AppError(
        "DOCUMENT_VALIDATION_FAILED",
        422,
        "Document request validation failed",
        false,
        e.issues.map((i) => ({ field: i.path.join(".") || "body", reason: i.message })),
      );
    throw e;
  }
}
function meta(requestId: string, replayed: boolean) {
  return { requestId, timestamp: new Date().toISOString(), replayed };
}
