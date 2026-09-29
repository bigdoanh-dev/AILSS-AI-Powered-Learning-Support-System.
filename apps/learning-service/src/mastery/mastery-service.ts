import {
  CANONICAL_PREREQUISITE_POLICY,
  CANONICAL_MASTERY_POLICY_V2,
  type MasteryPolicyConfig,
  type MasteryRecordV2,
  type MasteryState,
  type MultiFactorEvidence,
  type PrerequisiteEdgeV2,
  type DAGValidationResult,
  type MasteryHistoryRecord,
} from "../../../../packages/contracts/src/index.js";
import type {
  BloomCognitiveLevel,
  ConceptMastery,
  MasteryEvidenceSubmission,
  PrerequisiteEdge,
  PrerequisiteGap,
} from "./model.js";

const BLOOM_RANK: Record<BloomCognitiveLevel, number> = {
  REMEMBER: 1,
  UNDERSTAND: 2,
  APPLY: 3,
  ANALYZE: 4,
  EVALUATE: 5,
  CREATE: 6,
};

const SOURCE_WEIGHTS = {
  MANUAL_ASSESSMENT: 0.85,
  QUIZ: 0.7,
  LESSON_COMPLETION: 0.4,
};

export interface MasteryRepository {
  saveConceptMastery(mastery: ConceptMastery): Promise<void>;
  getConceptMastery(studentId: string, courseId: string, conceptId: string): Promise<ConceptMastery | null>;
  listStudentCourseMastery(studentId: string, courseId: string): Promise<ConceptMastery[]>;
  listCourseCohortMastery(courseId: string): Promise<ConceptMastery[]>;
  savePrerequisites(edges: PrerequisiteEdge[]): Promise<void>;
  getPrerequisites(courseId: string): Promise<PrerequisiteEdge[]>;
}

export class InMemoryMasteryRepository implements MasteryRepository {
  private readonly masteryStore = new Map<string, ConceptMastery>();
  private readonly prerequisitesStore = new Map<string, PrerequisiteEdge[]>();

  private makeKey(studentId: string, courseId: string, conceptId: string): string {
    return `${studentId}:${courseId}:${conceptId}`;
  }

  async saveConceptMastery(mastery: ConceptMastery): Promise<void> {
    const key = this.makeKey(mastery.studentId, mastery.courseId, mastery.conceptId);
    this.masteryStore.set(key, { ...mastery });
    return Promise.resolve();
  }

  async getConceptMastery(
    studentId: string,
    courseId: string,
    conceptId: string,
  ): Promise<ConceptMastery | null> {
    const key = this.makeKey(studentId, courseId, conceptId);
    return Promise.resolve(this.masteryStore.get(key) ?? null);
  }

  async listStudentCourseMastery(studentId: string, courseId: string): Promise<ConceptMastery[]> {
    const results: ConceptMastery[] = [];
    const prefix = `${studentId}:${courseId}:`;
    for (const [key, val] of this.masteryStore.entries()) {
      if (key.startsWith(prefix)) {
        results.push(val);
      }
    }
    return Promise.resolve(results);
  }

  async listCourseCohortMastery(courseId: string): Promise<ConceptMastery[]> {
    const results: ConceptMastery[] = [];
    for (const val of this.masteryStore.values()) {
      if (val.courseId === courseId) {
        results.push(val);
      }
    }
    return Promise.resolve(results);
  }

  async savePrerequisites(edges: PrerequisiteEdge[]): Promise<void> {
    const firstEdge = edges[0];
    if (!firstEdge) return Promise.resolve();
    const courseId = firstEdge.courseId;
    const existing = this.prerequisitesStore.get(courseId) ?? [];
    this.prerequisitesStore.set(courseId, [...existing, ...edges]);
    return Promise.resolve();
  }

  async getPrerequisites(courseId: string): Promise<PrerequisiteEdge[]> {
    return Promise.resolve(this.prerequisitesStore.get(courseId) ?? []);
  }
}

export class LearnerMasteryService {
  constructor(private readonly repository: MasteryRepository) {}

