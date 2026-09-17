import { z } from "zod";

export interface LessonFrictionSignal {
  lessonId: string;
  lessonTitle: string;
  courseId: string;
  averageQuizScorePercent: number;
  averageAttemptsPerStudent: number;
  assistantQueryCount: number;
  completionRatePercent: number;
}

export interface FrictionDiagnosticReport {
  lessonId: string;
  lessonTitle: string;
  courseId: string;
  frictionLevel: "HIGH" | "MEDIUM" | "LOW";
  isHighFriction: boolean;
  diagnostics: string[];
  suggestedInterventions: string[];
  metrics: {
    averageQuizScorePercent: number;
    averageAttemptsPerStudent: number;
    assistantQueryCount: number;
    completionRatePercent: number;
  };
}

export const ExperimentVariant = z.enum(["CONTROL", "ADAPTIVE_RECOMMENDATIONS_V1", "STEP_BY_STEP_V2"]);
export type ExperimentVariant = z.infer<typeof ExperimentVariant>;

export const RESTRICTED_EXPERIMENT_DOMAINS = [
  "AUTHENTICATION",
  "PAYMENT",
  "FINANCE_LEDGER",
  "RBAC",
  "ACADEMIC_INTEGRITY",
  "ACCOUNT_LINKING",
  "SAFETY_REFUSAL",
] as const;

export interface LearningExperiment {
  experimentId: string;
  name: string;
  courseId?: string | undefined;
  status: "DRAFT" | "ACTIVE" | "CONCLUDED";
  variants: ExperimentVariant[];
  targetMetric: string;
  hypothesis?: string | undefined;
  eligiblePopulation?: string | undefined;
  primaryMetric?: string | undefined;
  guardrailMetrics?: string[] | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
  createdAt: string;
}

export interface StudentExperimentAssignment {
  studentId: string;
  experimentId: string;
  assignedVariant: ExperimentVariant;
  assignedAt: string;
}
