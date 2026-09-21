import { z } from "zod";

// ============================================================================
// 39.A9 & 39.A11: AI Tutor Pedagogical Modes & Execution Boundaries
// ============================================================================
export const AITutorPedagogicalModeEnum = z.enum([
  "EXPLAIN",
  "SOCRATIC",
  "HINT_ONLY",
  "PRACTICE",
  "REVISION",
  "EXAM_PREP",
]);
export type AITutorPedagogicalMode = z.infer<typeof AITutorPedagogicalModeEnum>;

export interface AITutorToolContext {
  tenantId: string;
  userId: string;
  courseId: string;
  userRole: "STUDENT" | "LECTURER" | "ADMIN";
  permittedTools: readonly string[];
}

export interface AITutorCitation {
  sourceType: "COURSE_MATERIAL" | "LESSON_TRANSCRIPT" | "DOCUMENT_LIBRARY";
  documentId: string;
  documentTitle: string;
  sectionOrPage?: string | undefined;
  courseId: string;
  snippet: string;
}

export interface AITutorInteractionRequest {
  sessionId: string;
  tenantId: string;
  studentId: string;
  courseId: string;
  lessonId?: string | undefined;
  conceptId?: string | undefined;
  pedagogicalMode: AITutorPedagogicalMode;
  userMessage: string;
  assessmentContext?: {
    isGradedAssessmentActive: boolean;
    restrictedQuizId?: string | undefined;
    restrictedQuestionId?: string | undefined;
  } | undefined;
}

export interface AITutorInteractionResponse {
  sessionId: string;
  messageId: string;
  pedagogicalMode: AITutorPedagogicalMode;
  responseContent: string;
  citations: AITutorCitation[];
  suggestedNextAction?: {
    action: "REVIEW_PREREQUISITE" | "PRACTICE_QUESTION" | "ASK_FOLLOW_UP";
    targetId: string;
    description: string;
  } | undefined;
  guardrailsTriggered: {
    answerKeyRedacted: boolean;
    offTopicAbstained: boolean;
    tenantBoundaryEnforced: boolean;
  };
}

// ============================================================================
// 39.A14: ai-tutor-eval-v1 Evaluation Benchmark
// ============================================================================
export interface AITutorEvalBenchmarkResult {
  evaluationSuite: "ai-tutor-eval-v1";
  evaluatedAt: string;
  testCasesCount: number;
  metrics: {
    factualityScorePercent: number; // target >= 95%
    citationAccuracyScorePercent: number; // target >= 92%
    pedagogicalQualityScorePercent: number; // target >= 90%
    hintComplianceScorePercent: number; // target >= 98%
    assessmentAnswerLeakageRatePercent: number; // target 0.0%
    tenantIsolationBreachCount: number; // target 0
    masteryAwarenessAlignmentPercent: number; // target >= 92%
    appropriateAbstentionPercent: number; // target >= 96%
  };
  passed: boolean;
}
