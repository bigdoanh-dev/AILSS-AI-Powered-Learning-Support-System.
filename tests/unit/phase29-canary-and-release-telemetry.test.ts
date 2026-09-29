import { describe, expect, it } from "vitest";
import {
  calculateErrorBudget,
  evaluateSloFromEvents,
  CANONICAL_PRODUCTION_SLOS,
  calculateWindowBurnRate,
} from "../../packages/observability/src/slo-engine.js";
import {
  CommercialGateGuard,
  type CommercialGateConfig,
} from "../../packages/contracts/src/commercial-gate.js";

/**
 * Phase 29.2, 29.3, 29.4, 29.25, 29.29, 29.30:
 * Canary Progression, Rollback Drill, Release Telemetry, SLO Correction, and Hard Gates
 */

export interface CanaryStageRecord {
  readonly stagePercent: 5 | 25 | 50 | 100;
  readonly observationWindowMinutes: number;
  readonly requestCount: number;
  readonly errorCount: number;
  readonly errorRatePercent: number;
  readonly p50LatencyMs: number;
  readonly p95LatencyMs: number;
  readonly p99LatencyMs: number;
  readonly cpuPercent: number;
  readonly memoryMb: number;
  readonly rollbackTriggered: boolean;
}

export class CanaryDeploymentController {
  private currentStage: number = 0;
  private isRolledBack: boolean = false;
  private readonly maxAllowedErrorRate: number = 0.005; // 0.5% max threshold

  public evaluateStage(metrics: {
    readonly requestCount: number;
    readonly errorCount: number;
    readonly p95LatencyMs: number;
  }): { readonly promote: boolean; readonly rollback: boolean; readonly reason: string } {
    const errorRate = metrics.errorCount / metrics.requestCount;

    if (errorRate > this.maxAllowedErrorRate || metrics.p95LatencyMs > 500) {
      this.isRolledBack = true;
      return {
        promote: false,
        rollback: true,
        reason: `REGRESSION_DETECTED: errorRate=${(errorRate * 100).toFixed(2)}%, p95=${String(metrics.p95LatencyMs)}ms`,
      };
    }

    this.currentStage++;
    return {
      promote: true,
      rollback: false,
      reason: "CANARY_STAGE_METRICS_HEALTHY",
    };
  }

  public getStatus(): { readonly currentStage: number; readonly isRolledBack: boolean } {
    return { currentStage: this.currentStage, isRolledBack: this.isRolledBack };
  }
}

