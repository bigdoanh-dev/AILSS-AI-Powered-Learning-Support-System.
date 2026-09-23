import type { CryptoKey } from "jose";
import { signServiceToken } from "../../../../packages/security/src/index.js";
import type {
  AssistantDomainClient,
  CourseCatalogItem,
  CourseMaterialSnippet,
  StudentKnowledgeGap,
} from "./tool-runner.js";
import { z } from "zod";

const materialResponseSchema = z.object({
  data: z.array(z.object({
    courseId: z.string().uuid(), lessonId: z.string().uuid(), lessonVersion: z.number().int().positive(),
    courseVersion: z.number().int().positive(), title: z.string().min(1), sectionTitle: z.string().min(1),
    contentSnippet: z.string().min(1), sourceObjectId: z.string().length(64), retrievalScore: z.number().nonnegative(),
    sourceType: z.literal("LESSON_OBJECT"),
  })),
  meta: z.object({ retrievalState: z.enum(["MATCHES", "NO_MATCH"]), courseVersion: z.number().int().positive() }),
});

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
      if (!query) return [];
      const token = query
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .match(/[a-z0-9]{3,20}/u)?.[0];
      if (!token) return [];
      const url = new URL("/api/v1/courses/search", this.options.learningUrl);
      url.searchParams.set("q", token);

      const res = await fetch(url.toString(), {
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(this.options.deadlineMs ?? 5000),
      });

      if (!res.ok) return [];

      const body = (await res.json()) as {
        data?: ReadonlyArray<{
          courseId: string; title: string; price: string; currency: string;
          categoryId: string; lecturerId: string;
        }>;
      };
      let items: readonly CourseCatalogItem[] = (body.data ?? []).map((course) => ({
        courseId: course.courseId,
        title: course.title,
        description: "",
        priceAmount: Number(course.price),
        priceCurrency: course.currency,
        level: level ?? "UNSPECIFIED",
      }));
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

      if (!res.ok) return [];

      const body = (await res.json()) as { data?: readonly StudentKnowledgeGap[] };
      return body.data ?? [];
    } catch { return []; }
  }

  public async searchCourseMaterials(
    studentId: string,
    courseId: string,
    topic: string,
  ): Promise<readonly CourseMaterialSnippet[]> {
    try {
      const token = await this.mintServiceToken("learning-service", "learning.materials.read");
      const url = new URL(`/internal/v1/courses/${encodeURIComponent(courseId)}/materials/search`, this.options.learningUrl);
      url.searchParams.set("topic", topic);
      url.searchParams.set("studentId", studentId);

      const res = await fetch(url.toString(), {
        headers: { authorization: `Service ${token}` },
        signal: AbortSignal.timeout(this.options.deadlineMs ?? 5000),
      });

      if (res.status === 401 || res.status === 403) throw new Error("RAG_TOOL_FORBIDDEN");
      if (res.status === 409) throw new Error("RAG_MATERIAL_UNAVAILABLE");
      if (!res.ok) throw new Error("RAG_TOOL_UNAVAILABLE");

      const body = materialResponseSchema.parse(await res.json());
      if (body.data.some((item) => item.courseId !== courseId || item.courseVersion !== body.meta.courseVersion))
        throw new Error("RAG_SOURCE_SCOPE_MISMATCH");
      if ((body.meta.retrievalState === "NO_MATCH") !== (body.data.length === 0))
        throw new Error("RAG_RETRIEVAL_STATE_MISMATCH");
      return body.data;
    } catch (error) {
      if (error instanceof Error && ["RAG_TOOL_FORBIDDEN", "RAG_MATERIAL_UNAVAILABLE", "RAG_TOOL_UNAVAILABLE", "RAG_SOURCE_SCOPE_MISMATCH", "RAG_RETRIEVAL_STATE_MISMATCH"].includes(error.message)) throw error;
      throw new Error("RAG_TOOL_UNAVAILABLE");
    }
  }

  public async getStudentMastery(studentId: string, courseId: string): Promise<unknown> {
    return this.getAdaptive(`/internal/v1/students/${encodeURIComponent(studentId)}/mastery/${encodeURIComponent(courseId)}`);
  }

  public async getRecommendedLearningPath(studentId: string, courseId: string): Promise<unknown> {
    return this.getAdaptive(`/internal/v1/students/${encodeURIComponent(studentId)}/study-plan/${encodeURIComponent(courseId)}`);
  }

  private async getAdaptive(path: string): Promise<unknown> {
    const token = await this.mintServiceToken("learning-service", "learning.adaptive.ai.read");
    const response = await fetch(new URL(path, this.options.learningUrl), {
      headers: { authorization: `Service ${token}` },
      signal: AbortSignal.timeout(this.options.deadlineMs ?? 5000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "ADAPTIVE_TOOL_FORBIDDEN" : "ADAPTIVE_TOOL_UNAVAILABLE");
    const body = (await response.json()) as { data?: unknown };
    return body.data ?? null;
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
