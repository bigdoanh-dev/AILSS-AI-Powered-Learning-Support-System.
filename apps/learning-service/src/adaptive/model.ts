import { z } from "zod";

export const AdaptiveActionType = z.enum([
  "CONTINUE",
  "PRACTICE",
  "REVIEW",
  "REVISIT_PREREQUISITE",
  "OPTIONAL_ENRICHMENT",
]);
export type AdaptiveActionType = z.infer<typeof AdaptiveActionType>;

export interface AdaptivePathItem {
  itemId: string;
  courseId: string;
  lessonId?: string | undefined;
  conceptId: string;
  conceptName: string;
  action: AdaptiveActionType;
  priority: number; // 1 (highest) to 5 (lowest)
  rationale: string;
  prerequisiteGaps?:
    | {
        prerequisiteConceptId: string;
        currentScore: number;
        requiredScore: number;
      }[]
    | undefined;
}

export interface AdaptiveLearningPath {
  studentId: string;
  courseId: string;
  generatedAt: string;
  items: AdaptivePathItem[];
  overallMasteryPercent: number;
}

export const RecommendationFeedbackType = z.enum([
  "useful",
  "not_useful",
  "already_know",
  "too_difficult",
  "too_easy",
  "not_interested",
]);
export type RecommendationFeedbackType = z.infer<typeof RecommendationFeedbackType>;

import type { CandidateEligibilityStatus } from "../../../../packages/contracts/src/index.js";

export interface CourseRecommendation {
  recommendationId: string;
  studentId: string;
  courseId: string;
  courseTitle: string;
  score: number; // 0 - 100
  reasonCodes: string[];
  explanation: string;
  tags: string[];
  eligibilityStatus?: CandidateEligibilityStatus | undefined;
  prerequisiteGaps?: string[] | undefined;
}

export interface RecommendationFeedback {
  recommendationId: string;
  studentId: string;
  courseId: string;
  feedbackType: RecommendationFeedbackType;
  comment?: string | undefined;
  createdAt: string;
}
