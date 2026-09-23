import { Router, type Request } from "express";
import type { JWTPayload } from "jose";
import { z } from "zod";
import { AppError, currentRequestContext } from "../../../packages/http/src/index.js";
import type { AssessmentRepository } from "./repository.js";

export function assessmentScheduleInternalRouter(
  repository: AssessmentRepository,
  verify: (token: string) => Promise<JWTPayload>,
): Router {
  const router = Router();
  router.get("/internal/v1/courses/:courseId/assessment-schedule", async (request, response, next) => {
    try {
      let claims: JWTPayload;
      try { claims = await verify(serviceToken(request)); }
      catch { throw new AppError("INVALID_SERVICE_CREDENTIALS", 401, "Invalid service credentials"); }
      if (claims.sub !== "learning-service")
        throw new AppError("SERVICE_CALLER_NOT_ALLOWED", 403, "Service caller is not allowed");
      const courseId = z.string().uuid().parse(request.params.courseId);
      const now = Date.now();
      const data = (await repository.listProjection("COURSE", courseId, "PUBLISHED"))
        .filter((quiz): quiz is typeof quiz & { closesAt: Date } =>
          Boolean(quiz.closesAt && quiz.closesAt.getTime() > now))
        .map((quiz) => ({
          assessmentId: quiz.quizId,
          title: quiz.title,
          ...(quiz.opensAt ? { opensAt: quiz.opensAt.toISOString() } : {}),
          dueDate: quiz.closesAt.toISOString(),
          targetOutcomeIds: [] as string[],
          sourceVersion: quiz.recordVersion,
        }));
      response.json({ data, meta: { requestId: currentRequestContext()?.requestId, timestamp: new Date().toISOString() } });
    } catch (error) { next(error); }
  });
  return router;
}

function serviceToken(request: Request): string {
  const values = request.rawHeaders.flatMap((value, index) =>
    index % 2 === 0 && value.toLowerCase() === "authorization" ? [request.rawHeaders[index + 1] ?? ""] : []);
  const token = values.length === 1 ? /^Service ([A-Za-z0-9_.-]+)$/u.exec(values[0] ?? "")?.[1] : undefined;
  if (!token) throw new Error("SERVICE_HEADER_REJECTED");
  return token;
}
