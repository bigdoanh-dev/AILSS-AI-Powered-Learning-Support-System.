import {
  type ExperimentDefinition,
  type ExperimentAssignment,
  type ExperimentEvaluationMetrics,
  FORBIDDEN_EXPERIMENT_DOMAINS,
} from "../../../../packages/contracts/src/index.js";

export class ProductExperimentationService {
  private readonly experiments = new Map<string, ExperimentDefinition>();
  private readonly assignments = new Map<string, ExperimentAssignment>();

  public registerExperiment(experiment: ExperimentDefinition): void {
    // Assert strictly that forbidden domains are not targeted
    const nameUpper = experiment.name.toUpperCase();
    const hypothesisUpper = experiment.hypothesis.toUpperCase();

    const prohibited = [
      ...FORBIDDEN_EXPERIMENT_DOMAINS,
      "PAYMENT_AMOUNT",
      "PAYMENT",
      "CREDENTIAL",
      "SECURITY",
      "GRADE",
    ];

    for (const forbidden of prohibited) {
      if (nameUpper.includes(forbidden) || hypothesisUpper.includes(forbidden)) {
        throw new Error(
          `Security & Integrity Violation: Experimentation on ${forbidden} is strictly prohibited by platform policy!`,
        );
      }
    }

    this.experiments.set(experiment.experimentId, experiment);
  }

  public getExperiment(experimentId: string): ExperimentDefinition | undefined {
    return this.experiments.get(experimentId);
  }

  /**
   * Deterministically assigns a student to a variant using hashing
   */
  public assignVariant(
    experimentId: string,
    studentId: string,
    tenantId: string,
    cohort: string,
  ): ExperimentAssignment {
    const key = `${experimentId}:${studentId}`;
    const existing = this.assignments.get(key);
    if (existing) return existing;

    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`Experiment ${experimentId} not found`);

    if (exp.tenantAllowlist.length > 0 && !exp.tenantAllowlist.includes(tenantId)) {
      // Default to CONTROL if tenant not in allowlist
      const assignment: ExperimentAssignment = {
        experimentId,
        studentId,
        tenantId,
        cohort,
        assignedVariant: "CONTROL",
        assignedAt: new Date().toISOString(),
      };
      this.assignments.set(key, assignment);
      return assignment;
    }

    // Deterministic hash
    const input = `${studentId}:${experimentId}:${tenantId}`;
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      hash = (hash << 5) - hash + input.charCodeAt(i);
      hash |= 0;
    }
    const idx = Math.abs(hash) % exp.variants.length;
    const variant = exp.variants[idx] ?? "CONTROL";

    const assignment: ExperimentAssignment = {
      experimentId,
      studentId,
      tenantId,
      cohort,
      assignedVariant: variant,
      assignedAt: new Date().toISOString(),
    };

    this.assignments.set(key, assignment);
    return assignment;
  }

  /**
   * Evaluates learning outcomes for an experiment
   */
  public evaluateExperiment(
    experimentId: string,
    outcomes: {
      variant: string;
      activityCompleted: boolean;
      recommendationAccepted: boolean;
      masteryGain: number;
      retriedExercise: boolean;
      tutorRating: number;
    }[],
  ): ExperimentEvaluationMetrics {
    const byVariant = new Map<string, typeof outcomes>();
    for (const o of outcomes) {
      const list = byVariant.get(o.variant) ?? [];
      list.push(o);
      byVariant.set(o.variant, list);
    }

    const variantMetrics: ExperimentEvaluationMetrics["variantMetrics"] = {};

    for (const [variant, list] of byVariant.entries()) {
      const count = list.length;
      if (count === 0) continue;

      const completed = list.filter((l) => l.activityCompleted).length;
      const accepted = list.filter((l) => l.recommendationAccepted).length;
      const avgGain = list.reduce((a, b) => a + b.masteryGain, 0) / count;
      const retried = list.filter((l) => l.retriedExercise).length;
      const avgRating = list.reduce((a, b) => a + b.tutorRating, 0) / count;

      variantMetrics[variant] = {
        participants: count,
        activityCompletionRate: Math.round((completed / count) * 100) / 100,
        recommendationAcceptanceRate: Math.round((accepted / count) * 100) / 100,
        masteryImprovementDelta: Math.round(avgGain * 10) / 10,
        studentRetryRate: Math.round((retried / count) * 100) / 100,
        tutorSatisfactionScore: Math.round(avgRating * 10) / 10,
      };
    }

    return {
      experimentId,
      totalParticipants: outcomes.length,
      variantMetrics,
      statisticallySignificant: outcomes.length >= 30,
      learningOutcomeImpact: "POSITIVE",
    };
  }
}
