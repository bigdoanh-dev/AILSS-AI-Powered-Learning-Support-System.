import { createHash } from "node:crypto";
import { RESTRICTED_EXPERIMENT_DOMAINS } from "./model.js";
import type { ExperimentVariant, LearningExperiment, StudentExperimentAssignment } from "./model.js";

export class LearningExperimentationService {
  private readonly experiments = new Map<string, LearningExperiment>();
  private readonly assignments = new Map<string, StudentExperimentAssignment>();

  createExperiment(input: {
    experimentId: string;
    name: string;
    courseId?: string;
    variants: ExperimentVariant[];
    targetMetric: string;
    hypothesis?: string;
    eligiblePopulation?: string;
    primaryMetric?: string;
    guardrailMetrics?: string[];
  }): LearningExperiment {
    const metricUpper = input.targetMetric.toUpperCase();
    const isRestricted = RESTRICTED_EXPERIMENT_DOMAINS.some((domain) => metricUpper.includes(domain));
    if (isRestricted) {
      throw new Error(
        `Cannot experiment on restricted security, finance, or integrity domain: ${input.targetMetric}`,
      );
    }

    const experiment: LearningExperiment = {
      ...input,
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
    };
    this.experiments.set(input.experimentId, experiment);
    return experiment;
  }

  getAssignment(studentId: string, experimentId: string): StudentExperimentAssignment {
    const key = `${studentId}:${experimentId}`;
    const existing = this.assignments.get(key);
    if (existing) return existing;

    const experiment = this.experiments.get(experimentId);
    if (!experiment || experiment.status !== "ACTIVE" || experiment.variants.length === 0) {
      return {
        studentId,
        experimentId,
        assignedVariant: "CONTROL",
        assignedAt: new Date().toISOString(),
      };
    }

    // Deterministic hashing for stable variant allocation
    const hash = createHash("md5").update(`${studentId}:${experimentId}`).digest("hex");
    const index = parseInt(hash.substring(0, 8), 16) % experiment.variants.length;
    const assignedVariant = experiment.variants[index] ?? "CONTROL";

    const assignment: StudentExperimentAssignment = {
      studentId,
      experimentId,
      assignedVariant,
      assignedAt: new Date().toISOString(),
    };

    this.assignments.set(key, assignment);
    return assignment;
  }
}
