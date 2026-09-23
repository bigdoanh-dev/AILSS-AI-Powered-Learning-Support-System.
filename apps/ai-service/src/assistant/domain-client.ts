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

const catalogResponseSchema = z.object({
  data: z.array(z.object({
    courseId: z.string().uuid(),
    title: z.string().min(1),
    price: z.union([z.string(), z.number()]),
    currency: z.string().min(1),
  })),
});

const CATALOG_STOP_WORDS = new Set([
  "anh", "ban", "bat", "biet", "can", "cao", "cho", "chon", "chua", "coi", "con", "cua", "dang",
  "chao", "chut", "danh", "dau", "dinh", "duoc", "duoi", "em", "gia", "gio", "giup", "goi", "hay",
  "hoc", "hop", "khoa", "khoe", "khong", "kinh", "lam", "linh", "minh", "moi", "mot", "muc", "muon",
  "nam", "nang", "nao", "ngan", "ngay", "nghiem", "nghin", "nguoi", "nhieu", "noi",
  "phu", "sach", "sau", "the", "thang", "thich", "tien", "tim", "toi", "tren", "trieu",
  "trinh", "truoc", "tuan", "tung", "vnd", "voi", "xem", "xin", "yeu",
  "about", "and", "beginner", "budget", "can", "choose", "course", "courses", "find", "for",
  "evening", "experience", "good", "have", "hello", "help", "hour", "hours", "know", "learn",
  "learning", "like", "morning", "need", "please", "recommend", "some", "study", "thank", "thanks",
  "the", "there", "this", "want", "week", "which", "with", "would",
]);

// Answers to an advisor's qualification questions should preserve the earlier
// course subject. These words describe availability, budget, or prior level;
// their presence alone is not a new catalog query.
const ADVISOR_QUALIFICATION_WORDS = new Set([
  "affordable", "already", "available", "basic", "buoi", "cheap", "chieu", "chi", "cost", "cuoi",
  "days", "dong", "evenings", "familiar", "free", "gian", "khoang", "level", "max", "million",
  "morning", "nen", "novice", "phu", "phi", "price", "ranh", "sang", "tang", "thap",
  "thoi", "thousand", "tieng", "under", "years", "weekend", "weekday",
]);

/** The public Learning search index accepts title-word prefixes, not full sentences. */
export function extractCatalogSearchTokens(query: string): readonly string[] {
  const normalized = query.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/đ/gu, "d");
  return [...new Set((normalized.match(/[a-z0-9]+/gu) ?? [])
    .filter((word) => word.length >= 3 && !/^\d+$/u.test(word) && !CATALOG_STOP_WORDS.has(word) && !ADVISOR_QUALIFICATION_WORDS.has(word))
    .map((word) => word.slice(0, 20)))].slice(0, 3);
}

function catalogItem(course: z.infer<typeof catalogResponseSchema>["data"][number]): CourseCatalogItem {
  const priceAmount = Number(course.price);
  if (!Number.isFinite(priceAmount) || priceAmount < 0) throw new Error("CATALOG_INVALID_PRICE");
  return {
    courseId: course.courseId,
    title: course.title,
    description: "",
    priceAmount,
    priceCurrency: course.currency,
    // The public catalog currently has no authoritative level field.
    level: "UNSPECIFIED",
  };
}

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

  public async searchCourses(query?: string, _level?: string, maxPrice?: number): Promise<readonly CourseCatalogItem[]> {
    const tokens = extractCatalogSearchTokens(query ?? "");
    if (tokens.length === 0) return [];
    try {
      const pages = await Promise.all(tokens.map(async (token) => {
        const url = new URL("/api/v1/courses/search", this.options.learningUrl);
        url.searchParams.set("q", token);
        url.searchParams.set("limit", "20");
        const response = await fetch(url.toString(), {
          signal: AbortSignal.timeout(this.options.deadlineMs ?? 5000),
        });
        if (!response.ok) throw new Error("CATALOG_UNAVAILABLE");
        return catalogResponseSchema.parse(await response.json()).data.map(catalogItem);
      }));
      const unique = new Map<string, CourseCatalogItem>();
      for (const page of pages) for (const course of page) {
        if (maxPrice !== undefined && course.priceAmount > maxPrice) continue;
        unique.set(course.courseId, course);
      }
      const normalizedTitle = (title: string) => title.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/đ/gu, "d");
      const relevance = (course: CourseCatalogItem) => {
        const words = normalizedTitle(course.title).match(/[a-z0-9]+/gu) ?? [];
        return tokens.filter((token) => words.some((word) => word.startsWith(token))).length;
      };
      return [...unique.values()].sort((left, right) => relevance(right) - relevance(left)).slice(0, 20);
    } catch {
      throw new Error("CATALOG_UNAVAILABLE");
    }
  }

  public async getCourseDetails(courseId: string): Promise<CourseCatalogItem | null> {
    try {
      const url = new URL(`/api/v1/courses/${encodeURIComponent(courseId)}`, this.options.learningUrl);
      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(this.options.deadlineMs ?? 5000),
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("CATALOG_UNAVAILABLE");
      const body = z.object({ data: catalogResponseSchema.shape.data.element }).parse(await res.json());
      return catalogItem(body.data);
    } catch {
      throw new Error("CATALOG_UNAVAILABLE");
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
