import {
  type CourseHealthSummary,
  type ProgramOutcomeAttainment,
  type PrivacyGuardedAnalyticsResult,
  enforceCohortPrivacyThreshold,
} from "../../../../packages/contracts/src/index.js";

export class LearningIntelligenceService {
  public computeCourseHealth(input: {
    courseId: string;
    tenantId: string;
    enrolledStudentsCount: number;
    activeLearners7d: number;
    lessonCompletionsPercent: number;
    masteryScores: { conceptId: string; score: number; state: string }[];
    assessmentScores: number[];
    misconceptions: { conceptId: string; conceptName: string; affectedCount: number }[];
    atRiskStudentsCount: number;
    aiTutorSessionsCount: number;
  }): PrivacyGuardedAnalyticsResult<CourseHealthSummary> {
    return enforceCohortPrivacyThreshold(input.enrolledStudentsCount, () => {
      const distribution = {
        NOT_OBSERVED: 0,
        INTRODUCED: 0,
        DEVELOPING: 0,
        PROFICIENT: 0,
        MASTERED: 0,
        DECAY_RISK: 0,
      };

      for (const m of input.masteryScores) {
        if (m.state in distribution) {
          distribution[m.state as keyof typeof distribution]++;
        }
      }

      const avgAssessment =
        input.assessmentScores.length > 0
          ? Math.round(
              input.assessmentScores.reduce((a, b) => a + b, 0) / input.assessmentScores.length,
            )
          : 0;

      return {
        courseId: input.courseId,
        tenantId: input.tenantId,
        enrolledStudentsCount: input.enrolledStudentsCount,
        activeLearners7d: input.activeLearners7d,
        averageProgressPercent: input.lessonCompletionsPercent,
        masteryDistribution: distribution,
        assessmentAverageScore: avgAssessment,
        topMisconceptions: input.misconceptions.slice(0, 3),
        atRiskCount: input.atRiskStudentsCount,
        aiTutorSessionsCount: input.aiTutorSessionsCount,
        generatedAt: new Date().toISOString(),
      };
    });
  }

  public computeProgramOutcomes(input: {
    programId: string;
    tenantId: string;
    outcomes: {
      outcomeId: string;
      code: string;
      title: string;
      studentScores: number[];
    }[];
  }): ProgramOutcomeAttainment[] {
    return input.outcomes.map((o) => {
      const proficientCount = o.studentScores.filter((s) => s >= 75).length;
      const attainmentPercent =
        o.studentScores.length > 0
          ? Math.round((proficientCount / o.studentScores.length) * 100)
          : 0;
      const isCurriculumGap = o.studentScores.length === 0 || attainmentPercent < 50;

      return {
        programId: input.programId,
        tenantId: input.tenantId,
        outcomeId: o.outcomeId,
        outcomeCode: o.code,
        outcomeTitle: o.title,
        attainmentPercent,
        assessedEvidenceCount: o.studentScores.length,
        isCurriculumGap,
      };
    });
  }
}
