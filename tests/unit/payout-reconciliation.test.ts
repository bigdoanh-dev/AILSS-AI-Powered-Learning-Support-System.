import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ActorContext } from "../../packages/security/src/index.js";
import type { LearningCommerceRepository } from "../../apps/learning-service/src/commerce/repository.js";
import {
  FinancialLedger,
  LearningFinanceService,
  SimulationPaymentProvider,
  SimulationPayoutProvider,
  type FinancePolicyConfig,
} from "../../apps/learning-service/src/finance/index.js";

describe("Phase 19I/J — Finance Policy Hardening, Payout State Machine & Reconciliation", () => {
  const adminActor: ActorContext = {
    userId: randomUUID(),
    sessionId: randomUUID(),
    roles: ["ADMIN"],
    tokenVersion: 1,
    correlationId: "corr-admin",
    issuedAt: 1000,
    expiresAt: 2000,
  };

  const lecturerActor: ActorContext = {
    userId: randomUUID(),
    sessionId: randomUUID(),
    roles: ["LECTURER"],
    tokenVersion: 1,
    correlationId: "corr-lecturer",
    issuedAt: 1000,
    expiresAt: 2000,
  };

  const studentActor: ActorContext = {
    userId: randomUUID(),
    sessionId: randomUUID(),
    roles: ["STUDENT"],
    tokenVersion: 1,
    correlationId: "corr-student",
    issuedAt: 1000,
    expiresAt: 2000,
  };

  const dummyRepo = {
    order: () => Promise.resolve(undefined),
    course: () => Promise.resolve(undefined),
    entitlement: () => Promise.resolve(undefined),
  } as unknown as LearningCommerceRepository;

  describe("Integer Basis Points Math (Phase 19I)", () => {
    it("guarantees zero fractional drift on customized basis points policy", () => {
      // Custom enterprise partner split: 15.00% platform (1500 bps), 85.00% lecturer (8500 bps)
      const enterprisePolicy: FinancePolicyConfig = {
        policyVersion: 2,
        maxRefundDays: 14,
        maxProgressPercentForRefund: 30.0,
        platformFeeBasisPoints: 1500,
        lecturerShareBasisPoints: 8500,
      };

      const ledger = new FinancialLedger(enterprisePolicy);
      const paymentTx = ledger.recordPaymentSettlement({
        orderId: randomUUID(),
        courseId: randomUUID(),
        studentId: studentActor.userId,
        lecturerId: lecturerActor.userId,
        amountMinor: 3_333_333, // Prime non-trivial integer amount
        currency: "VND",
      });

      expect(paymentTx.balanced).toBe(true);

      const cashEntry = paymentTx.entries.find((e) => e.accountId === "00000000-0000-4000-8000-000000000001");
      const platformEntry = paymentTx.entries.find((e) => e.accountId === "00000000-0000-4000-8000-000000000002");
      const lecturerEntry = paymentTx.entries.find((e) => e.accountId === lecturerActor.userId);

      expect(cashEntry).toBeDefined();
      expect(platformEntry).toBeDefined();
      expect(lecturerEntry).toBeDefined();
      if (!cashEntry || !platformEntry || !lecturerEntry) throw new Error("Expected entries to be defined");

      // Platform commission: floor(3,333,333 * 1500 / 10000) = floor(499,999.95) = 499,999
      expect(platformEntry.amount).toBe(499_999);
      // Lecturer share: 3,333,333 - 499,999 = 2,833,334
      expect(lecturerEntry.amount).toBe(2_833_334);
      // Double entry balance invariant: cash = platform + lecturer
      expect(cashEntry.amount).toBe(platformEntry.amount + lecturerEntry.amount);
    });
  });

  describe("Strict Payout State Machine (Phase 19J)", () => {
    const simulationPayoutProvider = new SimulationPayoutProvider();
    const financeService = new LearningFinanceService({
      repository: dummyRepo,
      paymentProvider: new SimulationPaymentProvider(),
    });

    const period = "2026-09";

    it("executes the safe lifecycle: CREATED -> APPROVED -> SUBMITTED -> PAID", async () => {
      // 1. Seed revenue
      financeService.recordPayment({
        orderId: randomUUID(),
        courseId: randomUUID(),
        studentId: studentActor.userId,
        lecturerId: lecturerActor.userId,
        amountMinor: 5_000_000,
        currency: "VND",
      });

      // 2. Batch Creation -> State is CREATED (never prematurely marked PAID or SETTLED)
      const createdBatch = await financeService.createPayoutBatch({
        lecturerId: lecturerActor.userId,
        periodMonth: period,
        actor: lecturerActor,
      });

      expect(createdBatch.status).toBe("CREATED");
      expect(createdBatch.totalAmount).toBe(4_000_000); // 80% of 5,000,000
      expect(createdBatch.settledAt).toBeUndefined();

      // Attempting to submit without approval must fail
      await expect(
        financeService.submitPayoutToProvider({
          batchId: createdBatch.batchId,
          actor: adminActor,
          payoutProvider: simulationPayoutProvider,
        }),
      ).rejects.toThrow("Payout batch must be APPROVED before submitting");

      // 3. Admin Approval -> State is APPROVED
      const approvedBatch = await financeService.approvePayoutBatch({
        batchId: createdBatch.batchId,
        actor: adminActor,
      });
      expect(approvedBatch.status).toBe("APPROVED");

      // 4. Submit to external PayoutProvider -> State is PROCESSING
      const submittedBatch = await financeService.submitPayoutToProvider({
        batchId: createdBatch.batchId,
        actor: adminActor,
        payoutProvider: simulationPayoutProvider,
      });

      expect(submittedBatch.status).toBe("PROCESSING");
      expect(submittedBatch.providerPayoutId).toBeDefined();
      expect(submittedBatch.submittedAt).toBeDefined();
      expect(submittedBatch.settledAt).toBeUndefined(); // Still not paid!

      // 5. External bank processes the payout successfully
      expect(submittedBatch.providerPayoutId).toBeDefined();
      if (!submittedBatch.providerPayoutId) throw new Error("Expected providerPayoutId");
      simulationPayoutProvider.simulateExternalSettlement(submittedBatch.providerPayoutId, true);

      // 6. Reconciliation confirms external payment -> State is PAID
      const reconciledBatch = await financeService.reconcilePayoutWithProvider({
        batchId: createdBatch.batchId,
        payoutProvider: simulationPayoutProvider,
      });

      expect(reconciledBatch.status).toBe("PAID");
      expect(reconciledBatch.settledAt).toBeDefined();
    });

    it("handles external bank failure and safely reverts ledger payable", async () => {
      // 1. Seed another order
      financeService.recordPayment({
        orderId: randomUUID(),
        courseId: randomUUID(),
        studentId: studentActor.userId,
        lecturerId: lecturerActor.userId,
        amountMinor: 1_000_000,
        currency: "VND",
      });

      const batch = await financeService.createPayoutBatch({
        lecturerId: lecturerActor.userId,
        periodMonth: period,
        actor: adminActor,
      });
      await financeService.approvePayoutBatch({ batchId: batch.batchId, actor: adminActor });
      const submitted = await financeService.submitPayoutToProvider({
        batchId: batch.batchId,
        actor: adminActor,
        payoutProvider: simulationPayoutProvider,
      });

      // External bank rejects payout (e.g. invalid account or frozen bank)
      expect(submitted.providerPayoutId).toBeDefined();
      if (!submitted.providerPayoutId) throw new Error("Expected providerPayoutId");
      simulationPayoutProvider.simulateExternalSettlement(
        submitted.providerPayoutId,
        false,
        "INVALID_BENEFICIARY_ACCOUNT",
      );

      // Reconcile bank rejection
      const failedBatch = await financeService.reconcilePayoutWithProvider({
        batchId: batch.batchId,
        payoutProvider: simulationPayoutProvider,
      });

      expect(failedBatch.status).toBe("FAILED");
      expect(failedBatch.failureReason).toBe("INVALID_BENEFICIARY_ACCOUNT");
      expect(failedBatch.settledAt).toBeUndefined();
    });
  });
});
