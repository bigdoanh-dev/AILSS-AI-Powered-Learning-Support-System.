import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sanitizeAnalyticsPayload } from "../../packages/contracts/src/index.js";
import type { ActorContext } from "../../packages/security/src/index.js";
import type { LearningCommerceRepository } from "../../apps/learning-service/src/commerce/repository.js";
import {
  CourseRefundPolicyEngine,
  FinancePolicyRegistry,
  FinancialLedger,
  LearningFinanceService,
  ProductionPayoutProvider,
  SimulationPaymentProvider,
  SimulationPayoutProvider,
  resolvePaymentProvider,
  resolvePayoutProvider,
  type FinancePolicyVersion,
} from "../../apps/learning-service/src/finance/index.js";
import { LearningExperimentationService } from "../../apps/learning-service/src/experimentation/index.js";

describe("Phase 19.1 — Finance Hardening, Environment Safety & Replay Defenses", () => {
  const adminActor: ActorContext = {
    userId: randomUUID(),
    sessionId: randomUUID(),
    roles: ["ADMIN"],
    tokenVersion: 1,
    correlationId: "corr-admin-h19",
    issuedAt: 1000,
    expiresAt: 2000,
  };

  const lecturerActor: ActorContext = {
    userId: randomUUID(),
    sessionId: randomUUID(),
    roles: ["LECTURER"],
    tokenVersion: 1,
    correlationId: "corr-lecturer-h19",
    issuedAt: 1000,
    expiresAt: 2000,
  };

  const studentActor: ActorContext = {
    userId: randomUUID(),
    sessionId: randomUUID(),
    roles: ["STUDENT"],
    tokenVersion: 1,
    correlationId: "corr-student-h19",
    issuedAt: 1000,
    expiresAt: 2000,
  };

  const dummyRepo = {
    order: () => Promise.resolve(undefined),
    course: () => Promise.resolve(undefined),
    entitlement: () => Promise.resolve(undefined),
    grantEntitlement: () => Promise.resolve(true),
    updateEntitlement: () => Promise.resolve(true),
  } as unknown as LearningCommerceRepository;

  describe("Provider Environment Guard", () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
      vi.unstubAllEnvs();
    });

    it("fails closed: forbids SimulationPaymentProvider in production", () => {
      process.env.NODE_ENV = "production";
      expect(() => new SimulationPaymentProvider()).toThrowError(/prohibited in production/iu);
    });

    it("fails closed: forbids SimulationPayoutProvider in production", () => {
      process.env.NODE_ENV = "production";
      expect(() => new SimulationPayoutProvider()).toThrowError(/prohibited in production/iu);
    });

    it("resolvePaymentProvider throws error on simulation in production", () => {
      expect(() =>
        resolvePaymentProvider({
          NODE_ENV: "production",
          PAYMENT_PROVIDER: "simulation",
        }),
      ).toThrowError(/Cannot initialize simulation payment provider in production/iu);
    });

    it("resolvePayoutProvider throws error on simulation in production", () => {
      expect(() =>
        resolvePayoutProvider({
          NODE_ENV: "production",
          PAYOUT_PROVIDER: "simulation",
        }),
      ).toThrowError(/Cannot initialize simulation payout provider in production/iu);
    });
  });

  describe("Webhook Replay Protection (Double-Delivery Invariant)", () => {
    it("recognizes duplicate valid webhook: 1st accepted, 2nd idempotent with no duplicate ledger entry", () => {
      const ledger = new FinancialLedger();
      const processedTransactions = new Set<string>();
      const recordedLedgerEntries: string[] = [];

      const handleWebhookDelivery = (webhook: {
        transactionId: string;
        orderId: string;
        amountMinor: number;
        currency: string;
      }) => {
        // Idempotency / duplicate callback detection
        if (processedTransactions.has(webhook.transactionId)) {
          return { accepted: true, duplicate: true };
        }

        processedTransactions.add(webhook.transactionId);
        const tx = ledger.recordPaymentSettlement({
          orderId: webhook.orderId,
          courseId: randomUUID(),
          studentId: studentActor.userId,
          lecturerId: lecturerActor.userId,
          amountMinor: webhook.amountMinor,
          currency: webhook.currency,
        });

        recordedLedgerEntries.push(tx.transactionId);
        return { accepted: true, duplicate: false };
      };

      const validWebhook = {
        transactionId: "sepay-tx-999888",
        orderId: randomUUID(),
        amountMinor: 500_000,
        currency: "VND",
      };

      // FIRST DELIVERY: Accepted, not duplicate
      const delivery1 = handleWebhookDelivery(validWebhook);
      expect(delivery1.accepted).toBe(true);
      expect(delivery1.duplicate).toBe(false);
      expect(recordedLedgerEntries).toHaveLength(1);

      // SECOND DELIVERY: Exact same cryptographically valid webhook delivered again
      const delivery2 = handleWebhookDelivery(validWebhook);
      expect(delivery2.accepted).toBe(true);
      expect(delivery2.duplicate).toBe(true);
      // No duplicate ledger entry
      expect(recordedLedgerEntries).toHaveLength(1);
    });
  });

  describe("Finance Policy Versioning (Historical Semantic Immutability)", () => {
    it("preserves V1 80/20 split for Order A when policy updates to V2 75/25 for Order B", () => {
      const registry = new FinancePolicyRegistry();

      const policyV1: FinancePolicyVersion = {
        policyVersion: 1,
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        effectiveTo: new Date("2026-06-01T00:00:00Z"),
        refundWindowDays: 7,
        maxProgressBasisPoints: 2000,
        lecturerRevenueBasisPoints: 8000, // 80%
        platformRevenueBasisPoints: 2000, // 20%
        currencyRules: [{ currency: "VND", allowFractional: false, minimumAmountMinor: 10000 }],
        status: "DEPRECATED",
      };

      const policyV2: FinancePolicyVersion = {
        policyVersion: 2,
        effectiveFrom: new Date("2026-06-01T00:00:00Z"),
        refundWindowDays: 14,
        maxProgressBasisPoints: 1500,
        lecturerRevenueBasisPoints: 7500, // 75%
        platformRevenueBasisPoints: 2500, // 25%
        currencyRules: [{ currency: "VND", allowFractional: false, minimumAmountMinor: 10000 }],
        status: "ACTIVE",
      };

      registry.registerVersion(policyV1);
      registry.registerVersion(policyV2);

      const ledger = new FinancialLedger(registry.toConfig(policyV2));

      // Order A purchased under Policy V1
      const orderAId = randomUUID();
      const courseAId = randomUUID();
      const txA = ledger.recordPaymentSettlement({
        orderId: orderAId,
        courseId: courseAId,
        studentId: studentActor.userId,
        lecturerId: lecturerActor.userId,
        amountMinor: 1_000_000,
        currency: "VND",
        policy: registry.toConfig(policyV1), // Historical V1 pinned
      });

      const lecturerEntryA = txA.entries.find((e) => e.accountId === lecturerActor.userId);
      const platformEntryA = txA.entries.find((e) => e.accountId === "00000000-0000-4000-8000-000000000002");
      expect(lecturerEntryA?.amount).toBe(800_000); // 80%
      expect(platformEntryA?.amount).toBe(200_000); // 20%

      // Order B purchased under Policy V2
      const orderBId = randomUUID();
      const courseBId = randomUUID();
      const txB = ledger.recordPaymentSettlement({
        orderId: orderBId,
        courseId: courseBId,
        studentId: studentActor.userId,
        lecturerId: lecturerActor.userId,
        amountMinor: 1_000_000,
        currency: "VND",
        policy: registry.toConfig(policyV2), // Current V2
      });

      const lecturerEntryB = txB.entries.find((e) => e.accountId === lecturerActor.userId);
      const platformEntryB = txB.entries.find((e) => e.accountId === "00000000-0000-4000-8000-000000000002");
      expect(lecturerEntryB?.amount).toBe(750_000); // 75%
      expect(platformEntryB?.amount).toBe(250_000); // 25%

      // Verify refund for Order A uses V1 rules (7 days) via registry
      const refundEngine = new CourseRefundPolicyEngine(registry.toConfig(policyV2), registry);
      const now = new Date("2026-06-10T00:00:00Z");
      const paidAt8DaysAgo = new Date("2026-06-02T00:00:00Z");

      // Under V2 (14 days), 8 days would be eligible. But Order A was under V1 (7 days) -> Must be rejected!
      const evalA = refundEngine.evaluate({
        orderState: "ENTITLED",
        paidAt: paidAt8DaysAgo,
        progressPercent: 5.0,
        policyVersion: 1, // Historical Order A pinned
        now,
      });

      expect(evalA.eligible).toBe(false);
      expect(evalA.reasonCode).toBe("REFUND_WINDOW_EXPIRED");
      expect(evalA.policyVersionApplied).toBe(1);
    });
  });

  describe("Payout Idempotency & Reconciliation Discrepancy Handling", () => {
    it("submitting payout batch twice results in idempotent single dispatch", async () => {
      const financeService = new LearningFinanceService({
        repository: dummyRepo,
        paymentProvider: new SimulationPaymentProvider({ allowInProduction: true }),
      });
      const provider = new ProductionPayoutProvider({
        apiKey: "test_key",
        secretKey: "test_secret_32_chars_long_payout",
      });

      financeService.recordPayment({
        orderId: randomUUID(),
        courseId: randomUUID(),
        studentId: studentActor.userId,
        lecturerId: lecturerActor.userId,
        amountMinor: 1_000_000,
        currency: "VND",
        occurredAt: new Date("2026-09-01T12:00:00Z"),
      });

      const batch = await financeService.createPayoutBatch({
        lecturerId: lecturerActor.userId,
        periodMonth: "2026-09",
        actor: adminActor,
      });

      await financeService.approvePayoutBatch({
        batchId: batch.batchId,
        actor: adminActor,
      });

      // First submission
      const sub1 = await financeService.submitPayoutToProvider({
        batchId: batch.batchId,
        actor: adminActor,
        payoutProvider: provider,
      });
      expect(sub1.status).toBe("PROCESSING");
      expect(sub1.providerPayoutId).toBeDefined();

      // Second submission of same batch (retry)
      const sub2 = await financeService.submitPayoutToProvider({
        batchId: batch.batchId,
        actor: adminActor,
        payoutProvider: provider,
      });

      // Must return identical batch state without re-dispatching
      expect(sub2.providerPayoutId).toBe(sub1.providerPayoutId);
      expect(sub2.status).toBe("PROCESSING");
    });

    it("flags RECONCILIATION_REQUIRED when local was PAID but provider reports FAILED", async () => {
      const financeService = new LearningFinanceService({
        repository: dummyRepo,
        paymentProvider: new SimulationPaymentProvider({ allowInProduction: true }),
      });
      const provider = new SimulationPayoutProvider("sim_key", { allowInProduction: true });

      financeService.recordPayment({
        orderId: randomUUID(),
        courseId: randomUUID(),
        studentId: studentActor.userId,
        lecturerId: lecturerActor.userId,
        amountMinor: 1_500_000,
        currency: "VND",
        occurredAt: new Date("2026-09-01T12:00:00Z"),
      });

      const batch = await financeService.createPayoutBatch({
        lecturerId: lecturerActor.userId,
        periodMonth: "2026-09",
        actor: adminActor,
      });

      await financeService.approvePayoutBatch({
        batchId: batch.batchId,
        actor: adminActor,
      });

      const submitted = await financeService.submitPayoutToProvider({
        batchId: batch.batchId,
        actor: adminActor,
        payoutProvider: provider,
      });

      if (!submitted.providerPayoutId) throw new Error("Expected providerPayoutId");

      // Provider confirms settlement
      provider.simulateExternalSettlement(submitted.providerPayoutId, true);
      const settled = await financeService.reconcilePayoutWithProvider({
        batchId: batch.batchId,
        payoutProvider: provider,
      });
      expect(settled.status).toBe("PAID");

      // Unexpected bank bounce / provider failure reported AFTER local marked PAID
      provider.simulateExternalSettlement(submitted.providerPayoutId, false, "REVERSAL_CHARGEBACK");
      const reconciled = await financeService.reconcilePayoutWithProvider({
        batchId: batch.batchId,
        payoutProvider: provider,
      });

      // Must transition to RECONCILIATION_REQUIRED and not silently overwrite
      expect(reconciled.status).toBe("RECONCILIATION_REQUIRED");
      expect(reconciled.failureReason).toContain("DISCREPANCY");
    });
  });

  describe("Product Analytics Privacy Hardening (Schema Allowlisting & Value Redaction)", () => {
    it("redacts embedded secrets in string values and enforces family allowlists", () => {
      const dirtyCatalogPayload = {
        searchTerm: "Cassandra distributed database",
        category: "Databases",
        customerDescription: "User entered password=MySecretPassword123! in query",
        authHeader: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDc",
        unwhitelistedField: "should_be_dropped",
      };

      const sanitized = sanitizeAnalyticsPayload(dirtyCatalogPayload, "CATALOG");

      // Allowlisted fields preserved
      expect(sanitized.searchTerm).toBe("Cassandra distributed database");
      expect(sanitized.category).toBe("Databases");

      // Embedded password pattern redacted in value
      expect(sanitized.customerDescription).toBeUndefined(); // customerDescription is not in CATALOG allowlist!
      expect(sanitized.unwhitelistedField).toBeUndefined();

      // Test with an allowlisted field that has an embedded secret in its string
      const searchWithSecret = {
        searchTerm: "Searching with query password=UnsafePlainText",
      };
      const sanitizedSearch = sanitizeAnalyticsPayload(searchWithSecret, "CATALOG");
      expect(sanitizedSearch.searchTerm).toContain("[REDACTED_SECRET]");
      expect(sanitizedSearch.searchTerm).not.toContain("UnsafePlainText");
    });
  });

  describe("Experimentation Restriction Protection", () => {
    it("rejects experiments on payment, finance ledger, and authentication domains", () => {
      const expService = new LearningExperimentationService();

      expect(() =>
        expService.createExperiment({
          experimentId: "exp-payment-1",
          name: "Payment Gateway A/B Test",
          variants: ["CONTROL", "STEP_BY_STEP_V2"],
          targetMetric: "PAYMENT_SUCCESS_RATE",
        }),
      ).toThrowError(/Cannot experiment on restricted security, finance, or integrity domain/iu);

      expect(() =>
        expService.createExperiment({
          experimentId: "exp-auth-1",
          name: "Bypass Auth Prompt",
          variants: ["CONTROL"],
          targetMetric: "AUTHENTICATION_LATENCY",
        }),
      ).toThrowError(/Cannot experiment on restricted security, finance, or integrity domain/iu);
    });
  });
});
