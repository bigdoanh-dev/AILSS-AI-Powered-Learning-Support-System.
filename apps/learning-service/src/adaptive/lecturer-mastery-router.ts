import { Router, type RequestHandler } from "express";
import { z, ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import type { AdaptiveRuntimeRepository } from "./runtime-repository.js";
import { aggregateRadarEvidence } from "../../../../packages/learning-visuals/src/radar.js";

type CourseAuthority = {
  course: (courseId: string) => Promise<{ ownerLecturerId: string } | undefined>;
  entitlement: (studentId: string, courseId: string) => Promise<{ state: string } | undefined>;
  roster: (courseId: string) => Promise<{ studentId: string }[]>;
};

async function authorizeCourseOwner(
  actor: ActorContext,
  courseId: string,
  authority: Pick<CourseAuthority, "course">,
) {
  const course = await authority.course(courseId);
  if (!actor.roles.includes("LECTURER") || !course || course.ownerLecturerId !== actor.userId)
    throw new AppError("COURSE_MASTERY_FORBIDDEN", 403, "Course owner authorization required");
}

export async function authorizeCourseMastery(
  actor: ActorContext,
  courseId: string,
  studentId: string,
  authority: {
    course: (courseId: string) => Promise<{ ownerLecturerId: string } | undefined>;
    entitlement: (studentId: string, courseId: string) => Promise<{ state: string } | undefined>;
  },
): Promise<void> {
  await authorizeCourseOwner(actor, courseId, authority);
  if ((await authority.entitlement(studentId, courseId))?.state !== "ACTIVE")
    throw new AppError("COURSE_STUDENT_ACCESS_DENIED", 403, "Student is not active in this course");
}

export function lecturerMasteryRouter(
  repository: Pick<AdaptiveRuntimeRepository, "mastery">,
  verify: (token: string) => Promise<ActorContext>,
  authorize: (actor: ActorContext, courseId: string, studentId: string) => Promise<void>,
  authority: CourseAuthority,
): Router {
  const router = Router();
  // Both individual and aggregate reads require the same trusted lecturer context.
  const authenticate: RequestHandler = async (req, res, next) => {
    try {
      const context = currentRequestContext();
      if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
      const tokens = req.rawHeaders.flatMap((value, index) =>
        index % 2 === 0 && value.toLowerCase() === "x-actor-context" ? [req.rawHeaders[index + 1] ?? ""] : [],
      );
      let actor: ActorContext;
      try {
        if (tokens.length !== 1 || !tokens[0]) throw new Error();
        actor = await verify(tokens[0]);
        if (actor.correlationId !== context.correlationId) throw new Error();
      } catch {
        throw new AppError("INVALID_ACTOR_CONTEXT", 401, "Invalid trusted actor context");
      }
      if (!actor.roles.includes("LECTURER"))
        throw new AppError("LECTURER_REQUIRED", 403, "Lecturer role required");
      res.locals.masteryActor = actor;
      next();
    } catch (error) {
      next(error);
    }
  };
  router.get("/api/v1/courses/:courseId/mastery-summary", authenticate, async (req, res, next) => {
    try {
      const courseId = z.string().uuid().parse(req.params.courseId);
      await authorizeCourseOwner(res.locals.masteryActor as ActorContext, courseId, authority);
      const members = [...new Set((await authority.roster(courseId)).map((member) => member.studentId))];
      const records: Awaited<ReturnType<AdaptiveRuntimeRepository["mastery"]>>[] = [];
      // Bound database fan-out and verify current entitlement instead of trusting a stale roster.
      for (let start = 0; start < members.length; start += 8) {
        const batch = await Promise.all(
          members
            .slice(start, start + 8)
            .map(async (studentId) =>
              (await authority.entitlement(studentId, courseId))?.state === "ACTIVE"
                ? await repository.mastery(studentId, courseId)
                : null,
            ),
        );
        records.push(...batch.filter((item) => item !== null));
      }
      res.json({
        data: aggregateRadarEvidence(records),
        meta: { requestId: currentRequestContext()?.requestId },
      });
    } catch (error) {
      next(
        error instanceof ZodError
          ? new AppError("MASTERY_VALIDATION_FAILED", 422, "Invalid course ID")
          : error,
      );
    }
  });
  router.get(
    "/api/v1/courses/:courseId/students/:studentId/mastery",
    authenticate,
    async (req, res, next) => {
      try {
        const context = currentRequestContext();
        if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
        const actor = res.locals.masteryActor as ActorContext;
        const { courseId, studentId } = z
          .object({ courseId: z.string().uuid(), studentId: z.string().uuid() })
          .parse(req.params);
        await authorize(actor, courseId, studentId);
        res.json({
          data: await repository.mastery(studentId, courseId),
          meta: { requestId: context.requestId },
        });
      } catch (error) {
        next(
          error instanceof ZodError
            ? new AppError("MASTERY_VALIDATION_FAILED", 422, "Invalid course or student ID")
            : error,
        );
      }
    },
  );
  return router;
}
