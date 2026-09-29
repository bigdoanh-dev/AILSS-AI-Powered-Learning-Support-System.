import { z } from "zod";

// ============================================================================
// 39.A1 & 40.15 - 40.17: Canonical Learning-Outcome Graph & Mastery Policy V2
// ============================================================================
export const MasteryStateEnum = z.enum([
  "NOT_OBSERVED",
  "INTRODUCED",
  "DEVELOPING",
  "PROFICIENT",
  "MASTERED",
  "DECAY_RISK",
]);
export type MasteryState = z.infer<typeof MasteryStateEnum>;

export interface LearningOutcomeNode {
  outcomeId: string;
  programId?: string | undefined;
  courseId: string;
  moduleId?: string | undefined;
  code: string;
  title: string;
  description: string;
  bloomTaxonomyLevel: "REMEMBER" | "UNDERSTAND" | "APPLY" | "ANALYZE" | "EVALUATE" | "CREATE";
  concepts: string[];
}

export interface PrerequisiteEdgeV2 {
  sourceConceptId: string;
  targetConceptId: string;
  courseId: string;
  tenantId: string;
  strength: "REQUIRED" | "RECOMMENDED";
}

export interface MultiFactorEvidence {
  evidenceId: string;
  evidenceSource:
    | "QUIZ"
    | "MANUAL_ASSESSMENT"
    | "LESSON_COMPLETION"
    | "TEACHER_OBSERVATION"
    | "PRACTICE_ATTEMPT"
    | "PROCTORED_EXAM"
    | "FINAL_PROJECT"
    | "LAB"
    | "ASSIGNMENT"
    | "DIAGNOSTIC"
    | "PRACTICE"
    | "AI_CONVERSATION";
  questionDifficulty?: number | undefined; // 0.0 - 1.0
  rawScorePercent: number; // 0 - 100
  attemptNumber: number;
  timestamp: string;
  recencyWeight?: number | undefined; // calculated exponential decay factor
}

export interface MasteryPolicyConfig {
  policyId: string;
  version: string;
  tenantId?: string | undefined;
  evidenceWeights: Record<string, number>;
  attemptDampenerFactor: number;
  difficultyBonusMultiplier: number;
  freshWindowDays: number;
  staleWindowDays: number;
  decayLambda: number;
  decayFloor: number;
  developingThreshold: number;
  proficientThreshold: number;
  masteredThreshold: number;
  prerequisiteClampThreshold: number;
  prerequisitePolicy: "STRICT_CLAMP" | "WARN_ONLY";
}

export const CANONICAL_MASTERY_POLICY_V2: MasteryPolicyConfig = {
  policyId: "ailss-canonical-mastery-v2",
  version: "2.0.0",
  evidenceWeights: {
    QUIZ: 0.35,
    MANUAL_ASSESSMENT: 0.35,
    TEACHER_OBSERVATION: 0.2,
    LESSON_COMPLETION: 0.1,
    PRACTICE_ATTEMPT: 0.15,
  },
  attemptDampenerFactor: 0.15,
  difficultyBonusMultiplier: 0.2,
  freshWindowDays: 14,
  staleWindowDays: 21,
  decayLambda: 0.015,
  decayFloor: 25,
  developingThreshold: 40,
  proficientThreshold: 75,
  masteredThreshold: 90,
  prerequisiteClampThreshold: 74,
  prerequisitePolicy: "STRICT_CLAMP",
};

export interface MasteryRecordV2 {
  studentId: string;
  tenantId: string;
  learningOutcomeId: string;
  conceptId: string;
  courseId: string;
  masteryScore: number; // 0 - 100
  masteryState: MasteryState;
  previousMasteryState?: MasteryState | undefined;
  confidenceScore: number; // 0 - 100
  evidenceCount: number;
  evidenceIds: string[];
  algorithmVersion: string; // e.g. "v2.0.0"
  masteryPolicyId?: string | undefined;
  masteryPolicyVersion?: string | undefined;
  effectiveAt?: string | undefined;
  calculatedAt: string;
  lastDecayEvaluationAt: string;
  explanation: {
    whyState: string;
    nextSteps: string;
    contributingFactors: {
      assessmentPerformance: number;
      attemptCount: number;
      recencyStatus: "FRESH" | "STALE" | "DECAYING";
      prerequisiteFoundationMet: boolean;
    };
  };
}

