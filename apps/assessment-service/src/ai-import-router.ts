import { Router, type Request } from "express";
import type { JWTPayload } from "jose";
import { ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../packages/http/src/index.js";
import type { ActorContext } from "../../../packages/security/src/index.js";
import { aiDraftImportSchema } from "./model.js";
import type { AssessmentService } from "./service.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function assessmentAiImportRouter(
  service: AssessmentService,
  verifyService: (token: string) => Promise<JWTPayload>,
  verifyActor: (token: string) => Promise<ActorContext>,
  afterCommit?: (draftId: string, replayed: boolean) => Promise<void>,
): Router {
  const router = Router();
  router.post("/internal/v1/ai-drafts/:id/import", async (request, response, next) => {
    try {
      const context = currentRequestContext();
      if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
      const draftId = request.params.id;
      if (!uuid.test(draftId)) throw new AppError("INVALID_AI_DRAFT_ID", 400, "Invalid draft identifier");
      let claims: JWTPayload, actor: ActorContext;
      try {
        claims = await verifyService(serviceAuthorization(request));
        actor = await verifyActor(singleHeader(request, "x-actor-context", 4096));
      } catch {
        throw new AppError("INVALID_INTERNAL_AUTHORITY", 401, "Invalid service or actor authority");
      }
      if (claims.sub !== "ai-service" || actor.correlationId !== context.correlationId)
        throw new AppError("INVALID_INTERNAL_AUTHORITY", 403, "Invalid service or actor binding");
      let parsed;
      try {
        parsed = aiDraftImportSchema.parse(request.body);
      } catch (error) {
        if (error instanceof ZodError)
          throw new AppError(
            "AI_IMPORT_INVALID",
            422,
            "Invalid objective-v1 import",
            false,
            error.issues.map((issue) => ({ field: issue.path.join(".") || "body", reason: issue.message })),
          );
        throw error;
      }
      const key = singleHeader(request, "idempotency-key", 200);
      if (key !== parsed.importOperationId)
        throw new AppError("IDEMPOTENCY_KEY_MISMATCH", 400, "Idempotency-Key must equal importOperationId");
      const result = await service.importAiDraft({
        actor,
        draftId,
        request: parsed,
        requestId: context.requestId,
      });
      await afterCommit?.(draftId, result.replayed);
      response.status(200).json({ data: result.result });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

function singleHeader(request: Request, name: string, max: number): string {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2)
    if (request.rawHeaders[index]?.toLowerCase() === name) values.push(request.rawHeaders[index + 1] ?? "");
  if (values.length !== 1 || !values[0] || values[0].length > max)
    throw new Error("INVALID_HEADER_CARDINALITY");
  return values[0];
}

function serviceAuthorization(request: Request): string {
  const value = singleHeader(request, "authorization", 4096);
  if (!value.startsWith("Service ") || value.length <= 8) throw new Error("INVALID_SERVICE_AUTHORIZATION");
  return value.slice(8);
}
