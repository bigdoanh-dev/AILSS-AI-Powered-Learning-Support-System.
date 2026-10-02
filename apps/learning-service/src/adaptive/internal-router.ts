import { Router, type Request } from "express";
import type { JWTPayload } from "jose";
import { z } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { AdaptiveRuntimeRepository } from "./runtime-repository.js";
import { StudyPlanService } from "./study-plan-service.js";
import type { AuthoritativePlanContextProvider } from "./plan-context.js";

export type AdaptiveInternalVerifier = {
  read: (token: string) => Promise<JWTPayload>;
  write: (token: string) => Promise<JWTPayload>;
};

export function adaptiveInternalRouter(
  repository: AdaptiveRuntimeRepository,
  verify: AdaptiveInternalVerifier,
  hasEntitlement: (studentId: string, courseId: string) => Promise<boolean>,
  contextProvider: Pick<AuthoritativePlanContextProvider, "load">,
): Router {
  const router = Router();
  const generator = new StudyPlanService();
  const verifyRead = verify.read;
  const verifyWrite = verify.write;

  const authorize = async (request: Request, verifyFn: (token: string) => Promise<JWTPayload>) => {
    let claims: JWTPayload;
    try {
      claims = await verifyFn(serviceToken(request));
    } catch {
      throw new AppError("INVALID_SERVICE_CREDENTIALS", 401, "Invalid service credentials");
    }
    if (claims.sub !== "ai-service")
      throw new AppError("SERVICE_CALLER_NOT_ALLOWED", 403, "Service caller is not allowed");
  };
  router.get("/internal/v1/students/:studentId/mastery/:courseId", async (request, response, next) => {
    try {
      await authorize(request, verifyRead);
      const context = currentRequestContext();
      if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
      const { studentId, courseId } = ids.parse(request.params);
      if (!(await hasEntitlement(studentId, courseId)))
        throw new AppError("COURSE_ACCESS_DENIED", 403, "Student is not entitled to this course");
      response.json({
        data: await repository.mastery(studentId, courseId),
        meta: { requestId: context.requestId, timestamp: new Date().toISOString() },
      });
    } catch (error) {
      next(error);
    }
  });
  router.get("/internal/v1/students/:studentId/study-plan/:courseId", async (request, response, next) => {
    try {
      await authorize(request, verifyRead);
      const context = currentRequestContext();
      if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
      const { studentId, courseId } = ids.parse(request.params);
      if (!(await hasEntitlement(studentId, courseId)))
        throw new AppError("COURSE_ACCESS_DENIED", 403, "Student is not entitled to this course");
      const plan = await repository.currentPlan(studentId, courseId);
      if (!plan)
        throw new AppError("STUDY_PLAN_NOT_FOUND", 404, "No persisted Study Plan exists for this course");
      response.json({
        data: plan,
        meta: { requestId: context.requestId, timestamp: new Date().toISOString() },
      });
    } catch (error) {
      next(error);
    }
  });
  router.post("/internal/v1/students/:studentId/study-plan/generate", async (request, response, next) => {
    try {
      await authorize(request, verifyWrite);
      const context = currentRequestContext();
      if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
      const studentId = z.string().uuid().parse(request.params.studentId);
      const input = generateBody.parse(request.body);
      if (!(await hasEntitlement(studentId, input.courseId)))
        throw new AppError("COURSE_ACCESS_DENIED", 403, "Student is not entitled to this course");
      const records = await repository.mastery(studentId, input.courseId);
      if (!records[0])
        throw new AppError(
          "MASTERY_EVIDENCE_REQUIRED",
          409,
          "A study plan cannot be generated before mastery evidence exists",
        );
      const planContext = await contextProvider.load(input.courseId);
      const plan = generator.generateStudyPlan({
        studentId,
        tenantId: records[0].tenantId,
        courseId: input.courseId,
        availableHoursPerWeek: input.availableHoursPerWeek,
        masteryRecords: records,
        ...planContext,
      });
      await repository.savePlan(plan);
      response
        .status(201)
        .json({ data: plan, meta: { requestId: context.requestId, timestamp: new Date().toISOString() } });
    } catch (error) {
      next(error);
    }
  });
  router.patch(
    "/internal/v1/students/:studentId/study-plan/items/:itemId",
    async (request, response, next) => {
      try {
        await authorize(request, verifyWrite);
        const context = currentRequestContext();
        if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
        const studentId = z.string().uuid().parse(request.params.studentId);
        const itemId = z.string().uuid().parse(request.params.itemId);
        const input = updateItemBody.parse(request.body);
        if (!(await hasEntitlement(studentId, input.courseId)))
          throw new AppError("COURSE_ACCESS_DENIED", 403, "Student is not entitled to this course");
        const item = await repository.updateItem(
          studentId,
          input.courseId,
          itemId,
          input.status,
          input.scheduledDate,
        );
        if (!item) throw new AppError("STUDY_PLAN_ITEM_NOT_FOUND", 404, "Study plan item not found");
        response.json({
          data: item,
          meta: { requestId: context.requestId, timestamp: new Date().toISOString() },
        });
      } catch (error) {
        next(error);
      }
    },
  );
  return router;
}

const generateBody = z.object({
  courseId: z.string().uuid(),
  availableHoursPerWeek: z.number().min(1).max(80).default(7),
});

const updateItemBody = z
  .object({
    courseId: z.string().uuid(),
    status: z.enum(["ACCEPTED", "SKIPPED", "RESCHEDULED", "COMPLETED", "REPLACED"]),
    scheduledDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .superRefine((v, ctx) => {
    if (v.status === "RESCHEDULED" && !v.scheduledDate)
      ctx.addIssue({ code: "custom", message: "scheduledDate is required when rescheduling" });
  });

const ids = z.object({ studentId: z.string().uuid(), courseId: z.string().uuid() });
function serviceToken(request: Request): string {
  const values = request.rawHeaders.flatMap((value, index) =>
    index % 2 === 0 && value.toLowerCase() === "authorization" ? [request.rawHeaders[index + 1] ?? ""] : [],
  );
  const token = values.length === 1 ? /^Service ([A-Za-z0-9_.-]+)$/u.exec(values[0] ?? "")?.[1] : undefined;
  if (!token) throw new Error("SERVICE_HEADER_REJECTED");
  return token;
}
