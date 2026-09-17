import { Router, type Request } from "express";
import { z, ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../packages/http/src/index.js";
import type { createMetrics } from "../../../packages/observability/src/index.js";
import type { ActorContext } from "../../../packages/security/src/index.js";
import {
  parseAttemptSubmit,
  parseManualGrade,
  parseQuizCreate,
  parseQuizPatch,
  parseResultListQuery,
  validateIdempotencyKey,
} from "./model.js";
import type { AssessmentService } from "./service.js";

type Verifier = (token: string) => Promise<ActorContext>;

export function assessmentRouter(
  service: AssessmentService,
  verify: Record<
    | "create"
    | "detail"
    | "update"
    | "publish"
    | "list"
    | "attemptStart"
    | "attemptDetail"
    | "submit"
    | "result"
    | "results"
    | "gradeAttempt"
    | "listGrades",
    Verifier
  >,
  metrics: ReturnType<typeof createMetrics>,
): Router {
  const router = Router();
  router.post("/api/v1/quizzes", async (request, response, next) => {
    const stop = metrics.assessmentQuizLatency.startTimer({ operation: "create" });
    try {
      const context = requiredContext(),
        actor = await verified(request, verify.create, context.correlationId),
        result = await service.create({
          actor,
          request: body(() => parseQuizCreate(request.body)),
          idempotencyKey: idempotency(request),
          requestId: context.requestId,
        });
      response.status(201).json({ data: result.quiz, meta: meta(context.requestId, result) });
      metrics.assessmentQuizOperations.inc({
        operation: "create",
        outcome: result.replayed ? "replayed" : "success",
      });
    } catch (error) {
      metrics.assessmentQuizOperations.inc({ operation: "create", outcome: errorOutcome(error) });
      next(error);
    } finally {
      stop();
    }
  });
  router.get("/api/v1/quizzes/:quizId", async (request, response, next) => {
    const stop = metrics.assessmentQuizLatency.startTimer({ operation: "detail" });
    try {
      const context = requiredContext(),
        actor = await verified(request, verify.detail, context.correlationId),
        quizId = resourceId(request.params.quizId, "quizId");
      response.status(200).json({
        data: await service.detail(quizId, actor, context.requestId),
        meta: meta(context.requestId),
      });
      metrics.assessmentQuizOperations.inc({ operation: "detail", outcome: "success" });
    } catch (error) {
      metrics.assessmentQuizOperations.inc({ operation: "detail", outcome: errorOutcome(error) });
      next(error);
    } finally {
      stop();
    }
  });
  router.patch("/api/v1/quizzes/:quizId", async (request, response, next) => {
    const stop = metrics.assessmentQuizLatency.startTimer({ operation: "update" });
    try {
      const context = requiredContext(),
        actor = await verified(request, verify.update, context.correlationId),
        result = await service.update({
          actor,
          quizId: resourceId(request.params.quizId, "quizId"),
          request: body(() => parseQuizPatch(request.body)),
          idempotencyKey: idempotency(request),
          requestId: context.requestId,
        });
      response.status(200).json({ data: result.quiz, meta: meta(context.requestId, result) });
      metrics.assessmentQuizOperations.inc({
        operation: "update",
        outcome: result.replayed ? "replayed" : result.noOp ? "no_op" : "success",
      });
    } catch (error) {
      metrics.assessmentQuizOperations.inc({ operation: "update", outcome: errorOutcome(error) });
      next(error);
    } finally {
      stop();
    }
  });
  router.post("/api/v1/quizzes/:quizId/publish", async (request, response, next) => {
    const stop = metrics.assessmentQuizLatency.startTimer({ operation: "publish" });
    try {
      const context = requiredContext(),
        actor = await verified(request, verify.publish, context.correlationId),
        result = await service.publish({
          actor,
          quizId: resourceId(request.params.quizId, "quizId"),
          idempotencyKey: idempotency(request),
          requestId: context.requestId,
        });
      response.status(200).json({ data: result.quiz, meta: meta(context.requestId, result) });
      metrics.assessmentQuizOperations.inc({
        operation: "publish",
        outcome: result.replayed ? "replayed" : "success",
      });
    } catch (error) {
      metrics.assessmentQuizOperations.inc({ operation: "publish", outcome: errorOutcome(error) });
      next(error);
    } finally {
      stop();
    }
  });
  router.get("/api/v1/targets/:targetType/:targetId/quizzes", async (request, response, next) => {
    const stop = metrics.assessmentQuizLatency.startTimer({ operation: "list" });
    try {
      const context = requiredContext(),
        actor = await verified(request, verify.list, context.correlationId),
        targetType = body(() => z.enum(["COURSE", "CLASS"]).parse(request.params.targetType)),
        targetId = resourceId(request.params.targetId, "targetId");
      response.status(200).json({
        data: await service.list(targetType, targetId, actor, context.requestId),
        meta: meta(context.requestId),
      });
      metrics.assessmentQuizOperations.inc({ operation: "list", outcome: "success" });
    } catch (error) {
      metrics.assessmentQuizOperations.inc({ operation: "list", outcome: errorOutcome(error) });
      next(error);
    } finally {
      stop();
    }
  });
  router.post("/api/v1/quizzes/:quizId/attempts", async (request, response, next) => {
    try {
      const context = requiredContext(),
        token = singleHeader(request, "x-actor-context", 4096),
        actor = await verified(request, verify.attemptStart, context.correlationId),
        result = await service.startAttempt({
          actor,
          actorContext: token,
          quizId: resourceId(request.params.quizId, "quizId"),
          idempotencyKey: idempotency(request),
          requestId: context.requestId,
        });
      response.status(201).json({
        data: { ...result.attempt, questions: result.questions },
        meta: { ...meta(context.requestId), replayed: result.replayed },
      });
    } catch (error) {
      next(error);
    }
  });
  router.get("/api/v1/attempts/:attemptId", async (request, response, next) => {
    try {
      const context = requiredContext(),
        actor = await verified(request, verify.attemptDetail, context.correlationId);
      response.status(200).json({
        data: await service.attemptDetail(resourceId(request.params.attemptId, "attemptId"), actor),
        meta: meta(context.requestId),
      });
    } catch (error) {
      next(error);
    }
  });
  router.post("/api/v1/attempts/:attemptId/submit", async (request, response, next) => {
    const serverReceivedAt = new Date();
    try {
      const context = requiredContext(),
        actor = await verified(request, verify.submit, context.correlationId),
        result = await service.submit({
          actor,
          attemptId: resourceId(request.params.attemptId, "attemptId"),
          request: body(() => parseAttemptSubmit(request.body)),
          idempotencyKey: idempotency(request),
          serverReceivedAt,
        });
      response.status(202).json({
        data: {
          attemptId: result.attemptId,
          score: result.score,
          maxScore: result.maxScore,
          resultVersion: result.resultVersion,
        },
        meta: { ...meta(context.requestId), replayed: result.replayed },
      });
    } catch (error) {
      next(error);
    }
  });
  router.get("/api/v1/attempts/:attemptId/result", async (request, response, next) => {
    try {
      const context = requiredContext(),
        actor = await verified(request, verify.result, context.correlationId);
      response.status(200).json({
        data: await service.resultSummary(resourceId(request.params.attemptId, "attemptId"), actor),
        meta: meta(context.requestId),
      });
    } catch (error) {
      next(error);
    }
  });
  router.get("/api/v1/quizzes/:quizId/results", async (request, response, next) => {
    try {
      const context = requiredContext(),
        actor = await verified(request, verify.results, context.correlationId),
        query = resultQuery(request.query);
      response.status(200).json({
        data: await service.quizResults({
          actor,
          quizId: resourceId(request.params.quizId, "quizId"),
          month: query.month,
          limit: query.limit,
          ...(query.cursor ? { cursor: query.cursor } : {}),
          requestId: context.requestId,
        }),
        meta: meta(context.requestId),
      });
    } catch (error) {
      next(error);
    }
  });
  router.post("/api/v1/quizzes/:quizId/grades/:attemptId", async (request, response, next) => {
    try {
      const context = requiredContext(),
        actor = await verified(request, verify.gradeAttempt, context.correlationId),
        quizId = resourceId(request.params.quizId, "quizId"),
        attemptId = resourceId(request.params.attemptId, "attemptId"),
        reqBody = body(() => parseManualGrade(request.body)),
        result = await service.gradeAttempt({
          actor,
          quizId,
          attemptId,
          request: reqBody,
          requestId: context.requestId,
        });
      response.status(200).json({ data: result, meta: meta(context.requestId) });
    } catch (error) {
      next(error);
    }
  });
  router.get("/api/v1/quizzes/:quizId/grades", async (request, response, next) => {
    try {
      const context = requiredContext(),
        actor = await verified(request, verify.listGrades, context.correlationId),
        quizId = resourceId(request.params.quizId, "quizId"),
        month = typeof request.query.month === "string" ? request.query.month : undefined,
        limit = typeof request.query.limit === "string" ? Number(request.query.limit) : undefined;
      response.status(200).json({
        data: await service.listGrades({
          quizId,
          ...(month ? { month } : {}),
          ...(limit !== undefined && !Number.isNaN(limit) ? { limit } : {}),
          actor,
          requestId: context.requestId,
        }),
        meta: meta(context.requestId),
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

function errorOutcome(error: unknown): string {
  if (!(error instanceof AppError)) return "dependency_failure";
  if (error.status === 401) return "unauthorized";
  if (error.status === 403) return "forbidden";
  if (error.status === 404) return "not_found";
  if (error.status === 409) return "conflict";
  if (error.status === 422 || error.status === 400) return "invalid";
  return "dependency_failure";
}

function requiredContext() {
  const context = currentRequestContext();
  if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
  return context;
}

async function verified(request: Request, verifier: Verifier, correlationId: string) {
  try {
    const actor = await verifier(singleHeader(request, "x-actor-context", 4096));
    if (actor.correlationId !== correlationId) throw new Error("CORRELATION_MISMATCH");
    return actor;
  } catch {
    throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid trusted actor context");
  }
}

function resourceId(value: string | string[] | undefined, name: string): string {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new AppError("INVALID_RESOURCE_ID", 400, `${name} must be a UUID`);
  return parsed.data;
}

function idempotency(request: Request): string {
  try {
    return validateIdempotencyKey(singleHeader(request, "idempotency-key", 200));
  } catch {
    throw new AppError("INVALID_IDEMPOTENCY_KEY", 400, "A valid Idempotency-Key header is required");
  }
}

function singleHeader(request: Request, name: string, max: number): string {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2)
    if (request.rawHeaders[index]?.toLowerCase() === name) values.push(request.rawHeaders[index + 1] ?? "");
  if (values.length !== 1 || !values[0] || values[0].length > max) throw new Error("HEADER_REJECTED");
  return values[0];
}

function body<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (error instanceof ZodError)
      throw new AppError(
        "QUIZ_VALIDATION_FAILED",
        422,
        "Quiz request validation failed",
        false,
        error.issues.map((issue) => ({
          field: issue.path.join(".") || "body",
          reason: issue.message,
        })),
      );
    throw error;
  }
}

function resultQuery(value: unknown) {
  try {
    return parseResultListQuery(value);
  } catch (error) {
    if (error instanceof ZodError)
      throw new AppError(
        "INVALID_RESULT_QUERY",
        400,
        "A valid month, limit and cursor are required",
        false,
        error.issues.map((issue) => ({
          field: issue.path.join(".") || "query",
          reason: issue.message,
        })),
      );
    throw error;
  }
}

function meta(requestId: string, result?: { replayed: boolean; noOp: boolean }) {
  return {
    requestId,
    timestamp: new Date().toISOString(),
    ...(result ? { replayed: result.replayed, noOp: result.noOp } : {}),
  };
}
