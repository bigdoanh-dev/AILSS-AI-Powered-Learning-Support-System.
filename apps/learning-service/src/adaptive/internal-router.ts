import { Router, type Request } from "express";
import type { JWTPayload } from "jose";
import { z } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { AdaptiveRuntimeRepository } from "./runtime-repository.js";

export function adaptiveInternalRouter(
  repository: AdaptiveRuntimeRepository,
  verify: (token: string) => Promise<JWTPayload>,
  hasEntitlement: (studentId: string, courseId: string) => Promise<boolean>,
): Router {
  const router = Router();
  const authorize = async (request: Request) => {
    let claims: JWTPayload;
    try {
      claims = await verify(serviceToken(request));
    } catch {
      throw new AppError("INVALID_SERVICE_CREDENTIALS", 401, "Invalid service credentials");
    }
    if (claims.sub !== "ai-service")
      throw new AppError("SERVICE_CALLER_NOT_ALLOWED", 403, "Service caller is not allowed");
  };
  router.get("/internal/v1/students/:studentId/mastery/:courseId", async (request, response, next) => {
    try {
      await authorize(request);
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
      await authorize(request);
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
  return router;
}

const ids = z.object({ studentId: z.string().uuid(), courseId: z.string().uuid() });
function serviceToken(request: Request): string {
  const values = request.rawHeaders.flatMap((value, index) =>
    index % 2 === 0 && value.toLowerCase() === "authorization" ? [request.rawHeaders[index + 1] ?? ""] : [],
  );
  const token = values.length === 1 ? /^Service ([A-Za-z0-9_.-]+)$/u.exec(values[0] ?? "")?.[1] : undefined;
  if (!token) throw new Error("SERVICE_HEADER_REJECTED");
  return token;
}