export interface MasteryHistoryRecord {
  historyId: string;
  studentId: string;
  tenantId: string;
  courseId: string;
  conceptId: string;
  learningOutcomeId: string;
  currentScore: number;
  currentState: MasteryState;
  previousScore: number;
  previousState: MasteryState;
  changeReason: string;
  contributingFactors: {
    assessmentPerformance: number;
    attemptCount: number;
    recencyStatus: "FRESH" | "STALE" | "DECAYING";
    prerequisiteFoundationMet: boolean;
  };
  recommendedNextActions: string[];
  changedAt: string;
}

// ============================================================================
// 39.A4: Prerequisite DAG Validation
// ============================================================================
export interface DAGValidationResult {
  isValid: boolean;
  cyclesDetected: string[][];
  orphanConcepts: string[];
  missingPrerequisites: string[];
  invalidCrossTenantEdges: string[];
}

// ============================================================================
// 39.A5 & 39.A6: Personalized Study Plan
// ============================================================================
export const StudyPlanItemActionEnum = z.enum([
  "REVIEW_CONCEPT",
  "WATCH_LESSON",
  "READ_CONTENT",
  "PRACTICE_QUESTIONS",
  "TAKE_DIAGNOSTIC",
  "ASK_AI_TUTOR",
  "RETRY_ASSESSMENT",
  "CONTACT_INSTRUCTOR",
]);
export type StudyPlanItemAction = z.infer<typeof StudyPlanItemActionEnum>;

export const StudyPlanItemStatusEnum = z.enum([
  "PROPOSED",
  "PENDING",
  "ACCEPTED",
  "SKIPPED",
  "RESCHEDULED",
  "COMPLETED",
  "ALTERNATIVE_REQUESTED",
  "REPLACED",
]);
export type StudyPlanItemStatus = z.infer<typeof StudyPlanItemStatusEnum>;

export interface StudyPlanItem {
  itemId: string;
  planId: string;
  courseId: string;
  lessonId?: string | undefined;
  conceptId: string;
  title: string;
  description: string;
  action: StudyPlanItemAction;
  status: StudyPlanItemStatus;
  scheduledDate: string; // ISO date YYYY-MM-DD
  estimatedMinutes: number;
  priority: number; // 1 (highest) to 5
  reasonCode:
    "LOW_MASTERY" | "PREREQUISITE_GAP" | "RECENCY_DECAY" | "UPCOMING_ASSESSMENT" | "TEACHER_PRIORITY";
  rationale: string;
  /** Mandatory on the Phase 40 runtime path; optional here for historical payload compatibility. */
  sourceType?: "MASTERY_PROJECTION" | "COURSE_REQUIREMENT" | "ASSESSMENT";
  sourceId?: string;
  sourceVersion?: number;
  dueAt?: string;
  learningOutcomeId?: string;
  masteryPolicyVersion?: string;
  generatedAt?: string;
}

export interface StudyPlanV2 {
  planId: string;
  studentId: string;
  tenantId: string;
  courseId: string;
  weekStartDate: string; // ISO date
  generatedAt: string;
  items: StudyPlanItem[];
  overallMasteryPercent: number;
  masteryGaps: {
    conceptId: string;
    conceptName: string;
    currentScore: number;
    targetScore: number;
  }[];
  upcomingAssessments: {
    assessmentId: string;
    title: string;
    dueDate: string;
    targetOutcomeIds: string[];
  }[];
}

// ============================================================================
// 39.A7 & 39.A8: Adaptive Next-Action Engine & Feedback Loop
// ============================================================================
export interface NextActionRecommendation {
  recommendationId: string;
  studentId: string;
  courseId: string;
  action: StudyPlanItemAction;
  targetId: string; // conceptId or lessonId or assessmentId
  title: string;
  reasonCode:
    "LOW_MASTERY" | "PREREQUISITE_GAP" | "RECENCY_DECAY" | "UPCOMING_ASSESSMENT" | "TEACHER_PRIORITY";
  reasonDescription: string;
  urgencyScore: number; // 0 - 100
  loopPreventionHash: string; // hash of (studentId, action, targetId, last24h)
}

export interface RecommendationFeedbackEvent {
  feedbackId: string;
  recommendationId: string;
  studentId: string;
  actionTaken: "ACCEPTED" | "COMPLETED" | "DISMISSED" | "EXPIRED";
  masteryDeltaAfterCompletion?: number | undefined;
  timeToImprovementHours?: number | undefined;
  recordedAt: string;
}