  async recordEvidence(submission: MasteryEvidenceSubmission): Promise<ConceptMastery> {
    const existing = await this.repository.getConceptMastery(
      submission.studentId,
      submission.courseId,
      submission.conceptId,
    );

    const weight = SOURCE_WEIGHTS[submission.evidenceSource];
    const rawScore = Math.max(0, Math.min(100, Math.round(submission.rawScorePercent)));

    let newScore: number;
    let newEvidenceCount: number;
    let newBloom: BloomCognitiveLevel = submission.bloomLevel;

    if (!existing) {
      newScore = Math.round(rawScore * weight + (1 - weight) * 50);
      newEvidenceCount = 1;
    } else {
      newEvidenceCount = existing.evidenceCount + 1;
      // Exponential moving average weighted by source reliability
      const alpha = Math.min(0.6, weight / Math.sqrt(newEvidenceCount));
      newScore = Math.round((1 - alpha) * existing.masteryScore + alpha * rawScore);

      // Keep higher Bloom level if student demonstrated higher cognitive achievement
      if (BLOOM_RANK[submission.bloomLevel] > BLOOM_RANK[existing.bloomLevel]) {
        newBloom = submission.bloomLevel;
      } else {
        newBloom = existing.bloomLevel;
      }
    }

    // Confidence increases with evidence count and higher Bloom levels
    const confidenceScore = Math.min(100, Math.round(newEvidenceCount * 25 + BLOOM_RANK[newBloom] * 4));

    const evidenceItem = {
      source: submission.evidenceSource,
      bloom: submission.bloomLevel,
      score: rawScore,
      timestamp: new Date().toISOString(),
    };

    const previousItems = existing?.evidenceItems ?? [];
    const evidenceItems = [...previousItems, evidenceItem];

    const bloomDistribution = { ...(existing?.bloomDistribution ?? {}) };
    bloomDistribution[submission.bloomLevel] = (bloomDistribution[submission.bloomLevel] ?? 0) + 1;

    const updated: ConceptMastery = {
      studentId: submission.studentId,
      courseId: submission.courseId,
      courseVersion: submission.courseVersion ?? existing?.courseVersion,
      conceptId: submission.conceptId,
      conceptName: submission.conceptName,
      masteryScore: Math.max(0, Math.min(100, newScore)),
      confidenceScore,
      evidenceCount: newEvidenceCount,
      bloomLevel: newBloom,
      lastAssessedAt: new Date().toISOString(),
      lastEvidenceSource: submission.evidenceSource,
      evidenceItems,
      bloomDistribution,
    };

    await this.repository.saveConceptMastery(updated);
    return updated;
  }

  async getStudentMastery(studentId: string, courseId: string): Promise<ConceptMastery[]> {
    return this.repository.listStudentCourseMastery(studentId, courseId);
  }

  async findPrerequisiteGaps(
    studentId: string,
    courseId: string,
    targetConceptId?: string,
  ): Promise<PrerequisiteGap[]> {
    const prerequisites = await this.repository.getPrerequisites(courseId);
    const studentMastery = await this.repository.listStudentCourseMastery(studentId, courseId);
    const masteryMap = new Map(studentMastery.map((m) => [m.conceptId, m.masteryScore]));

    const gaps: PrerequisiteGap[] = [];

    for (const edge of prerequisites) {
      if (targetConceptId && edge.conceptId !== targetConceptId) {
        continue;
      }

      const prereqScore = masteryMap.get(edge.prerequisiteConceptId) ?? 0;
      const requiredScore =
        edge.strength === "REQUIRED"
          ? CANONICAL_PREREQUISITE_POLICY.requiredPrerequisiteMastery
          : CANONICAL_PREREQUISITE_POLICY.recommendedPrerequisiteMastery;

      if (prereqScore < requiredScore) {
        gaps.push({
          conceptId: edge.conceptId,
          conceptName: edge.conceptId,
          prerequisiteConceptId: edge.prerequisiteConceptId,
          currentPrereqMastery: prereqScore,
          requiredScore,
          severity: edge.strength === "REQUIRED" ? "CRITICAL" : "MODERATE",
        });
      }
    }

    return gaps;
  }

