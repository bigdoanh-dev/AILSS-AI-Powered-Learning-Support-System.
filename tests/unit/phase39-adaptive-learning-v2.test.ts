import { describe, it, expect } from "vitest";
import {
  LearnerMasteryServiceV2,
  PrerequisiteDAGValidator,
} from "../../apps/learning-service/src/mastery/mastery-service.js";
import { StudyPlanService } from "../../apps/learning-service/src/adaptive/study-plan-service.js";
import { AdaptiveNextActionEngine } from "../../apps/learning-service/src/adaptive/recommendation-service.js";
import type {
  MultiFactorEvidence,
  PrerequisiteEdgeV2,
  MasteryRecordV2,
} from "../../packages/contracts/src/index.js";

describe("Phase 39 Track A: Adaptive Learning V2 & Mastery Engine", () => {
  const masteryEngine = new LearnerMasteryServiceV2();

  describe("39.A1 & 39.A2: Multi-Factor Mastery Engine V2", () => {
    it("returns NOT_OBSERVED when no evidence is recorded", () => {
      const record = masteryEngine.calculateMasteryV2({
        studentId: "std-001",
        tenantId: "tenant-polytech",
        courseId: "course-cs101",
        conceptId: "avl_rotations",
        learningOutcomeId: "lo-avl",
        evidences: [],
        hasMetPrerequisites: true,
        daysSinceLastActivity: 0,
      });

      expect(record.masteryState).toBe("NOT_OBSERVED");
      expect(record.masteryScore).toBe(0);
      expect(record.confidenceScore).toBe(0);
      expect(record.explanation.whyState).toContain("No learning activity");
      expect(record.explanation.nextSteps).toContain("introductory lesson");
      expect(record.algorithmVersion).toBe("v2.0.0");
    });

    it("evaluates multi-factor evidence across quizzes, teacher observation, and difficulty", () => {
      const evidences: MultiFactorEvidence[] = [
        {
          evidenceId: "ev-1",
          evidenceSource: "QUIZ",
          rawScorePercent: 80,
          attemptNumber: 1,
          questionDifficulty: 0.6,
          timestamp: new Date().toISOString(),
          recencyWeight: 1.0,
        },
        {
          evidenceId: "ev-2",
          evidenceSource: "TEACHER_OBSERVATION",
          rawScorePercent: 90,
          attemptNumber: 1,
          questionDifficulty: 0.8,
          timestamp: new Date().toISOString(),
          recencyWeight: 1.0,
        },
        {
          evidenceId: "ev-3",
          evidenceSource: "MANUAL_ASSESSMENT",
          rawScorePercent: 85,
          attemptNumber: 1,
          questionDifficulty: 0.7,
          timestamp: new Date().toISOString(),
          recencyWeight: 1.0,
        },
      ];

      const record = masteryEngine.calculateMasteryV2({
        studentId: "std-001",
        tenantId: "tenant-polytech",
        courseId: "course-cs101",
        conceptId: "avl_rotations",
        learningOutcomeId: "lo-avl",
        evidences,
        hasMetPrerequisites: true,
        daysSinceLastActivity: 2,
      });

      expect(record.masteryState).toBe("PROFICIENT");
      expect(record.masteryScore).toBeGreaterThanOrEqual(75);
      expect(record.confidenceScore).toBeGreaterThanOrEqual(60);
      expect(record.explanation.whyState).toContain("Strong grasp");
      expect(record.explanation.contributingFactors.prerequisiteFoundationMet).toBe(true);
    });

    it("clamps state to DEVELOPING if prerequisites are NOT met even with high quiz score", () => {
      const evidences: MultiFactorEvidence[] = [
        {
          evidenceId: "ev-1",
          evidenceSource: "QUIZ",
          rawScorePercent: 95,
          attemptNumber: 1,
          timestamp: new Date().toISOString(),
          recencyWeight: 1.0,
        },
      ];

      const record = masteryEngine.calculateMasteryV2({
        studentId: "std-001",
        tenantId: "tenant-polytech",
        courseId: "course-cs101",
        conceptId: "red_black_trees",
        learningOutcomeId: "lo-rbt",
        evidences,
        hasMetPrerequisites: false, // unfulfilled prerequisites!
        daysSinceLastActivity: 1,
      });

      expect(record.masteryState).toBe("DEVELOPING");
      expect(record.masteryScore).toBeLessThanOrEqual(74);
      expect(record.explanation.whyState).toContain("prerequisite foundations require completion");
    });

    it("triggers DECAY_RISK when student has been inactive for > 21 days", () => {
      const evidences: MultiFactorEvidence[] = [
        {
          evidenceId: "ev-1",
          evidenceSource: "QUIZ",
          rawScorePercent: 90,
          attemptNumber: 1,
          timestamp: new Date().toISOString(),
          recencyWeight: 0.8,
        },
      ];

      const record = masteryEngine.calculateMasteryV2({
        studentId: "std-001",
        tenantId: "tenant-polytech",
        courseId: "course-cs101",
        conceptId: "dijkstra",
        learningOutcomeId: "lo-dijkstra",
        evidences,
        hasMetPrerequisites: true,
        daysSinceLastActivity: 25, // inactive 25 days!
        previousState: "PROFICIENT",
      });

      expect(record.masteryState).toBe("DECAY_RISK");
      expect(record.explanation.whyState).toContain("inactive for 25 days");
      expect(record.explanation.nextSteps).toContain("5-minute refresher practice session");
    });
  });

  describe("39.A4: Prerequisite DAG V2 Validation", () => {
    it("validates a healthy acyclic DAG within tenant boundary", () => {
      const edges: PrerequisiteEdgeV2[] = [
        {
          sourceConceptId: "binary_trees",
          targetConceptId: "bst",
          courseId: "course-cs101",
          tenantId: "tenant-polytech",
          strength: "REQUIRED",
        },
        {
          sourceConceptId: "bst",
          targetConceptId: "avl_trees",
          courseId: "course-cs101",
          tenantId: "tenant-polytech",
          strength: "REQUIRED",
        },
      ];

      const res = PrerequisiteDAGValidator.validate(
        edges,
        ["binary_trees", "bst", "avl_trees"],
        "tenant-polytech",
      );

      expect(res.isValid).toBe(true);
      expect(res.cyclesDetected).toHaveLength(0);
      expect(res.invalidCrossTenantEdges).toHaveLength(0);
      expect(res.missingPrerequisites).toHaveLength(0);
    });

    it("detects prerequisite cycles and cross-tenant boundary violations", () => {
      const edgesWithCycleAndTenantBreach: PrerequisiteEdgeV2[] = [
        {
          sourceConceptId: "conceptA",
          targetConceptId: "conceptB",
          courseId: "course-cs101",
          tenantId: "tenant-polytech",
          strength: "REQUIRED",
        },
        {
          sourceConceptId: "conceptB",
          targetConceptId: "conceptA", // Cycle!
          courseId: "course-cs101",
          tenantId: "tenant-polytech",
          strength: "REQUIRED",
        },
        {
          sourceConceptId: "conceptB",
          targetConceptId: "conceptC",
          courseId: "course-cs101",
          tenantId: "OTHER_TENANT", // Cross-tenant leak!
          strength: "REQUIRED",
        },
      ];

      const res = PrerequisiteDAGValidator.validate(
        edgesWithCycleAndTenantBreach,
        ["conceptA", "conceptB", "conceptC"],
        "tenant-polytech",
      );

      expect(res.isValid).toBe(false);
      expect(res.cyclesDetected.length).toBeGreaterThan(0);
      expect(res.invalidCrossTenantEdges).toContain("conceptB->conceptC");
    });
  });

  describe("39.A5 & 39.A6: Personalized Study Plan Engine & User Mutations", () => {
    const studyPlanService = new StudyPlanService();

    it("generates a weekly study plan prioritizing decay risks, gaps, and upcoming assessments", () => {
      const records: MasteryRecordV2[] = [
        {
          studentId: "std-001",
          tenantId: "tenant-polytech",
          learningOutcomeId: "lo-1",
          conceptId: "avl_trees",
          courseId: "course-cs101",
          masteryScore: 60,
          masteryState: "DEVELOPING",
          confidenceScore: 50,
          evidenceCount: 2,
          evidenceIds: ["ev-1"],
          algorithmVersion: "v2.0.0",
          calculatedAt: new Date().toISOString(),
          lastDecayEvaluationAt: new Date().toISOString(),
          explanation: {
            whyState: "Developing",
            nextSteps: "Practice",
            contributingFactors: {
              assessmentPerformance: 60,
              attemptCount: 1,
              recencyStatus: "FRESH",
              prerequisiteFoundationMet: true,
            },
          },
        },
        {
          studentId: "std-001",
          tenantId: "tenant-polytech",
          learningOutcomeId: "lo-2",
          conceptId: "hash_tables",
          courseId: "course-cs101",
          masteryScore: 85,
          masteryState: "DECAY_RISK",
          confidenceScore: 70,
          evidenceCount: 3,
          evidenceIds: ["ev-2"],
          algorithmVersion: "v2.0.0",
          calculatedAt: new Date().toISOString(),
          lastDecayEvaluationAt: new Date().toISOString(),
          explanation: {
            whyState: "Decay Risk",
            nextSteps: "Refresher",
            contributingFactors: {
              assessmentPerformance: 85,
              attemptCount: 2,
              recencyStatus: "DECAYING",
              prerequisiteFoundationMet: true,
            },
          },
        },
      ];

      const plan = studyPlanService.generateStudyPlan({
        studentId: "std-001",
        tenantId: "tenant-polytech",
        courseId: "course-cs101",
        availableHoursPerWeek: 5,
        masteryRecords: records,
        courseRequirements: [
          {
            lessonId: "lesson-required-1",
            title: "Required syllabus lesson",
            learningOutcomeId: "lo-required",
            sourceVersion: 7,
          },
        ],
        upcomingAssessments: [
          {
            assessmentId: "midterm-1",
            title: "CS101 Midterm",
            dueDate: "2026-09-28",
            targetOutcomeIds: ["lo-1"],
            sourceVersion: 1,
          },
        ],
      });

      expect(plan.planId).toBeDefined();
      expect(plan.items.length).toBeGreaterThanOrEqual(3);
      expect(plan.items.some((i) => i.reasonCode === "RECENCY_DECAY")).toBe(true);
      expect(plan.items.some((i) => i.reasonCode === "LOW_MASTERY")).toBe(true);
      expect(plan.items.some((i) => i.reasonCode === "UPCOMING_ASSESSMENT")).toBe(true);
      expect(plan.items).toContainEqual(
        expect.objectContaining({
          lessonId: "lesson-required-1",
          sourceType: "COURSE_REQUIREMENT",
          sourceId: "lesson-required-1",
          learningOutcomeId: "lo-required",
        }),
      );

      // Student mutation: mark complete
      const firstItem = plan.items[0];
      expect(firstItem).toBeDefined();
      if (firstItem) {
        const updated = studyPlanService.updateItemStatus(plan.planId, firstItem.itemId, "COMPLETED");
        expect(updated?.status).toBe("COMPLETED");

        // Student mutation: reschedule
        const rescheduled = studyPlanService.updateItemStatus(
          plan.planId,
          plan.items[1]!.itemId,
          "RESCHEDULED",
          "2026-09-26",
        );
        expect(rescheduled?.status).toBe("RESCHEDULED");
        expect(rescheduled?.scheduledDate).toBe("2026-09-26");
      }
    });
  });

  describe("39.A7 & 39.A8: Adaptive Next-Action Engine & Loop Prevention", () => {
    const nextActionEngine = new AdaptiveNextActionEngine();

    it("generates ranked candidates and skips recently repeated recommendations to prevent recommendation loops", () => {
      const records: MasteryRecordV2[] = [
        {
          studentId: "std-001",
          tenantId: "tenant-polytech",
          learningOutcomeId: "lo-1",
          conceptId: "trees",
          courseId: "course-cs101",
          masteryScore: 50,
          masteryState: "DEVELOPING",
          confidenceScore: 40,
          evidenceCount: 1,
          evidenceIds: [],
          algorithmVersion: "v2.0.0",
          calculatedAt: new Date().toISOString(),
          lastDecayEvaluationAt: new Date().toISOString(),
          explanation: {
            whyState: "Developing",
            nextSteps: "Practice",
            contributingFactors: {
              assessmentPerformance: 50,
              attemptCount: 1,
              recencyStatus: "FRESH",
              prerequisiteFoundationMet: true,
            },
          },
        },
      ];

      // Round 1: No recent recommendations
      const round1 = nextActionEngine.generateNextActions({
        studentId: "std-001",
        courseId: "course-cs101",
        masteryRecords: records,
        prerequisiteGaps: [{ conceptId: "trees", missingPrereqId: "recursion" }],
        upcomingAssessments: [{ assessmentId: "quiz-2", title: "Quiz 2", dueDays: 2 }],
      });

      expect(round1[0]?.reasonCode).toBe("PREREQUISITE_GAP");
      expect(round1[0]?.targetId).toBe("recursion");

      // Round 2: Provide loopPreventionHash from round 1 to simulate recent issuance
      const round2 = nextActionEngine.generateNextActions({
        studentId: "std-001",
        courseId: "course-cs101",
        masteryRecords: records,
        prerequisiteGaps: [{ conceptId: "trees", missingPrereqId: "recursion" }],
        upcomingAssessments: [{ assessmentId: "quiz-2", title: "Quiz 2", dueDays: 2 }],
        recentRecommendationHashes: [round1[0]!.loopPreventionHash],
      });

      // Loop prevented: next candidate is selected instead!
      expect(round2[0]?.reasonCode).toBe("UPCOMING_ASSESSMENT");
      expect(round2[0]?.targetId).toBe("quiz-2");
    });
  });
});
