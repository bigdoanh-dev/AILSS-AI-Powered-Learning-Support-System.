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

export type CitationQualityClassification =
  | "VALID"
  | "WRONG_DOCUMENT"
  | "WRONG_SECTION"
  | "UNSUPPORTED_CLAIM"
  | "STALE_SOURCE"
  | "RETRIEVAL_MISMATCH"
  | "WRONG_SOURCE"
  | "MISSING_CITATION"
  | "RETRIEVAL_FAILURE";

export interface AITutorCitation {
  sourceType: "COURSE_MATERIAL" | "LESSON_TRANSCRIPT" | "DOCUMENT_LIBRARY";
  documentId: string;
  documentTitle: string;
  sectionOrPage?: string | undefined;
  courseId: string;
  snippet: string;
  confidenceScore?: number | undefined; // 0.0 - 1.0
  classification?: CitationQualityClassification | undefined;
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
  personalizationEnabled?: boolean | undefined;
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
  citationConfidence?: number | undefined; // 0.0 - 1.0
  isAbstainedDueToLowEvidence?: boolean | undefined;
  suggestedNextAction?: {
    action: "REVIEW_PREREQUISITE" | "PRACTICE_QUESTION" | "ASK_FOLLOW_UP";
    targetId: string;
    description: string;
  } | undefined;
  guardrailsTriggered: {
    answerKeyRedacted: boolean;
    offTopicAbstained: boolean;
    tenantBoundaryEnforced: boolean;
    promptInjectionBlocked?: boolean | undefined;
  };
}

// ============================================================================
// 39.A14: ai-tutor-eval-v1 Evaluation Benchmark (Legacy)
// ============================================================================
export interface AITutorEvalBenchmarkResult {
  evaluationSuite: "ai-tutor-eval-v1";
  evaluatedAt: string;
  testCasesCount: number;
  metrics: {
    factualityScorePercent: number;
    citationAccuracyScorePercent: number;
    pedagogicalQualityScorePercent: number;
    hintComplianceScorePercent: number;
    assessmentAnswerLeakageRatePercent: number;
    tenantIsolationBreachCount: number;
    masteryAwarenessAlignmentPercent: number;
    appropriateAbstentionPercent: number;
  };
  passed: boolean;
}

// ============================================================================
// 40.24 & 40.25: AI Tutor Session Controls & Memory Architecture
// ============================================================================
export interface AITutorSessionControls {
  sessionId: string;
  studentId: string;
  tenantId: string;
  currentMode: AITutorPedagogicalMode;
  personalizationEnabled: boolean;
  clearConversation(): void;
  startNewTopic(topic: string): void;
  setPedagogicalMode(mode: AITutorPedagogicalMode): void;
  togglePersonalization(enabled: boolean): void;
}

export interface AITutorMemoryContext {
  sessionId: string;
  sessionTurnsCount: number;
  courseId: string;
  courseTitle: string;
  masteryGaps: string[];
  userPreferences: {
    preferredTone: "CONCISE" | "DETAILED" | "SOCRATIC";
    language: "vi" | "en";
  };
  retentionPolicyDays: number;
  ephemeralSessionOnly: boolean;
}

// ============================================================================
// 40.20 - 40.22: ai-tutor-eval-v2 Benchmark Result Contract
// ============================================================================
export interface AITutorEvalV2BenchmarkResult {
  evaluationSuite: "ai-tutor-eval-v2";
  datasetVersion: string; // e.g. "2.0.0"
  totalSamples: number;
  samplesByCategory: Record<string, number>;
  courseCount: number;
  tenantCount: number;
  languages: string[];
  modelVersion: string;
  retrieverVersion: string;
  promptVersion: string;
  evaluatedAt: string;
  metrics: {
    factualityPercent: number; // target >= 95%
    citationCorrectnessPercent: number; // target >= 92%
    citationCompletenessPercent: number; // target >= 90%
    pedagogicalUsefulnessPercent: number; // target >= 90%
    instructionFollowingPercent: number; // target >= 98%
    masteryAwarenessPercent: number; // target >= 92%
    abstentionQualityPercent: number; // target >= 96%
  };
  assessmentIntegrity: {
    totalAttacks: number;
    successfulAttacks: number;
    attackSuccessRatio: string; // "0 / N"
    leakageDetected: boolean;
    zeroFailureDisclaimer: string; // "0% observed leakage does NOT imply zero risk"
  };
  verdict: "PASS" | "FAIL";
}

// ============================================================================
// 40.C20 - 40.C24: ai-tutor-eval-v3 Benchmark Result with Explicit Denominators
// ============================================================================
export interface MetricRatio {
  passed: number;
  total: number;
  percentage: number;
}

export interface AITutorEvalV3BenchmarkResult {
  evaluationSuite: "ai-tutor-eval-v3";
  datasetVersion: "3.0.0";
  totalSamples: number;
  samplesByCategory: Record<string, number>;
  courseCount: number;
  tenantCount: number;
  languages: string[];
  modelVersion: string;
  retrieverVersion: string;
  promptVersion: string;
  evaluatedAt: string;
  metrics: {
    factuality: MetricRatio;
    citationCorrectness: MetricRatio;
    citationCompleteness: MetricRatio;
    pedagogicalUsefulness: MetricRatio;
    instructionFollowing: MetricRatio;
    masteryAwareness: MetricRatio;
    abstentionQuality: MetricRatio;
  };
  pilotThresholds: {
    factualityTarget: number; // >= 95%
    citationCorrectnessTarget: number; // >= 92%
    assessmentLeakageTarget: string; // "0 / N"
    allThresholdsMet: boolean;
  };
  assessmentIntegrity: {
    totalAttacks: number;
    successfulAttacks: number;
    attackSuccessRatio: string; // "0 / 16"
    leakageDetected: boolean;
    zeroFailureDisclaimer: string;
  };
  verdict: "PASS" | "FAIL";
}
