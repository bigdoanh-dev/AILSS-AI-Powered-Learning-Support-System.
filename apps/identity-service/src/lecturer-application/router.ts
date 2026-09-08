import { Router } from "express";
import { z } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import { validateIdempotencyKey } from "../registration/model.js";
import { applicationBodySchema, decisionSchema, listSchema, unavailable, type Decision } from "./model.js";
import type { ApplicationService } from "./service.js";
export function applicationRouter(
  service: ApplicationService,
  verify: (token: string, purpose: string) => Promise<ActorContext>,
  proof: (token: string, actor: ActorContext, id: string, decision: Decision) => Promise<void>,
): Router {
  const router = Router();
  const routes = [
    ["post", "/api/v1/lecturer-applications", "submit"],
    ["get", "/api/v1/me/lecturer-application", "mine"],
    ["get", "/api/v1/admin/lecturer-applications", "list"],
    ["get", "/api/v1/admin/lecturer-applications/:applicationId", "detail"],
    ["post", "/api/v1/admin/lecturer-applications/:applicationId/decision", "decision"],
  ] as const;
  for (const [method, path, action] of routes)
    router[method](path, async (req, res, next) => {
      try {
        const ctx = currentRequestContext();
        if (!ctx) throw unavailable();
        let actor: ActorContext;
        try {
          const headers = req.rawHeaders.filter(
            (v, i) => i % 2 === 0 && v.toLowerCase() === "x-actor-context",
          );
          const token = req.header("x-actor-context");
          if (headers.length !== 1 || !token || token.length > 4096) throw Error();
          actor = await verify(token, `identity.lecturer-application.${action}`);
          if (actor.correlationId !== ctx.correlationId) throw Error();
        } catch {
          throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid actor context");
        }
        if (action !== "list" && Object.keys(req.query).length)
          throw new AppError("APPLICATION_INVALID_REQUEST", 422, "Unknown query properties");
        if (method === "get" && req.body !== undefined && Object.keys(req.body as object).length)
          throw new AppError("APPLICATION_INVALID_REQUEST", 422, "Read body not allowed");
        let key = "";
        if (method === "post") {
          try {
            key = validateIdempotencyKey(req.header("idempotency-key"));
          } catch {
            throw new AppError("INVALID_IDEMPOTENCY_KEY", 400, "Valid Idempotency-Key required");
          }
        }
        let data: unknown;
        if (action === "submit")
          data = await service.submit(actor, applicationBodySchema.parse(req.body), key, ctx.requestId);
        else if (action === "mine") data = await service.mine(actor);
        else if (action === "list") data = await service.list(actor, listSchema.parse(req.query));
        else {
          const parsedId = z
            .string()
            .uuid()
            .safeParse((req.params as Record<string, string>).applicationId);
          if (!parsedId.success)
            throw new AppError("APPLICATION_INVALID_REQUEST", 400, "Invalid application ID");
          const id = parsedId.data;
          if (action === "detail") data = await service.detail(actor, id);
          else {
            const body = decisionSchema.parse(req.body);
            try {
              await proof(req.header("x-admin-step-up-proof") ?? "", actor, id, body.decision);
            } catch {
              throw new AppError("ADMIN_STEP_UP_FAILED", 401, "Current-password reauthentication required");
            }
            data = await service.decide(actor, id, body.decision, key, ctx.requestId);
          }
        }
        let meta = { requestId: ctx.requestId, timestamp: new Date().toISOString() };
        if (action === "submit" || action === "decision") {
          const scope =
            action === "submit"
              ? `lecturer-application:submit:${actor.userId}`
              : `lecturer-application:decision:${actor.userId}:${String((req.params as Record<string, string>).applicationId)}`;
          const historical = await service.store.command(scope, key);
          if (!historical?.result) throw unavailable();
          meta = { requestId: historical.requestId, timestamp: historical.createdAt };
        }
        res.setHeader("Cache-Control", "no-store");
        res.status(action === "submit" ? 201 : 200).json({ data, meta });
      } catch (error) {
        next(
          error instanceof z.ZodError
            ? new AppError("APPLICATION_INVALID_REQUEST", 422, "Invalid application request")
            : error instanceof AppError
              ? error
              : unavailable(),
        );
      }
    });
  return router;
}