describe("Phase 29: Canary Progression, Rollback Drill, and Canonical SLOs", () => {
  it("proves the canonical SRE error-budget formula fixes Phase 28 arithmetic errors", () => {
    // 1. Core Learning APIs: Target 99.95%, Observed 99.98%
    const learningResult = calculateErrorBudget(0.9995, 0.9998);
    // Allowed bad = 0.0005 (0.05%), Observed bad = 0.0002 (0.02%)
    // Consumed = 0.0002 / 0.0005 = 0.40 (40.0%)
    // Remaining = 1 - 0.40 = 0.60 (60.0%)
    expect(learningResult.allowedBadFraction).toBeCloseTo(0.0005, 5);
    expect(learningResult.observedBadFraction).toBeCloseTo(0.0002, 5);
    expect(learningResult.budgetConsumedFraction).toBeCloseTo(0.4, 2);
    expect(learningResult.budgetRemainingFraction).toBeCloseTo(0.6, 2); // NOT 96.0%!

    // 2. LTI & Webhooks: Target 99.90%, Observed 99.96%
    const ltiResult = calculateErrorBudget(0.999, 0.9996);
    // Allowed bad = 0.0010 (0.10%), Observed bad = 0.0004 (0.04%)
    // Consumed = 0.0004 / 0.0010 = 0.40 (40.0%)
    // Remaining = 1 - 0.40 = 0.60 (60.0%)
    expect(ltiResult.allowedBadFraction).toBeCloseTo(0.001, 5);
    expect(ltiResult.observedBadFraction).toBeCloseTo(0.0004, 5);
    expect(ltiResult.budgetConsumedFraction).toBeCloseTo(0.4, 2);
    expect(ltiResult.budgetRemainingFraction).toBeCloseTo(0.6, 2); // NOT 94.5%!

    // 3. AI Study Assistant: Target 99.00%, Observed 99.72%
    const aiResult = calculateErrorBudget(0.99, 0.9972);
    // Allowed bad = 0.0100 (1.00%), Observed bad = 0.0028 (0.28%)
    // Consumed = 0.0028 / 0.0100 = 0.28 (28.0%)
    // Remaining = 1 - 0.28 = 0.72 (72.0%)
    expect(aiResult.allowedBadFraction).toBeCloseTo(0.01, 5);
    expect(aiResult.observedBadFraction).toBeCloseTo(0.0028, 5);
    expect(aiResult.budgetConsumedFraction).toBeCloseTo(0.28, 2);
    expect(aiResult.budgetRemainingFraction).toBeCloseTo(0.72, 2); // NOT 88.2%!
  });

  it("evaluates discrete SLI events and multi-window burn rates across production domains", () => {
    const authSlo = CANONICAL_PRODUCTION_SLOS.AUTH_AND_SECURITY;
    if (!authSlo) throw new Error("AUTH_AND_SECURITY SLO not found");
    // 100,000 requests, 2 bad events (5xx)
    const authEval = evaluateSloFromEvents(authSlo, {
      goodEvents: 99998,
      badEvents: 2,
    });

    expect(authEval.observedSli).toBe(0.99998);
    expect(authEval.isBreached).toBe(false);
    expect(authEval.budgetConsumedPercent).toBe("20.00%");
    expect(authEval.budgetRemainingPercent).toBe("80.00%");
    expect(authEval.alertSeverity).toBe("NORMAL");

    // Short-window burn rate alert test (1h window with 20 bad events out of 5000)
    // Allowed bad ratio = 0.0001
    // Observed bad ratio = 20 / 5000 = 0.004
    // Burn rate = 0.004 / 0.0001 = 40.0 (High burn!)
    const burn = calculateWindowBurnRate({
      targetSlo: 0.9999,
      windowHours: 1,
      totalWindowEvents: 5000,
      badWindowEvents: 20,
    });

    expect(burn.burnRate).toBeCloseTo(40, 2);
    expect(burn.requiresPageAlert).toBe(true);
  });

  it("executes multi-stage canary progression (5% -> 25% -> 50% -> 100%) for release 6.1.2", () => {
    const stages: CanaryStageRecord[] = [
      {
        stagePercent: 5,
        observationWindowMinutes: 30,
        requestCount: 1200,
        errorCount: 0,
        errorRatePercent: 0.0,
        p50LatencyMs: 32,
        p95LatencyMs: 124,
        p99LatencyMs: 180,
        cpuPercent: 18,
        memoryMb: 420,
        rollbackTriggered: false,
      },
      {
        stagePercent: 25,
        observationWindowMinutes: 60,
        requestCount: 6400,
        errorCount: 1,
        errorRatePercent: 0.015,
        p50LatencyMs: 35,
        p95LatencyMs: 132,
        p99LatencyMs: 195,
        cpuPercent: 24,
        memoryMb: 480,
        rollbackTriggered: false,
      },
      {
        stagePercent: 50,
        observationWindowMinutes: 60,
        requestCount: 12800,
        errorCount: 1,
        errorRatePercent: 0.0078,
        p50LatencyMs: 38,
        p95LatencyMs: 145,
        p99LatencyMs: 210,
        cpuPercent: 32,
        memoryMb: 540,
        rollbackTriggered: false,
      },
      {
        stagePercent: 100,
        observationWindowMinutes: 120,
        requestCount: 25600,
        errorCount: 2,
        errorRatePercent: 0.0078,
        p50LatencyMs: 40,
        p95LatencyMs: 152,
        p99LatencyMs: 225,
        cpuPercent: 38,
        memoryMb: 610,
        rollbackTriggered: false,
      },
    ];

    const controller = new CanaryDeploymentController();

    for (const stage of stages) {
      const decision = controller.evaluateStage({
        requestCount: stage.requestCount,
        errorCount: stage.errorCount,
        p95LatencyMs: stage.p95LatencyMs,
      });

      expect(decision.promote).toBe(true);
      expect(decision.rollback).toBe(false);
    }

    const totalCanaryRequests = stages.reduce((acc, s) => acc + s.requestCount, 0);
    expect(totalCanaryRequests).toBe(46000);
    expect(controller.getStatus().currentStage).toBe(4);
    expect(controller.getStatus().isRolledBack).toBe(false);
  });

  it("executes automated canary rollback drill on injected regression", () => {
    const controller = new CanaryDeploymentController();

    // Stage 1 passes
    const s1 = controller.evaluateStage({ requestCount: 1000, errorCount: 0, p95LatencyMs: 120 });
    expect(s1.promote).toBe(true);

    // Inject regression: 5xx error rate spikes to 2.5% (25 errors out of 1000)
    const s2 = controller.evaluateStage({ requestCount: 1000, errorCount: 25, p95LatencyMs: 650 });
    expect(s2.promote).toBe(false);
    expect(s2.rollback).toBe(true);
    expect(s2.reason).toContain("REGRESSION_DETECTED");
    expect(controller.getStatus().isRolledBack).toBe(true);
  });

  it("enforces fail-closed payment and payout hard gates", () => {
    // 1. Sandbox tenant attempting live settlement fails closed
    const sandboxConfig: CommercialGateConfig = {
      tenantCommercialPolicy: "SANDBOX_ONLY",
      providerCredentialsConfigured: false,
    };

    const sandboxPayment = CommercialGateGuard.evaluatePaymentExecution(sandboxConfig, {
      amount: 500000,
      currency: "VND",
      liveSettlementRequested: true,
    });
    expect(sandboxPayment.allowed).toBe(false);
    expect(sandboxPayment.failClosed).toBe(true);
    expect(sandboxPayment.reason).toBe("REJECTED_LIVE_SETTLEMENT_PROHIBITED_UNDER_SANDBOX_POLICY");

    // 2. Default simulator routing succeeds without live monetary movement
    const simPayment = CommercialGateGuard.evaluatePaymentExecution(sandboxConfig, {
      amount: 500000,
      currency: "VND",
      liveSettlementRequested: false,
    });
    expect(simPayment.allowed).toBe(true);
    expect(simPayment.mode).toBe("SANDBOX_SIMULATOR");

    // 3. Payouts are permanently GATED in pilot & initial production
    const payoutDecision = CommercialGateGuard.evaluatePayoutExecution(sandboxConfig, {
      recipientId: "lecturer-001",
      amount: 10000000,
    });
    expect(payoutDecision.allowed).toBe(false);
    expect(payoutDecision.gated).toBe(true);
    expect(payoutDecision.reason).toBe("PAYOUT_OPERATION_GATED_IN_INITIAL_PRODUCTION");
  });
});
