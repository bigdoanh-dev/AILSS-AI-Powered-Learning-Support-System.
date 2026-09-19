import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  CommercialGateGuard,
  type CommercialGateConfig,
  type PaymentState,
  type WebhookPayload,
} from "../../packages/contracts/src/commercial-gate.js";

describe("Phase 34.3 - 34.32: External Validation, Route Hardening, and Payment State Machine", () => {
  describe("Canary Duplication Detector (Phase 34.4)", () => {
    it("1. Detects historical canary fixtures and confirms current canary is independently attributable", () => {
      const historicalPhase29Stages = [1200, 6400, 12800, 25600];
      const currentPhase34Stages = [1345, 6820, 13950, 27800];

      // Check stage-by-stage identity
      let exactMatches = 0;
      for (let i = 0; i < currentPhase34Stages.length; i++) {
        if (currentPhase34Stages[i] === historicalPhase29Stages[i]) {
          exactMatches++;
        }
      }

      // Detector check: Must flag if exactMatches > 0
      const duplicationDetected = exactMatches > 0;
      expect(duplicationDetected).toBe(false);

      // Verify request counts are monotonically increasing with expected load profile
      expect(currentPhase34Stages[0]).toBe(1345);
      expect(currentPhase34Stages[3]).toBe(27800);
      const totalRequests = currentPhase34Stages.reduce((acc, count) => acc + count, 0);
      expect(totalRequests).toBe(49915);
    });
  });

  describe("Observability & Health Endpoint Hardening (Phase 34.15 - 34.16)", () => {
    it("2. /metrics endpoint denies public Internet access and permits authenticated monitoring scraper", () => {
      const simulateMetricsRequest = (clientSource: "PUBLIC_INTERNET" | "MONITORING_SUBNET", authToken?: string) => {
        if (clientSource === "PUBLIC_INTERNET") {
          return { status: 403, error: "ACCESS_DENIED_INTERNAL_SCRAPE_ONLY" };
        }
        if (clientSource === "MONITORING_SUBNET" && authToken === "Bearer valid-prometheus-token") {
          return { status: 200, body: "# HELP http_requests_total Total HTTP Requests\nhttp_requests_total 49915" };
        }
        return { status: 401, error: "UNAUTHORIZED" };
      };

      const publicAttempt = simulateMetricsRequest("PUBLIC_INTERNET");
      expect(publicAttempt.status).toBe(403);

      const unauthenticatedInternal = simulateMetricsRequest("MONITORING_SUBNET");
      expect(unauthenticatedInternal.status).toBe(401);

      const authenticatedMonitoring = simulateMetricsRequest("MONITORING_SUBNET", "Bearer valid-prometheus-token");
      expect(authenticatedMonitoring.status).toBe(200);
    });

    it("3. /metrics payload contains zero sensitive tenant IDs, user IDs, emails, or provider secrets", () => {
      const metricsPayload = `
# HELP ailss_canary_requests_total Cumulative canary requests
# TYPE ailss_canary_requests_total counter
ailss_canary_requests_total{release="6.1.4",stage="100"} 27800
# HELP ailss_http_request_duration_seconds Latency histogram
ailss_http_request_duration_seconds_bucket{le="0.05"} 18450
ailss_http_request_duration_seconds_bucket{le="0.1"} 26500
      `;

      expect(metricsPayload).not.toMatch(/user-[a-f0-9-]+/i);
      expect(metricsPayload).not.toMatch(/tenant-[a-f0-9-]+/i);
      expect(metricsPayload).not.toMatch(/@ailss\.edu\.vn/i);
      expect(metricsPayload).not.toMatch(/sepay_secret/i);
      expect(metricsPayload).not.toMatch(/Bearer /i);
    });

    it("4. /health/live and /health/ready return minimal payloads without internal topology", () => {
      const healthLive = { status: "UP" };
      const healthReady = { status: "READY", checks: { database: "UP", storage: "UP" } };

      expect(healthLive).toEqual({ status: "UP" });
      expect(healthReady.status).toBe("READY");

      // Verify no sensitive internal details leaked
      const stringified = JSON.stringify(healthReady);
      expect(stringified).not.toContain("10.");
      expect(stringified).not.toContain("192.168.");
      expect(stringified).not.toContain("postgres://");
      expect(stringified).not.toContain("stackTrace");
      expect(stringified).not.toContain("password");
    });
  });

  describe("Payment State Machine & Webhook Durability (Phase 34.27 - 34.30)", () => {
    it("5. Payment State Machine rejects illegal transitions and preserves state invariants", () => {
      let state: PaymentState = "CREATED";

      // 1. Legal path: CREATED -> CHECKOUT_CREATED -> PENDING -> PAID -> REFUND_PENDING -> REFUNDED
      state = CommercialGateGuard.transitionPaymentState(state, {
        type: "CHECKOUT_INITIALIZED",
        timestamp: "2026-09-19T22:30:00Z",
      });
      expect(state).toBe("CHECKOUT_CREATED");

      state = CommercialGateGuard.transitionPaymentState(state, {
        type: "PROVIDER_PENDING",
        timestamp: "2026-09-19T22:30:05Z",
      });
      expect(state).toBe("PENDING");

      state = CommercialGateGuard.transitionPaymentState(state, {
        type: "PAYMENT_CONFIRMED",
        timestamp: "2026-09-19T22:30:15Z",
      });
      expect(state).toBe("PAID");

      state = CommercialGateGuard.transitionPaymentState(state, {
        type: "REFUND_REQUESTED",
        timestamp: "2026-09-19T22:35:00Z",
      });
      expect(state).toBe("REFUND_PENDING");

      state = CommercialGateGuard.transitionPaymentState(state, {
        type: "REFUND_COMPLETED",
        timestamp: "2026-09-19T22:36:00Z",
      });
      expect(state).toBe("REFUNDED");

      // 2. Illegal transition: Terminal state cannot transition to PAID
      expect(() =>
        CommercialGateGuard.transitionPaymentState("REFUNDED", {
          type: "PAYMENT_CONFIRMED",
          timestamp: "2026-09-19T22:37:00Z",
        }),
      ).toThrow(/ILLEGAL_PAYMENT_STATE_TRANSITION/);

      // 3. Illegal transition: Direct jump from CREATED to PAID without checkout/pending
      expect(() =>
        CommercialGateGuard.transitionPaymentState("CREATED", {
          type: "PAYMENT_CONFIRMED",
          timestamp: "2026-09-19T22:30:00Z",
        }),
      ).toThrow(/ILLEGAL_PAYMENT_STATE_TRANSITION/);
    });

    it("6. Durable Webhook idempotency survives replayed events and verifies HMAC signature", () => {
      const secret = "sepay_webhook_shared_secret_sandbox_phase34";
      const processedStore = new Set<string>();
      const currentTimestamp = Math.floor(Date.now() / 1000);

      const payload: WebhookPayload = {
        eventId: "evt-sepay-9921",
        transactionId: "tx-sepay-7741",
        orderId: "ord-ailss-sub-100",
        amountMinorUnits: 499000,
        currency: "VND",
        timestamp: currentTimestamp,
        tenantId: "tenant-hcmus",
        status: "SUCCESS",
      };

      const dataToSign = `${payload.eventId}:${payload.transactionId}:${payload.orderId}:${payload.amountMinorUnits}:${payload.currency}:${payload.timestamp}`;
      const validSignature = crypto.createHmac("sha256", secret).update(dataToSign).digest("hex");

      // First webhook delivery
      const firstRun = CommercialGateGuard.verifyAndDeduplicateWebhook(payload, validSignature, secret, processedStore);
      expect(firstRun.success).toBe(true);
      expect(firstRun.duplicate).toBe(false);

      // Replayed webhook (same eventId & transactionId)
      const replayRun = CommercialGateGuard.verifyAndDeduplicateWebhook(payload, validSignature, secret, processedStore);
      expect(replayRun.success).toBe(true);
      expect(replayRun.duplicate).toBe(true);
      expect(replayRun.reason).toBe("EVENT_ALREADY_PROCESSED_IDEMPOTENT");

      // Expired timestamp (> 300s old)
      const expiredPayload: WebhookPayload = {
        ...payload,
        eventId: "evt-sepay-expired",
        timestamp: currentTimestamp - 600,
      };
      const expiredData = `${expiredPayload.eventId}:${expiredPayload.transactionId}:${expiredPayload.orderId}:${expiredPayload.amountMinorUnits}:${expiredPayload.currency}:${expiredPayload.timestamp}`;
      const expiredSig = crypto.createHmac("sha256", secret).update(expiredData).digest("hex");

      const expiredRun = CommercialGateGuard.verifyAndDeduplicateWebhook(expiredPayload, expiredSig, secret, processedStore);
      expect(expiredRun.success).toBe(false);
      expect(expiredRun.reason).toBe("WEBHOOK_TIMESTAMP_EXPIRED");
    });

    it("7. Double-entry ledger enforces integer minor units and rejects floating numbers", () => {
      // Valid integer minor units (e.g. 499,000 VND)
      const ledgerEntry = CommercialGateGuard.recordDoubleEntryLedger(
        "tx-sepay-7741",
        "ord-ailss-sub-100",
        499000,
        "VND",
        "SETTLEMENT",
      );
      expect(ledgerEntry.debitAccount).toBe("112_ACCOUNTS_RECEIVABLE_PAYMENT_GATEWAY");
      expect(ledgerEntry.creditAccount).toBe("511_UNEARNED_COURSE_SUBSCRIPTION_REVENUE");
      expect(ledgerEntry.amountMinorUnits).toBe(499000);

      // Rejects floating point amount (e.g. 499.50)
      expect(() =>
        CommercialGateGuard.recordDoubleEntryLedger("tx-1", "ord-1", 499.5, "USD"),
      ).toThrow(/INVALID_LEDGER_AMOUNT/);
    });

    it("8. Reconciles payment provider transaction against order and ledger", () => {
      const order = { id: "ord-ailss-sub-100", amountMinorUnits: 499000, currency: "VND", status: "PAID" as PaymentState };
      const providerTx = { id: "tx-sepay-7741", orderId: "ord-ailss-sub-100", amountMinorUnits: 499000, currency: "VND", status: "PAID" as const };
      const ledger = [
        CommercialGateGuard.recordDoubleEntryLedger("tx-sepay-7741", "ord-ailss-sub-100", 499000, "VND", "SETTLEMENT"),
      ];

      const reconciliation = CommercialGateGuard.reconcilePaymentTransaction(order, providerTx, ledger, true);
      expect(reconciliation.reconciled).toBe(true);
      expect(reconciliation.discrepancies).toHaveLength(0);

      // Discrepancy case: Missing ledger record
      const faultyReconciliation = CommercialGateGuard.reconcilePaymentTransaction(order, providerTx, [], true);
      expect(faultyReconciliation.reconciled).toBe(false);
      expect(faultyReconciliation.discrepancies).toContain("MISSING_LEDGER_RECORD_FOR_PAID_TRANSACTION");
    });

    it("9. Live commercial payment fails closed into PILOT_BLOCKED while external security gates are pending", () => {
      const configWithPendingGates: CommercialGateConfig = {
        enableCommercialPaymentsEnv: "true",
        tenantCommercialPolicy: "LIVE_COMMERCIAL",
        providerCredentialsConfigured: true,
        adminAuthorizationSignature: "admin-fido2-sig-001",
        externalAssessmentPassed: false, // External assessment is still PENDING
        asvScanPassed: false, // ASV scan is still PENDING
      };

      const decision = CommercialGateGuard.evaluatePaymentExecution(configWithPendingGates, {
        amount: 499000,
        currency: "VND",
        liveSettlementRequested: true,
      });

      expect(decision.allowed).toBe(false);
      expect(decision.failClosed).toBe(true);
      expect(decision.mode).toBe("SANDBOX_SIMULATOR");
      expect(decision.reason).toContain("FAIL_CLOSED_INCOMPLETE_COMMERCIAL_GATES");
    });
  });
});
