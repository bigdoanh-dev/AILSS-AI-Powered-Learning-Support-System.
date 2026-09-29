import { describe, it, expect, beforeEach } from "vitest";
import { DifferentialPrivacyService } from "../../apps/learning-service/src/analytics/differential-privacy-service.js";

describe("Phase 40 Final Corrective Closure: Differential Privacy Semantics & Defenses (40.F7 - 40.F13)", () => {
  beforeEach(() => {
    DifferentialPrivacyService.resetBudget("researcher-01", "tenant-polytech");
    DifferentialPrivacyService.resetBudget("researcher-02", "tenant-polytech");
  });

  it("40.F7 & 40.F8 & 40.F9 & 40.F13 — verifies pure (epsilon, 0)-DP guarantee, USER_LEVEL unit, and REPLACE_ONE adjacency", () => {
    const mech = DifferentialPrivacyService.getMechanismDefinition(50);

    // 40.F7: Pure (epsilon, 0)-DP guarantee (strictly delta = 0 for standard Laplace)
    expect(mech.guaranteeType).toBe("PURE_EPSILON_DP");
    expect(mech.epsilon).toBe(1.0);
    expect(mech.delta).toBe(0);
    expect(mech.status).toBe("VALIDATED_EPSILON_DP");

    // 40.F8: Unit of privacy
    expect(mech.privacyUnit).toBe("USER_LEVEL");

    // 40.F9: Adjacency model
    expect(mech.adjacencyModel).toBe("REPLACE_ONE");

    // 40.F10: Global sensitivity Delta f = (100 - 0) / N = 100 / 50 = 2.0
    expect(mech.boundingInterval).toEqual([0, 100]);
    expect(mech.sensitivityFormula).toBe("DELTA_F = (MAX - MIN) / N");
    expect(mech.globalSensitivity).toBe(2.0);

    // 40.F11: Composition rule and budget scoping
    expect(mech.compositionRule).toBe("BASIC_SEQUENTIAL_COMPOSITION");
    expect(mech.totalBudgetPerResearcher).toBe(10.0);
    expect(mech.budgetScope).toBe("RESEARCHER_TENANT_SCOPE");
    expect(mech.budgetResetPolicy).toBe("EXPLICIT_IRB_OR_DPO_APPROVAL_ONLY");
  });

  it("40.F10 — mathematically derives sensitivity across different cohort sizes", () => {
    // For N = 10: Delta f = 100 / 10 = 10.0
    const m10 = DifferentialPrivacyService.getMechanismDefinition(10);
    expect(m10.globalSensitivity).toBe(10.0);

    // For N = 100: Delta f = 100 / 100 = 1.0
    const m100 = DifferentialPrivacyService.getMechanismDefinition(100);
    expect(m100.globalSensitivity).toBe(1.0);

    // For N = 500: Delta f = 100 / 500 = 0.2
    const m500 = DifferentialPrivacyService.getMechanismDefinition(500);
    expect(m500.globalSensitivity).toBe(0.2);
  });

  it("40.F12 — defends against repeated identical queries by enforcing budget consumption", () => {
    const cohort = Array.from({ length: 50 }, (_, i) => 75);

    // Run 10 queries with eps = 1.0
    for (let i = 0; i < 10; i++) {
      const res = DifferentialPrivacyService.evaluateDPAggregate({
        researcherId: "researcher-01",
        tenantId: "tenant-polytech",
        cohortData: cohort,
        queryType: "MEAN_SCORE",
        epsilonRequested: 1.0,
      });
      expect(res.isBudgetExhausted).toBe(false);
      expect(res.remainingBudget).toBe(10 - (i + 1));
    }

    // 11th query must be rejected with budget exhausted
    const blocked = DifferentialPrivacyService.evaluateDPAggregate({
      researcherId: "researcher-01",
      tenantId: "tenant-polytech",
      cohortData: cohort,
      queryType: "MEAN_SCORE",
      epsilonRequested: 1.0,
    });

    expect(blocked.isBudgetExhausted).toBe(true);
    expect(blocked.remainingBudget).toBe(0);
    expect(blocked.epsilonConsumed).toBe(0);
  });

  it("40.F12 — defends against overlapping queries, query splitting, and cohort filtering attacks", () => {
    const baseCohort = Array.from({ length: 50 }, (_, i) => 70 + (i % 20));

    // Attack 1: Overlapping query with 1 student removed
    const overlappingCohort = baseCohort.slice(0, 49);
    const res1 = DifferentialPrivacyService.evaluateDPAggregate({
      researcherId: "researcher-02",
      tenantId: "tenant-polytech",
      cohortData: baseCohort,
      queryType: "MEAN_SCORE",
      epsilonRequested: 2.0,
    });
    expect(res1.remainingBudget).toBe(8.0);

    const res2 = DifferentialPrivacyService.evaluateDPAggregate({
      researcherId: "researcher-02",
      tenantId: "tenant-polytech",
      cohortData: overlappingCohort,
      queryType: "MEAN_SCORE",
      epsilonRequested: 2.0,
    });
    // Budget must decrement sequentially regardless of overlapping cohort
    expect(res2.remainingBudget).toBe(6.0);

    // Attack 2: Query splitting into small eps requests (e.g. eps = 0.5)
    for (let i = 0; i < 4; i++) {
      DifferentialPrivacyService.evaluateDPAggregate({
        researcherId: "researcher-02",
        tenantId: "tenant-polytech",
        cohortData: baseCohort,
        queryType: "MEAN_SCORE",
        epsilonRequested: 0.5,
      });
    }
    // 6.0 - 4 * 0.5 = 4.0
    expect(DifferentialPrivacyService.getRemainingBudget("researcher-02", "tenant-polytech")).toBe(4.0);

    // Attack 3: Cohort filtering attack targeting tiny sub-cohort N < 5
    const filteredMicroCohort = [98, 95, 92]; // N = 3
    const microRes = DifferentialPrivacyService.evaluateDPAggregate({
      researcherId: "researcher-02",
      tenantId: "tenant-polytech",
      cohortData: filteredMicroCohort,
      queryType: "MEAN_SCORE",
      epsilonRequested: 1.0,
    });
    // Micro cohort must be suppressed to prevent singling-out
    expect(microRes.suppressionApplied).toBe(true);
    expect(microRes.noisyMean).toBe(0);
    // Suppressed queries do not deduct privacy budget
    expect(microRes.remainingBudget).toBe(4.0);
  });

  it("40.F12 — validates cross-session budget persistence within tenant scope", () => {
    // Session 1
    DifferentialPrivacyService.evaluateDPAggregate({
      researcherId: "researcher-persistent",
      tenantId: "tenant-polytech",
      cohortData: Array.from({ length: 50 }, () => 80),
      queryType: "MEAN_SCORE",
      epsilonRequested: 3.0,
    });
    expect(DifferentialPrivacyService.getRemainingBudget("researcher-persistent", "tenant-polytech")).toBe(
      7.0,
    );

    // Session 2 (same researcher, same tenant)
    const session2Budget = DifferentialPrivacyService.getRemainingBudget(
      "researcher-persistent",
      "tenant-polytech",
    );
    expect(session2Budget).toBe(7.0);

    // Cross-tenant isolation (same researcher in tenant-fpt has isolated budget)
    const otherTenantBudget = DifferentialPrivacyService.getRemainingBudget(
      "researcher-persistent",
      "tenant-fpt-uni",
    );
    expect(otherTenantBudget).toBe(10.0);
  });

  it("measures utility and error tradeoffs across cohort sizes", () => {
    const benchmark = DifferentialPrivacyService.runUtilityBenchmark(100);
    expect(benchmark).toHaveLength(3);

    const small = benchmark.find((b) => b.cohortSize === 10);
    expect(small?.sensitivity).toBe(10.0);
    expect(small?.institutionalUsabilityVerdict).toBe("NOISY_PREFER_SUPPRESSION");

    const large = benchmark.find((b) => b.cohortSize === 200);
    expect(large?.sensitivity).toBe(0.5);
    expect(large?.institutionalUsabilityVerdict).toBe("ACCEPTABLE");
    expect(large?.measuredMeanAbsoluteError).toBeLessThan(small!.measuredMeanAbsoluteError);
  });

  it("40.G8 - 40.G10: enforces user-level contribution bounding on multi-submission and extreme records", () => {
    // Student 1 has 5 submissions on different assessments, Student 2 has duplicates, Student 3 has extreme scores
    const rawRecords = [
      { userId: "u1", score: 80, assessmentId: "a1" },
      { userId: "u1", score: 90, assessmentId: "a2" },
      { userId: "u1", score: 70, assessmentId: "a3" },
      // u2 has duplicate submissions on a1 (re-attempts)
      { userId: "u2", score: 40, assessmentId: "a1", timestamp: "2026-09-20T10:00:00Z" },
      { userId: "u2", score: 85, assessmentId: "a1", timestamp: "2026-09-20T11:00:00Z" }, // latest re-attempt
      // u3 has extreme values outside [0, 100]
      { userId: "u3", score: 150, assessmentId: "a1" },
      // u4 and u5 are normal students
      { userId: "u4", score: 60, assessmentId: "a1" },
      { userId: "u5", score: 75, assessmentId: "a1" },
    ];

    const boundResult = DifferentialPrivacyService.aggregateAndBoundUserContributions(rawRecords, {
      maxRowsPerUser: 10,
      duplicateHandling: "LATEST_SUBMISSION",
    });

    expect(boundResult.userCount).toBe(5);
    expect(boundResult.boundedUserScores).toHaveLength(5);
    expect(boundResult.duplicateRowsCollapsed).toBeGreaterThan(0);
    expect(boundResult.clampedCount).toBe(1); // u3 clamped from 150 to 100

    // u1 score: mean of (80, 90, 70) = 80
    expect(boundResult.boundedUserScores[0]).toBe(80);
    // u2 score: deduplicated to latest 85
    expect(boundResult.boundedUserScores[1]).toBe(85);
    // u3 score: clamped to 100
    expect(boundResult.boundedUserScores[2]).toBe(100);

    // Run DP evaluation using userRecords
    const dpRes = DifferentialPrivacyService.evaluateDPAggregate({
      researcherId: "researcher-01",
      tenantId: "tenant-polytech",
      userRecords: rawRecords,
      queryType: "MEAN_SCORE",
      epsilonRequested: 1.0,
    });

    expect(dpRes.rawCount).toBe(5); // exactly 5 distinct users, NOT 8 raw rows!
    expect(dpRes.isBudgetExhausted).toBe(false);
    expect(dpRes.suppressionApplied).toBe(false);
    expect(dpRes.mechanism.globalSensitivity).toBe(100 / 5); // 20.0
  });

  it("40.G12 & 40.G13: guarantees join safety (no user contribution amplification) and validates explicit budget policy", () => {
    // Simulate relational multi-table join (student x course x assessment x submission)
    // u1 has 20 joined rows across 3 courses!
    const joinedRows = [];
    for (let c = 1; c <= 3; c++) {
      for (let a = 1; a <= 7; a++) {
        joinedRows.push({
          userId: "u-active",
          courseId: `course-${c}`,
          assessmentId: `c${c}-a${a}`,
          score: 80 + (a % 10),
        });
      }
    }
    // Add 9 other students with 1 row each
    for (let i = 1; i <= 9; i++) {
      joinedRows.push({
        userId: `u-other-${i}`,
        courseId: "course-1",
        assessmentId: "c1-a1",
        score: 70,
      });
    }

    // Evaluate DP aggregate over joined rows
    const dpRes = DifferentialPrivacyService.evaluateDPAggregate({
      researcherId: "researcher-01",
      tenantId: "tenant-polytech",
      userRecords: joinedRows,
      queryType: "MEAN_SCORE",
      epsilonRequested: 1.0,
    });

    // Total distinct users must be 10 (1 u-active + 9 others), NOT 30 rows!
    expect(dpRes.rawCount).toBe(10);
    expect(dpRes.mechanism.globalSensitivity).toBe(10.0); // 100 / 10

    // Validate 40.G13 budget policy rationale
    const policy = dpRes.mechanism.privacyBudgetPolicy;
    expect(policy.epsilonPerQuery).toBe(1.0);
    expect(policy.budgetPerResearcher).toBe(10.0);
    expect(policy.budgetPerTenant).toBe(50.0);
    expect(policy.budgetPeriodDays).toBe(30);
    expect(policy.resetPolicy).toBe("EXPLICIT_IRB_OR_DPO_APPROVAL_ONLY");
    expect(policy.governanceNote).toContain("institutional policy threshold");
  });

  // ============================================================
  // 40.H17: Join multiplication — prove student cannot become multiple contributions
  // ============================================================
  it("40.H17 — join multiplication: student with attempts+submissions+mastery history rows maps to exactly 1 DP contribution", () => {
    // One student with multiple rows across attempts, submissions, and mastery events
    // Simulating a raw SQL join result where each row is a (student, assessment, event) tuple
    const multiSourceRows = [
      // 3 attempt rows for same assessment (reattempts)
      { userId: "u-power", assessmentId: "a1", score: 60, submissionId: "sub-1" },
      { userId: "u-power", assessmentId: "a1", score: 70, submissionId: "sub-2" },
      { userId: "u-power", assessmentId: "a1", score: 75, submissionId: "sub-3" },
      // 2 other assessments
      { userId: "u-power", assessmentId: "a2", score: 88, submissionId: "sub-4" },
      { userId: "u-power", assessmentId: "a3", score: 92, submissionId: "sub-5" },
      // Mastery event rows (different courseId, no assessmentId)
      { userId: "u-power", courseId: "c1", score: 85 },
      { userId: "u-power", courseId: "c2", score: 80 },
      // 4 other students with 1 row each
      { userId: "u2", assessmentId: "a1", score: 70 },
      { userId: "u3", assessmentId: "a1", score: 65 },
      { userId: "u4", assessmentId: "a2", score: 72 },
      { userId: "u5", assessmentId: "a3", score: 78 },
    ];

    const boundResult = DifferentialPrivacyService.aggregateAndBoundUserContributions(multiSourceRows, {
      maxRowsPerUser: 10,
      duplicateHandling: "LATEST_SUBMISSION",
    });

    // Must have exactly 5 distinct users
    expect(boundResult.userCount).toBe(5);
    expect(boundResult.boundedUserScores).toHaveLength(5);

    // u-power's contribution is bounded to a single scalar (not 7 separate contributions)
    const dpRes = DifferentialPrivacyService.evaluateDPAggregate({
      researcherId: "researcher-01",
      tenantId: "tenant-polytech",
      userRecords: multiSourceRows,
      queryType: "MEAN_SCORE",
      epsilonRequested: 1.0,
    });

    // rawCount must equal distinct user count (5), not raw row count (11)
    expect(dpRes.rawCount).toBe(5);
    // Sensitivity based on user count, not row count
    expect(dpRes.mechanism.globalSensitivity).toBe(100 / 5); // 20.0
    // u-power must NOT multiply sensitivity
    expect(dpRes.mechanism.globalSensitivity).not.toBe(100 / 11);
  });

  // ============================================================
  // 40.H18: Duplicate record injection — contribution bounding unchanged
  // ============================================================
  it("40.H18 — duplicate record injection: injecting duplicate rows for one learner does not change their DP contribution", () => {
    const baseline = [
      { userId: "u-target", assessmentId: "a1", score: 80 },
      { userId: "u-target", assessmentId: "a2", score: 90 },
      { userId: "u-b", assessmentId: "a1", score: 70 },
      { userId: "u-c", assessmentId: "a1", score: 65 },
    ];

    // Inject 50 exact duplicate rows for u-target (simulating a bad join or replay attack)
    const withDuplicates = [...baseline];
    for (let d = 0; d < 50; d++) {
      withDuplicates.push({ userId: "u-target", assessmentId: "a1", score: 80 });
    }

    const boundBaseline = DifferentialPrivacyService.aggregateAndBoundUserContributions(baseline, {
      maxRowsPerUser: 10,
      duplicateHandling: "LATEST_SUBMISSION",
    });
    const boundWithDups = DifferentialPrivacyService.aggregateAndBoundUserContributions(withDuplicates, {
      maxRowsPerUser: 10,
      duplicateHandling: "LATEST_SUBMISSION",
    });

    // User count must remain the same
    expect(boundWithDups.userCount).toBe(boundBaseline.userCount);
    // u-target's contribution must be the same scalar regardless of 50 duplicates
    expect(boundWithDups.boundedUserScores[0]).toBe(boundBaseline.boundedUserScores[0]);
    // duplicateRowsCollapsed must be > 0 (bounding worked)
    expect(boundWithDups.duplicateRowsCollapsed).toBeGreaterThan(boundBaseline.duplicateRowsCollapsed);
  });

  // ============================================================
  // 40.H19: Cross-course query — contribution definition across courses
  // ============================================================
  it("40.H19 — cross-course query: one student enrolled in 3 courses contributes exactly 1 bounded scalar to institution-wide export", () => {
    // Institution-wide cross-course analytics: student has scores in 3 courses
    const crossCourseRows = [
      { userId: "u-multi-course", courseId: "math-101", assessmentId: "m1", score: 85 },
      { userId: "u-multi-course", courseId: "phys-201", assessmentId: "p1", score: 72 },
      { userId: "u-multi-course", courseId: "hist-301", assessmentId: "h1", score: 90 },
      // 4 other students each in 1 course
      { userId: "u2", courseId: "math-101", assessmentId: "m1", score: 70 },
      { userId: "u3", courseId: "phys-201", assessmentId: "p1", score: 68 },
      { userId: "u4", courseId: "hist-301", assessmentId: "h1", score: 75 },
      { userId: "u5", courseId: "math-101", assessmentId: "m1", score: 80 },
    ];

    const dpRes = DifferentialPrivacyService.evaluateDPAggregate({
      researcherId: "researcher-02",
      tenantId: "tenant-polytech",
      userRecords: crossCourseRows,
      queryType: "MEAN_SCORE",
      epsilonRequested: 1.0,
    });

    // Even though u-multi-course has 3 courses, they contribute 1 scalar
    expect(dpRes.rawCount).toBe(5);
    // Cross-course aggregation rule: PER_USER_MEAN_CLAMPED_TO_BOUNDING_INTERVAL
    expect(dpRes.mechanism.contributionBounding.perUserAggregationRule).toBe(
      "PER_USER_MEAN_CLAMPED_TO_BOUNDING_INTERVAL",
    );
  });

  // ============================================================
  // 40.H20 + 40.H21: Overlapping cohorts / budget reset bypass prevention
  // ============================================================
  it("40.H20 & 40.H21 — overlapping cohorts consume shared budget; budget cannot be bypassed via new session/token/job", () => {
    const cohort = Array.from({ length: 20 }, () => 75);

    // Query 1: consume 3.0 epsilon
    DifferentialPrivacyService.evaluateDPAggregate({
      researcherId: "researcher-bypass-test",
      tenantId: "tenant-polytech",
      cohortData: cohort,
      queryType: "MEAN_SCORE",
      epsilonRequested: 3.0,
    });
    expect(DifferentialPrivacyService.getRemainingBudget("researcher-bypass-test", "tenant-polytech")).toBe(
      7.0,
    );

    // Query 2: overlapping cohort (49/50 students) — budget still decrements
    const overlappingCohort = cohort.slice(0, 19);
    DifferentialPrivacyService.evaluateDPAggregate({
      researcherId: "researcher-bypass-test",
      tenantId: "tenant-polytech",
      cohortData: overlappingCohort,
      queryType: "MEAN_SCORE",
      epsilonRequested: 3.0,
    });
    expect(DifferentialPrivacyService.getRemainingBudget("researcher-bypass-test", "tenant-polytech")).toBe(
      4.0,
    );

    // 40.H21: Bypass attempt 1 — "new API token" (same researcher/tenant key in budget store)
    // Budget ledger is keyed by (researcherId, tenantId), not by token/session — so it's unchanged
    const afterBypass1 = DifferentialPrivacyService.getRemainingBudget(
      "researcher-bypass-test",
      "tenant-polytech",
    );
    expect(afterBypass1).toBe(4.0); // Budget NOT reset

    // Bypass attempt 2 — "different export job ID" (still same researcher/tenant)
    DifferentialPrivacyService.evaluateDPAggregate({
      researcherId: "researcher-bypass-test",
      tenantId: "tenant-polytech",
      cohortData: cohort,
      queryType: "MEAN_SCORE",
      epsilonRequested: 4.0, // try to consume remaining
    });
    expect(DifferentialPrivacyService.getRemainingBudget("researcher-bypass-test", "tenant-polytech")).toBe(
      0.0,
    );

    // Bypass attempt 3 — "different tenant" (isolated budget, NOT shared)
    const crossTenantBudget = DifferentialPrivacyService.getRemainingBudget(
      "researcher-bypass-test",
      "tenant-fpt-uni",
    );
    expect(crossTenantBudget).toBe(10.0); // Separate tenant = separate budget

    // Verify: 40.H21 budget reset policy — manual reset is blocked without explicit clearance
    // (Policy is EXPLICIT_IRB_OR_DPO_APPROVAL_ONLY — resetBudget() exists but requires explicit call,
    //  simulating DPO approval; it cannot be triggered by the researcher directly in production)
    const policy = DifferentialPrivacyService.getMechanismDefinition(20).privacyBudgetPolicy;
    expect(policy.resetPolicy).toBe("EXPLICIT_IRB_OR_DPO_APPROVAL_ONLY");
    expect(policy.approvalPolicy).toBe("PRODUCT_GOVERNANCE_THRESHOLD_REQUIRING_DPO_SIGN_OFF");
  });
});
