import type { CryptoKey } from "jose";
import { signServiceToken } from "../../../../packages/security/src/index.js";
import type { LearningLessonRepository } from "../lessons/repository.js";

export interface PlanContext {
  courseRequirements: Array<{
    lessonId: string;
    title: string;
    learningOutcomeId: string;
    sourceVersion: number;
  }>;
  upcomingAssessments: Array<{
    assessmentId: string;
    title: string;
    dueDate: string;
    targetOutcomeIds: string[];
    sourceVersion: number;
  }>;
}

export class AuthoritativePlanContextProvider {
  public constructor(
    private readonly lessons: LearningLessonRepository,
    private readonly assessmentUrl: string,
    private readonly key: CryptoKey,
    private readonly issuer: string,
    private readonly kid: string,
    private readonly timeoutMs = 5_000,
  ) {}

  public async load(courseId: string): Promise<PlanContext> {
    const course = await this.lessons.course(courseId);
    if (!course || !["PUBLISHED", "HIDDEN"].includes(course.state)) throw new Error("ACTIVE_COURSE_REQUIRED");
    const syllabus = await this.lessons.list(courseId, course.contentVersion);
    const courseRequirements = syllabus
      .filter((lesson) => lesson.state === "READY")
      .map((lesson) => ({
        lessonId: lesson.lessonId,
        title: lesson.title,
        learningOutcomeId: `lesson:${lesson.lessonId}`,
        sourceVersion: course.contentVersion,
      }));
    const token = await signServiceToken(this.key, {
      issuer: this.issuer,
      serviceId: "learning-service",
      audience: "assessment-service",
      purpose: "assessment.schedule.read",
      kid: this.kid,
      ttlSeconds: 60,
    });
    const response = await fetch(
      new URL(`/internal/v1/courses/${encodeURIComponent(courseId)}/assessment-schedule`, this.assessmentUrl),
      {
        headers: { authorization: `Service ${token}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );
    if (!response.ok) throw new Error("ASSESSMENT_SCHEDULE_UNAVAILABLE");
    const body = (await response.json()) as { data?: PlanContext["upcomingAssessments"] };
    return { courseRequirements, upcomingAssessments: body.data ?? [] };
  }
}
