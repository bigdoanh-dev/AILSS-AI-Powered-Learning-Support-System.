import { Router } from "express";
import { types } from "cassandra-driver";
import { z } from "zod";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { LearningAuthoringRepository } from "./repository.js";
import { IdentityPublicProfileClientError, type IdentityPublicProfileClient } from "../identity-client.js";
import { courseDto } from "./model.js";

export function ownedCoursesRouter(
  db: CassandraClient,
  repo: LearningAuthoringRepository,
  identity: Pick<IdentityPublicProfileClient, "get">,
  verify: (token: string) => Promise<ActorContext>,
): Router {
  const router = Router();
  router.get(["/api/v1/me/owned-courses", "/api/v1/me/owned-courses/:courseId"], async (req, res, next) => {
    try {
      const context = currentRequestContext();
      const token = req.header("x-actor-context");
      if (!context || !token) throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid actor");
      let actor: ActorContext;
      try {
        actor = await verify(token);
      } catch {
        throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid actor");
      }
      if (actor.correlationId !== context.correlationId)
        throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid actor");
      if (actor.roles.length !== 1 || actor.roles[0] !== "LECTURER")
        throw new AppError("LECTURER_REQUIRED", 403, "Lecturer account required");
      try {
        await identity.get(actor.userId, context.requestId);
      } catch (error) {
        if (error instanceof IdentityPublicProfileClientError && error.code === "IDENTITY_PROFILE_REJECTED")
          throw new AppError("LECTURER_NOT_ELIGIBLE", 403, "Lecturer verification required");
        throw new AppError(
          "IDENTITY_SERVICE_UNAVAILABLE",
          503,
          "Identity service is temporarily unavailable",
          true,
        );
      }
      const id = typeof req.params.courseId === "string" ? req.params.courseId : undefined;
      if (id) {
        if (!z.string().uuid().safeParse(id).success)
          throw new AppError("INVALID_COURSE_ID", 422, "Invalid course");
        const course = await repo.get(id);
        if (!course || course.ownerLecturerId !== actor.userId)
          throw new AppError("COURSE_NOT_FOUND", 404, "Course not found");
        res.json({ data: courseDto(course) });
        return;
      }
      const rows = await db.execute(
        "SELECT course_id FROM courses_by_lecturer WHERE lecturer_id=? LIMIT 100",
        [types.Uuid.fromString(actor.userId)],
        "LOCAL_QUORUM",
      );
      const ids = [...new Set(rows.map((row) => String(row.get("course_id"))))];
      const courses = await Promise.all(ids.map((id) => repo.get(id)));
      res.json({
        data: courses.flatMap((c) => c && c.ownerLecturerId === actor.userId ? [courseDto(c)] : []),
        meta: { limit: 100 },
      });
    } catch (error) {
      next(error);
    }
  });
  return router;
}
