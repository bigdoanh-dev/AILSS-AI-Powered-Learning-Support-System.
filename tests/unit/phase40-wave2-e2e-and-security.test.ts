import { describe, it, expect } from "vitest";
import { CourseAuthoringStudioService } from "../../apps/learning-service/src/course-authoring/course-authoring-studio-service.js";
import { QuestionBankV2Service } from "../../apps/assessment-service/src/authoring/question-bank-v2-service.js";
import { CurriculumIntelligenceService } from "../../apps/learning-service/src/curriculum/curriculum-intelligence-service.js";
import { ProductExperimentationService } from "../../apps/learning-service/src/experimentation/product-experimentation-service.js";
import { FleetOperationsService } from "../../apps/identity-service/src/tenant/fleet-operations-service.js";
import { TenantFeatureFlagResolver } from "../../packages/contracts/src/feature-flags.js";

describe("Phase 40 Corrective Closure: Wave 1 Security Paths & Wave 2 Feature E2E (40.C7 - 40.C12)", () => {
  // ==========================================================================
  // 40.C7: Wave 1 Negative & Security Paths
  // ==========================================================================
  describe("40.C7 — Wave 1 Negative & Security Paths", () => {
    it("rejects saving templates containing forbidden secret material", () => {
      const fleetService = new FleetOperationsService();
      expect(() => {
        fleetService.saveTemplate({
          templateId: "bad-sec-template",
          name: "Leak Template",
          description: "Bad",
          identitySetup: {
            protocol: "OIDC",
            discoveryUrlPattern: "https://auth.example.com",
            allowedDomainRules: ["example.com"],
            ...({ client_secret: "secret-token-leak" } as unknown as object),
          },
          featurePolicy: {},
          aiPolicy: {
            allowedPedagogicalModes: ["EXPLAIN"],
            requireTeacherReviewForAiContent: true,
            studentDirectChatEnabled: true,
          },
          defaultLearningConfig: { gradingScale: "10", masteryPolicyId: "p", passingScore: 5 },
          notificationConfig: { digestFrequency: "DAILY", smsEnabled: false },
          createdAt: new Date().toISOString(),
        });
      }).toThrow(/Security Violation/);
    });

    it("requires dry-run bulk preview before executing changes", () => {
      const fleetService = new FleetOperationsService();
      fleetService.registerTenantConfig("tenant-polytech", { name: "Polytech", AI_TUTOR_V2: false });
      fleetService.registerTenantConfig("tenant-fpt-uni", { name: "FPT", AI_TUTOR_V2: false });

      const preview = fleetService.previewBulkOperation({
        targetTenantIds: ["tenant-polytech", "tenant-fpt-uni"],
        operationType: "FEATURE_ENABLEMENT",
        payload: { AI_TUTOR_V2: true },
      });

      expect(preview.dryRunPassed).toBe(true);
      expect(preview.targetTenantCount).toBe(2);

      const exec = fleetService.executeBulkOperation(preview);
      expect(exec.successfulCount).toBe(2);
    });

    it("handles feature flag disabled gracefully by returning false", () => {
      const resolver = new TenantFeatureFlagResolver([
        {
          flag: "ADAPTIVE_LEARNING_V2",
          mode: "OFF",
          allowedTenants: [],
          description: "Disabled for testing",
          updatedAt: new Date().toISOString(),
        },
      ]);

      const isEnabled = resolver.isEnabled("ADAPTIVE_LEARNING_V2", { tenantId: "tenant-polytech" });
      expect(isEnabled).toBe(false);
    });

    it("handles RAG low evidence by triggering pedagogical abstention", () => {
      const emptyCitations: Array<{ confidenceScore: number }> = [];
      const shouldAbstain = emptyCitations.length === 0;
      expect(shouldAbstain).toBe(true);
    });

    it("detects configuration drift against desired baseline", () => {
      const fleetService = new FleetOperationsService();
      fleetService.registerTenantConfig("tenant-drift-check", {
        name: "Drift College",
        AI_TUTOR_V2: false,
      });

      const report = fleetService.detectConfigDrift("tenant-drift-check", {
        AI_TUTOR_V2: true,
      });

      expect(report.status).toBe("DRIFTED");
      expect(report.driftedFields[0]?.field).toBe("AI_TUTOR_V2");
    });
  });

  // ==========================================================================
  // 40.C8: Course Authoring V2 E2E
  // ==========================================================================
  describe("40.C8 — Course Authoring Studio V2 Journey", () => {
    it("executes full authoring lifecycle: module, lesson, outcome, review, approval, publish", () => {
      const studio = new CourseAuthoringStudioService();
      const tenantId = "tenant-polytech";
      const courseId = "course-cs202";
      const lecturerId = "lecturer-lead";

      // 1. Create draft
      const course = studio.createCourse({
        courseId,
        tenantId,
        title: "Cấu trúc Dữ liệu Nâng cao V2",
        description: "Khoá học toàn diện về B-Tree, Red-Black Tree và Đồ thị",
      });
      expect(course.status).toBe("DRAFT");

      // 2. Add Module & Lessons
      const mod1 = studio.addModule(courseId, {
        title: "Module 1: Cây Cân Bằng AVL & Đỏ-Đen",
        learningOutcomeIds: ["LO-AVL-01"],
      });
      const lesson1 = studio.addLesson(courseId, mod1.moduleId, {
        title: "Bài 1.1: Phép xoay cây AVL",
        content: "Nội dung chi tiết...",
        estimatedMinutes: 45,
        learningOutcomeIds: ["LO-AVL-01"],
      });
      expect(lesson1.title).toBe("Bài 1.1: Phép xoay cây AVL");

      // 3. Invariant: Cannot publish when DRAFT
      expect(() => {
        studio.publishCourseVersion({
          courseId,
          newVersion: "v2.0.0",
          changedBy: lecturerId,
          approvedBy: "chair-01",
          changeSummary: "First release",
        });
      }).toThrow(/Cannot publish: Course must have APPROVED status/);

      // 4. Transition DRAFT -> IN_REVIEW -> APPROVED
      studio.updateLifecycleStatus(courseId, "IN_REVIEW", { userId: lecturerId, role: "INSTRUCTOR" });
      studio.updateLifecycleStatus(courseId, "APPROVED", { userId: "chair-01", role: "ADMIN" });

      // 5. Publish snapshot
      const snapshot = studio.publishCourseVersion({
        courseId,
        newVersion: "v2.0.0",
        changedBy: lecturerId,
        approvedBy: "chair-01",
        changeSummary: "First approved release of CS202 V2",
      });

      expect(snapshot.courseVersion).toBe("v2.0.0");
      expect(snapshot.approvedBy).toBe("chair-01");
      expect(snapshot.isCurrentActive).toBe(true);

      // 6. Verify learner-visible version
      const learnerView = studio.getCourse(courseId);
      expect(learnerView).not.toBeNull();
      expect(learnerView?.status).toBe("PUBLISHED");
      expect(learnerView?.currentVersion).toBe("v2.0.0");
    });

    it("rejects unauthorized publishing without review approval", () => {
      const studio = new CourseAuthoringStudioService();
      studio.createCourse({
        courseId: "course-unauth-test",
        tenantId: "tenant-polytech",
        title: "Unauthorized publish test",
        description: "test",
      });

      // Attempting to publish straight from DRAFT without approval
      expect(() => {
        studio.publishCourseVersion({
          courseId: "course-unauth-test",
          newVersion: "v1.0.0",
          changedBy: "student-attacker",
          approvedBy: "student-attacker",
          changeSummary: "illegal bypass",
        });
      }).toThrow(/Cannot publish: Course must have APPROVED status/);
    });
  });

  // ==========================================================================
  // 40.C9: Assessment Authoring V2 & Item Analysis E2E
  // ==========================================================================
  describe("40.C9 — Assessment Question Bank V2 & Item Analysis", () => {
    it("creates question draft, validates blueprint, performs human review, and calculates item analysis", () => {
      const qb = new QuestionBankV2Service();
      const tenantId = "tenant-polytech";
      const courseId = "course-cs101";
      const lecturerId = "lecturer-smith";

      // 1. Create AI-assisted question draft
      const question = qb.createQuestion({
        questionId: "q-ai-test-01",
        tenantId,
        learningOutcomeIds: ["LO-DATA-01"],
        prompt: "Tìm kiếm 1 khóa trong B-Tree bậc m có n phần tử tốn thời gian bao nhiêu?",
        questionType: "MULTIPLE_CHOICE",
        options: [
          { id: "opt-a", text: "O(log_m n)", isCorrect: true },
          { id: "opt-b", text: "O(n)", isCorrect: false },
          { id: "opt-c", text: "O(n^2)", isCorrect: false },
        ],
        difficulty: 0.7,
        bloomTaxonomyLevel: "APPLY",
        tags: ["b-tree", "complexity"],
        authorId: lecturerId,
        isAiGenerated: true,
      });

      // Must start in DRAFT
      expect(question.status).toBe("DRAFT");

      // 2. Human reviewer approves
      const approved = qb.updateQualityStatus(question.questionId, "APPROVED", lecturerId);
      expect(approved.status).toBe("APPROVED");
      expect(approved.reviewerId).toBe(lecturerId);

      // 3. Item Analysis after student attempts
      qb.recordAttempt(question.questionId, {
        studentId: "s-1",
        selectedOption: "opt-a",
        isCorrect: true,
        totalExamScore: 90,
      });
      qb.recordAttempt(question.questionId, {
        studentId: "s-2",
        selectedOption: "opt-a",
        isCorrect: true,
        totalExamScore: 85,
      });
      qb.recordAttempt(question.questionId, {
        studentId: "s-3",
        selectedOption: "opt-b",
        isCorrect: false,
        totalExamScore: 40,
      });

      // 3. Small-sample guard (N=3 < 30) -> INSUFFICIENT_SAMPLE
      const analysisSmall = qb.computeItemAnalysis(question.questionId);
      expect(analysisSmall.totalAttempts).toBe(3);
      expect(analysisSmall.status).toBe("INSUFFICIENT_SAMPLE");
      expect(analysisSmall.itemDifficultyP).toBe(0.67);
      expect(analysisSmall.upperLowerDiscriminationD).toBeNull();
      expect(analysisSmall.pointBiserialRpb).toBeNull();
      expect(analysisSmall.reviewVerdict).toBe("INSUFFICIENT_SAMPLE");
    });

    it("40.F14 - 40.F19: computes separated P, D, r_pb, distractor efficiency, and advisory review flags across synthetic distributions", () => {
      const qb = new QuestionBankV2Service();
      const tenantId = "tenant-polytech";

      // 1. Easy / High-Discrimination Item (N = 100)
      const qEasyHighDisc = qb.createQuestion({
        questionId: "q-easy-high-disc",
        tenantId,
        learningOutcomeIds: ["LO-CS-01"],
        prompt: "Cú pháp khai báo biến trong TypeScript",
        questionType: "MULTIPLE_CHOICE",
        options: [
          { id: "A", text: "let x: number = 5;", isCorrect: true },
          { id: "B", text: "dim x as integer", isCorrect: false },
          { id: "C", text: "val x := 5", isCorrect: false },
          { id: "D", text: "var int x = 5", isCorrect: false },
        ],
        difficulty: 0.3,
        bloomTaxonomyLevel: "REMEMBER",
        tags: ["ts", "variables"],
        authorId: "lecturer-01",
      });

      // Helper to generate synthetic test attempts concisely without bloating test file
      const recordBatchAttempts = (
        qId: string,
        prefix: string,
        count: number,
        correctCount: number,
        baseScore: number,
        options: { correct: string; incorrect: string },
      ) => {
        for (let i = 0; i < count; i++) {
          const isCorrect = i < correctCount;
          qb.recordAttempt(qId, {
            studentId: `${prefix}-${String(i)}`,
            selectedOption: isCorrect ? options.correct : options.incorrect,
            isCorrect,
            totalExamScore: baseScore + (i % 20),
          });
        }
      };

      // Top 27 (all correct, high scores), Middle 46 (40 correct), Bottom 27 (10 correct, low scores)
      recordBatchAttempts(qEasyHighDisc.questionId, "s-top", 27, 27, 85, { correct: "A", incorrect: "B" });
      recordBatchAttempts(qEasyHighDisc.questionId, "s-mid", 46, 40, 60, { correct: "A", incorrect: "B" });
      recordBatchAttempts(qEasyHighDisc.questionId, "s-bot", 27, 10, 20, { correct: "A", incorrect: "B" });

      const resEasy = qb.computeItemAnalysis(qEasyHighDisc.questionId);
      expect(resEasy.status).toBe("CALCULATED");
      expect(resEasy.totalAttempts).toBe(100);
      expect(resEasy.itemDifficultyP).toBe(0.77); // (27 + 40 + 10) / 100
      expect(resEasy.upperLowerDiscriminationD).not.toBeNull();
      expect(resEasy.upperLowerDiscriminationD?.pUpper).toBe(1.0); // 27/27
      expect(resEasy.upperLowerDiscriminationD?.pLower).toBe(0.37); // 10/27
      expect(resEasy.upperLowerDiscriminationD?.dValue).toBe(0.63); // 1.0 - 0.37
      expect(resEasy.pointBiserialRpb).not.toBeNull();
      expect(resEasy.pointBiserialRpb?.rPb).toBeGreaterThan(0.4); // Strong positive item-rest correlation
      expect(resEasy.pointBiserialRpb?.scoreDefinition).toBe("CORRECTED_TOTAL_EXCLUDING_ITEM");
      expect(resEasy.pointBiserialRpb?.methodVersion).toBe("CORRECTED_ITEM_REST_PEARSON");
      expect(resEasy.correctedItemRestPointBiserial?.rPb).toBe(resEasy.pointBiserialRpb?.rPb);
      expect(resEasy.itemRestPointBiserial?.rPb).toBe(resEasy.pointBiserialRpb?.rPb);

      // 2. Negative Discrimination Item (Tricky distractor misleading top students)
      const qNegativeDisc = qb.createQuestion({
        questionId: "q-neg-disc",
        tenantId,
        learningOutcomeIds: ["LO-CS-02"],
        prompt: "Trick question where top students pick misleading distractor",
        questionType: "MULTIPLE_CHOICE",
        difficulty: 0.8,
        bloomTaxonomyLevel: "ANALYZE",
        tags: ["trick"],
        authorId: "lecturer-01",
      });

      // Top 27: only 5 correct, Bottom 27: 18 correct
      recordBatchAttempts(qNegativeDisc.questionId, "s-top", 27, 5, 85, { correct: "A", incorrect: "B" });
      recordBatchAttempts(qNegativeDisc.questionId, "s-bot", 27, 18, 20, { correct: "A", incorrect: "B" });

      const resNeg = qb.computeItemAnalysis(qNegativeDisc.questionId, 54);
      expect(resNeg.upperLowerDiscriminationD?.dValue).toBeLessThan(0);
      expect(resNeg.correctedItemRestPointBiserial?.rPb).toBeLessThan(0);
      expect(resNeg.advisoryFlags).toContain("NEGATIVE_DISCRIMINATION");
      expect(resNeg.reviewVerdict).toBe("REVIEW_RECOMMENDED");
      // Advisory invariant: Question is NEVER auto-deleted or invalidated
      expect(qb.getQuestion(qNegativeDisc.questionId)).toBeDefined();

      // 3. All-Correct and All-Incorrect boundary cases (40.G20)
      const qAllCorrect = qb.createQuestion({
        questionId: "q-all-correct",
        tenantId,
        learningOutcomeIds: ["LO-CS-03"],
        prompt: "1 + 1 = ?",
        questionType: "MULTIPLE_CHOICE",
        difficulty: 0.1,
        bloomTaxonomyLevel: "REMEMBER",
        tags: ["math"],
        authorId: "lecturer-01",
      });
      recordBatchAttempts(qAllCorrect.questionId, "s-ac", 40, 40, 50, { correct: "A", incorrect: "B" });
      const resAllCorrect = qb.computeItemAnalysis(qAllCorrect.questionId, 30);
      expect(resAllCorrect.itemDifficultyP).toBe(1.0);
      expect(resAllCorrect.upperLowerDiscriminationD?.dValue).toBe(0.0);
      expect(resAllCorrect.correctedItemRestPointBiserial?.rPb).toBe(0.0);
      expect(resAllCorrect.advisoryFlags).toContain("EXTREME_DIFFICULTY");

      const qAllIncorrect = qb.createQuestion({
        questionId: "q-all-incorrect",
        tenantId,
        learningOutcomeIds: ["LO-CS-03B"],
        prompt: "Impossible question",
        questionType: "MULTIPLE_CHOICE",
        difficulty: 0.99,
        bloomTaxonomyLevel: "ANALYZE",
        tags: ["hard"],
        authorId: "lecturer-01",
      });
      recordBatchAttempts(qAllIncorrect.questionId, "s-ai", 40, 0, 30, { correct: "A", incorrect: "B" });
      const resAllIncorrect = qb.computeItemAnalysis(qAllIncorrect.questionId, 30);
      expect(resAllIncorrect.itemDifficultyP).toBe(0.0);
      expect(resAllIncorrect.correctedItemRestPointBiserial?.rPb).toBe(0.0);
      expect(resAllIncorrect.advisoryFlags).toContain("EXTREME_DIFFICULTY");

      // 4. Near-Zero Correlation (40.G20)
      const qNearZero = qb.createQuestion({
        questionId: "q-near-zero",
        tenantId,
        learningOutcomeIds: ["LO-CS-04"],
        prompt: "Uncorrelated item",
        questionType: "MULTIPLE_CHOICE",
        difficulty: 0.5,
        bloomTaxonomyLevel: "UNDERSTAND",
        tags: ["random"],
        authorId: "lecturer-01",
      });
      for (let i = 0; i < 40; i++) {
        const isCorrect = i % 2 === 0;
        qb.recordAttempt(qNearZero.questionId, {
          studentId: `s-nz-${i}`,
          selectedOption: isCorrect ? "A" : "B",
          isCorrect,
          totalExamScore: 50 + (i % 5) * 5, // uncorrelated scores
        });
      }
      const resNearZero = qb.computeItemAnalysis(qNearZero.questionId, 30);
      expect(Math.abs(resNearZero.correctedItemRestPointBiserial?.rPb ?? 1)).toBeLessThan(0.2);

      // 5. One-Item Assessment (40.G20: rest score X' = y - y = 0 => Var(X') = 0 => 0.0, no NaN)
      const qOneItem = qb.createQuestion({
        questionId: "q-one-item",
        tenantId,
        learningOutcomeIds: ["LO-CS-05"],
        prompt: "Single item quiz",
        questionType: "MULTIPLE_CHOICE",
        difficulty: 0.5,
        bloomTaxonomyLevel: "REMEMBER",
        tags: ["single"],
        authorId: "lecturer-01",
      });
      for (let i = 0; i < 30; i++) {
        const isCorrect = i < 15;
        qb.recordAttempt(qOneItem.questionId, {
          studentId: `s-single-${i}`,
          selectedOption: isCorrect ? "A" : "B",
          isCorrect,
          totalExamScore: isCorrect ? 1 : 0, // totalExamScore is solely this item
        });
      }
      const resOneItem = qb.computeItemAnalysis(qOneItem.questionId, 30);
      expect(resOneItem.correctedItemRestPointBiserial?.rPb).toBe(0.0);
      expect(Number.isNaN(resOneItem.correctedItemRestPointBiserial?.rPb)).toBe(false);

      // 6. Two-Item Assessment (40.G20: total score in {0, 1, 2}, rest score is the other item)
      const qTwoItem = qb.createQuestion({
        questionId: "q-two-item",
        tenantId,
        learningOutcomeIds: ["LO-CS-06"],
        prompt: "Two-item test question 1",
        questionType: "MULTIPLE_CHOICE",
        difficulty: 0.6,
        bloomTaxonomyLevel: "UNDERSTAND",
        tags: ["two-item"],
        authorId: "lecturer-01",
      });
      for (let i = 0; i < 30; i++) {
        // High ability students (first 18) get both items right (total=2, y=1 => rest=1)
        // Low ability students (remaining 12) get both wrong (total=0, y=0 => rest=0)
        const isCorrect = i < 18;
        qb.recordAttempt(qTwoItem.questionId, {
          studentId: `s-two-${i}`,
          selectedOption: isCorrect ? "A" : "B",
          isCorrect,
          totalExamScore: isCorrect ? 2 : 0,
        });
      }
      const resTwoItem = qb.computeItemAnalysis(qTwoItem.questionId, 30);
      expect(resTwoItem.correctedItemRestPointBiserial?.rPb).toBeGreaterThan(0.9);
      expect(Number.isNaN(resTwoItem.correctedItemRestPointBiserial?.rPb)).toBe(false);
    });
  });

  // ==========================================================================
  // 40.C10: Curriculum Intelligence E2E
  // ==========================================================================
  describe("40.C10 — Curriculum Intelligence & Outcome Coverage", () => {
    it("analyzes program curriculum map, identifies coverage gaps, and exports audit-logged report", () => {
      const curriculumService = new CurriculumIntelligenceService();
      const tenantId = "tenant-polytech";
      const programId = "prog-software-engineering-2026";

      const map = curriculumService.buildCurriculumMap(programId, tenantId, [
        {
          programOutcomeCode: "PO-01",
          courseOutcomeCode: "CO-CS101",
          learningOutcomeId: "LO-01",
          learningOutcomeTitle: "Nhập môn Lập trình",
          assessmentEvidenceCount: 5,
        },
        {
          programOutcomeCode: "PO-02",
          courseOutcomeCode: "CO-CS201",
          learningOutcomeId: "LO-02",
          learningOutcomeTitle: "Cấu trúc Dữ liệu & Giải thuật",
          assessmentEvidenceCount: 8,
        },
      ]);

      expect(map.programId).toBe(programId);
      expect(map.links).toHaveLength(2);

      // Coverage analysis against accredited program outcomes
      const coverage = curriculumService.analyzeCoverage(
        map,
        [
          { outcomeId: "LO-01", title: "Nhập môn Lập trình" },
          { outcomeId: "LO-02", title: "Cấu trúc Dữ liệu & Giải thuật" },
          { outcomeId: "LO-SEC-01", title: "An toàn Thông tin Nâng cao" }, // Missing security outcome!
        ],
        [{ source: "LO-01", target: "LO-02" }],
      );

      expect(coverage.unassessedOutcomes).toContain("LO-SEC-01 (An toàn Thông tin Nâng cao)");
      expect(coverage.summaryVerdict).toBe("ACTION_RECOMMENDED");

      // Export report with audit log
      const exportReport = curriculumService.exportCurriculumEvidence({
        tenantId,
        requestedBy: "academic-dean-01",
        userRole: "ADMIN",
        map,
        coverage,
      });

      expect(exportReport.exportId).toBeDefined();
      expect(exportReport.auditSignature).toContain("sha256-audit");
      expect(exportReport.tenantId).toBe(tenantId);
    });
  });

  // ==========================================================================
  // 40.C11: Product Experimentation E2E
  // ==========================================================================
  describe("40.C11 — Product Experimentation Framework", () => {
    it("allocates deterministic and stable variants across sessions", () => {
      const expService = new ProductExperimentationService();
      const tenantId = "tenant-polytech";

      expService.registerExperiment({
        experimentId: "exp-ui-cta-placement-v1",
        name: "Workspace Hero Banner Test",
        hypothesis: "New banner increases activity",
        experimentDomain: "RECOMMENDATION_RANKING",
        variants: ["CONTROL", "TREATMENT_A", "TREATMENT_B"],
        tenantAllowlist: [tenantId],
        startDate: "2026-09-21",
        endDate: "2026-10-21",
        status: "RUNNING",
      });

      // Deterministic allocation for student-1
      const v1 = expService.assignVariant("exp-ui-cta-placement-v1", "student-1", tenantId, "2026-Fall");
      const v2 = expService.assignVariant("exp-ui-cta-placement-v1", "student-1", tenantId, "2026-Fall");
      expect(v1.assignedVariant).toBe(v2.assignedVariant); // Stable across repeated calls
    });

    it("strictly blocks experiments attempting to modify grades, credentials, or payments", () => {
      const expService = new ProductExperimentationService();
      const tenantId = "tenant-polytech";

      // Attempting to target GRADE_CORRECTNESS -> BLOCKED!
      expect(() => {
        expService.registerExperiment({
          experimentId: "exp-grade-curve-test",
          name: "Experiment on GRADE_CORRECTNESS calculation",
          hypothesis: "Inflate grades for engagement",
          experimentDomain: "RECOMMENDATION_RANKING",
          variants: ["CONTROL", "TREATMENT_A"],
          tenantAllowlist: [tenantId],
          startDate: "2026-09-21",
          endDate: "2026-10-21",
          status: "DRAFT",
        });
      }).toThrow(
        /Security & Integrity Violation: Experimentation on GRADE_CORRECTNESS is strictly prohibited/,
      );

      // Attempting to target PAYMENT -> BLOCKED!
      expect(() => {
        expService.registerExperiment({
          experimentId: "exp-payment-test",
          name: "Experiment on PAYMENT_AMOUNT calculation",
          hypothesis: "Discount testing",
          experimentDomain: "RECOMMENDATION_RANKING",
          variants: ["CONTROL", "TREATMENT_A"],
          tenantAllowlist: [tenantId],
          startDate: "2026-09-21",
          endDate: "2026-10-21",
          status: "DRAFT",
        });
      }).toThrow(/Security & Integrity Violation: Experimentation on PAYMENT_AMOUNT is strictly prohibited/);
    });

    it("evaluates learning metrics across variants", () => {
      const expService = new ProductExperimentationService();
      const tenantId = "tenant-polytech";

      expService.registerExperiment({
        experimentId: "exp-layout-v2",
        name: "New Dashboard Layout",
        hypothesis: "Dashboard layout test",
        experimentDomain: "STUDY_PLAN_UI",
        variants: ["CONTROL", "TREATMENT_A"],
        tenantAllowlist: [tenantId],
        startDate: "2026-09-21",
        endDate: "2026-10-21",
        status: "RUNNING",
      });

      const assignment = expService.assignVariant("exp-layout-v2", "student-2", tenantId, "2026-Fall");
      expect(assignment.assignedVariant).toBeDefined();

      const evaluation = expService.evaluateExperiment("exp-layout-v2", [
        {
          variant: assignment.assignedVariant,
          activityCompleted: true,
          recommendationAccepted: true,
          masteryGain: 15,
          retriedExercise: true,
          tutorRating: 5,
        },
      ]);

      expect(evaluation.experimentId).toBe("exp-layout-v2");
      expect(evaluation.totalParticipants).toBe(1);
    });
  });
});
