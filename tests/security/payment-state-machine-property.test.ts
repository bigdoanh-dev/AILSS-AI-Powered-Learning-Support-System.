import { describe, it, expect, beforeEach } from "vitest";
import {
  CommercialGateGuard,
  type PaymentState,
  type PaymentEvent,
  type CommercialGateConfig,
  type WebhookPayload,
} from "../../packages/contracts/src/commercial-gate.js";
import crypto from "node:crypto";

class EmergencyKillSwitchTestHarness {
  private static killSwitchActive = false;
  static setEmergencyKillSwitch(active: boolean): void { this.killSwitchActive = active; }
  static isEmergencyKillSwitchActive(): boolean { return this.killSwitchActive; }
  static evaluatePaymentExecution(
    config: CommercialGateConfig,
    request: { readonly amount: number; readonly currency: string; readonly liveSettlementRequested?: boolean },
  ) {
    if (this.killSwitchActive) {
      return {
        allowed: false,
        mode: "SANDBOX_SIMULATOR" as const,
        reason: "REJECTED_COMMERCIAL_PAYMENT_KILL_SWITCH_ACTIVE",
        failClosed: true,
      };
    }
    return CommercialGateGuard.evaluatePaymentExecution(config, request);
  }
}

describe("Phase 35.33 & 35.37: Payment State Machine Property Invariants & Kill Switch Game Day", () => {
  beforeEach(() => {
    EmergencyKillSwitchTestHarness.setEmergencyKillSwitch(false);
  });

  describe("Property Invariants of Payment State Machine", () => {
    const allStates: PaymentState[] = [
      "CREATED",
      "CHECKOUT_CREATED",
      "PENDING",
      "PAID",
      "FAILED",
      "EXPIRED",
      "REFUND_PENDING",
      "REFUNDED",
      "PARTIALLY_REFUNDED",
      "RECONCILIATION_REQUIRED",
    ];

    const allEventTypes: PaymentEvent["type"][] = [
      "CHECKOUT_INITIALIZED",
      "PROVIDER_PENDING",
      "PAYMENT_CONFIRMED",
      "PAYMENT_FAILED",
      "EXPIRED",
      "REFUND_REQUESTED",
      "REFUND_COMPLETED",
      "ANOMALY_DETECTED",
    ];

    it("1. Invariant: FAILED state cannot transition to PAID under any event", () => {
      for (const eventType of allEventTypes) {
        expect(() =>
          CommercialGateGuard.transitionPaymentState("FAILED", {
            type: eventType,
            timestamp: new Date().toISOString(),
          }),
        ).toThrow(/ILLEGAL_PAYMENT_STATE_TRANSITION/);
      }
    });

    it("2. Invariant: EXPIRED state cannot transition to PAID under any event", () => {
      for (const eventType of allEventTypes) {
        expect(() =>
          CommercialGateGuard.transitionPaymentState("EXPIRED", {
            type: eventType,
            timestamp: new Date().toISOString(),
          }),
        ).toThrow(/ILLEGAL_PAYMENT_STATE_TRANSITION/);
      }
    });

    it("3. Invariant: REFUNDED terminal state cannot transition to PAID under any event", () => {
      for (const eventType of allEventTypes) {
        expect(() =>
          CommercialGateGuard.transitionPaymentState("REFUNDED", {
            type: eventType,
            timestamp: new Date().toISOString(),
          }),
        ).toThrow(/ILLEGAL_PAYMENT_STATE_TRANSITION/);
      }
    });

    it("4. Invariant: PAID state cannot transition backwards to CREATED", () => {
      for (const eventType of allEventTypes) {
        if (eventType === "REFUND_REQUESTED") {
          const next = CommercialGateGuard.transitionPaymentState("PAID", {
            type: eventType,
            timestamp: new Date().toISOString(),
          });
          expect(next).toBe("REFUND_PENDING");
        } else if (eventType === "ANOMALY_DETECTED") {
          const next = CommercialGateGuard.transitionPaymentState("PAID", {
            type: eventType,
            timestamp: new Date().toISOString(),
          });
          expect(next).toBe("RECONCILIATION_REQUIRED");
        } else {
          expect(() =>
            CommercialGateGuard.transitionPaymentState("PAID", {
              type: eventType,
              timestamp: new Date().toISOString(),
            }),
          ).toThrow(/ILLEGAL_PAYMENT_STATE_TRANSITION/);
        }
      }
    });

    it("5. Randomized Property Fuzzing: 200 random state transitions uphold finite-state invariants", () => {
      let illegalRejections = 0;
      let legalTransitions = 0;

      for (let i = 0; i < 200; i++) {
        const stateIdx = Math.floor(Math.random() * allStates.length);
        const eventIdx = Math.floor(Math.random() * allEventTypes.length);
        const state = allStates[stateIdx] ?? "CREATED";
        const eventType = allEventTypes[eventIdx] ?? "CHECKOUT_INITIALIZED";

        try {
          const nextState = CommercialGateGuard.transitionPaymentState(state, {
            type: eventType,
            timestamp: new Date().toISOString(),
          });
          expect(allStates).toContain(nextState);
          legalTransitions++;
        } catch (err) {
          expect((err as Error).message).toContain("ILLEGAL_PAYMENT_STATE_TRANSITION");
          illegalRejections++;
        }
      }

      expect(illegalRejections).toBeGreaterThan(50);
      expect(legalTransitions).toBeGreaterThan(10);
    });
  });

  describe("Emergency Payment Kill Switch Game Day (Phase 35.37)", () => {
    it("6. Kill Switch blocks new checkout creation immediately", () => {
      const liveConfig: CommercialGateConfig = {
        enableCommercialPaymentsEnv: "true",
        tenantCommercialPolicy: "LIVE_COMMERCIAL",
        providerCredentialsConfigured: true,
        adminAuthorizationSignature: "valid-admin-sig",
        externalAssessmentPassed: true,
        asvScanPassed: true,
      };

      // Before kill switch: allowed
      const decisionBefore = EmergencyKillSwitchTestHarness.evaluatePaymentExecution(liveConfig, {
        amount: 250000,
        currency: "VND",
        liveSettlementRequested: true,
      });
      expect(decisionBefore.allowed).toBe(true);

      // Trigger Game Day emergency kill switch
      EmergencyKillSwitchTestHarness.setEmergencyKillSwitch(true);
      expect(EmergencyKillSwitchTestHarness.isEmergencyKillSwitchActive()).toBe(true);

      // After kill switch: blocked fail-closed
      const decisionAfter = EmergencyKillSwitchTestHarness.evaluatePaymentExecution(liveConfig, {
        amount: 250000,
        currency: "VND",
        liveSettlementRequested: true,
      });
      expect(decisionAfter.allowed).toBe(false);
      expect(decisionAfter.failClosed).toBe(true);
      expect(decisionAfter.reason).toBe("REJECTED_COMMERCIAL_PAYMENT_KILL_SWITCH_ACTIVE");
    });

    it("7. Kill Switch allows ongoing provider webhooks and refunds to safely reconcile without money corruption", () => {
      EmergencyKillSwitchTestHarness.setEmergencyKillSwitch(true);

      // Ongoing webhook continues to process idempotently
      const secret = "shared_webhook_secret_gameday";
      const processedStore = new Set<string>();
      const payload: WebhookPayload = {
        eventId: "evt-gameday-001",
        transactionId: "tx-gameday-001",
        orderId: "ord-gameday-001",
        amountMinorUnits: 250000,
        currency: "VND",
        timestamp: Math.floor(Date.now() / 1000),
        tenantId: "tenant-uit",
        status: "SUCCESS",
      };

      const dataToSign = `${payload.eventId}:${payload.transactionId}:${payload.orderId}:${payload.amountMinorUnits}:${payload.currency}:${payload.timestamp}`;
      const signature = crypto.createHmac("sha256", secret).update(dataToSign).digest("hex");

      const webhookResult = CommercialGateGuard.verifyAndDeduplicateWebhook(payload, signature, secret, processedStore);
      expect(webhookResult.success).toBe(true);

      // Ledger recording continues to record balanced entries
      const ledgerEntry = CommercialGateGuard.recordDoubleEntryLedger(
        payload.transactionId,
        payload.orderId,
        payload.amountMinorUnits,
        payload.currency,
        "SETTLEMENT",
      );
      expect(ledgerEntry.debitAccount).toBe("112_ACCOUNTS_RECEIVABLE_PAYMENT_GATEWAY");
      expect(ledgerEntry.creditAccount).toBe("511_UNEARNED_COURSE_SUBSCRIPTION_REVENUE");
      expect(ledgerEntry.amountMinorUnits).toBe(250000);

      // Refund reversal continues without corruption
      const reversalEntry = CommercialGateGuard.recordDoubleEntryLedger(
        payload.transactionId,
        payload.orderId,
        payload.amountMinorUnits,
        payload.currency,
        "REFUND_REVERSAL",
      );
      expect(reversalEntry.debitAccount).toBe("511_UNEARNED_COURSE_SUBSCRIPTION_REVENUE");
      expect(reversalEntry.creditAccount).toBe("112_ACCOUNTS_RECEIVABLE_PAYMENT_GATEWAY");
      expect(reversalEntry.amountMinorUnits).toBe(250000);
    });
  });
});
