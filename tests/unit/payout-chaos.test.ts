import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ActorContext } from "../../packages/security/src/index.js";
import type { LearningCommerceRepository } from "../../apps/learning-service/src/commerce/repository.js";
import {
  LearningFinanceService,
  SimulationPaymentProvider,
  SimulationPayoutProvider,
} from "../../apps/learning-service/src/finance/index.js";

describe("Phase 21.11: Payout Idempotency Chaos & Failover Simulation", () => {
  const adminActor: ActorContext = {
    userId: randomUUID(),
    sessionId: randomUUID(),
    roles: ["ADMIN"],
    tokenVersion: 1,
    correlationId: "corr-admin-chaos",
    issuedAt: 1000,
    expiresAt: 2000,
  };

  const lecturerActor: ActorContext = {
    userId: randomUUID(),
    sessionId: randomUUID(),
    roles: ["LECTURER"],
    tokenVersion: 1,
    correlationId: "corr-lecturer-chaos",
    issuedAt: 1000,
    expiresAt: 2000,
  };

  const studentActor: ActorContext = {
    userId: randomUUID(),
    sessionId: randomUUID(),
    roles: ["STUDENT"],
    tokenVersion: 1,
    correlationId: "corr-student-chaos",
    issuedAt: 1000,
    expiresAt: 2000,
  };

  const dummyRepo = {
    order: () => Promise.resolve(undefined),
    course: () => Promise.resolve(undefined),
    entitlement: () => Promise.resolve(undefined),
  } as unknown as LearningCommerceRepository;

  it("prevents double-submission and double-debiting when worker crashes after dispatch", async () => {
    const simulationPayoutProvider = new SimulationPayoutProvider();
    const financeService = new LearningFinanceService({
      repository: dummyRepo,
      paymentProvider: new SimulationPaymentProvider(),
    });

    // Seed revenue: 10,000,000 VND
    financeService.recordPayment({
      orderId: randomUUID(),
      courseId: randomUUID(),
      studentId: studentActor.userId,
      lecturerId: lecturerActor.userId,
      amountMinor: 10_000_000,
      currency: "VND",
    });

    const batch = await financeService.createPayoutBatch({
      lecturerId: lecturerActor.userId,
      periodMonth: "2026-09",
      actor: lecturerActor,
    });

    await financeService.approvePayoutBatch({
      batchId: batch.batchId,
      actor: adminActor,
    });

    // 1. Initial submission succeeds -> batch is in PROCESSING
    const firstSubmission = await financeService.submitPayoutToProvider({
      batchId: batch.batchId,
      actor: adminActor,
      payoutProvider: simulationPayoutProvider,
    });

    expect(firstSubmission.status).toBe("PROCESSING");
    const initialProviderPayoutId = firstSubmission.providerPayoutId;
    expect(initialProviderPayoutId).toBeDefined();

    // 2. Worker crashes and restarts: worker retries submitting the exact same batch
    const secondSubmission = await financeService.submitPayoutToProvider({
      batchId: batch.batchId,
      actor: adminActor,
      payoutProvider: simulationPayoutProvider,
    });

    // Must return the exact same batch without generating a new providerPayoutId or double debit
    expect(secondSubmission.status).toBe("PROCESSING");
    expect(secondSubmission.providerPayoutId).toBe(initialProviderPayoutId);
    expect(secondSubmission.ledgerRef).toBe(firstSubmission.ledgerRef);
  });

  it("handles re-execution idempotently even after batch reaches settled PAID state", async () => {
    const simulationPayoutProvider = new SimulationPayoutProvider();
    const financeService = new LearningFinanceService({
      repository: dummyRepo,
      paymentProvider: new SimulationPaymentProvider(),
    });

    financeService.recordPayment({
      orderId: randomUUID(),
      courseId: randomUUID(),
      studentId: studentActor.userId,
      lecturerId: lecturerActor.userId,
      amountMinor: 4_000_000,
      currency: "VND",
    });

    const batch = await financeService.createPayoutBatch({
      lecturerId: lecturerActor.userId,
      periodMonth: "2026-09",
      actor: adminActor,
    });

    await financeService.approvePayoutBatch({ batchId: batch.batchId, actor: adminActor });
    const submitted = await financeService.submitPayoutToProvider({
      batchId: batch.batchId,
      actor: adminActor,
      payoutProvider: simulationPayoutProvider,
    });

    if (!submitted.providerPayoutId) throw new Error("Expected providerPayoutId");
    simulationPayoutProvider.simulateExternalSettlement(submitted.providerPayoutId, true);

    const settled = await financeService.reconcilePayoutWithProvider({
      batchId: batch.batchId,
      payoutProvider: simulationPayoutProvider,
    });

    expect(settled.status).toBe("PAID");

    // Client/Worker retries submission on already-paid batch -> must return PAID batch idempotently
    const retrySubmission = await financeService.submitPayoutToProvider({
      batchId: batch.batchId,
      actor: adminActor,
      payoutProvider: simulationPayoutProvider,
    });

    expect(retrySubmission.status).toBe("PAID");
    expect(retrySubmission.providerPayoutId).toBe(submitted.providerPayoutId);
  });

  it("recovers state through reconciliation when external network times out during dispatch confirmation", async () => {
    const simulationPayoutProvider = new SimulationPayoutProvider();
    const financeService = new LearningFinanceService({
      repository: dummyRepo,
      paymentProvider: new SimulationPaymentProvider(),
    });

    financeService.recordPayment({
      orderId: randomUUID(),
      courseId: randomUUID(),
      studentId: studentActor.userId,
      lecturerId: lecturerActor.userId,
      amountMinor: 2_000_000,
      currency: "VND",
    });

    const batch = await financeService.createPayoutBatch({
      lecturerId: lecturerActor.userId,
      periodMonth: "2026-09",
      actor: adminActor,
    });

    await financeService.approvePayoutBatch({ batchId: batch.batchId, actor: adminActor });
    const submitted = await financeService.submitPayoutToProvider({
      batchId: batch.batchId,
      actor: adminActor,
      payoutProvider: simulationPayoutProvider,
    });

    if (!submitted.providerPayoutId) throw new Error("Expected providerPayoutId");
    // Simulate bank completed payment out-of-band while our client was disconnected
    simulationPayoutProvider.simulateExternalSettlement(submitted.providerPayoutId, true);

    // Cron reconciliation wakes up and queries provider
    const recovered = await financeService.reconcilePayoutWithProvider({
      batchId: batch.batchId,
      payoutProvider: simulationPayoutProvider,
    });

    expect(recovered.status).toBe("PAID");
    expect(recovered.settledAt).toBeDefined();
  });
});
