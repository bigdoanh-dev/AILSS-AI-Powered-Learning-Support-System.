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
    expect(mech.budgetResetPolicy).toBe("EXPLICIT_ADMIN_RESET_OR_30_DAY_EXPIRATION");
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
    expect(DifferentialPrivacyService.getRemainingBudget("researcher-persistent", "tenant-polytech")).toBe(7.0);

    // Session 2 (same researcher, same tenant)
    const session2Budget = DifferentialPrivacyService.getRemainingBudget("researcher-persistent", "tenant-polytech");
    expect(session2Budget).toBe(7.0);

    // Cross-tenant isolation (same researcher in tenant-fpt has isolated budget)
    const otherTenantBudget = DifferentialPrivacyService.getRemainingBudget("researcher-persistent", "tenant-fpt-uni");
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
});
