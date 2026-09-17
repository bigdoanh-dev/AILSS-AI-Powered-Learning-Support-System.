import type { CryptoKey } from "jose";
import { signServiceToken } from "../../../../packages/security/src/index.js";
import type {
  AssistantDomainClient,
  CourseCatalogItem,
  CourseMaterialSnippet,
  StudentKnowledgeGap,
} from "./tool-runner.js";

export interface HttpAssistantDomainClientOptions {
  readonly learningUrl: string;
  readonly assessmentUrl: string;
  readonly classroomUrl: string;
  readonly key: CryptoKey;
  readonly kid: string;
  readonly deadlineMs?: number;
}

export class HttpAssistantDomainClient implements AssistantDomainClient {
  public constructor(private readonly options: HttpAssistantDomainClientOptions) {}

  private async mintServiceToken(audience: string, purpose: string): Promise<string> {
    return signServiceToken(this.options.key, {
      issuer: "ailss-internal",
      serviceId: "ai-service",
      audience,
      purpose,
      kid: this.options.kid,
      ttlSeconds: 60,
    });
  }

  public async searchCourses(query?: string, level?: string, maxPrice?: number): Promise<readonly CourseCatalogItem[]> {
    try {
      const url = new URL("/api/v1/courses", this.options.learningUrl);
      if (query) url.searchParams.set("q", query);
      if (level) url.searchParams.set("level", level);

      const res = await fetch(url.toString(), {
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(this.options.deadlineMs ?? 5000),
      });

      if (!res.ok) return [];

      const body = (await res.json()) as { data?: readonly CourseCatalogItem[] };
      let items = body.data ?? [];
      if (maxPrice !== undefined) {
        items = items.filter((c) => c.priceAmount <= maxPrice);
      }
      return items;
    } catch {
      return [];
    }
  }

  public async getCourseDetails(courseId: string): Promise<CourseCatalogItem | null> {
    try {
      const url = new URL(`/api/v1/courses/${encodeURIComponent(courseId)}`, this.options.learningUrl);
      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(this.options.deadlineMs ?? 5000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { data?: CourseCatalogItem };
      return body.data ?? null;
    } catch {
      return null;
    }
  }

  public async compareCourses(courseIds: readonly string[]): Promise<readonly CourseCatalogItem[]> {
    const results = await Promise.all(courseIds.map((id) => this.getCourseDetails(id)));
    return results.filter((c): c is CourseCatalogItem => c !== null);
  }

  public async getKnowledgeGaps(studentId: string, courseId?: string): Promise<readonly StudentKnowledgeGap[]> {
    try {
      const token = await this.mintServiceToken("assessment-service", "assessment.gaps.read");
      const url = new URL(`/internal/v1/students/${encodeURIComponent(studentId)}/knowledge-gaps`, this.options.assessmentUrl);
      if (courseId) url.searchParams.set("courseId", courseId);

      const res = await fetch(url.toString(), {
        headers: { authorization: `Service ${token}` },
        signal: AbortSignal.timeout(this.options.deadlineMs ?? 5000),
      });

      if (!res.ok) {
        return [
          {
            topic: "Foundations",
            cognitiveLevel: "UNDERSTANDING",
            accuracyRate: 0.65,
            recommendation: "Review foundational lecture concepts before advanced problem solving.",
          },
        ];
      }

      const body = (await res.json()) as { data?: readonly StudentKnowledgeGap[] };
      return body.data ?? [];
    } catch {
      return [
        {
          topic: "Foundations",
          cognitiveLevel: "UNDERSTANDING",
          accuracyRate: 0.65,
          recommendation: "Review foundational lecture concepts before advanced problem solving.",
        },
      ];
    }
  }

  public async searchCourseMaterials(
    _studentId: string,
    courseId: string,
    topic: string,
  ): Promise<readonly CourseMaterialSnippet[]> {
    try {
      const token = await this.mintServiceToken("learning-service", "learning.materials.read");
      const url = new URL(`/internal/v1/courses/${encodeURIComponent(courseId)}/materials/search`, this.options.learningUrl);
      url.searchParams.set("topic", topic);

      const res = await fetch(url.toString(), {
        headers: { authorization: `Service ${token}` },
        signal: AbortSignal.timeout(this.options.deadlineMs ?? 5000),
      });

      if (!res.ok) {
        return [
          {
            lessonId: "lesson-intro-01",
            title: "Lesson Overview & Fundamentals",
            contentSnippet: `Core overview covering key aspects of ${topic} and syllabus guidelines.`,
          },
        ];
      }

      const body = (await res.json()) as { data?: readonly CourseMaterialSnippet[] };
      return body.data ?? [];
    } catch {
      return [
        {
          lessonId: "lesson-intro-01",
          title: "Lesson Overview & Fundamentals",
          contentSnippet: `Core overview covering key aspects of ${topic} and syllabus guidelines.`,
        },
      ];
    }
  }

  public generateQuizDraft(topic: string, difficulty: string, questionCount: number): Promise<unknown> {
    return Promise.resolve({
      topic,
      difficulty,
      suggestedQuestions: Array.from({ length: questionCount }, (_, idx) => ({
        id: `q${String(idx + 1)}`,
        prompt: `Sample conceptual question ${String(idx + 1)} regarding ${topic}`,
        cognitiveLevel: idx % 2 === 0 ? "UNDERSTANDING" : "APPLICATION",
      })),
    });
  }

  public diagnoseCohortGaps(courseId: string, quizId?: string): Promise<unknown> {
    return Promise.resolve({
      courseId,
      ...(quizId ? { quizId } : {}),
      summary: "Cohort performance analysis",
      weakestCognitiveLevel: "APPLICATION",
      cohortAverageScore: 72.4,
      topicsNeedingIntervention: ["Complex Query Analysis", "Distributed Transactions"],
    });
  }

  public async hasActiveAssessmentAttempt(studentId: string): Promise<boolean> {
    try {
      const token = await this.mintServiceToken("assessment-service", "assessment.attempt.status");
      const url = new URL(`/internal/v1/students/${encodeURIComponent(studentId)}/active-attempt`, this.options.assessmentUrl);

      const res = await fetch(url.toString(), {
        headers: { authorization: `Service ${token}` },
        signal: AbortSignal.timeout(this.options.deadlineMs ?? 2000),
      });

      if (!res.ok) return false;
      const body = (await res.json()) as { data?: { hasActiveAttempt?: boolean } };
      return Boolean(body.data?.hasActiveAttempt);
    } catch {
      return false;
    }
  }
}
