import { Router } from "express";
import type { JWTPayload } from "jose";
import { z } from "zod";
import { AppError, currentRequestContext } from "../../../packages/http/src/index.js";
import type { LearningCatalogRepository } from "./catalog/repository.js";

export function learningAiContextRouter(
  repository: Pick<LearningCatalogRepository, "getCanonicalCourse">,
  verify: (token: string) => Promise<JWTPayload>,
): Router {
  const router = Router();
  router.get("/internal/v1/courses/:id/ai-context", async (request, response, next) => {
    try {
      const context = currentRequestContext();
      if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
      let claims: JWTPayload;
      try {
        claims = await verify(serviceToken(request.rawHeaders));
      } catch {
        throw new AppError("INVALID_SERVICE_CREDENTIALS", 401, "Invalid service credentials");
      }
      if (claims.sub !== "ai-service")
        throw new AppError("SERVICE_CALLER_NOT_ALLOWED", 403, "Service caller is not allowed");
      const course = await repository.getCanonicalCourse(z.string().uuid().parse(request.params.id));
      if (!course || !["DRAFT", "SUBMITTED", "PUBLISHED"].includes(course.state))
        throw new AppError("COURSE_NOT_AVAILABLE", 404, "Course is not available");
      response.json({
        data: {
          courseId: course.courseId,
          ownerLecturerId: course.ownerLecturerId,
          state: course.state,
          recordVersion: course.recordVersion,
        },
        meta: { requestId: context.requestId, timestamp: new Date().toISOString() },
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
function serviceToken(headers: string[]) {
  const values: string[] = [];
  for (let i = 0; i < headers.length; i += 2)
    if (headers[i]?.toLowerCase() === "authorization") values.push(headers[i + 1] ?? "");
  const token = values.length === 1 ? /^Service ([A-Za-z0-9_.-]+)$/u.exec(values[0] ?? "")?.[1] : undefined;
  if (!token) throw new Error("SERVICE_HEADER_REJECTED");
  return token;
}
