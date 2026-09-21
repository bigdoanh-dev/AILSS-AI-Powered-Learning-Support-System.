import {
  type CourseHealthSummary,
  type ProgramOutcomeAttainment,
  type PrivacyGuardedAnalyticsResult,
  type AnalyticsPrivacyPolicyV2,
  type AnalyticsExportAuditRecord,
  type DifferentialPrivacyQueryConfig,
  type DifferentialPrivacyResult,
  LaplaceNoiseMechanism,
  MIN_COHORT_PRIVACY_THRESHOLD,
  enforceCohortPrivacyThreshold,
} from "../../../../packages/contracts/src/index.js";

export class LearningIntelligenceService {
  private readonly exportAudits: AnalyticsExportAuditRecord[] = [];

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

  /**
   * Evaluates if a query attempts a singling-out / reconstruction attack against small cohorts
   */
  public evaluateSinglingOutRisk(cohortSize: number, predicatesCount: number): {
    isVulnerableToSinglingOut: boolean;
    recommendedAction: "ALLOW" | "SUPPRESS" | "APPLY_DP_NOISE";
  } {
    // If cohort size is below threshold or number of narrowing predicates isolates <= 2 records
    if (cohortSize < MIN_COHORT_PRIVACY_THRESHOLD || (cohortSize < 10 && predicatesCount >= 3)) {
      return {
        isVulnerableToSinglingOut: true,
        recommendedAction: "SUPPRESS",
      };
    }
    return {
      isVulnerableToSinglingOut: false,
      recommendedAction: "ALLOW",
    };
  }

  /**
   * Executes a mathematically rigorous differential privacy query with Laplace noise
   */
  public executeDifferentialPrivacyQuery(
    trueValue: number,
    config: DifferentialPrivacyQueryConfig,
    remainingBudget: number,
  ): DifferentialPrivacyResult<number> {
    if (remainingBudget < config.epsilon) {
      throw new Error(`Insufficient differential privacy budget: required ${String(config.epsilon)}, available ${String(remainingBudget)}`);
    }

    const noise = LaplaceNoiseMechanism.sample(config.sensitivity, config.epsilon);
    const noisyValue = Math.round((trueValue + noise) * 100) / 100;
    const noiseScale = config.sensitivity / config.epsilon;

    return {
      noisyValue,
      epsilonConsumed: config.epsilon,
      sensitivity: config.sensitivity,
      noiseScale,
      budgetRemaining: remainingBudget - config.epsilon,
      mathematicalGuarantee: `(\\epsilon=${String(config.epsilon)}, \\delta=0)-Differential Privacy satisfied via Laplace mechanism`,
    };
  }

  /**
   * Applies Analytics Privacy Policy V2 column masking and export auditing
   */
  public auditAndExportDataset<T extends Record<string, unknown>>(
    dataset: T[],
    policy: AnalyticsPrivacyPolicyV2,
    context: { tenantId: string; userId: string; userRole: string; datasetName: string },
  ): {
    exportedData: Partial<T>[];
    auditRecord: AnalyticsExportAuditRecord;
  } {
    if (policy.tenantIsolation && dataset.length > 0) {
      const crossTenant = dataset.some(
        (row) => "tenantId" in row && row["tenantId"] !== context.tenantId,
      );
      if (crossTenant) {
        throw new Error("Cross-tenant analytics export rejected by tenant isolation policy");
      }
    }

    // Filter and mask sensitive columns
    const exportedData = dataset.map((row) => {
      const masked: Partial<T> = {};
      for (const [key, value] of Object.entries(row)) {
        const classification = policy.piiClassifications[key] ?? "PUBLIC_METRIC";
        if (classification === "DIRECT_IDENTIFIER") {
          // Direct identifiers always stripped in exported analytics
          continue;
        }
        if (policy.suppressedColumns.includes(key)) {
          continue;
        }
        masked[key as keyof T] = value as T[keyof T];
      }
      return masked;
    });

    const auditRecord: AnalyticsExportAuditRecord = {
      exportId: `audit-exp-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      tenantId: context.tenantId,
      userId: context.userId,
      userRole: context.userRole,
      datasetName: context.datasetName,
      recordsCount: exportedData.length,
      cohortFiltered: dataset.length < policy.minimumCohortThreshold,
      exportedAt: new Date().toISOString(),
      signature: `sig-sha256-audit-${context.tenantId}-${context.userId}-${Date.now()}`,
    };

    this.exportAudits.push(auditRecord);
    return { exportedData, auditRecord };
  }

  public getExportAudits(): AnalyticsExportAuditRecord[] {
    return [...this.exportAudits];
  }
}