  async getCohortMasteryDistribution(courseId: string): Promise<
    {
      conceptId: string;
      conceptName: string;
      averageMastery: number;
      studentCount: number;
      atRiskCount: number; // < 50%
      developingCount: number; // 50-75%
      masteredCount: number; // > 75%
      isHighFriction: boolean;
    }[]
  > {
    const allMastery = await this.repository.listCourseCohortMastery(courseId);
    const byConcept = new Map<string, ConceptMastery[]>();

    for (const m of allMastery) {
      const list = byConcept.get(m.conceptId) ?? [];
      list.push(m);
      byConcept.set(m.conceptId, list);
    }

    const distribution = [];
    for (const [conceptId, list] of byConcept.entries()) {
      const studentCount = list.length;
      const totalScore = list.reduce((acc, curr) => acc + curr.masteryScore, 0);
      const averageMastery = studentCount > 0 ? Math.round(totalScore / studentCount) : 0;

      let atRiskCount = 0;
      let developingCount = 0;
      let masteredCount = 0;

      for (const item of list) {
        if (item.masteryScore < CANONICAL_PREREQUISITE_POLICY.reviewThreshold) atRiskCount++;
        else if (item.masteryScore <= CANONICAL_PREREQUISITE_POLICY.practiceThreshold) developingCount++;
        else masteredCount++;
      }

      const isHighFriction = averageMastery < 55 || (studentCount >= 3 && atRiskCount / studentCount >= 0.4);

      distribution.push({
        conceptId,
        conceptName: list[0]?.conceptName ?? conceptId,
        averageMastery,
        studentCount,
        atRiskCount,
        developingCount,
        masteredCount,
        isHighFriction,
      });
    }

    return distribution;
  }
}

// ============================================================================
// 39.A1 - 39.A4: Prerequisite DAG Validator (Pure Function / Service)
// ============================================================================
export const PrerequisiteDAGValidator = {
  validate(
    edges: PrerequisiteEdgeV2[],
    knownConcepts: string[],
    expectedTenantId: string,
  ): DAGValidationResult {
    const cyclesDetected: string[][] = [];
    const invalidCrossTenantEdges: string[] = [];
    const missingPrerequisites: string[] = [];
    const orphanConcepts: string[] = [];

    const knownSet = new Set(knownConcepts);
    const connectedConcepts = new Set<string>();

    const adj = new Map<string, string[]>();
    for (const edge of edges) {
      if (edge.tenantId !== expectedTenantId) {
        invalidCrossTenantEdges.push(`${edge.sourceConceptId}->${edge.targetConceptId}`);
      }
      if (!knownSet.has(edge.sourceConceptId)) {
        missingPrerequisites.push(edge.sourceConceptId);
      }
      if (!knownSet.has(edge.targetConceptId)) {
        missingPrerequisites.push(edge.targetConceptId);
      }

      connectedConcepts.add(edge.sourceConceptId);
      connectedConcepts.add(edge.targetConceptId);

      const targets = adj.get(edge.sourceConceptId) ?? [];
      targets.push(edge.targetConceptId);
      adj.set(edge.sourceConceptId, targets);
    }

    for (const concept of knownConcepts) {
      if (!connectedConcepts.has(concept) && knownConcepts.length > 1) {
        orphanConcepts.push(concept);
      }
    }

    const state = new Map<string, number>();
    const parentMap = new Map<string, string>();

    const dfs = (node: string, path: string[]): void => {
      state.set(node, 1);
      path.push(node);

      const neighbors = adj.get(node) ?? [];
      for (const neighbor of neighbors) {
        const neighborState = state.get(neighbor) ?? 0;
        if (neighborState === 1) {
          const cycleStartIdx = path.indexOf(neighbor);
          const cycle = [...path.slice(cycleStartIdx), neighbor];
          cyclesDetected.push(cycle);
        } else if (neighborState === 0) {
          parentMap.set(neighbor, node);
          dfs(neighbor, [...path]);
        }
      }

      state.set(node, 2);
    };

    for (const node of connectedConcepts) {
      if ((state.get(node) ?? 0) === 0) {
        dfs(node, []);
      }
    }

    return {
      isValid:
        cyclesDetected.length === 0 &&
        invalidCrossTenantEdges.length === 0 &&
        missingPrerequisites.length === 0,
      cyclesDetected,
      orphanConcepts,
      missingPrerequisites: [...new Set(missingPrerequisites)],
      invalidCrossTenantEdges,
    };
  },
};

