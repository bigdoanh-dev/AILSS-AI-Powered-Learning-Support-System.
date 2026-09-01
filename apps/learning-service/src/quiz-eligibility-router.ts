import { Router, type Request } from "express";
import type { JWTPayload } from "jose";
import { z } from "zod";
import { AppError, currentRequestContext } from "../../../packages/http/src/index.js";
import type { LearningCatalogRepository } from "./catalog/repository.js";
import type { LearningCommerceRepository } from "./commerce/repository.js";
import type { ActorContext } from "../../../packages/security/src/index.js";

export function learningQuizEligibilityRouter(
  repository: Pick<LearningCatalogRepository, "getCanonicalCourse"> &
    Pick<LearningCommerceRepository, "entitlement">,
  verify: (token: string) => Promise<JWTPayload>,
  verifyActor: (token: string) => Promise<ActorContext>,
): Router {
  const router = Router();
  router.get("/internal/v1/courses/:id/quiz-eligibility", async (request, response, next) => {
    try {
      const context = currentRequestContext();
      if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
      let claims: JWTPayload;
      try {
        claims = await verify(serviceToken(request));
      } catch {
        throw new AppError("INVALID_SERVICE_CREDENTIALS", 401, "Invalid service credentials");
      }
      if (claims.sub !== "assessment-service")
        throw new AppError("SERVICE_CALLER_NOT_ALLOWED", 403, "Service caller is not allowed");
      const courseId = z.string().uuid().parse(request.params.id),
        course = await repository.getCanonicalCourse(courseId);
      if (!course || course.state !== "PUBLISHED")
        throw new AppError("COURSE_NOT_QUIZ_ELIGIBLE", 404, "Course is not available for quizzes");
      const actorToken = optionalHeader(request, "x-actor-context");
      let studentEligible: boolean | undefined;
      if (actorToken) {
        let actor: ActorContext;
        try {
          actor = await verifyActor(actorToken);
        } catch {
          throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid actor context");
        }
        if (actor.correlationId !== context.correlationId || !actor.roles.includes("STUDENT"))
          throw new AppError("STUDENT_NOT_ELIGIBLE", 403, "Student is not eligible");
        const entitlement = await repository.entitlement(actor.userId, courseId);
        if (!entitlement || entitlement.state !== "ACTIVE")
          throw new AppError("STUDENT_NOT_ELIGIBLE", 403, "Student is not eligible");
        studentEligible = true;
      }
      response.status(200).json({
        data: {
          courseId: course.courseId,
          ownerLecturerId: course.ownerLecturerId,
          state: "PUBLISHED",
          recordVersion: course.recordVersion,
          ...(studentEligible ? { studentEligible } : {}),
        },
        meta: { requestId: context.requestId, timestamp: new Date().toISOString() },
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

function optionalHeader(request: Request, name: string): string | undefined {
  const values: string[] = [];
  for (let i = 0; i < request.rawHeaders.length; i += 2)
    if (request.rawHeaders[i]?.toLowerCase() === name) values.push(request.rawHeaders[i + 1] ?? "");
  if (values.length === 0) return undefined;
  if (values.length !== 1 || !values[0] || values[0].length > 4096) throw new Error("HEADER_REJECTED");
  return values[0];
}

function serviceToken(request: Request): string {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2)
    if (request.rawHeaders[index]?.toLowerCase() === "authorization")
      values.push(request.rawHeaders[index + 1] ?? "");
  const token = values.length === 1 ? /^Service ([A-Za-z0-9_.-]+)$/u.exec(values[0] ?? "")?.[1] : undefined;
  if (!token || token.length > 4096) throw new Error("SERVICE_HEADER_REJECTED");
  return token;
}
