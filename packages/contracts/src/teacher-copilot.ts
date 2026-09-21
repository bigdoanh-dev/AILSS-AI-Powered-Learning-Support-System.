import { z } from "zod";

// ============================================================================
// 39.A15 & 39.A16: Teacher Copilot Drafts & Human Approval Gate
// ============================================================================
export const CopilotDraftTypeEnum = z.enum([
  "QUESTION_DRAFT",
  "RUBRIC_DRAFT",
  "LESSON_SUMMARY_DRAFT",
  "INTERVENTION_DRAFT",
]);
export type CopilotDraftType = z.infer<typeof CopilotDraftTypeEnum>;

export const ApprovalStatusEnum = z.enum([
  "DRAFT",
  "REVIEWED",
  "APPROVED",
  "REJECTED",
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusEnum>;

export interface GeneratedQuestionDraft {
  draftId: string;
  courseId: string;
  moduleId?: string | undefined;
  learningOutcomeId: string;
  questionType: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER";
  questionText: string;
  options?: { id: string; text: string }[] | undefined;
  correctAnswerSummary: string;
  explanation: string;
  difficultyProposal: "INTRODUCTORY" | "INTERMEDIATE" | "ADVANCED";
  sourceContentIds: string[];
  modelVersion: string;
  promptTemplateVersion: string;
  status: ApprovalStatus;
  generatedAt: string;
  approvedBy?: string | undefined;
  approvedAt?: string | undefined;
  rejectionReason?: string | undefined;
}

export interface RubricCriterion {
  criterionId: string;
  title: string;
  description: string;
  maxPoints: number;
  levels: {
    levelName: string;
    points: number;
    description: string;
  }[];
}

export interface GeneratedRubricDraft {
  draftId: string;
  assessmentId: string;
  courseId: string;
  title: string;
  criteria: RubricCriterion[];
  totalPoints: number;
  learningOutcomeIds: string[];
  modelVersion: string;
  status: ApprovalStatus;
  generatedAt: string;
  approvedBy?: string | undefined;
  approvedAt?: string | undefined;
}

// ============================================================================
// 39.A18: Student Misconception Aggregation (Privacy-Preserved)
// ============================================================================
export interface MisconceptionInsight {
  misconceptionId: string;
  courseId: string;
  conceptId: string;
  conceptName: string;
  affectedLearnersCount: number;
  cohortPercentage: number;
  commonWrongPattern: string;
  supportingQuestionIds: string[];
  recommendedRemediation: string;
  detectedAt: string;
}

// ============================================================================
// 39.A19 & 39.A20: Early-Warning Signals & Intervention Workflow
// ============================================================================
export const RiskSignalTypeEnum = z.enum([
  "MISSED_ACTIVITY",
  "RAPID_MASTERY_DECLINE",
  "REPEATED_FAILED_ATTEMPTS",
  "LONG_INACTIVITY",
  "DEADLINE_RISK",
  "TEACHER_DEFINED_RULE",
]);
export type RiskSignalType = z.infer<typeof RiskSignalTypeEnum>;

export interface StudentRiskSignal {
  signalId: string;
  studentId: string;
  courseId: string;
  tenantId: string;
  signalType: RiskSignalType;
  severity: "LOW" | "MEDIUM" | "HIGH";
  actionableExplanation: string; // transparent explanation, not opaque AI score
  evidenceDetails: {
    metricName: string;
    currentValue: string | number;
    threshold: string | number;
  };
  detectedAt: string;
}

export const InterventionStatusEnum = z.enum([
  "OPEN",
  "DISMISSED",
  "CONTACTED_STUDENT",
  "ASSIGNED_REMEDIATION",
  "RESOLVED",
]);
export type InterventionStatus = z.infer<typeof InterventionStatusEnum>;

export interface StudentInterventionRecord {
  interventionId: string;
  tenantId: string;
  studentId: string;
  courseId: string;
  triggerSignalId: string;
  status: InterventionStatus;
  notes?: string | undefined;
  remediationAction?: string | undefined;
  assignedBy: string; // instructorId
  assignedAt: string;
  resolvedAt?: string | undefined;
  resolutionSummary?: string | undefined;
}
