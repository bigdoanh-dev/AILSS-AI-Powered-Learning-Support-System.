import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ActorContext } from "../../packages/security/src/index.js";
import type { CourseEntitlement, LearningOrder } from "../../apps/learning-service/src/commerce/model.js";
import type { LearningCommerceRepository } from "../../apps/learning-service/src/commerce/repository.js";
import {
  CourseRefundPolicyEngine,
  FinancialLedger,
  LearningFinanceService,
  SimulationPaymentProvider,
} from "../../apps/learning-service/src/finance/index.js";

describe("Phase 18B — Finance, Double-Entry Ledger & Safe Refunds", () => {
  it("enforces double-entry ledger balance invariant (Total Debits == Total Credits) on payment", () => {
    const ledger = new FinancialLedger();
    const orderId = randomUUID();
    const courseId = randomUUID();
    const studentId = randomUUID();
    const lecturerId = randomUUID();
    const amount = 1_000_000; // 1,000,000 VND

    const tx = ledger.recordPaymentSettlement({
      orderId,
      courseId,
      studentId,
      lecturerId,
      amountMinor: amount,
      currency: "VND",
    });

    expect(tx.balanced).toBe(true);
    expect(tx.entries).toHaveLength(3);

    const cashEntry = tx.entries.find((e) => e.entryType === "PAYMENT_SETTLED");
    const platformEntry = tx.entries.find((e) => e.entryType === "PLATFORM_COMMISSION");
    const lecturerEntry = tx.entries.find((e) => e.entryType === "LECTURER_REVENUE");

    expect(cashEntry?.direction).toBe("DEBIT");
    expect(cashEntry?.amount).toBe(1_000_000);

    expect(platformEntry?.direction).toBe("CREDIT");
    expect(platformEntry?.amount).toBe(200_000); // 20% platform commission

    expect(lecturerEntry?.direction).toBe("CREDIT");
    expect(lecturerEntry?.amount).toBe(800_000); // 80% lecturer share
  });

  it("enforces double-entry ledger balance on refund settlement", () => {
    const ledger = new FinancialLedger();
    const refundId = randomUUID();
    const orderId = randomUUID();
    const courseId = randomUUID();
    const studentId = randomUUID();
    const lecturerId = randomUUID();
    const amount = 500_000;

    const tx = ledger.recordRefundSettlement({
      refundId,
      orderId,
      courseId,
      studentId,
      lecturerId,
      amountMinor: amount,
      currency: "VND",
    });

    expect(tx.balanced).toBe(true);
    const cashEntry = tx.entries.find((e) => e.entryType === "STUDENT_REFUND");
    expect(cashEntry?.direction).toBe("CREDIT");
    expect(cashEntry?.amount).toBe(500_000);

    const platformReversal = tx.entries.find((e) => e.entryType === "PLATFORM_COMMISSION");
    expect(platformReversal?.direction).toBe("DEBIT");
    expect(platformReversal?.amount).toBe(100_000);

    const lecturerReversal = tx.entries.find((e) => e.entryType === "LECTURER_REVENUE");
    expect(lecturerReversal?.direction).toBe("DEBIT");
    expect(lecturerReversal?.amount).toBe(400_000);
  });

  describe("CourseRefundPolicyEngine", () => {
    const policy = new CourseRefundPolicyEngine();

    it("qualifies refund within 7 days and under 20% progress", () => {
      const now = new Date();
      const paidAt = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000); // 3 days ago

      const result = policy.evaluate({
        orderState: "ENTITLED",
        paidAt,
        progressPercent: 12.5,
        now,
      });

      expect(result.eligible).toBe(true);
      expect(result.reasonCode).toBe("REFUND_QUALIFIED");
    });

    it("rejects refund when student has completed >= 20% of the course", () => {
      const now = new Date();
      const paidAt = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000); // 2 days ago

      const result = policy.evaluate({
        orderState: "ENTITLED",
        paidAt,
        progressPercent: 25.0, // Exceeded 20%
        now,
      });

      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe("PROGRESS_EXCEEDED_THRESHOLD");
      expect(result.userSafeExplanation).toContain("20%");
    });

    it("rejects refund when more than 7 days have elapsed since purchase", () => {
      const now = new Date();
      const paidAt = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days ago

      const result = policy.evaluate({
        orderState: "ENTITLED",
        paidAt,
        progressPercent: 5.0,
        now,
      });

      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe("REFUND_WINDOW_EXPIRED");
      expect(result.userSafeExplanation).toContain("7 ngày");
    });
  });

  describe("LearningFinanceService", () => {
    function createMockRepo() {
      const orders = new Map<string, LearningOrder>();
      const courses = new Map<string, { courseId: string; ownerLecturerId: string }>();
      const entitlements = new Map<string, CourseEntitlement>();

      const repo: LearningCommerceRepository = {
        order: (id: string) => Promise.resolve(orders.get(id) ?? null),
        course: (id: string) => Promise.resolve(courses.get(id) ?? null),
        entitlement: (studentId: string, courseId: string) =>
          Promise.resolve(entitlements.get(`${studentId}:${courseId}`) ?? null),
        grantEntitlement: (ent: CourseEntitlement) => {
          entitlements.set(`${ent.studentId}:${ent.courseId}`, ent);
          return Promise.resolve();
        },
      } as unknown as LearningCommerceRepository;

      return { repo, orders, courses, entitlements };
    }

    const studentActor: ActorContext = {
      userId: randomUUID(),
      roles: ["STUDENT"],
      sessionId: "session-1",
      tokenVersion: 1,
      correlationId: "corr-1",
      issuedAt: 1000,
      expiresAt: 2000,
    };

    const lecturerActor: ActorContext = {
      userId: randomUUID(),
      roles: ["LECTURER"],
      sessionId: "session-2",
      tokenVersion: 1,
      correlationId: "corr-2",
      issuedAt: 1000,
      expiresAt: 2000,
    };

    const adminActor: ActorContext = {
      userId: randomUUID(),
      roles: ["ADMIN"],
      sessionId: "session-3",
      tokenVersion: 1,
      correlationId: "corr-3",
      issuedAt: 1000,
      expiresAt: 2000,
    };

    it("processes refund, revokes entitlement, and dispatches ledger reversal", async () => {
      const mock = createMockRepo();
      const orderId = randomUUID();
      const courseId = randomUUID();

      mock.orders.set(orderId, {
        orderId,
        studentId: studentActor.userId,
        courseId,
        offeringId: randomUUID(),
        offeringType: "SELF_PACED",
        state: "ENTITLED",
        fulfillmentState: "ACTIVE",
        price: "1000000",
        currency: "VND",
        paidAt: new Date(),
        version: 1,
      } as LearningOrder);

      mock.courses.set(courseId, {
        courseId,
        ownerLecturerId: lecturerActor.userId,
      });

      mock.entitlements.set(`${studentActor.userId}:${courseId}`, {
        entitlementId: randomUUID(),
        studentId: studentActor.userId,
        courseId,
        state: "ACTIVE",
        sourceOfferingId: randomUUID(),
        sourceEnrollmentId: randomUUID(),
        grantedAt: new Date(),
        version: 1,
        updatedAt: new Date(),
      });

      const financeService = new LearningFinanceService({
        repository: mock.repo,
        paymentProvider: new SimulationPaymentProvider(),
      });

      const refundRecord = await financeService.requestRefund({
        actor: studentActor,
        orderId,
        reason: "Không phù hợp với lộ trình học",
        idempotencyKey: "ref-key-1",
      });

      expect(refundRecord.status).toBe("PROCESSED");
      expect(refundRecord.amount).toBe(1_000_000);

      // Entitlement must be REVOKED
      const updatedEnt = await mock.repo.entitlement(studentActor.userId, courseId);
      expect(updatedEnt?.state).toBe("REVOKED");
    });

    it("aggregates lecturer revenue and allows admin to disburse payout", async () => {
      const mock = createMockRepo();
      const financeService = new LearningFinanceService({
        repository: mock.repo,
        paymentProvider: new SimulationPaymentProvider(),
      });

      const orderId1 = randomUUID();
      const courseId1 = randomUUID();

      // Record a 2,000,000 VND order payment in September 2026
      financeService.recordPayment({
        orderId: orderId1,
        courseId: courseId1,
        studentId: studentActor.userId,
        lecturerId: lecturerActor.userId,
        amountMinor: 2_000_000,
        currency: "VND",
      });

      const period = new Date().toISOString().slice(0, 7); // e.g. "2026-09"
      const revenue = await financeService.getLecturerRevenue({
        lecturerId: lecturerActor.userId,
        periodMonth: period,
        actor: lecturerActor,
      });

      expect(revenue.grossRevenue).toBe(2_000_000);
      expect(revenue.platformFee).toBe(400_000); // 20%
      expect(revenue.netEarnings).toBe(1_600_000); // 80%

      // Admin settles payout batch
      const payout = await financeService.generateLecturerPayout({
        lecturerId: lecturerActor.userId,
        periodMonth: period,
        actor: adminActor,
      });

      expect(payout.status).toBe("SETTLED");
      expect(payout.totalAmount).toBe(1_600_000);
      expect(payout.ledgerRef).toBeDefined();
    });
  });
});