// ============================================================================
// 40.15 - 40.19: Canonical Learner Mastery Service V2
// ============================================================================
export class LearnerMasteryServiceV2 {
  public static readonly ALGORITHM_VERSION = "v2.0.0";
  private readonly historyStore = new Map<string, MasteryHistoryRecord[]>();

  constructor(private readonly policyConfig: MasteryPolicyConfig = CANONICAL_MASTERY_POLICY_V2) {}

  public calculateMasteryV2(input: {
    studentId: string;
    tenantId: string;
    courseId: string;
    conceptId: string;
    learningOutcomeId: string;
    evidences: MultiFactorEvidence[];
    hasMetPrerequisites: boolean;
    daysSinceLastActivity: number;
    previousState?: MasteryState | undefined;
    previousScore?: number | undefined;
    recalculationReason?: string | undefined;
  }): MasteryRecordV2 {
    const {
      studentId,
      tenantId,
      courseId,
      conceptId,
      learningOutcomeId,
      evidences,
      hasMetPrerequisites,
      daysSinceLastActivity,
      previousState,
      previousScore = 0,
      recalculationReason,
    } = input;

    const policy = this.policyConfig;
    const calculatedAt = new Date().toISOString();

    if (evidences.length === 0) {
      const emptyRecord: MasteryRecordV2 = {
        studentId,
        tenantId,
        learningOutcomeId,
        conceptId,
        courseId,
        masteryScore: 0,
        masteryState: "NOT_OBSERVED",
        previousMasteryState: previousState,
        confidenceScore: 0,
        evidenceCount: 0,
        evidenceIds: [],
        algorithmVersion: LearnerMasteryServiceV2.ALGORITHM_VERSION,
        masteryPolicyId: policy.policyId,
        masteryPolicyVersion: policy.version,
        effectiveAt: calculatedAt,
        calculatedAt,
        lastDecayEvaluationAt: calculatedAt,
        explanation: {
          whyState: "No learning activity or assessment evidence has been recorded for this outcome yet.",
          nextSteps: "Start with the introductory lesson and foundational knowledge checks.",
          contributingFactors: {
            assessmentPerformance: 0,
            attemptCount: 0,
            recencyStatus: "FRESH",
            prerequisiteFoundationMet: hasMetPrerequisites,
          },
        },
      };
      return emptyRecord;
    }

    let totalWeight = 0;
    let weightedScoreSum = 0;

    for (const ev of evidences) {
      const baseWeight = policy.evidenceWeights[ev.evidenceSource] ?? 0.2;
      const attemptDampener = 1 / (1 + policy.attemptDampenerFactor * Math.max(0, ev.attemptNumber - 1));
      const difficultyBonus = 1 + (ev.questionDifficulty ?? 0.5) * policy.difficultyBonusMultiplier;

      const effectiveWeight = baseWeight * attemptDampener * difficultyBonus * (ev.recencyWeight || 1);
      weightedScoreSum += ev.rawScorePercent * effectiveWeight;
      totalWeight += effectiveWeight;
    }

    let calculatedScore = totalWeight > 0 ? Math.round(weightedScoreSum / totalWeight) : 0;

    // Recency evaluation
    let recencyStatus: "FRESH" | "STALE" | "DECAYING" = "FRESH";
    if (daysSinceLastActivity > policy.staleWindowDays) {
      recencyStatus = "DECAYING";
      const decayFactor = Math.exp(-policy.decayLambda * (daysSinceLastActivity - policy.staleWindowDays));
      calculatedScore = Math.max(policy.decayFloor, Math.round(calculatedScore * decayFactor));
    } else if (daysSinceLastActivity > policy.freshWindowDays) {
      recencyStatus = "STALE";
    }

    const confidenceScore = Math.min(100, Math.round(evidences.length * 20 + (hasMetPrerequisites ? 20 : 0)));

    // State thresholds
    let masteryState: MasteryState;
    if (recencyStatus === "DECAYING" && (previousState === "PROFICIENT" || previousState === "MASTERED")) {
      masteryState = "DECAY_RISK";
    } else if (calculatedScore < policy.developingThreshold) {
      masteryState = "INTRODUCED";
    } else if (calculatedScore < policy.proficientThreshold) {
      masteryState = "DEVELOPING";
    } else if (calculatedScore < policy.masteredThreshold) {
      masteryState = "PROFICIENT";
    } else {
      masteryState = "MASTERED";
    }

    // Prerequisite clamp
    if (
      !hasMetPrerequisites &&
      policy.prerequisitePolicy === "STRICT_CLAMP" &&
      (masteryState === "PROFICIENT" || masteryState === "MASTERED")
    ) {
      masteryState = "DEVELOPING";
      calculatedScore = Math.min(policy.prerequisiteClampThreshold, calculatedScore);
    }

    // Explanation strings formatted safely without template string number issues
    let whyState: string;
    let nextSteps: string;

    switch (masteryState) {
      case "MASTERED":
        whyState = `Demonstrated superior mastery (${String(calculatedScore)}%) across ${String(evidences.length)} verified assessments.`;
        nextSteps = "Help peers in the course discussion or explore advanced enrichment topics.";
        break;
      case "PROFICIENT":
        whyState = `Strong grasp of foundational and applied concepts (${String(calculatedScore)}%). Prerequisites verified.`;
        nextSteps = "Complete the final comprehensive assessment to lock in full mastery.";
        break;
      case "DEVELOPING":
        if (!hasMetPrerequisites) {
          whyState = `Score is ${String(calculatedScore)}%, but prerequisite foundations require completion before advancing.`;
          nextSteps = "Review prerequisite concepts and complete prerequisite diagnostic checks.";
        } else {
          whyState = `Working understanding demonstrated (${String(calculatedScore)}%), but requires more consistent practice.`;
          nextSteps = "Take practice questions and ask AI Tutor for Socratic review on tricky problems.";
        }
        break;
      case "DECAY_RISK":
        whyState = `Previously achieved proficiency, but inactive for ${String(daysSinceLastActivity)} days. Knowledge decay detected.`;
        nextSteps = "Complete a quick 5-minute refresher practice session to restore active mastery status.";
        break;
      case "INTRODUCED":
      default:
        whyState = `Initial exposure completed (${String(calculatedScore)}%), but core competencies are not yet solid.`;
        nextSteps = "Review the core lesson materials and attempt guided practice exercises.";
        break;
    }

    const record: MasteryRecordV2 = {
      studentId,
      tenantId,
      learningOutcomeId,
      conceptId,
      courseId,
      masteryScore: Math.max(0, Math.min(100, calculatedScore)),
      masteryState,
      previousMasteryState: previousState,
      confidenceScore,
      evidenceCount: evidences.length,
      evidenceIds: evidences.map((e) => e.evidenceId),
      algorithmVersion: LearnerMasteryServiceV2.ALGORITHM_VERSION,
      masteryPolicyId: policy.policyId,
      masteryPolicyVersion: policy.version,
      effectiveAt: calculatedAt,
      calculatedAt,
      lastDecayEvaluationAt: calculatedAt,
      explanation: {
        whyState,
        nextSteps,
        contributingFactors: {
          assessmentPerformance: calculatedScore,
          attemptCount: evidences.length,
          recencyStatus,
          prerequisiteFoundationMet: hasMetPrerequisites,
        },
      },
    };

    // Store history record for audit and explainability UI
    const historyEntry: MasteryHistoryRecord = {
      historyId: `hist-${studentId}-${conceptId}-${String(Date.now())}`,
      studentId,
      tenantId,
      courseId,
      conceptId,
      learningOutcomeId,
      currentScore: record.masteryScore,
      currentState: record.masteryState,
      previousScore,
      previousState: previousState ?? "NOT_OBSERVED",
      changeReason: recalculationReason ?? `Evidence submission (${String(evidences.length)} items)`,
      contributingFactors: record.explanation.contributingFactors,
      recommendedNextActions: [nextSteps],
      changedAt: calculatedAt,
    };

    const historyKey = `${studentId}:${courseId}:${conceptId}`;
    const existingHistory = this.historyStore.get(historyKey) ?? [];
    existingHistory.push(historyEntry);
    this.historyStore.set(historyKey, existingHistory);

    return record;
  }

  public getMasteryHistory(studentId: string, courseId: string, conceptId: string): MasteryHistoryRecord[] {
    const key = `${studentId}:${courseId}:${conceptId}`;
    return this.historyStore.get(key) ?? [];
  }
}
