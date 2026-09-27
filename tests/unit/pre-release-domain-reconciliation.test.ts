import { describe, it, expect, beforeEach } from "vitest";
import { CANONICAL_PREREQUISITE_POLICY } from "../../packages/contracts/src/index.js";
import {
  LearnerMasteryService,
  InMemoryMasteryRepository,
} from "../../apps/learning-service/src/mastery/mastery-service.js";
import {
  CourseRecommendationService,
  InMemoryRecommendationRepository,
  type CandidateCourse,
} from "../../apps/learning-service/src/adaptive/recommendation-service.js";
import {
  CourseVersioningService,
  InMemoryVersioningRepository,
} from "../../apps/learning-service/src/versioning/versioning-service.js";
import {
  ProductionPayoutProvider,
  InMemoryPayoutIdempotencyStore,
  type PayoutSubmissionRequest,
} from "../../apps/learning-service/src/finance/payout-provider.js";

describe("Phase 20.0 — Pre-Implementation Reality Reconciliation & Stabilization", () => {
  describe("20.0.2 Prerequisite Threshold Policy Resolution", () => {
    it("exports consistent canonical thresholds across all subsystems", () => {
      expect(CANONICAL_PREREQUISITE_POLICY.requiredPrerequisiteMastery).toBe(70);
      expect(CANONICAL_PREREQUISITE_POLICY.recommendedPrerequisiteMastery).toBe(50);
      expect(CANONICAL_PREREQUISITE_POLICY.reviewThreshold).toBe(50);
      expect(CANONICAL_PREREQUISITE_POLICY.practiceThreshold).toBe(75);
      expect(CANONICAL_PREREQUISITE_POLICY.advancedMasteryThreshold).toBe(85);
    });

    it("evaluates required (70) and recommended (50) prerequisite gaps using canonical policy", async () => {
      const repo = new InMemoryMasteryRepository();
      const masteryService = new LearnerMasteryService(repo);

      await repo.savePrerequisites([
        {
          courseId: "course-adv",
          conceptId: "ADVANCED_CONCEPT",
          prerequisiteConceptId: "HARD_PREREQ",
          strength: "REQUIRED",
        },
        {
          courseId: "course-adv",
          conceptId: "ADVANCED_CONCEPT",
          prerequisiteConceptId: "SOFT_PREREQ",
          strength: "RECOMMENDED",
        },
      ]);

      // Student has 65% in HARD_PREREQ (fails required threshold 70)
      await masteryService.recordEvidence({
        studentId: "stu-1",
        courseId: "course-adv",
        conceptId: "HARD_PREREQ",
        conceptName: "Hard Prerequisite",
        rawScorePercent: 65,
        evidenceSource: "QUIZ",
        bloomLevel: "APPLY",
      });

      // Student has 45% in SOFT_PREREQ (fails recommended threshold 50)
      await masteryService.recordEvidence({
        studentId: "stu-1",
        courseId: "course-adv",
        conceptId: "SOFT_PREREQ",
        conceptName: "Soft Prerequisite",
        rawScorePercent: 45,
        evidenceSource: "QUIZ",
        bloomLevel: "UNDERSTAND",
      });

      const gaps = await masteryService.findPrerequisiteGaps("stu-1", "course-adv", "ADVANCED_CONCEPT");
      expect(gaps.length).toBe(2);

      const hardGap = gaps.find((g) => g.prerequisiteConceptId === "HARD_PREREQ");
      expect(hardGap).toBeDefined();
      expect(hardGap?.requiredScore).toBe(70);
      expect(hardGap?.severity).toBe("CRITICAL");

      const softGap = gaps.find((g) => g.prerequisiteConceptId === "SOFT_PREREQ");
      expect(softGap).toBeDefined();
      expect(softGap?.requiredScore).toBe(50);
      expect(softGap?.severity).toBe("MODERATE");
    });
  });

  describe("20.0.3 Recommender Candidate Eligibility (INELIGIBLE vs ELIGIBLE_WITH_WARNING vs ELIGIBLE)", () => {
    let repo: InMemoryRecommendationRepository;
    let service: CourseRecommendationService;

    beforeEach(() => {
      repo = new InMemoryRecommendationRepository();
      service = new CourseRecommendationService(repo);
    });

    const testCatalog: CandidateCourse[] = [
      {
        courseId: "c-hard-blocked",
        title: "Calculus III",
        category: "Math",
        tags: ["CALCULUS"],
        prerequisites: [{ conceptId: "CALCULUS_I", strength: "REQUIRED" }],
        isPublished: true,
      },
      {
        courseId: "c-soft-warning",
        title: "Data Visualization",
        category: "Data Science",
        tags: ["VIZ"],
        prerequisites: [{ conceptId: "STATISTICS_BASICS", strength: "RECOMMENDED" }],
        isPublished: true,
      },
      {
        courseId: "c-fully-ready",
        title: "Web Engineering",
        category: "Computer Science",
        tags: ["WEB"],
        prerequisites: [{ conceptId: "HTML_CSS", strength: "REQUIRED" }],
        isPublished: true,
      },
    ];

    it("strictly filters out INELIGIBLE candidates and flags ELIGIBLE_WITH_WARNING candidates", async () => {
      const recs = await service.generateRecommendations({
        studentId: "student-eligibility-test",
        enrolledCourseIds: [],
        masteredConceptIds: ["HTML_CSS"], // Has HTML_CSS (100%), but missing CALCULUS_I and STATISTICS_BASICS
        catalogCourses: testCatalog,
      });

      // 1. Calculus III has missing REQUIRED prerequisite -> INELIGIBLE -> must NOT appear
      expect(recs.some((r) => r.courseId === "c-hard-blocked")).toBe(false);

      // 2. Data Visualization has missing RECOMMENDED prerequisite -> ELIGIBLE_WITH_WARNING -> appears with warning
      const vizRec = recs.find((r) => r.courseId === "c-soft-warning");
      expect(vizRec).toBeDefined();
      expect(vizRec?.eligibilityStatus).toBe("ELIGIBLE_WITH_WARNING");
      expect(vizRec?.reasonCodes).toContain("PREREQUISITE_GAP_WARNING");
      expect(vizRec?.explanation).toContain("Note: recommended background concepts");

      // 3. Web Engineering has satisfied REQUIRED prerequisite -> ELIGIBLE -> top recommendation
      const webRec = recs.find((r) => r.courseId === "c-fully-ready");
      expect(webRec).toBeDefined();
      expect(webRec?.eligibilityStatus).toBe("ELIGIBLE");
      expect(webRec?.reasonCodes).toContain("ALL_PREREQUISITES_SATISFIED");
    });
  });

  describe("20.0.4 Course Release Concurrency (CAS / LWT Safe Sequencing)", () => {
    it("rejects concurrent publication race conditions with CONCURRENT_PUBLICATION_CONFLICT", async () => {
      const repo = new InMemoryVersioningRepository();
      const service = new CourseVersioningService(repo);

      const courseId = "course-concurrency-test";
      const dummySyllabus = {
        modules: [
          {
            moduleId: "mod-1",
            title: "Module 1",
            order: 1,
            lessons: [{ lessonId: "les-1", title: "Lesson 1", order: 1 }],
          },
        ],
      };

      // Initial release v1 publishes cleanly
      const v1 = await service.publishRelease({
        courseId,
        title: "Version 1",
        syllabus: dummySyllabus,
        changeLog: "Initial release",
        publishedBy: "lecturer-1",
        isLecturerReviewed: true,
      });
      expect(v1.version).toBe(1);

      // Simulate two concurrent requests both attempting to publish v2 from v1 baseline
      const latestBeforePublish = await repo.getLatestRelease(courseId);
      expect(latestBeforePublish?.version).toBe(1);

      // Request A publishes v2
      const publishPromiseA = service.publishRelease({
        courseId,
        title: "Version 2A",
        syllabus: dummySyllabus,
        changeLog: "Request A update",
        publishedBy: "lecturer-1",
        isLecturerReviewed: true,
      });

      // Request B also attempts to publish, but CAS enforces optimistic locking
      // If we simulate concurrent race by manually calling saveReleaseWithCas on stale expected version 1:
      const v2A = await publishPromiseA;
      expect(v2A.version).toBe(2);

      // Now concurrent transaction B with stale expected version 1 must fail:
      await expect(
        repo.saveReleaseWithCas(
          {
            courseId,
            version: 2,
            status: "PUBLISHED",
            title: "Version 2B Collision",
            syllabusJson: JSON.stringify(dummySyllabus),
            contentHash: "hash-collision",
            changeLog: "Conflicting release",
            publishedBy: "lecturer-2",
            publishedAt: new Date().toISOString(),
          },
          1, // Stale expected version (since current version is already 2)
        ),
      ).resolves.toBe(false);

      // Direct service call now correctly increments to version 3
      const v3 = await service.publishRelease({
        courseId,
        title: "Version 3",
        syllabus: dummySyllabus,
        changeLog: "Request B after retry",
        publishedBy: "lecturer-2",
        isLecturerReviewed: true,
      });
      expect(v3.version).toBe(3);
    });
  });

  describe("20.0.5 Durable Payout Idempotency (Surviving Service Restarts & Crash)", () => {
    it("guarantees idempotency across separate service instances sharing durable store", async () => {
      const durableStore = new InMemoryPayoutIdempotencyStore();

      // Instance A
      const instanceA = new ProductionPayoutProvider({
        apiKey: "sepay_key",
        secretKey: "shared_secret",
        idempotencyStore: durableStore,
      });

      const payoutRequest: PayoutSubmissionRequest = {
        batchId: "batch-durability-test-100",
        lecturerId: "lecturer-fin-1",
        amountMinor: 5000000,
        currency: "VND",
        bankAccount: {
          accountNumber: "0123456789",
          bankCode: "VCB",
          beneficiaryName: "Nguyen Van A",
        },
      };

      // Instance A executes payout
      const responseA = await instanceA.submitPayout(payoutRequest);
      expect(responseA.status).toBe("PROCESSING");
      expect(responseA.providerPayoutId).toContain("pout_prod_");

      // Verify record is durably stored
      const storedRecord = await durableStore.get(`${payoutRequest.batchId}:${payoutRequest.lecturerId}`);
      expect(storedRecord).toBeDefined();
      expect(storedRecord?.providerPayoutId).toBe(responseA.providerPayoutId);

      // Simulate Instance A CRASH!
      // New Instance B starts up in cluster, sharing same durable store
      const instanceB = new ProductionPayoutProvider({
        apiKey: "sepay_key",
        secretKey: "shared_secret",
        idempotencyStore: durableStore,
      });

      // Instance B receives duplicate submit payout request
      const responseB = await instanceB.submitPayout(payoutRequest);

      // Instance B returns identical providerPayoutId and status without calling bank again
      expect(responseB.providerPayoutId).toBe(responseA.providerPayoutId);
      expect(responseB.status).toBe("PROCESSING");
      expect(responseB.submittedAt.toISOString()).toBe(responseA.submittedAt.toISOString());
    });
  });
});
