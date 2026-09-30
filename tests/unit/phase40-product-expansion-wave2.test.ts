import { describe, it, expect } from "vitest";
import { CourseAuthoringStudioService } from "../../apps/learning-service/src/course-authoring/course-authoring-studio-service.js";
import { QuestionBankV2Service } from "../../apps/assessment-service/src/authoring/question-bank-v2-service.js";
import { CurriculumIntelligenceService } from "../../apps/learning-service/src/curriculum/curriculum-intelligence-service.js";
import { FleetOperationsService } from "../../apps/identity-service/src/tenant/fleet-operations-service.js";
import { ProductExperimentationService } from "../../apps/learning-service/src/experimentation/product-experimentation-service.js";
import type {
  AssessmentBlueprint,
  InstitutionTemplate,
  ExperimentDefinition,
} from "../../packages/contracts/src/index.js";

describe("Phase 40 Track 2: Product Expansion Wave 2 Verification", () => {
  describe("40.29 - 40.33: Course Authoring Studio V2 (Structure, Lifecycle, AI Assistant)", () => {
    const studio = new CourseAuthoringStudioService();

    it("enforces explicit course publishing lifecycle and blocks unapproved releases", () => {
      const course = studio.createCourse({
        courseId: "course-cs101-v2",
        tenantId: "tenant-polytech",
        title: "Cấu trúc Dữ liệu Nâng cao",
        description: "Khóa học mở rộng Wave 2",
      });
      expect(course.status).toBe("DRAFT");

      const mod = studio.addModule("course-cs101-v2", {
        title: "Chương 1: Cây cân bằng",
        learningOutcomeIds: ["LO-01", "LO-02"],
      });
      expect(mod.moduleId).toBeDefined();

      const lesson = studio.addLesson("course-cs101-v2", mod.moduleId, {
        title: "Bài 1: Cây AVL",
        content: "Nội dung chi tiết...",
        estimatedMinutes: 45,
        learningOutcomeIds: ["LO-01"],
      });
      expect(lesson.title).toBe("Bài 1: Cây AVL");

      // Invariant: Cannot publish when DRAFT
      expect(() =>
        studio.publishCourseVersion({
          courseId: "course-cs101-v2",
          newVersion: "v2.0.0",
          changedBy: "inst-01",
          approvedBy: "chair-01",
          changeSummary: "First release",
        }),
      ).toThrow("Cannot publish: Course must have APPROVED status");

      // Transition DRAFT -> IN_REVIEW -> APPROVED
      studio.updateLifecycleStatus("course-cs101-v2", "IN_REVIEW", { userId: "inst-01", role: "INSTRUCTOR" });
      studio.updateLifecycleStatus("course-cs101-v2", "APPROVED", { userId: "chair-01", role: "ADMIN" });

      // Publish snapshot
      const snapshot = studio.publishCourseVersion({
        courseId: "course-cs101-v2",
        newVersion: "v2.0.0",
        changedBy: "inst-01",
        approvedBy: "chair-01",
        changeSummary: "First approved release of CS101 V2",
      });

      expect(snapshot.courseVersion).toBe("v2.0.0");
      expect(snapshot.approvedBy).toBe("chair-01");
      expect(snapshot.isCurrentActive).toBe(true);
      expect(studio.getCourse("course-cs101-v2")?.status).toBe("PUBLISHED");
    });

    it("generates AI authoring draft with source citations and marks it strictly DRAFT_REQUIRES_HUMAN_APPROVAL", () => {
      const draft = studio.requestAiDraft({
        courseId: "course-cs101-v2",
        learningOutcomeId: "LO-01",
        draftType: "PRACTICE_ACTIVITY",
        sourceMaterialReferences: [
          {
            documentId: "doc-textbook-algo",
            documentTitle: "Giáo trình Cấu trúc Dữ liệu",
            section: "4.2 Cây AVL",
          },
        ],
        promptInstructions: "Tạo bài tập tự luận mô phỏng các bước xoay cây AVL",
      });

      expect(draft.status).toBe("DRAFT_REQUIRES_HUMAN_APPROVAL");
      expect(draft.humanApproved).toBe(false);
      expect(draft.sourceGroundingCitations[0]).toContain("Giáo trình Cấu trúc Dữ liệu");
      expect(draft.sourceGroundingCitations[0]).toContain("4.2 Cây AVL");

      // Human approval
      studio.approveAiDraft(draft.draftId, "instructor-head");
      expect((draft as unknown as { humanApproved: boolean }).humanApproved).toBe(true);
    });
  });

  describe("40.34 - 40.37: Assessment Authoring V2 (Question Bank, Blueprint, Item Analysis)", () => {
    const qb = new QuestionBankV2Service();

    it("enforces AI-generated questions begin in DRAFT and require review before APPROVED", () => {
      const aiQuestion = qb.createQuestion({
        questionId: "q-ai-01",
        tenantId: "tenant-polytech",
        learningOutcomeIds: ["LO-01"],
        prompt: "Độ phức tạp khi xoay cây AVL là bao nhiêu?",
        questionType: "MULTIPLE_CHOICE",
        options: [
          { id: "A", text: "O(1)", isCorrect: true },
          { id: "B", text: "O(n)", isCorrect: false },
        ],
        difficulty: 0.3,
        bloomTaxonomyLevel: "UNDERSTAND",
        tags: ["avl", "complexity"],
        authorId: "ai-generator",
        isAiGenerated: true,
      });

      // AI questions must always start as DRAFT
      expect(aiQuestion.status).toBe("DRAFT");

      // Instructor review and approval
      const approvedQ = qb.updateQualityStatus("q-ai-01", "APPROVED", "instructor-reviewer");
      expect(approvedQ.status).toBe("APPROVED");
      expect(approvedQ.reviewerId).toBe("instructor-reviewer");
      expect(approvedQ.approvedAt).toBeDefined();
    });

    it("validates an assessment question pool against an Assessment Blueprint", () => {
      const blueprint: AssessmentBlueprint = {
        blueprintId: "bp-midterm-01",
        courseId: "course-cs101",
        title: "Midterm Blueprint",
        targetOutcomeIds: ["LO-01", "LO-02"],
        desiredQuestionCount: 2,
        difficultyDistribution: { easyPercent: 50, mediumPercent: 50, hardPercent: 0 },
        questionTypes: ["MULTIPLE_CHOICE"],
        totalPoints: 20,
      };

      const q1 = qb.getQuestion("q-ai-01");
      const q2 = qb.createQuestion({
        questionId: "q-hand-02",
        tenantId: "tenant-polytech",
        learningOutcomeIds: ["LO-02"],
        prompt: "Viết hàm tìm kiếm trên cây AVL?",
        questionType: "CODE_ANALYSIS",
        difficulty: 0.6,
        bloomTaxonomyLevel: "APPLY",
        tags: ["avl", "code"],
        authorId: "instructor-01",
        isAiGenerated: false,
      });

      const validation = qb.validateAssessmentAgainstBlueprint([q1!, q2], blueprint);
      expect(validation.outcomeCoveragePercent).toBe(100);
      expect(validation.missingOutcomes).toHaveLength(0);
      expect(validation.isAligned).toBe(true);
    });

    it("calculates Item Analysis difficulty index (P) and discrimination index (D)", () => {
      // Simulate 100 examinee attempts: 70 correct, 30 wrong
      for (let i = 0; i < 70; i++) {
        qb.recordAttempt("q-ai-01", {
          studentId: `s-${String(i)}`,
          selectedOption: "A",
          isCorrect: true,
          totalExamScore: 80 + (i % 20),
        });
      }
      for (let i = 70; i < 100; i++) {
        qb.recordAttempt("q-ai-01", {
          studentId: `s-${String(i)}`,
          selectedOption: "B",
          isCorrect: false,
          totalExamScore: 40 + (i % 20),
        });
      }

      const analysis = qb.computeItemAnalysis("q-ai-01");
      expect(analysis.totalAttempts).toBe(100);
      expect(analysis.difficultyIndex).toBe(0.7); // 70 / 100
      expect(analysis.discriminationIndex).toBeGreaterThan(0.3); // High positive discrimination
      expect(analysis.optionSelectionDistribution["A"]).toBe(70);
      expect(analysis.optionSelectionDistribution["B"]).toBe(30);
    });
  });

  describe("40.38 - 40.40: Curriculum Intelligence (Map, Coverage & Evidence Export)", () => {
    const curriculum = new CurriculumIntelligenceService();

    it("builds curriculum map and identifies coverage gaps", () => {
      const map = curriculum.buildCurriculumMap("prog-se-2026", "tenant-polytech", [
        {
          programOutcomeCode: "PO-01",
          courseOutcomeCode: "CO-CS101",
          learningOutcomeId: "LO-01",
          learningOutcomeTitle: "Cây AVL",
          assessmentEvidenceCount: 5,
        },
      ]);

      const knownOutcomes = [
        { outcomeId: "LO-01", title: "Cây AVL" },
        { outcomeId: "LO-99", title: "Cây B-Tree nâng cao" }, // Unassessed!
      ];

      const report = curriculum.analyzeCoverage(map, knownOutcomes, [{ source: "LO-01", target: "LO-99" }]);

      expect(report.unassessedOutcomes).toContain("LO-99 (Cây B-Tree nâng cao)");
      expect(report.summaryVerdict).toBe("ACTION_RECOMMENDED");
    });

    it("generates tenant-isolated, audit-signed curriculum evidence export", () => {
      const map = curriculum.buildCurriculumMap("prog-se-2026", "tenant-polytech", []);
      const coverage = curriculum.analyzeCoverage(map, [], []);

      const exportRes = curriculum.exportCurriculumEvidence({
        tenantId: "tenant-polytech",
        requestedBy: "dean-cse",
        userRole: "ADMIN",
        map,
        coverage,
      });

      expect(exportRes.tenantId).toBe("tenant-polytech");
      expect(exportRes.auditSignature).toContain("sha256-audit");
      expect(curriculum.getExportHistory()).toHaveLength(1);

      // Verify cross-tenant export is rejected
      expect(() =>
        curriculum.exportCurriculumEvidence({
          tenantId: "tenant-unauthorized",
          requestedBy: "hacker",
          userRole: "ADMIN",
          map,
          coverage,
        }),
      ).toThrow("Cross-tenant curriculum export prohibited");
    });
  });

  describe("40.41 - 40.43: Institutional Fleet Operations (Templates, Bulk Dry-Run, Drift)", () => {
    const fleet = new FleetOperationsService();

    it("blocks saving templates containing secret material", () => {
      const dangerousTemplate: InstitutionTemplate = {
        templateId: "bad-template",
        name: "Leak Template",
        description: "Bad",
        identitySetup: {
          protocol: "OIDC",
          discoveryUrlPattern: "https://auth.example.com",
          allowedDomainRules: ["example.com"],
          // Secret sneak-in:
          ...({ client_secret: "super-secret-password" } as unknown as object),
        },
        featurePolicy: {},
        aiPolicy: {
          allowedPedagogicalModes: ["EXPLAIN"],
          requireTeacherReviewForAiContent: true,
          studentDirectChatEnabled: true,
        },
        defaultLearningConfig: { gradingScale: "10", masteryPolicyId: "p", passingScore: 5 },
        notificationConfig: { digestFrequency: "DAILY", smsEnabled: false },
        createdAt: "2026-09-21T00:00:00Z",
      };

      expect(() => fleet.saveTemplate(dangerousTemplate)).toThrow("Security Violation");
    });

    it("requires dry-run preview before executing bulk operations", () => {
      fleet.registerTenantConfig("tenant-polytech", { name: "Polytech", AI_TUTOR_V2: false });
      fleet.registerTenantConfig("tenant-vnu", { name: "VNU", AI_TUTOR_V2: false });

      const preview = fleet.previewBulkOperation({
        targetTenantIds: ["tenant-polytech", "tenant-vnu"],
        operationType: "FEATURE_ENABLEMENT",
        payload: { AI_TUTOR_V2: true },
      });

      expect(preview.dryRunPassed).toBe(true);
      expect(preview.targetTenantCount).toBe(2);

      const exec = fleet.executeBulkOperation(preview);
      expect(exec.successfulCount).toBe(2);
    });

    it("detects configuration drift against desired baseline", () => {
      fleet.registerTenantConfig("tenant-drift-test", {
        name: "Drift College",
        AI_TUTOR_V2: false, // Drifted!
      });

      const report = fleet.detectConfigDrift("tenant-drift-test", {
        AI_TUTOR_V2: true, // Desired
      });

      expect(report.status).toBe("DRIFTED");
      expect(report.driftedFields[0]?.field).toBe("AI_TUTOR_V2");
    });
  });

  describe("40.44 - 40.46: Product Experimentation Framework", () => {
    const experimentation = new ProductExperimentationService();

    it("strictly blocks experiments targeting sensitive and security domains", () => {
      const invalidExp: ExperimentDefinition = {
        experimentId: "exp-hack-grades",
        name: "Experiment on GRADE_CORRECTNESS calculation",
        hypothesis: "Inflate grades for engagement",
        experimentDomain: "RECOMMENDATION_RANKING",
        variants: ["CONTROL", "TREATMENT_A"],
        tenantAllowlist: [],
        startDate: "2026-09-21",
        endDate: "2026-10-21",
        status: "DRAFT",
      };

      expect(() => experimentation.registerExperiment(invalidExp)).toThrow(
        "Security & Integrity Violation: Experimentation on GRADE_CORRECTNESS is strictly prohibited",
      );
    });

    it("assigns students to variants deterministically using hashing", () => {
      const validExp: ExperimentDefinition = {
        experimentId: "exp-study-plan-layout-v1",
        name: "Study Plan Layout Comparison",
        hypothesis: "Card layout increases module completion by 5%",
        experimentDomain: "STUDY_PLAN_UI",
        variants: ["CONTROL", "TREATMENT_A", "TREATMENT_B"],
        tenantAllowlist: ["tenant-polytech"],
        startDate: "2026-09-21",
        endDate: "2026-10-21",
        status: "RUNNING",
      };

      experimentation.registerExperiment(validExp);

      const a1 = experimentation.assignVariant(
        "exp-study-plan-layout-v1",
        "stu-01",
        "tenant-polytech",
        "2026-Fall",
      );
      const a2 = experimentation.assignVariant(
        "exp-study-plan-layout-v1",
        "stu-01",
        "tenant-polytech",
        "2026-Fall",
      );
      // Deterministic invariant
      expect(a1.assignedVariant).toBe(a2.assignedVariant);

      // Tenant outside allowlist defaults to CONTROL
      const ext = experimentation.assignVariant(
        "exp-study-plan-layout-v1",
        "stu-99",
        "tenant-other",
        "2026-Fall",
      );
      expect(ext.assignedVariant).toBe("CONTROL");
    });

    it("evaluates learning outcome metrics (completion, retry, mastery, satisfaction)", () => {
      const outcomes = [
        {
          variant: "CONTROL",
          activityCompleted: true,
          recommendationAccepted: true,
          masteryGain: 5.0,
          retriedExercise: false,
          tutorRating: 4.2,
        },
        {
          variant: "TREATMENT_A",
          activityCompleted: true,
          recommendationAccepted: true,
          masteryGain: 12.0,
          retriedExercise: true,
          tutorRating: 4.8,
        },
      ];

      const metrics = experimentation.evaluateExperiment("exp-study-plan-layout-v1", outcomes);
      expect(metrics.variantMetrics["TREATMENT_A"]?.masteryImprovementDelta).toBe(12.0);
      expect(metrics.variantMetrics["TREATMENT_A"]?.tutorSatisfactionScore).toBe(4.8);
      expect(metrics.learningOutcomeImpact).toBe("POSITIVE");
    });
  });
});
