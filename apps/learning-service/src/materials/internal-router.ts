import { Router, type Request } from "express";
import { createHash } from "node:crypto";
import type { JWTPayload } from "jose";
import { z } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { ObjectStorage } from "../../../../packages/storage/src/index.js";
import type { LearningLessonRepository } from "../lessons/repository.js";

const paramsSchema = z.object({ courseId: z.string().uuid() });
const querySchema = z.object({
  studentId: z.string().uuid(),
  topic: z.string().trim().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(10).default(5),
});

export function learningMaterialsInternalRouter(
  repository: LearningLessonRepository,
  storage: ObjectStorage | undefined,
  verify: (token: string) => Promise<JWTPayload>,
  hasEntitlement: (studentId: string, courseId: string) => Promise<boolean>,
): Router {
  const router = Router();
  router.get("/internal/v1/courses/:courseId/materials/search", async (request, response, next) => {
    try {
      const claims = await authorize(request, verify);
      if (claims.sub !== "ai-service")
        throw new AppError("SERVICE_CALLER_NOT_ALLOWED", 403, "Service caller is not allowed");
      const { courseId } = paramsSchema.parse(request.params);
      const { studentId, topic, limit } = querySchema.parse(request.query);
      if (!(await hasEntitlement(studentId, courseId)))
        throw new AppError("COURSE_ACCESS_DENIED", 403, "Student is not entitled to this course");

      const course = await repository.course(courseId);
      if (!course || course.state !== "PUBLISHED")
        throw new AppError("COURSE_MATERIALS_NOT_AVAILABLE", 404, "Published course materials are unavailable");
      const lessons = await repository.list(courseId, course.contentVersion);
      const terms = normalizedTerms(topic);
      const candidates = lessons.filter((lesson) => lesson.state === "READY");
      const records = await Promise.all(candidates.map(async (lesson) => {
        let content: string | undefined;
        let sourceObjectId: string | undefined;
        if (storage && lesson.objectKey) {
          const metadata = await storage.stat(lesson.objectKey);
          if (metadata.contentType === "text/plain") {
            content = `${lesson.sectionTitle}\n${lesson.title}\n${(await storage.read(lesson.objectKey, 512 * 1024)).toString("utf8")}`;
            sourceObjectId = createHash("sha256").update(lesson.objectKey).digest("hex");
          }
        }
        if (!content || !sourceObjectId) return null;
        const score = terms.reduce((value, term) => value + occurrences(content, term), 0);
        return {
          retrievalScore: score,
          courseId,
          lessonId: lesson.lessonId,
          lessonVersion: lesson.lessonVersion,
          courseVersion: course.contentVersion,
          title: lesson.title,
          sectionTitle: lesson.sectionTitle,
          contentSnippet: snippet(content, terms),
          sourceObjectId,
          sourceType: "LESSON_OBJECT",
        } as const;
      }));
      const searchableRecords = records.filter((record) => record !== null);
      if (searchableRecords.length === 0)
        throw new AppError("COURSE_MATERIALS_NOT_INDEXED", 409, "Published course has no searchable text material");
      const data = searchableRecords
        .filter((record) => record.retrievalScore > 0)
        .sort((left, right) => right.retrievalScore - left.retrievalScore || left.lessonId.localeCompare(right.lessonId))
        .slice(0, limit);
      const context = currentRequestContext();
      response.json({
        data,
        meta: {
          requestId: context?.requestId,
          timestamp: new Date().toISOString(),
          retrievalState: data.length > 0 ? "MATCHES" : "NO_MATCH",
          courseVersion: course.contentVersion,
        },
      });
    } catch (error) { next(error); }
  });
  return router;
}

async function authorize(request: Request, verify: (token: string) => Promise<JWTPayload>) {
  try { return await verify(serviceToken(request)); }
  catch { throw new AppError("INVALID_SERVICE_CREDENTIALS", 401, "Invalid service credentials"); }
}

function serviceToken(request: Request): string {
  const values = request.rawHeaders.flatMap((value, index) =>
    index % 2 === 0 && value.toLowerCase() === "authorization" ? [request.rawHeaders[index + 1] ?? ""] : []);
  const token = values.length === 1 ? /^Service ([A-Za-z0-9_.-]+)$/u.exec(values[0] ?? "")?.[1] : undefined;
  if (!token) throw new Error("SERVICE_HEADER_REJECTED");
  return token;
}

function normalizedTerms(value: string): string[] {
  return [...new Set(value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])];
}

function occurrences(content: string, term: string): number {
  const normalized = content.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  return normalized.split(term).length - 1;
}

function snippet(content: string, terms: readonly string[]): string {
  const compact = content.replace(/\s+/gu, " ").trim();
  const normalized = compact.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const first = terms.map((term) => normalized.indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  return compact.slice(Math.max(0, first - 100), Math.min(compact.length, first + 400));
}
