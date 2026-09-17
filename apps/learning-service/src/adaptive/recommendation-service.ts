import { randomUUID } from "node:crypto";
import { CANONICAL_PREREQUISITE_POLICY, type CandidateEligibilityStatus } from "../../../../packages/contracts/src/index.js";
import type {
  CourseRecommendation,
  RecommendationFeedback,
  RecommendationFeedbackType,
} from "./model.js";

export interface CandidatePrerequisite {
  conceptId: string;
  strength?: "REQUIRED" | "RECOMMENDED" | undefined;
}

export interface CandidateCourse {
  courseId: string;
  title: string;
  category: string;
  tags: string[];
  prerequisites: (string | CandidatePrerequisite)[];
  isPublished: boolean;
  priceMinor?: number | undefined;
  estimatedHours?: number | undefined;
  learningGoals?: string[] | undefined;
}

export interface RecommendationRepository {
  saveFeedback(feedback: RecommendationFeedback): Promise<void>;
  getFeedbackForStudent(studentId: string): Promise<RecommendationFeedback[]>;
}

export class InMemoryRecommendationRepository implements RecommendationRepository {
  private readonly feedbackStore = new Map<string, RecommendationFeedback>();

  async saveFeedback(feedback: RecommendationFeedback): Promise<void> {
    const key = `${feedback.studentId}:${feedback.recommendationId}`;
    this.feedbackStore.set(key, { ...feedback });
    return Promise.resolve();
  }

  async getFeedbackForStudent(studentId: string): Promise<RecommendationFeedback[]> {
    return Promise.resolve(
      Array.from(this.feedbackStore.values()).filter((f) => f.studentId === studentId),
    );
  }
}

export class CourseRecommendationService {
  constructor(private readonly repository: RecommendationRepository) {}

