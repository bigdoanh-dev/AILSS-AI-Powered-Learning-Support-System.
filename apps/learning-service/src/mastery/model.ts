import { z } from "zod";

export const BloomCognitiveLevel = z.enum([
  "REMEMBER",
  "UNDERSTAND",
  "APPLY",
  "ANALYZE",
  "EVALUATE",
  "CREATE",
]);
export type BloomCognitiveLevel = z.infer<typeof BloomCognitiveLevel>;

export const EvidenceSource = z.enum(["QUIZ", "MANUAL_ASSESSMENT", "LESSON_COMPLETION"]);
export type EvidenceSource = z.infer<typeof EvidenceSource>;

export interface MasteryEvidenceItem {
  source: EvidenceSource;
  bloom: BloomCognitiveLevel;
  score: number;
  timestamp: string;
}

export interface ConceptMastery {
  studentId: string;
  courseId: string;
  courseVersion?: number | undefined;
  conceptId: string;
  conceptName: string;
  masteryScore: number; // 0 - 100
  confidenceScore: number; // 0 - 100
  evidenceCount: number;
  bloomLevel: BloomCognitiveLevel;
  lastAssessedAt: string;
  lastEvidenceSource: EvidenceSource;
  evidenceItems?: MasteryEvidenceItem[] | undefined;
  bloomDistribution?: Partial<Record<BloomCognitiveLevel, number>> | undefined;
}

export interface PrerequisiteEdge {
  courseId: string;
  conceptId: string;
  prerequisiteConceptId: string;
  strength: "REQUIRED" | "RECOMMENDED";
}

export interface PrerequisiteGap {
  conceptId: string;
  conceptName: string;
  prerequisiteConceptId: string;
  currentPrereqMastery: number;
  requiredScore: number;
  severity: "CRITICAL" | "MODERATE";
}

export interface MasteryEvidenceSubmission {
  studentId: string;
  courseId: string;
  courseVersion?: number | undefined;
  conceptId: string;
  conceptName: string;
  rawScorePercent: number; // 0 - 100
  evidenceSource: EvidenceSource;
  bloomLevel: BloomCognitiveLevel;
}
