import { createHash } from "node:crypto";
import { Router, type RequestHandler } from "express";
import { z, ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import type { AdaptiveRuntimeRepository } from "./runtime-repository.js";
import { aggregateRadarEvidence } from "../../../../packages/learning-visuals/src/radar.js";
import { LearnerMasteryServiceV2 } from "../mastery/mastery-service.js";
import type {
  MasteryIngestionRepository,
  AuthoritativeMasteryEvidence,
} from "./mastery-ingestion-repository.js";

export type CourseAuthority = {
  course: (courseId: string) => Promise<{ ownerLecturerId: string; tenantId?: string } | undefined>;
  entitlement: (
    studentId: string,
    courseId: string,
  ) => Promise<{ state: string; tenantId?: string } | undefined>;
  roster: (courseId: string) => Promise<{ studentId: string }[]>;
  lookupProducerRecord?: (
    courseId: string,
    sourceType: "ASSIGNMENT" | "LAB" | "FINAL_PROJECT",
    sourceRecordId: string,
  ) => Promise<{ id: string; tenantId?: string } | undefined>;
  canonicalTenantId?: string;
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
  ingestionRepository?: MasteryIngestionRepository,
  canonicalTenantId?: string,
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
  router.post(
    "/api/v1/courses/:courseId/students/:studentId/evidence",
    authenticate,
    async (req, res, next) => {
      try {
        const context = currentRequestContext();
        if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
        const actor = res.locals.masteryActor as ActorContext;
        const evidenceRepository = ingestionRepository;
        if (!evidenceRepository) {
          throw new AppError(
            "MASTERY_INGESTION_UNAVAILABLE",
            503,
            "Mastery evidence ingestion is unavailable",
            true,
          );
        }
        const { courseId, studentId } = z
          .object({ courseId: z.string().uuid(), studentId: z.string().uuid() })
          .parse(req.params);
        await authorize(actor, courseId, studentId);

        const rawKey = req.headers["idempotency-key"];
        if (typeof rawKey !== "string" || rawKey.trim().length === 0) {
          throw new AppError("IDEMPOTENCY_KEY_REQUIRED", 400, "Non-empty Idempotency-Key header is required");
        }
        const key = rawKey.trim();

        const [courseInfo, entitlementInfo] = await Promise.all([
          authority.course(courseId),
          authority.entitlement(studentId, courseId),
        ]);
        if (!courseInfo) throw new AppError("COURSE_NOT_FOUND", 404, "Course is not available");
        if (!entitlementInfo || entitlementInfo.state !== "ACTIVE") {
          throw new AppError("COURSE_STUDENT_ACCESS_DENIED", 403, "Student is not active in this course");
        }
        const effectiveCanonicalTenant = canonicalTenantId ?? authority.canonicalTenantId;
        const courseTenantId = courseInfo.tenantId ?? effectiveCanonicalTenant;
        const studentTenantId = entitlementInfo.tenantId ?? effectiveCanonicalTenant;

        if (courseTenantId && studentTenantId && courseTenantId !== studentTenantId) {
          throw new AppError("CROSS_TENANT_VIOLATION", 403, "Student and course belong to different tenants");
        }

        const tenantId = courseTenantId ?? studentTenantId;
        if (!tenantId) {
          throw new AppError("TENANT_RESOLUTION_FAILED", 400, "Authoritative tenant could not be resolved");
        }

        const body = recordEvidenceBody.parse(req.body);
        let sourceId: string;
        if (body.sourceType === "TEACHER_OBSERVATION") {
          sourceId = `lecturer:${actor.userId}`;
        } else {
          if (!body.sourceRecordId) {
            throw new AppError(
              "EVIDENCE_PRODUCER_UNVERIFIED",
              422,
              `Source record ID is required for authoritative evidence of type ${body.sourceType}`,
            );
          }
          const producerRecord = await authority.lookupProducerRecord?.(
            courseId,
            body.sourceType,
            body.sourceRecordId,
          );
          if (!producerRecord) {
            throw new AppError(
              "EVIDENCE_PRODUCER_UNVERIFIED",
              422,
              `Authoritative record for ${body.sourceType} ${body.sourceRecordId} was not found`,
            );
          }
          if (producerRecord.tenantId && producerRecord.tenantId !== tenantId) {
            throw new AppError(
              "CROSS_TENANT_VIOLATION",
              403,
              "Producer record belongs to a different tenant",
            );
          }
          sourceId = `${body.sourceType.toLowerCase()}:${body.sourceRecordId}`;
        }

        const eventId = deterministicUuid(`evidence:${courseId}:${studentId}:${body.conceptId}:${key}`);
        const occurredAt = new Date().toISOString();
        const evidence: AuthoritativeMasteryEvidence = {
          eventId,
          tenantId,
          studentId,
          courseId,
          learningOutcomeId: body.learningOutcomeId,
          conceptId: body.conceptId,
          sourceType: body.sourceType,
          sourceId,
          occurredAt,
          schemaVersion: "1.0",
          rawScorePercent: body.rawScorePercent,
          correlationId: context.correlationId,
        };
        const reservation = await evidenceRepository.reserve(evidence);
        if (reservation === "DONE") {
          const current = await evidenceRepository.current(evidence);
          return res.status(200).json({
            data: { evidence, record: current, replayed: true },
            meta: { requestId: context.requestId, timestamp: occurredAt },
          });
        }
        await evidenceRepository.persistEvidence(evidence);
        const [allEvidence, current] = await Promise.all([
          evidenceRepository.evidence(evidence),
          evidenceRepository.current(evidence),
        ]);
        const latest = Math.max(...allEvidence.map((item) => Date.parse(item.timestamp)));
        const record = new LearnerMasteryServiceV2().calculateMasteryV2({
          studentId,
          tenantId: evidence.tenantId,
          courseId,
          conceptId: body.conceptId,
          learningOutcomeId: body.learningOutcomeId,
          evidences: allEvidence,
          hasMetPrerequisites: true,
          daysSinceLastActivity: Math.max(0, Math.floor((Date.now() - latest) / 86400000)),
          previousState: current?.state,
          previousScore: current?.score,
          recalculationReason: `AUTHORITATIVE_LECTURER_OBSERVATION:${actor.userId}`,
        });
        await evidenceRepository.saveProjection(record, evidence);
        await evidenceRepository.complete(evidence.eventId);
        res.status(201).json({
          data: { evidence, record, replayed: false },
          meta: { requestId: context.requestId, timestamp: occurredAt },
        });
      } catch (error) {
        next(
          error instanceof ZodError
            ? new AppError("MASTERY_VALIDATION_FAILED", 422, "Invalid mastery evidence submission")
            : error,
        );
      }
    },
  );
  return router;
}

const recordEvidenceBody = z.object({
  learningOutcomeId: z.string().min(1).max(200),
  conceptId: z.string().min(1).max(200),
  rawScorePercent: z.number().min(0).max(100),
  sourceType: z
    .enum(["TEACHER_OBSERVATION", "ASSIGNMENT", "LAB", "FINAL_PROJECT"])
    .default("TEACHER_OBSERVATION"),
  sourceRecordId: z.string().min(1).max(200).optional(),
  notes: z.string().max(1000).optional(),
});

function deterministicUuid(seed: string): string {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex.slice(12, 16).join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}
