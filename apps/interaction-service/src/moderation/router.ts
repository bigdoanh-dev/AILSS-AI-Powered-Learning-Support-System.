/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { Router, type Request } from "express";
import { z, ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import { createReportSchema, moderateSchema, reason } from "./model.js";
import type { ModerationService } from "./service.js";

export function moderationRouter(
  service: ModerationService,
  verifyActor: (token: string) => Promise<ActorContext>,
  verifyProof: (proof: string, reportId: string, adminId: string) => Promise<unknown>,
  audit: (record: Record<string, unknown>) => void,
): Router {
  const router = Router();
  router.post("/api/v1/reports", async (req, res, next) => {
    try {
      const context = ctx(),
        token = single(req, "x-actor-context"),
        actor = await verified(token, verifyActor, context.correlationId),
        parsed = createReportSchema.parse(req.body),
        result = await service.create({
          ...parsed,
          reason: reason(parsed.reason),
          key: key(req),
          actor,
          actorToken: token,
          correlationId: context.correlationId,
          requestId: context.requestId,
        });
      send(res, result);
    } catch (error) {
      next(map(error));
    }
  });
  router.get("/api/v1/admin/reports", async (req, res, next) => {
    try {
      const context = ctx(),
        actor = await verified(single(req, "x-actor-context"), verifyActor, context.correlationId),
        limit = parseLimit(req.query.limit),
        result = await service.list({
          actor,
          limit,
          ...(typeof req.query.cursor === "string" ? { cursor: req.query.cursor } : {}),
          requestId: context.requestId,
        });
      res.json(result);
    } catch (error) {
      next(map(error));
    }
  });
  router.post("/api/v1/admin/reports/:reportId/moderate", async (req, res, next) => {
    try {
      const context = ctx(),
        reportId = z.string().uuid().parse(req.params.reportId),
        actor = await verified(single(req, "x-actor-context"), verifyActor, context.correlationId),
        proof = single(req, "x-admin-step-up-proof"),
        parsed = moderateSchema.parse(req.body),
        result = await service.moderate({
          reportId,
          action: parsed.action,
          reason: reason(parsed.reason),
          expected: match(req),
          key: key(req),
          actor,
          proof,
          verifyProof: () => verifyProof(proof, reportId, actor.userId).then(() => undefined),
          correlationId: context.correlationId,
          requestId: context.requestId,
        });
      audit({
        auditAction: "INTERACTION_REPORT_MODERATE",
        actorId: actor.userId,
        reportId,
        result: "SUCCESS",
        correlationId: context.correlationId,
      });
      send(res, result);
    } catch (error) {
      const context = currentRequestContext();
      audit({
        auditAction: "INTERACTION_REPORT_MODERATE",
        reportId: req.params.reportId,
        result:
          error instanceof AppError && (error.status === 401 || error.status === 403) ? "DENIED" : "FAILURE",
        ...(context ? { correlationId: context.correlationId } : {}),
      });
      next(map(error));
    }
  });
  return router;
}
const ctx = () => {
    const value = currentRequestContext();
    if (!value) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
    return value;
  },
  headers = (r: Request, name: string) =>
    r.rawHeaders.flatMap((v, i) =>
      i % 2 === 0 && v.toLowerCase() === name ? [r.rawHeaders[i + 1] ?? ""] : [],
    ),
  single = (r: Request, name: string) => {
    const values = headers(r, name);
    if (values.length !== 1 || !values[0])
      throw new AppError(
        name === "x-actor-context" ? "INVALID_ACCESS_TOKEN" : "INVALID_STEP_UP_PROOF",
        401,
        "Required authorization missing",
      );
    return values[0];
  },
  key = (r: Request) => {
    const values = headers(r, "idempotency-key");
    if (values.length !== 1 || !values[0] || values[0].length > 128)
      throw new AppError("INVALID_IDEMPOTENCY_KEY", 400, "Idempotency-Key required");
    return values[0];
  },
  match = (r: Request) => {
    const value = single(r, "if-match"),
      m = /^"v([1-9][0-9]*)"$/u.exec(value);
    if (!m) throw new AppError("INVALID_IF_MATCH", 400, "If-Match required");
    return Number(m[1]);
  },
  parseLimit = (value: unknown) => {
    const n = value === undefined ? 20 : Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 100) throw new AppError("INVALID_LIMIT", 400, "Invalid limit");
    return n;
  },
  verified = async (token: string, verify: (v: string) => Promise<ActorContext>, correlationId: string) => {
    try {
      const actor = await verify(token);
      if (actor.correlationId !== correlationId) throw new Error("CORRELATION_MISMATCH");
      return actor;
    } catch {
      throw new AppError("INVALID_ACCESS_TOKEN", 401, "Invalid access token");
    }
  },
  send = (res: any, result: any) =>
    res
      .set("etag", `"v${String(result.version)}"`)
      .status(result.status)
      .type("json")
      .send(result.body),
  map = (error: unknown) =>
    error instanceof AppError
      ? error
      : error instanceof ZodError ||
          (error instanceof Error &&
            (error.message === "INVALID_REPORT_REASON" || error.message === "INVALID_COMMENT_BODY"))
        ? new AppError("REPORT_VALIDATION_FAILED", 422, "Report validation failed")
        : new AppError("MODERATION_UNAVAILABLE", 503, "Moderation temporarily unavailable", true);