  async generateRecommendations(input: {
    studentId: string;
    enrolledCourseIds: string[];
    masteredConceptIds: string[];
    masteryScores?: Record<string, number> | undefined;
    interestCategories?: string[] | undefined;
    catalogCourses: CandidateCourse[];
    budgetMinor?: number | undefined;
    weeklyAvailabilityHours?: number | undefined;
    learningGoals?: string[] | undefined;
    limit?: number | undefined;
  }): Promise<CourseRecommendation[]> {
    const limit = input.limit ?? 5;
    const enrolledSet = new Set(input.enrolledCourseIds);
    const masteredConceptsSet = new Set(input.masteredConceptIds);
    const interestSet = new Set((input.interestCategories ?? []).map((c) => c.toLowerCase()));
    const goalsSet = new Set((input.learningGoals ?? []).map((g) => g.toLowerCase()));

    const previousFeedback = await this.repository.getFeedbackForStudent(input.studentId);
    const negativeFeedbackCourses = new Set(
      previousFeedback
        .filter((f) => f.feedbackType === "not_useful" || f.feedbackType === "already_know" || f.feedbackType === "not_interested")
        .map((f) => f.courseId),
    );

    // Stage 1: Candidate Generation (Filtering & Eligibility Evaluation)
    const eligibleCandidates: {
      course: CandidateCourse;
      eligibilityStatus: CandidateEligibilityStatus;
      unmetPrerequisites: string[];
      hasPrerequisites: boolean;
    }[] = [];

    for (const course of input.catalogCourses) {
      // Must be published
      if (!course.isPublished) continue;
      // Cannot be already enrolled
      if (enrolledSet.has(course.courseId)) continue;
      // Exclude courses with prior negative feedback
      if (negativeFeedbackCourses.has(course.courseId)) continue;
      // Budget constraint filtering
      if (input.budgetMinor !== undefined && course.priceMinor !== undefined && course.priceMinor > input.budgetMinor) {
        continue;
      }

      // Evaluate prerequisite eligibility
      const unmetRequired: string[] = [];
      const unmetRecommended: string[] = [];

      for (const p of course.prerequisites) {
        const conceptId = typeof p === "string" ? p : p.conceptId;
        const strength = typeof p === "string" ? "REQUIRED" : (p.strength ?? "REQUIRED");
        const score = input.masteryScores?.[conceptId] ?? (masteredConceptsSet.has(conceptId) ? 100 : 0);

        if (strength === "REQUIRED") {
          if (score < CANONICAL_PREREQUISITE_POLICY.requiredPrerequisiteMastery) {
            unmetRequired.push(conceptId);
          }
        } else {
          if (score < CANONICAL_PREREQUISITE_POLICY.recommendedPrerequisiteMastery) {
            unmetRecommended.push(conceptId);
          }
        }
      }

      // Strict candidate eligibility rule:
      // If ANY required prerequisite is unmet -> INELIGIBLE (filtered out from candidate pool)
      if (unmetRequired.length > 0) {
        // Drop candidate immediately
        continue;
      }

      // If soft/recommended prerequisites are missing -> ELIGIBLE_WITH_WARNING
      const eligibilityStatus: CandidateEligibilityStatus =
        unmetRecommended.length > 0 ? "ELIGIBLE_WITH_WARNING" : "ELIGIBLE";

      eligibleCandidates.push({
        course,
        eligibilityStatus,
        unmetPrerequisites: unmetRecommended,
        hasPrerequisites: course.prerequisites.length > 0,
      });
    }

    // Stage 2: Scoring & Ranking
    const scored: {
      course: CandidateCourse;
      score: number;
      reasonCodes: string[];
      explanation: string;
      eligibilityStatus: CandidateEligibilityStatus;
      prerequisiteGaps?: string[];
    }[] = [];

    for (const candidate of eligibleCandidates) {
      const { course, eligibilityStatus, unmetPrerequisites, hasPrerequisites } = candidate;
      let score = 50; // Base score
      const reasonCodes: string[] = [];

      // Category match
      if (interestSet.has(course.category.toLowerCase())) {
        score += 25;
        reasonCodes.push("INTEREST_MATCH");
      }

      // Learning goals match
      if (goalsSet.size > 0) {
        const matchesGoal = (course.learningGoals ?? []).some((g) => goalsSet.has(g.toLowerCase())) ||
          course.tags.some((t) => goalsSet.has(t.toLowerCase()));
        if (matchesGoal) {
          score += 20;
          reasonCodes.push("GOAL_MATCH");
        }
      }

      // Budget fit match
      if (input.budgetMinor !== undefined && course.priceMinor !== undefined && course.priceMinor <= input.budgetMinor) {
        score += 15;
        reasonCodes.push("BUDGET_MATCH");
      }

      // Time commitment match
      if (input.weeklyAvailabilityHours !== undefined && course.estimatedHours !== undefined) {
        if (course.estimatedHours <= input.weeklyAvailabilityHours * 4) {
          score += 15;
          reasonCodes.push("TIME_COMMITMENT_MATCH");
        }
      }

      // Prerequisite score adjustment based on eligibility status
      if (eligibilityStatus === "ELIGIBLE") {
        if (hasPrerequisites) {
          score += 20;
          reasonCodes.push("ALL_PREREQUISITES_SATISFIED");
          reasonCodes.push("PREREQUISITE_MATCH");
        } else {
          score += 10;
          reasonCodes.push("NO_PREREQUISITES_REQUIRED");
        }
      } else if (eligibilityStatus === "ELIGIBLE_WITH_WARNING") {
        score -= 15; // Warning penalty
        reasonCodes.push("PREREQUISITE_GAP_WARNING");
      }

      // Tag overlap with mastered concepts
      const relevantTags = course.tags.filter((t) => masteredConceptsSet.has(t));
      if (relevantTags.length > 0) {
        score += 15;
        reasonCodes.push("SKILL_CONTINUATION");
      }

      const clampedScore = Math.max(1, Math.min(100, score));
      let explanation = `Recommended based on ${reasonCodes.join(", ").toLowerCase().replace(/_/g, " ")}.`;
      if (eligibilityStatus === "ELIGIBLE_WITH_WARNING") {
        explanation += ` Note: recommended background concepts (${unmetPrerequisites.join(", ")}) not yet completed.`;
      }

      scored.push({
        course,
        score: clampedScore,
        reasonCodes,
        explanation,
        eligibilityStatus,
        ...(unmetPrerequisites.length > 0 ? { prerequisiteGaps: unmetPrerequisites } : {}),
      });
    }

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map((s) => ({
      recommendationId: randomUUID(),
      studentId: input.studentId,
      courseId: s.course.courseId,
      courseTitle: s.course.title,
      score: s.score,
      reasonCodes: s.reasonCodes,
      explanation: s.explanation,
      tags: s.course.tags,
      eligibilityStatus: s.eligibilityStatus,
      prerequisiteGaps: s.prerequisiteGaps,
    }));
  }


  async recordFeedback(input: {
    studentId: string;
    recommendationId: string;
    courseId: string;
    feedbackType: RecommendationFeedbackType;
    comment?: string | undefined;
  }): Promise<RecommendationFeedback> {
    const feedback: RecommendationFeedback = {
      studentId: input.studentId,
      recommendationId: input.recommendationId,
      courseId: input.courseId,
      feedbackType: input.feedbackType,
      comment: input.comment,
      createdAt: new Date().toISOString(),
    };

    await this.repository.saveFeedback(feedback);
    return feedback;
  }
}
