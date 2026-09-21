import { describe, it, expect, beforeEach } from "vitest";
import { DifferentialPrivacyService } from "../../apps/learning-service/src/analytics/differential-privacy-service.js";

describe("Phase 40 Corrective Closure: Differential Privacy Mechanism Validation (40.C25 - 40.C29)", () => {
  beforeEach(() => {
    DifferentialPrivacyService.resetBudget("researcher-01");
  });

  it("40.C25 & 40.C27 — verifies DP mechanism definition and parameters", () => {
    const mech = DifferentialPrivacyService.getMechanismDefinition();

    expect(mech.adjacencyRelation).toBe("DIFFER_BY_ONE_LEARNER_RECORD");
    expect(mech.boundingInterval).toEqual([0, 100]);
    expect(mech.sensitivityFormula).toBe("DELTA_F = (MAX - MIN) / N");
    expect(mech.epsilon).toBe(1.0);
    expect(mech.delta).toBe(0.00001);
    expect(mech.randomnessGenerator).toBe("CRYPTOGRAPHIC_LAPLACE_INVERSE_CDF");
    expect(mech.compositionRule).toBe("SEQUENTIAL_BASIC_COMPOSITION");
    expect(mech.totalBudgetPerResearcher).toBe(10.0);
  });

  it("40.C28 — enforces small-cohort suppression even when DP requested for N < 5", () => {
    const smallCohort = [85, 90, 75, 80]; // N = 4 < 5
    const result = DifferentialPrivacyService.evaluateDPAggregate({
      researcherId: "researcher-01",
      tenantId: "tenant-polytech",
      cohortData: smallCohort,
      queryType: "MEAN_SCORE",
    });

    expect(result.suppressionApplied).toBe(true);
    expect(result.rawCount).toBe(4);
    // Suppressed result does not leak mean
    expect(result.noisyMean).toBe(0);
  });

  it("40.C28 — generates noisy aggregate and deducts privacy budget", () => {
    // Cohort of 50 learners
    const cohort = Array.from({ length: 50 }, (_, i) => 70 + (i % 20));
    const result = DifferentialPrivacyService.evaluateDPAggregate({
      researcherId: "researcher-01",
      tenantId: "tenant-polytech",
      cohortData: cohort,
      queryType: "MEAN_SCORE",
      epsilonRequested: 1.0,
    });

    expect(result.suppressionApplied).toBe(false);
    expect(result.rawCount).toBe(50);
    expect(result.noisyMean).toBeGreaterThan(0);
    expect(result.epsilonConsumed).toBe(1.0);
    expect(result.remainingBudget).toBe(9.0);
    expect(result.isBudgetExhausted).toBe(false);
  });

  it("40.C28 — prevents averaging attacks by enforcing budget exhaustion", () => {
    const cohort = Array.from({ length: 50 }, (_, i) => 75);

    // Exhaust budget (10 queries of eps=1.0)
    for (let i = 0; i < 10; i++) {
      const res = DifferentialPrivacyService.evaluateDPAggregate({
        researcherId: "researcher-01",
        tenantId: "tenant-polytech",
        cohortData: cohort,
        queryType: "MEAN_SCORE",
        epsilonRequested: 1.0,
      });
      expect(res.isBudgetExhausted).toBe(false);
    }

    // 11th query should be blocked
    const blockedRes = DifferentialPrivacyService.evaluateDPAggregate({
      researcherId: "researcher-01",
      tenantId: "tenant-polytech",
      cohortData: cohort,
      queryType: "MEAN_SCORE",
      epsilonRequested: 1.0,
    });

    expect(blockedRes.isBudgetExhausted).toBe(true);
    expect(blockedRes.remainingBudget).toBe(0);
  });

  it("40.C29 — measures utility and error tradeoffs across cohort sizes", () => {
    const benchmark = DifferentialPrivacyService.runUtilityBenchmark(100);

    expect(benchmark).toHaveLength(3);

    // Small cohort (N=10) has high sensitivity (10.0) -> high noise
    const small = benchmark.find((b) => b.cohortSize === 10);
    expect(small?.sensitivity).toBe(10.0);
    expect(small?.institutionalUsabilityVerdict).toBe("NOISY_PREFER_SUPPRESSION");

    // Large cohort (N=200) has low sensitivity (0.5) -> low noise, acceptable usability
    const large = benchmark.find((b) => b.cohortSize === 200);
    expect(large?.sensitivity).toBe(0.5);
    expect(large?.institutionalUsabilityVerdict).toBe("ACCEPTABLE");
    expect(large?.measuredMeanAbsoluteError).toBeLessThan(small!.measuredMeanAbsoluteError);
  });
});
