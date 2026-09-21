// ============================================================================
// 40.12 - 40.14: Analytics Privacy & Small-Cohort Suppression (NOT Differential Privacy)
// ============================================================================

export const MIN_COHORT_PRIVACY_THRESHOLD = 5;
export const SMALL_COHORT_SUPPRESSION = "SMALL_COHORT_SUPPRESSION" as const;

export interface PrivacyGuardedAnalyticsResult<T> {
  data: T | null;
  mechanism: typeof SMALL_COHORT_SUPPRESSION;
  isSuppressedDueToSmallCohort: boolean;
  sampleSize: number;
  minimumThreshold: number;
  suppressionNotice?: string | undefined;
}

/**
 * Enforces minimum cohort privacy threshold to prevent singling-out / re-identification.
 * NOTE: This is strictly small-cohort suppression (k-anonymity style thresholding),
 * NOT differential privacy (no Laplacian/Gaussian noise addition).
 */
export function enforceCohortPrivacyThreshold<T>(
  cohortCount: number,
  dataBuilder: () => T,
): PrivacyGuardedAnalyticsResult<T> {
  if (cohortCount < MIN_COHORT_PRIVACY_THRESHOLD) {
    return {
      data: null,
      mechanism: SMALL_COHORT_SUPPRESSION,
      isSuppressedDueToSmallCohort: true,
      sampleSize: cohortCount,
      minimumThreshold: MIN_COHORT_PRIVACY_THRESHOLD,
      suppressionNotice: `Aggregated analytics are suppressed because the cohort size (${String(cohortCount)}) is below the minimum privacy threshold (${String(MIN_COHORT_PRIVACY_THRESHOLD)}) to prevent individual re-identification.`,
    };
  }
  return {
    data: dataBuilder(),
    mechanism: SMALL_COHORT_SUPPRESSION,
    isSuppressedDueToSmallCohort: false,
    sampleSize: cohortCount,
    minimumThreshold: MIN_COHORT_PRIVACY_THRESHOLD,
  };
}

// ============================================================================
// 40.13: Mathematical Differential Privacy Specification (Optional True DP)
// ============================================================================
export interface DifferentialPrivacyQueryConfig {
  queryType: "COUNT" | "SUM" | "MEAN" | "HISTOGRAM";
  sensitivity: number; // L1 sensitivity \Delta f
  noiseMechanism: "LAPLACE" | "GAUSSIAN";
  epsilon: number; // \epsilon privacy parameter
  delta?: number | undefined; // \delta for Gaussian mechanism
  privacyBudget: number; // Total allowable \epsilon per epoch
  budgetResetLifecycle: "DAILY" | "WEEKLY" | "ACADEMIC_TERM";
}

export interface DifferentialPrivacyResult<T> {
  noisyValue: T;
  epsilonConsumed: number;
  sensitivity: number;
  noiseScale: number; // b = \Delta f / \epsilon
  budgetRemaining: number;
  mathematicalGuarantee: string;
}

export class LaplaceNoiseMechanism {
  /**
   * Samples noise from Laplace(0, b) where b = sensitivity / epsilon
   */
  public static sample(sensitivity: number, epsilon: number): number {
    if (epsilon <= 0) throw new Error("Epsilon must be strictly positive");
    const b = sensitivity / epsilon;
    // Inverse CDF: F^{-1}(u) = -b * sgn(u - 0.5) * ln(1 - 2|u - 0.5|)
    const u = Math.random();
    const centered = u - 0.5;
    const sign = centered < 0 ? -1 : 1;
    return -b * sign * Math.log(1 - 2 * Math.abs(centered));
  }
}

// ============================================================================
// 40.14: Analytics Privacy V2 (Role Scope, Tenant Isolation, Singling-out Defense)
// ============================================================================
export type PIISensitivityLevel =
  | "DIRECT_IDENTIFIER" // e.g., student name, email, student ID -> always suppressed in aggregates
  | "QUASI_IDENTIFIER" // e.g., cohort, major, birth year -> suppressed if cohort < threshold
  | "SENSITIVE_ATTRIBUTE" // e.g., disability accommodation, grade, sanction -> strict role gating
  | "PUBLIC_METRIC"; // e.g., course title, syllabus -> publicly visible

export interface AnalyticsPrivacyPolicyV2 {
  minimumCohortThreshold: number;
  roleScope: "INSTRUCTOR" | "ADMIN" | "RESEARCHER";
  tenantIsolation: boolean;
  exportAuditRequired: boolean;
  suppressedColumns: string[];
  piiClassifications: Record<string, PIISensitivityLevel>;
}

export interface AnalyticsExportAuditRecord {
  exportId: string;
  tenantId: string;
  userId: string;
  userRole: string;
  datasetName: string;
  recordsCount: number;
  cohortFiltered: boolean;
  exportedAt: string;
  signature: string;
}

// ============================================================================
// 39.A29: Course Health Intelligence
// ============================================================================
export interface CourseHealthSummary {
  courseId: string;
  tenantId: string;
  enrolledStudentsCount: number;
  activeLearners7d: number;
  averageProgressPercent: number;
  masteryDistribution: {
    NOT_OBSERVED: number;
    INTRODUCED: number;
    DEVELOPING: number;
    PROFICIENT: number;
    MASTERED: number;
    DECAY_RISK: number;
  };
  assessmentAverageScore: number;
  topMisconceptions: {
    conceptId: string;
    conceptName: string;
    affectedCount: number;
  }[];
  atRiskCount: number;
  aiTutorSessionsCount: number;
  generatedAt: string;
}

// ============================================================================
// 39.A30: Program Outcome Intelligence
// ============================================================================
export interface ProgramOutcomeAttainment {
  programId: string;
  tenantId: string;
  outcomeId: string;
  outcomeCode: string;
  outcomeTitle: string;
  attainmentPercent: number; // % of students proficient or mastered
  assessedEvidenceCount: number;
  isCurriculumGap: boolean; // if evidenceCount == 0 or attainment < 50%
}
