import { Router, type Request } from "express";
import { z, ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import { StudyPlanService } from "./study-plan-service.js";
import type { AdaptiveRuntimeRepository } from "./runtime-repository.js";
import type { AuthoritativePlanContextProvider } from "./plan-context.js";

const courseQuery = z.object({ courseId: z.string().uuid() });
const generateBody = z.object({ courseId: z.string().uuid(), availableHoursPerWeek: z.number().min(1).max(80).default(7) });
const updateBody = z.object({ courseId: z.string().uuid(), status: z.enum(["ACCEPTED", "SKIPPED", "RESCHEDULED", "COMPLETED", "REPLACED"]), scheduledDate: z.string().date().optional() }).superRefine((v, ctx) => {
  if (v.status === "RESCHEDULED" && !v.scheduledDate) ctx.addIssue({ code: "custom", message: "scheduledDate is required when rescheduling" });
});

export function adaptiveRuntimeRouter(repository: AdaptiveRuntimeRepository, verify: (token: string) => Promise<ActorContext>, contextProvider: AuthoritativePlanContextProvider): Router {
  const router = Router();
  const generator = new StudyPlanService();
  router.get("/api/v1/mastery/me", async (req, res, next) => {
    try { const context = requestContext(); const actor = await student(req, verify, context.correlationId); const { courseId } = courseQuery.parse(req.query); res.json({ data: await repository.mastery(actor.userId, courseId), meta: meta(context.requestId) }); } catch (error) { next(map(error)); }
  });
  router.get("/api/v1/mastery/courses/:courseId", async (req, res, next) => {
    try { const context = requestContext(); const actor = await student(req, verify, context.correlationId); const courseId = z.string().uuid().parse(req.params.courseId); res.json({ data: await repository.mastery(actor.userId, courseId), meta: meta(context.requestId) }); } catch (error) { next(map(error)); }
  });
  router.get("/api/v1/mastery/outcomes/:outcomeId", async (req, res, next) => {
    try { const context = requestContext(); const actor = await student(req, verify, context.correlationId); const { courseId } = courseQuery.parse(req.query); const outcomeId = z.string().min(1).max(200).parse(req.params.outcomeId); const records = await repository.mastery(actor.userId, courseId); res.json({ data: records.filter((record) => record.learningOutcomeId === outcomeId), meta: meta(context.requestId) }); } catch (error) { next(map(error)); }
  });
  router.post("/api/v1/study-plan/generate", async (req, res, next) => {
    try { const context = requestContext(); const actor = await student(req, verify, context.correlationId); const input = generateBody.parse(req.body); const records = await repository.mastery(actor.userId, input.courseId); if (!records[0]) throw new AppError("MASTERY_EVIDENCE_REQUIRED", 409, "A study plan cannot be generated before mastery evidence exists"); const planContext = await contextProvider.load(input.courseId); const plan = generator.generateStudyPlan({ studentId: actor.userId, tenantId: records[0].tenantId, courseId: input.courseId, availableHoursPerWeek: input.availableHoursPerWeek, masteryRecords: records, ...planContext }); await repository.savePlan(plan); res.status(201).json({ data: plan, meta: meta(context.requestId) }); } catch (error) { next(map(error)); }
  });
  router.get("/api/v1/study-plan/current", async (req, res, next) => {
    try { const context = requestContext(); const actor = await student(req, verify, context.correlationId); const { courseId } = courseQuery.parse(req.query); const plan = await repository.currentPlan(actor.userId, courseId); if (!plan) throw new AppError("STUDY_PLAN_NOT_FOUND", 404, "No generated study plan exists for this course"); res.json({ data: plan, meta: meta(context.requestId) }); } catch (error) { next(map(error)); }
  });
  router.patch("/api/v1/study-plan/items/:itemId", async (req, res, next) => {
    try { const context = requestContext(); const actor = await student(req, verify, context.correlationId); const input = updateBody.parse(req.body); const itemId = z.string().uuid().parse(req.params.itemId); const item = await repository.updateItem(actor.userId, input.courseId, itemId, input.status, input.scheduledDate); if (!item) throw new AppError("STUDY_PLAN_ITEM_NOT_FOUND", 404, "Study plan item not found"); res.json({ data: item, meta: meta(context.requestId) }); } catch (error) { next(map(error)); }
  });
  for (const [path, status] of [["accept", "ACCEPTED"], ["skip", "SKIPPED"], ["complete", "COMPLETED"], ["alternative", "REPLACED"]] as const) {
    router.post(`/api/v1/study-plan/items/:itemId/${path}`, async (req, res, next) => {
      try { const context = requestContext(); const actor = await student(req, verify, context.correlationId); const { courseId } = courseQuery.parse(req.body); const itemId = z.string().uuid().parse(req.params.itemId); const item = await repository.updateItem(actor.userId, courseId, itemId, status); if (!item) throw new AppError("STUDY_PLAN_ITEM_NOT_FOUND", 404, "Study plan item not found"); res.json({ data: item, meta: meta(context.requestId) }); } catch (error) { next(map(error)); }
    });
  }
  router.post("/api/v1/study-plan/items/:itemId/reschedule", async (req, res, next) => {
    try { const context = requestContext(); const actor = await student(req, verify, context.correlationId); const input = z.object({ courseId: z.string().uuid(), scheduledDate: z.string().date() }).parse(req.body); const itemId = z.string().uuid().parse(req.params.itemId); const item = await repository.updateItem(actor.userId, input.courseId, itemId, "RESCHEDULED", input.scheduledDate); if (!item) throw new AppError("STUDY_PLAN_ITEM_NOT_FOUND", 404, "Study plan item not found"); res.json({ data: item, meta: meta(context.requestId) }); } catch (error) { next(map(error)); }
  });
  return router;
}

async function student(req: Request, verify: (token: string) => Promise<ActorContext>, correlationId: string) {
  const values = req.rawHeaders.flatMap((value, index) => index % 2 === 0 && value.toLowerCase() === "x-actor-context" ? [req.rawHeaders[index + 1] ?? ""] : []);
  try { if (values.length !== 1 || !values[0]) throw new Error(); const actor = await verify(values[0]); if (actor.correlationId !== correlationId) throw new Error(); if (!actor.roles.includes("STUDENT")) throw new AppError("STUDENT_REQUIRED", 403, "Student role required"); return actor; }
  catch (error) { if (error instanceof AppError) throw error; throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid trusted actor context"); }
}
const requestContext = () => { const value = currentRequestContext(); if (!value) throw new Error("REQUEST_CONTEXT_UNAVAILABLE"); return value; };
const meta = (requestId: string) => ({ requestId, timestamp: new Date().toISOString() });
const map = (error: unknown) => error instanceof ZodError ? new AppError("ADAPTIVE_VALIDATION_FAILED", 422, "Adaptive learning request validation failed") : error instanceof Error && error.message === "INVALID_STUDY_PLAN_TRANSITION" ? new AppError("INVALID_STUDY_PLAN_TRANSITION", 409, "The requested Study Plan transition is not allowed") : error;
