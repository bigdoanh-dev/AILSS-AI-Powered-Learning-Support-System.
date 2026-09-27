import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AdaptivePathService,
  CourseRecommendationService,
  InMemoryRecommendationRepository,
  type CandidateCourse,
} from "../../apps/learning-service/src/adaptive/index.js";
import {
  InMemoryMasteryRepository,
  LearnerMasteryService,
} from "../../apps/learning-service/src/mastery/index.js";

describe("Phase 19B/C/D/E — Learner Mastery, Adaptive Paths & Explainable Recommendations", () => {
  const masteryRepo = new InMemoryMasteryRepository();
  const masteryService = new LearnerMasteryService(masteryRepo);
  const pathService = new AdaptivePathService(masteryService);

  const recommendationRepo = new InMemoryRecommendationRepository();
  const recommendationService = new CourseRecommendationService(recommendationRepo);

  const studentId = randomUUID();
  const courseId = randomUUID();

  describe("Authoritative Learner Knowledge Model (Phase 19B)", () => {
    it("records assessment evidence with source reliability weighting and Bloom level", async () => {
      // 1. Initial quiz attempt on SQL Indexing
      const entry1 = await masteryService.recordEvidence({
        studentId,
        courseId,
        conceptId: "B_TREE_INDEXING",
        conceptName: "B-Tree Database Indexing",
        rawScorePercent: 80,
        evidenceSource: "QUIZ",
        bloomLevel: "UNDERSTAND",
      });

      expect(entry1.studentId).toBe(studentId);
      expect(entry1.conceptId).toBe("B_TREE_INDEXING");
      expect(entry1.evidenceCount).toBe(1);
      expect(entry1.bloomLevel).toBe("UNDERSTAND");
      expect(entry1.masteryScore).toBeGreaterThanOrEqual(60);

      // 2. High-stake manual assessment / coding exercise on same concept
      const entry2 = await masteryService.recordEvidence({
        studentId,
        courseId,
        conceptId: "B_TREE_INDEXING",
        conceptName: "B-Tree Database Indexing",
        rawScorePercent: 95,
        evidenceSource: "MANUAL_ASSESSMENT",
        bloomLevel: "APPLY",
      });

      expect(entry2.evidenceCount).toBe(2);
      expect(entry2.bloomLevel).toBe("APPLY"); // Promoted from UNDERSTAND to APPLY
      expect(entry2.confidenceScore).toBeGreaterThan(entry1.confidenceScore);
      expect(entry2.masteryScore).toBeGreaterThan(entry1.masteryScore);
    });

    it("identifies prerequisite gaps when foundational mastery is inadequate", async () => {
      // Define prerequisite: QUERY_OPTIMIZATION requires B_TREE_INDEXING and RELATIONAL_ALGEBRA
      await masteryRepo.savePrerequisites([
        {
          courseId,
          conceptId: "QUERY_OPTIMIZATION",
          prerequisiteConceptId: "B_TREE_INDEXING",
          strength: "REQUIRED",
        },
        {
          courseId,
          conceptId: "QUERY_OPTIMIZATION",
          prerequisiteConceptId: "RELATIONAL_ALGEBRA",
          strength: "REQUIRED",
        },
      ]);

      // Student has no evidence in RELATIONAL_ALGEBRA (score 0 < 60)
      const gaps = await masteryService.findPrerequisiteGaps(
        studentId,
        courseId,
        "QUERY_OPTIMIZATION",
      );

      expect(gaps).toHaveLength(1);
      expect(gaps[0]?.prerequisiteConceptId).toBe("RELATIONAL_ALGEBRA");
      expect(gaps[0]?.severity).toBe("CRITICAL");
      expect(gaps[0]?.currentPrereqMastery).toBe(0);
    });
  });

  describe("Adaptive Learning Path Engine (Phase 19C)", () => {
    it("generates prioritized adaptive study interventions based on prerequisites and mastery states", async () => {
      // Concepts in course outline
      const courseConcepts = [
        {
          conceptId: "RELATIONAL_ALGEBRA",
          conceptName: "Relational Algebra Fundamentals",
          lessonId: "les-rel-alg",
          order: 1,
        },
        {
          conceptId: "B_TREE_INDEXING",
          conceptName: "B-Tree Indexing",
          lessonId: "les-btree",
          order: 2,
        },
        {
          conceptId: "QUERY_OPTIMIZATION",
          conceptName: "Cost-Based Query Optimization",
          lessonId: "les-opt",
          order: 3,
        },
        {
          conceptId: "TRANSACTION_ISOLATION",
          conceptName: "ACID Isolation Levels",
          lessonId: "les-acid",
          order: 4,
        },
      ];

      // Give student a weak score in RELATIONAL_ALGEBRA (< 50)
      await masteryService.recordEvidence({
        studentId,
        courseId,
        conceptId: "RELATIONAL_ALGEBRA",
        conceptName: "Relational Algebra Fundamentals",
        rawScorePercent: 35,
        evidenceSource: "QUIZ",
        bloomLevel: "REMEMBER",
      });

      const path = await pathService.generatePath({
        studentId,
        courseId,
        courseConcepts,
        completedLessonIds: ["les-btree"], // Completed lesson 2
      });

      expect(path.studentId).toBe(studentId);
      expect(path.items.length).toBeGreaterThan(0);

      // QUERY_OPTIMIZATION requires RELATIONAL_ALGEBRA (which is < 60), so priority 1 REVISIT_PREREQUISITE
      const prereqItem = path.items.find((i) => i.conceptId === "QUERY_OPTIMIZATION");
      expect(prereqItem).toBeDefined();
      expect(prereqItem?.action).toBe("REVISIT_PREREQUISITE");
      expect(prereqItem?.priority).toBe(1);

      // RELATIONAL_ALGEBRA score is low (< 50), so recommendation is REVIEW
      const reviewItem = path.items.find((i) => i.conceptId === "RELATIONAL_ALGEBRA");
      expect(reviewItem).toBeDefined();
      expect(reviewItem?.action).toBe("REVIEW");

      // B_TREE_INDEXING is > 85 and completed, so OPTIONAL_ENRICHMENT
      const enrichmentItem = path.items.find((i) => i.conceptId === "B_TREE_INDEXING");
      expect(enrichmentItem).toBeDefined();
      expect(enrichmentItem?.action).toBe("OPTIONAL_ENRICHMENT");

      // TRANSACTION_ISOLATION has no prerequisites and is unstarted -> CONTINUE
      const continueItem = path.items.find((i) => i.conceptId === "TRANSACTION_ISOLATION");
      expect(continueItem).toBeDefined();
      expect(continueItem?.action).toBe("CONTINUE");
    });
  });

  describe("Two-Stage Recommendations & Learner Feedback (Phase 19D & 19E)", () => {
    const catalog: CandidateCourse[] = [
      {
        courseId: "course-adv-db",
        title: "Advanced Database Internals",
        category: "Databases",
        tags: ["B_TREE_INDEXING", "QUERY_OPTIMIZATION"],
        prerequisites: ["B_TREE_INDEXING"], // Satisfied by student
        isPublished: true,
      },
      {
        courseId: "course-quantum",
        title: "Quantum Computing Basics",
        category: "Physics",
        tags: ["QUANTUM"],
        prerequisites: ["QUANTUM_MECHANICS_101"], // Not satisfied
        isPublished: true,
      },
      {
        courseId: "course-draft",
        title: "Unpublished Draft Course",
        category: "Databases",
        tags: ["DATABASES"],
        prerequisites: [],
        isPublished: false, // Not published
      },
    ];

    it("filters unpublished & already enrolled courses, and ranks by prerequisite readiness and category", async () => {
      const recs = await recommendationService.generateRecommendations({
        studentId,
        enrolledCourseIds: [courseId], // Already enrolled in courseId
        masteredConceptIds: ["B_TREE_INDEXING"],
        interestCategories: ["Databases"],
        catalogCourses: catalog,
      });

      // Draft course must never appear
      expect(recs.some((r) => r.courseId === "course-draft")).toBe(false);

      // Advanced DB should be top recommendation (prerequisites satisfied + interest match)
      expect(recs[0]?.courseId).toBe("course-adv-db");
      expect(recs[0]?.reasonCodes).toContain("ALL_PREREQUISITES_SATISFIED");
      expect(recs[0]?.reasonCodes).toContain("INTEREST_MATCH");
      expect(recs[0]?.score).toBeGreaterThan(70);
    });

    it("captures recommendation feedback and excludes courses with negative feedback", async () => {
      // Student marks course-adv-db as "already_know"
      await recommendationService.recordFeedback({
        studentId,
        recommendationId: randomUUID(),
        courseId: "course-adv-db",
        feedbackType: "already_know",
        comment: "I completed this elsewhere.",
      });

      const updatedRecs = await recommendationService.generateRecommendations({
        studentId,
        enrolledCourseIds: [courseId],
        masteredConceptIds: ["B_TREE_INDEXING"],
        interestCategories: ["Databases"],
        catalogCourses: catalog,
      });

      // course-adv-db is now suppressed due to negative feedback
      expect(updatedRecs.some((r) => r.courseId === "course-adv-db")).toBe(false);
    });
  });
});
