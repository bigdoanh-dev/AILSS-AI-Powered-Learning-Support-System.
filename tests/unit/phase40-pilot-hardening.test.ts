import { describe, it, expect } from "vitest";
import { LearningIntelligenceService } from "../../apps/learning-service/src/analytics/learning-intelligence-service.js";
import {
  SMALL_COHORT_SUPPRESSION,
  MIN_COHORT_PRIVACY_THRESHOLD,
  type AnalyticsPrivacyPolicyV2,
} from "../../packages/contracts/src/index.js";
import { LearnerMasteryServiceV2 } from "../../apps/learning-service/src/mastery/mastery-service.js";
import {
  MasteryCalibrationRunner,
  MASTERY_CALIBRATION_DATASET_V1,
} from "../../apps/learning-service/src/mastery/mastery-calibration-v1.js";
import { AITutorEvaluatorV2 } from "../../apps/ai-service/src/assistant/ai-tutor-eval-v2.js";
import {
  AssessmentIntegrityDefender,
  ADVERSARIAL_ATTACK_TEST_CASES,
} from "../../apps/ai-service/src/assistant/assessment-integrity-attacks.js";
import { TenantFeatureFlagResolver } from "../../packages/contracts/src/feature-flags.js";

describe("Phase 40 Track 1: Pilot Hardening Verification", () => {
  describe("40.12 - 40.14: Analytics Privacy & Small-Cohort Suppression", () => {
    const intelligence = new LearningIntelligenceService();

    it("verifies cohort < 5 is suppressed under SMALL_COHORT_SUPPRESSION (not differential privacy)", () => {
      const result = intelligence.computeCourseHealth({
        courseId: "course-small",
        tenantId: "tenant-polytech",
        enrolledStudentsCount: 3,
        activeLearners7d: 3,
        lessonCompletionsPercent: 85,
        masteryScores: [{ conceptId: "c1", score: 90, state: "MASTERED" }],
        assessmentScores: [90, 85, 95],
        misconceptions: [],
        atRiskStudentsCount: 0,
        aiTutorSessionsCount: 4,
      });

      expect(result.mechanism).toBe(SMALL_COHORT_SUPPRESSION);
      expect(result.isSuppressedDueToSmallCohort).toBe(true);
      expect(result.data).toBeNull();
      expect(result.minimumThreshold).toBe(MIN_COHORT_PRIVACY_THRESHOLD);
      expect(result.suppressionNotice).toContain("minimum privacy threshold (5)");
    });

    it("detects and blocks singling-out reconstruction attacks against small cohorts", () => {
      const attackCheck1 = intelligence.evaluateSinglingOutRisk(4, 1);
      expect(attackCheck1.isVulnerableToSinglingOut).toBe(true);
      expect(attackCheck1.recommendedAction).toBe("SUPPRESS");

      const attackCheck2 = intelligence.evaluateSinglingOutRisk(8, 4); // 8 students narrowed by 4 predicates
      expect(attackCheck2.isVulnerableToSinglingOut).toBe(true);
      expect(attackCheck2.recommendedAction).toBe("SUPPRESS");

      const safeCheck = intelligence.evaluateSinglingOutRisk(40, 2);
      expect(safeCheck.isVulnerableToSinglingOut).toBe(false);
      expect(safeCheck.recommendedAction).toBe("ALLOW");
    });

    it("executes mathematically rigorous Laplace Differential Privacy query when requested", () => {
      const trueAverage = 76.5;
      const dpConfig = {
        queryType: "MEAN" as const,
        sensitivity: 2.0,
        noiseMechanism: "LAPLACE" as const,
        epsilon: 0.5,
        privacyBudget: 5.0,
        budgetResetLifecycle: "DAILY" as const,
      };

      const dpResult = intelligence.executeDifferentialPrivacyQuery(trueAverage, dpConfig, 4.5);
      expect(dpResult.epsilonConsumed).toBe(0.5);
      expect(dpResult.budgetRemaining).toBe(4.0);
      expect(dpResult.noiseScale).toBe(4.0); // 2.0 / 0.5
      expect(dpResult.mathematicalGuarantee).toContain("Differential Privacy satisfied");
    });

    it("masks direct identifiers and enforces tenant isolation during dataset exports", () => {
      const policy: AnalyticsPrivacyPolicyV2 = {
        minimumCohortThreshold: 5,
        roleScope: "INSTRUCTOR",
        tenantIsolation: true,
        exportAuditRequired: true,
        suppressedColumns: ["internalStudentNote"],
        piiClassifications: {
          studentId: "DIRECT_IDENTIFIER",
          studentEmail: "DIRECT_IDENTIFIER",
          conceptId: "PUBLIC_METRIC",
          score: "SENSITIVE_ATTRIBUTE",
        },
      };

      const rawData = [
        {
          tenantId: "tenant-polytech",
          studentId: "s-1",
          studentEmail: "s1@polytech.edu.vn",
          conceptId: "avl",
          score: 88,
          internalStudentNote: "secret",
        },
        {
          tenantId: "tenant-polytech",
          studentId: "s-2",
          studentEmail: "s2@polytech.edu.vn",
          conceptId: "avl",
          score: 92,
          internalStudentNote: "secret",
        },
      ];

      const { exportedData, auditRecord } = intelligence.auditAndExportDataset(rawData, policy, {
        tenantId: "tenant-polytech",
        userId: "instructor-01",
        userRole: "INSTRUCTOR",
        datasetName: "avl-cohort-scores",
      });

      expect(exportedData).toHaveLength(2);
      // Direct identifiers and suppressed columns MUST be stripped
      expect(exportedData[0]).not.toHaveProperty("studentId");
      expect(exportedData[0]).not.toHaveProperty("studentEmail");
      expect(exportedData[0]).not.toHaveProperty("internalStudentNote");
      expect(exportedData[0]).toHaveProperty("score", 88);

      // Verify audit record
      expect(auditRecord.recordsCount).toBe(2);
      expect(auditRecord.signature).toContain("sha256-audit");
    });
  });

  describe("40.15 - 40.19: Mastery V2 Canonical Formula & Calibration Dataset", () => {
    const masteryService = new LearnerMasteryServiceV2();

    it("binds calculation to canonical policy ID, version, and clamping invariants", () => {
      const record = masteryService.calculateMasteryV2({
        studentId: "student-test-01",
        tenantId: "tenant-polytech",
        courseId: "course-cs101",
        conceptId: "avl_tree",
        learningOutcomeId: "LO-02",
        evidences: [
          {
            evidenceId: "ev-1",
            evidenceSource: "QUIZ",
            questionDifficulty: 0.8,
            rawScorePercent: 95,
            attemptNumber: 1,
            timestamp: "2026-09-20T10:00:00Z",
            recencyWeight: 1.0,
          },
        ],
        hasMetPrerequisites: false, // PREREQUISITE GAP!
        daysSinceLastActivity: 2,
      });

      expect(record.masteryPolicyId).toBe("ailss-canonical-mastery-v2");
      expect(record.masteryPolicyVersion).toBe("2.0.0");
      // Score clamped to 74 max due to unmet prerequisite
      expect(record.masteryScore).toBe(74);
      expect(record.masteryState).toBe("DEVELOPING");
      expect(record.explanation.whyState).toContain("prerequisite foundations require completion");
    });

    it("evaluates the full mastery-calibration-v1 dataset with 100% case pass and zero unexpected jumps", () => {
      const calibrationReport = MasteryCalibrationRunner.runCalibration();

      expect(calibrationReport.datasetVersion).toBe("mastery-calibration-v1");
      expect(calibrationReport.totalTestCases).toBe(MASTERY_CALIBRATION_DATASET_V1.length);
      expect(calibrationReport.passedCases).toBe(calibrationReport.totalTestCases);
      expect(calibrationReport.failedCases).toBe(0);
      expect(calibrationReport.unexpectedStateJumps).toBe(0);
      expect(calibrationReport.stabilityScore).toBeGreaterThanOrEqual(0.95);
      expect(calibrationReport.sensitivityScore).toBeGreaterThanOrEqual(0.95);
      expect(calibrationReport.verdict).toBe("CALIBRATED_STABLE");
    });

    it("records and exposes explainable Mastery History without private reasoning traces", () => {
      const history = masteryService.getMasteryHistory("student-test-01", "course-cs101", "avl_tree");
      expect(history.length).toBeGreaterThanOrEqual(1);
      const firstEntry = history[0];
      expect(firstEntry).toBeDefined();
      expect(firstEntry?.currentScore).toBe(74);
      expect(firstEntry?.currentState).toBe("DEVELOPING");
      expect(firstEntry?.recommendedNextActions.length).toBeGreaterThanOrEqual(1);
      // Ensure no raw internal LLM prompt traces or secrets are exposed
      expect(JSON.stringify(firstEntry)).not.toContain("system_prompt");
    });
  });

  describe("40.20 - 40.23: AI Tutor Eval V2 & Assessment Integrity Attack Suite", () => {
    it("executes the dedicated assessment integrity attack suite with 0 breaches and mandatory disclaimer", () => {
      const attackReport = AssessmentIntegrityDefender.runAttackSuite();

      expect(attackReport.suiteName).toBe("assessment-integrity-attack-suite-v2");
      expect(attackReport.totalAttacks).toBe(ADVERSARIAL_ATTACK_TEST_CASES.length);
      expect(attackReport.successfulAttacks).toBe(0);
      expect(attackReport.attackSuccessRatio).toBe(`0 / ${String(ADVERSARIAL_ATTACK_TEST_CASES.length)}`);
      expect(attackReport.leakageDetected).toBe(false);
      // Absolute rule: zero failure disclaimer MUST be explicitly recorded
      expect(attackReport.zeroFailureDisclaimer).toContain("0% observed leakage does NOT imply zero risk");
    });

    it("runs AI Tutor Eval V2 across 50 samples with explicit category denominators", () => {
      const evalReport = AITutorEvaluatorV2.runEvalV2();

      expect(evalReport.evaluationSuite).toBe("ai-tutor-eval-v2");
      expect(evalReport.datasetVersion).toBe("2.0.0");
      expect(evalReport.totalSamples).toBe(50);
      expect(evalReport.samplesByCategory.FACTUALITY).toBe(10);
      expect(evalReport.samplesByCategory.CITATION_CORRECTNESS).toBe(8);
      expect(evalReport.metrics.factualityPercent).toBeGreaterThanOrEqual(95);
      expect(evalReport.metrics.citationCorrectnessPercent).toBeGreaterThanOrEqual(92);
      expect(evalReport.metrics.instructionFollowingPercent).toBeGreaterThanOrEqual(98);
      expect(evalReport.verdict).toBe("PASS");
    });

    it("handles citation confidence and abstains on stale or unsupported sources", () => {
      const validCitation = AITutorEvaluatorV2.evaluateCitationConfidence({
        documentId: "doc-textbook",
        snippet: "AVL Tree rotations",
        docExists: true,
        sectionExists: true,
        claimSupported: true,
        isStale: false,
      });
      expect(validCitation.confidenceScore).toBe(0.95);
      expect(validCitation.classification).toBe("VALID");
      expect(validCitation.shouldAbstain).toBe(false);

      const staleCitation = AITutorEvaluatorV2.evaluateCitationConfidence({
        documentId: "doc-textbook",
        snippet: "Old 1998 algorithm",
        docExists: true,
        sectionExists: true,
        claimSupported: true,
        isStale: true,
      });
      expect(staleCitation.classification).toBe("STALE_SOURCE");
      expect(staleCitation.shouldAbstain).toBe(true);
    });
  });

  describe("40.7: Tenant-Scoped Feature Flags", () => {
    const resolver = new TenantFeatureFlagResolver();

    it("evaluates all 5 rollout states: OFF, INTERNAL, PILOT_TENANTS, PERCENT_ROLLOUT, ON", () => {
      // 1. OFF
      resolver.setPolicy({
        flag: "ADAPTIVE_LEARNING_V2",
        mode: "OFF",
        allowedTenants: ["tenant-polytech-hcm"],
        description: "Disabled",
        updatedAt: "2026-09-21T00:00:00Z",
      });
      expect(resolver.isEnabled("ADAPTIVE_LEARNING_V2", { tenantId: "tenant-polytech-hcm" })).toBe(false);

      // 2. ON
      resolver.setPolicy({
        flag: "ADAPTIVE_LEARNING_V2",
        mode: "ON",
        allowedTenants: [],
        description: "Globally enabled",
        updatedAt: "2026-09-21T00:00:00Z",
      });
      expect(resolver.isEnabled("ADAPTIVE_LEARNING_V2", { tenantId: "any-tenant" })).toBe(true);

      // 3. INTERNAL
      resolver.setPolicy({
        flag: "AI_TUTOR_V2",
        mode: "INTERNAL",
        allowedTenants: [],
        description: "Internal only",
        updatedAt: "2026-09-21T00:00:00Z",
      });
      expect(resolver.isEnabled("AI_TUTOR_V2", { tenantId: "tenant-prod-hcm" })).toBe(false);
      expect(resolver.isEnabled("AI_TUTOR_V2", { tenantId: "tenant-internal-dev", isInternalTenant: true })).toBe(true);

      // 4. PILOT_TENANTS
      resolver.setPolicy({
        flag: "TEACHER_COPILOT",
        mode: "PILOT_TENANTS",
        allowedTenants: ["tenant-polytech-hcm", "tenant-vnu-hn"],
        description: "Pilot allowlist",
        updatedAt: "2026-09-21T00:00:00Z",
      });
      expect(resolver.isEnabled("TEACHER_COPILOT", { tenantId: "tenant-polytech-hcm" })).toBe(true);
      expect(resolver.isEnabled("TEACHER_COPILOT", { tenantId: "tenant-unauthorized-external" })).toBe(false);

      // 5. PERCENT_ROLLOUT
      resolver.setPolicy({
        flag: "LEARNING_INTERVENTIONS",
        mode: "PERCENT_ROLLOUT",
        allowedTenants: [],
        rolloutPercentage: 50,
        description: "50% deterministic rollout",
        updatedAt: "2026-09-21T00:00:00Z",
      });
      // Deterministic: multiple checks on same tenant MUST return same boolean
      const res1 = resolver.isEnabled("LEARNING_INTERVENTIONS", { tenantId: "tenant-deterministic-01" });
      const res2 = resolver.isEnabled("LEARNING_INTERVENTIONS", { tenantId: "tenant-deterministic-01" });
      expect(res1).toBe(res2);
    });
  });
});
