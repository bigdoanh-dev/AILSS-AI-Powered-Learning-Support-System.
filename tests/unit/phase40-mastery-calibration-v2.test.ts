import { describe, it, expect } from "vitest";
import {
  MasteryCalibrationRunnerV2,
  MASTERY_CALIBRATION_DATASET_V2,
} from "../../apps/learning-service/src/mastery/mastery-calibration-v2.js";

describe("Phase 40 Corrective Closure: Mastery Calibration V2 & Property Testing (40.C17 - 40.C19)", () => {
  const runner = new MasteryCalibrationRunnerV2();

  it("40.C17 — executes expanded 20-case calibration across 4 courses with 100% pass", () => {
    const result = runner.runCalibration();

    expect(result.datasetVersion).toBe("mastery-calibration-v2");
    expect(result.totalTestCases).toBe(20);
    expect(result.passedCases).toBe(20);
    expect(result.failedCases).toBe(0);
    expect(result.unexpectedStateJumps).toBe(0);
    expect(result.verdict).toBe("CALIBRATED_STABLE");
    expect(result.stabilityScore).toBeGreaterThanOrEqual(0.95);
    expect(result.sensitivityScore).toBeGreaterThanOrEqual(0.95);
  });

  it("40.C18 — verifies all 6 mathematical property invariants", () => {
    const properties = runner.verifyProperties();

    // Property 1: Score bounded [0, 100]
    expect(properties.scoreBounded).toBe(true);

    // Property 2: Adding strong evidence preserves or increases mastery score
    expect(properties.moreEvidenceDoesNotLowerMasteryWithoutDecay).toBe(true);

    // Property 3: Retry dampening is strictly monotonic
    expect(properties.retryDampeningMonotonic).toBe(true);

    // Property 4: Prerequisite clamp strictly limits score <= 65 when prerequisites unmet
    expect(properties.prerequisiteClampEnforced).toBe(true);

    // Property 5: Inactivity decay is monotonic
    expect(properties.recencyDecayMonotonic).toBe(true);

    // Property 6: Tenant policies are isolated
    expect(properties.tenantPolicyIsolation).toBe(true);
  });

  it("40.C19 — evaluates teacher agreement rate and Cohen's Kappa", () => {
    const result = runner.runCalibration();

    // Agreement between algorithmic classification and expert human instructor expectations
    expect(result.teacherAgreementRate).toBeGreaterThanOrEqual(90);
    expect(result.cohensKappa).toBeGreaterThanOrEqual(0.85);
  });
});
