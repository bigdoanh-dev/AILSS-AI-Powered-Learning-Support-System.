import { CANONICAL_PREREQUISITE_POLICY } from "../../../../packages/contracts/src/index.js";
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

  async getConceptMastery(studentId: string, courseId: string, conceptId: string): Promise<ConceptMastery | null> {
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

  async getCohortMasteryDistribution(courseId: string): Promise<{
    conceptId: string;
    conceptName: string;
    averageMastery: number;
    studentCount: number;
    atRiskCount: number; // < 50%
    developingCount: number; // 50-75%
    masteredCount: number; // > 75%
    isHighFriction: boolean;
  }[]> {
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


      // Flag as high friction if average mastery < 55 or > 40% of cohort is at risk
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
