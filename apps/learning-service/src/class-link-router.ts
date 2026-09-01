import { Router, type Request } from "express";
import { z } from "zod";
import type { JWTPayload } from "jose";
import { AppError, currentRequestContext } from "../../../packages/http/src/index.js";
import type { LearningCatalogRepository } from "./catalog/repository.js";

export function learningClassLinkRouter(
  repository: Pick<LearningCatalogRepository, "getCanonicalCourse">,
  verify: (token: string) => Promise<JWTPayload>,
): Router {
  const router = Router();
  router.get("/internal/v1/courses/:id/class-link-eligibility", async (req, res, next) => {
    try {
      const context = currentRequestContext();
      if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
      let claims: JWTPayload;
      try {
        claims = await verify(serviceToken(req));
      } catch {
        throw new AppError("INVALID_SERVICE_CREDENTIALS", 401, "Invalid service credentials");
      }
      if (claims.sub !== "classroom-service")
        throw new AppError("SERVICE_CALLER_NOT_ALLOWED", 403, "Service caller is not allowed");
      const courseId = z.string().uuid().parse(req.params.id);
      const course = await repository.getCanonicalCourse(courseId);
      if (!course || course.state !== "PUBLISHED")
        throw new AppError("COURSE_NOT_LINKABLE", 404, "Course is not available for Class linking");
      res.status(200).json({
        data: {
          courseId: course.courseId,
          ownerLecturerId: course.ownerLecturerId,
          state: "PUBLISHED",
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

function serviceToken(req: Request) {
  const values: string[] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2)
    if (req.rawHeaders[i]?.toLowerCase() === "authorization") values.push(req.rawHeaders[i + 1] ?? "");
  const token = values.length === 1 ? /^Service ([A-Za-z0-9_.-]+)$/u.exec(values[0] ?? "")?.[1] : undefined;
  if (!token || token.length > 4096) throw new Error("SERVICE_HEADER_REJECTED");
  return token;
}
