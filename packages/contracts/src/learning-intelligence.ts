import { z } from "zod";

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

// ============================================================================
// 39.A31: Analytics Privacy & Differential Thresholding
// ============================================================================
export const MIN_COHORT_PRIVACY_THRESHOLD = 5;

export interface PrivacyGuardedAnalyticsResult<T> {
  data: T | null;
  isSuppressedDueToSmallCohort: boolean;
  sampleSize: number;
  minimumThreshold: number;
  suppressionNotice?: string | undefined;
}

export function enforceCohortPrivacyThreshold<T>(
  cohortCount: number,
  dataBuilder: () => T,
): PrivacyGuardedAnalyticsResult<T> {
  if (cohortCount < MIN_COHORT_PRIVACY_THRESHOLD) {
    return {
      data: null,
      isSuppressedDueToSmallCohort: true,
      sampleSize: cohortCount,
      minimumThreshold: MIN_COHORT_PRIVACY_THRESHOLD,
      suppressionNotice: `Aggregated analytics are suppressed because the cohort size (${String(cohortCount)}) is below the privacy threshold (${String(MIN_COHORT_PRIVACY_THRESHOLD)}) to prevent individual re-identification.`,
    };
  }
  return {
    data: dataBuilder(),
    isSuppressedDueToSmallCohort: false,
    sampleSize: cohortCount,
    minimumThreshold: MIN_COHORT_PRIVACY_THRESHOLD,
  };
}
