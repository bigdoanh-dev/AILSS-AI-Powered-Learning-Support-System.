import { ApiError, record, string } from "./api";
import type { Session } from "./session";

export type MasteryState =
  "NOT_OBSERVED" | "INTRODUCED" | "DEVELOPING" | "PROFICIENT" | "MASTERED" | "DECAY_RISK";
export interface MasteryRecord {
  courseId: string;
  conceptId: string;
  learningOutcomeId: string;
  masteryScore: number;
  masteryState: MasteryState;
  confidenceScore: number;
  evidenceCount: number;
  calculatedAt: string;
  explanation: { whyState: string; nextSteps: string };
}

const masteryStates = new Set<MasteryState>([
  "NOT_OBSERVED",
  "INTRODUCED",
  "DEVELOPING",
  "PROFICIENT",
  "MASTERED",
  "DECAY_RISK",
]);

export function masteryRecords(value: unknown): MasteryRecord[] {
  if (!Array.isArray(value)) throw new ApiError("invalid");
  return value.map((entry) => {
    const row = record(entry);
    const explanation = record(row.explanation);
    const state = row.masteryState;
    if (typeof state !== "string" || !masteryStates.has(state as MasteryState)) throw new ApiError("invalid");
    const score = Number(row.masteryScore);
    const confidence = Number(row.confidenceScore);
    const evidenceCount = Number(row.evidenceCount);
    if (
      !Number.isFinite(score) ||
      score < 0 ||
      score > 100 ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 100 ||
      !Number.isInteger(evidenceCount) ||
      evidenceCount < 0
    )
      throw new ApiError("invalid");
    return {
      courseId: string(row.courseId),
      conceptId: string(row.conceptId),
      learningOutcomeId: string(row.learningOutcomeId),
      masteryScore: score,
      masteryState: state as MasteryState,
      confidenceScore: confidence,
      evidenceCount,
      calculatedAt: string(row.calculatedAt),
      explanation: { whyState: string(explanation.whyState), nextSteps: string(explanation.nextSteps) },
    };
  });
}

export type StudyPlanStatus =
  | "PROPOSED"
  | "PENDING"
  | "ACCEPTED"
  | "SKIPPED"
  | "RESCHEDULED"
  | "COMPLETED"
  | "ALTERNATIVE_REQUESTED"
  | "REPLACED";
export interface StudyPlanItem {
  itemId: string;
  courseId: string;
  lessonId?: string;
  title: string;
  description: string;
  action: string;
  status: StudyPlanStatus;
  scheduledDate: string;
  estimatedMinutes: number;
  rationale: string;
  dueAt?: string;
}
export interface StudyPlan {
  planId: string;
  courseId: string;
  generatedAt: string;
  overallMasteryPercent: number;
  items: StudyPlanItem[];
  masteryGaps: { conceptId: string; conceptName: string; currentScore: number; targetScore: number }[];
  upcomingAssessments: { assessmentId: string; title: string; dueDate: string }[];
}
const planStatuses = new Set<StudyPlanStatus>([
  "PROPOSED",
  "PENDING",
  "ACCEPTED",
  "SKIPPED",
  "RESCHEDULED",
  "COMPLETED",
  "ALTERNATIVE_REQUESTED",
  "REPLACED",
]);

export function studyPlan(value: unknown): StudyPlan {
  const row = record(value);
  if (!Array.isArray(row.items) || !Array.isArray(row.masteryGaps) || !Array.isArray(row.upcomingAssessments))
    throw new ApiError("invalid");
  const percent = Number(row.overallMasteryPercent);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new ApiError("invalid");
  return {
    planId: string(row.planId),
    courseId: string(row.courseId),
    generatedAt: string(row.generatedAt),
    overallMasteryPercent: percent,
    items: row.items.map((entry) => {
      const item = record(entry);
      if (typeof item.status !== "string" || !planStatuses.has(item.status as StudyPlanStatus))
        throw new ApiError("invalid");
      const minutes = Number(item.estimatedMinutes);
      if (!Number.isInteger(minutes) || minutes < 0) throw new ApiError("invalid");
      return {
        itemId: string(item.itemId),
        courseId: string(item.courseId),
        ...(typeof item.lessonId === "string" ? { lessonId: item.lessonId } : {}),
        title: string(item.title),
        description: string(item.description),
        action: string(item.action),
        status: item.status as StudyPlanStatus,
        scheduledDate: string(item.scheduledDate),
        estimatedMinutes: minutes,
        rationale: string(item.rationale),
        ...(typeof item.dueAt === "string" ? { dueAt: item.dueAt } : {}),
      };
    }),
    masteryGaps: row.masteryGaps.map((entry) => {
      const item = record(entry);
      return {
        conceptId: string(item.conceptId),
        conceptName: string(item.conceptName),
        currentScore: Number(item.currentScore),
        targetScore: Number(item.targetScore),
      };
    }),
    upcomingAssessments: row.upcomingAssessments.map((entry) => {
      const item = record(entry);
      return {
        assessmentId: string(item.assessmentId),
        title: string(item.title),
        dueDate: string(item.dueDate),
      };
    }),
  };
}

export interface TutorCitation {
  sourceId: string;
  title: string;
  courseId?: string;
  lessonId?: string;
  snippet?: string;
}
export interface TutorCatalogCourse {
  courseId: string;
  title: string;
  priceAmount: number;
  priceCurrency: string;
}
export interface TutorReply {
  conversationId: string;
  content: string;
  citations: TutorCitation[];
  safetyBlocked: boolean;
  catalogCourses: TutorCatalogCourse[];
}
export function tutorReply(value: unknown): TutorReply {
  const row = record(value);
  if (!Array.isArray(row.citations)) throw new ApiError("invalid");
  const rawCatalog = row.catalogCourses ?? [];
  if (!Array.isArray(rawCatalog)) throw new ApiError("invalid");
  const catalogCourses: TutorCatalogCourse[] = rawCatalog
    .map((entry: unknown) => {
      const course = record(entry);
      const amount = course.priceAmount;
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) throw new ApiError("invalid");
      return {
        courseId: string(course.courseId),
        title: string(course.title),
        priceAmount: amount,
        priceCurrency: string(course.priceCurrency),
      };
    })
    .slice(0, 3);
  return {
    conversationId: string(row.conversationId),
    content: string(row.content),
    safetyBlocked: row.safetyBlocked === true,
    catalogCourses,
    citations: row.citations.map((entry) => {
      const citation = record(entry);
      return {
        sourceId: string(citation.sourceId),
        title: string(citation.title),
        ...(typeof citation.courseId === "string" ? { courseId: citation.courseId } : {}),
        ...(typeof citation.lessonId === "string" ? { lessonId: citation.lessonId } : {}),
        ...(typeof citation.snippet === "string" ? { snippet: citation.snippet } : {}),
      };
    }),
  };
}

export async function askTutor(
  session: Pick<Session, "request">,
  input: {
    mode?: "STUDENT_ADVISOR" | "STUDY_BUDDY";
    courseId?: string;
    conversationId?: string;
    message: string;
    signal: AbortSignal;
  },
): Promise<TutorReply> {
  const response = await session.request("/api/v1/assistant/chat", {
    method: "POST",
    signal: input.signal,
    timeoutMs: 65000,
    body: {
      mode: input.mode ?? "STUDY_BUDDY",
      ...(input.courseId ? { courseId: input.courseId } : {}),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      message: input.message,
      historyLimit: 20,
    },
  });
  // Never turn missing, forbidden, or degraded backend data into synthetic answers or citations.
  return tutorReply(response);
}
