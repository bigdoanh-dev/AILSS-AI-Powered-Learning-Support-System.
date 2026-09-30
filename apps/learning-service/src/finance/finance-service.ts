import { randomUUID } from "node:crypto";
import { AppError } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import type { LearningCommerceRepository } from "../commerce/repository.js";
import { FinancialLedger, type LedgerEntry } from "./ledger.js";
import type { PaymentProvider, PaymentWebhookResult } from "./payment-provider.js";
import type { PayoutProvider, PayoutStatus } from "./payout-provider.js";
import {
  CourseRefundPolicyEngine,
  DEFAULT_FINANCE_POLICY,
  type FinancePolicyConfig,
} from "./refund-policy.js";
import type { DurableFinanceStore } from "./repository.js";

export interface RefundRequestInput {
  readonly actor: ActorContext;
  readonly orderId: string;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export interface RefundRecord {
  readonly refundId: string;
  readonly orderId: string;
  readonly studentId: string;
  readonly courseId: string;
  readonly amount: number;
  readonly currency: string;
  readonly reason: string;
  readonly status: "PENDING" | "PROCESSED" | "REJECTED";
  readonly progressPercentAtRequest: number;
  readonly requestedAt: Date;
  readonly processedAt?: Date;
  readonly failureReason?: string;
}

export interface LecturerPayoutBatch {
  readonly batchId: string;
  readonly lecturerId: string;
  readonly periodMonth: string;
  readonly totalAmount: number;
  readonly currency: string;
  readonly status: PayoutStatus | "PENDING" | "SETTLED";
  readonly ledgerRef: string;
  readonly providerPayoutId?: string;
  readonly failureReason?: string;
  readonly createdAt: Date;
  readonly submittedAt?: Date;
  readonly settledAt?: Date;
}

export interface LecturerRevenueSummary {
  readonly lecturerId: string;
  readonly periodMonth: string;
  readonly grossRevenue: number;
  readonly platformFee: number;
  readonly netEarnings: number;
  readonly totalOrders: number;
  readonly currency: string;
}

export class LearningFinanceService {
  readonly #repo: LearningCommerceRepository;
  readonly #ledger: FinancialLedger;
  readonly #refundPolicy: CourseRefundPolicyEngine;
  readonly #paymentProvider: PaymentProvider;
  readonly #persistence: DurableFinanceStore | undefined;
  readonly #ledgerEntriesStore: Map<string, LedgerEntry[]> = new Map();
  readonly #refundsStore: Map<string, RefundRecord> = new Map();
  readonly #orderRefundStore: Map<string, string> = new Map(); // orderId -> refundId
  readonly #payoutsStore: Map<string, LecturerPayoutBatch> = new Map();

  public constructor(options: {
    repository: LearningCommerceRepository;
    paymentProvider: PaymentProvider;
    ledger?: FinancialLedger;
    refundPolicy?: CourseRefundPolicyEngine;
    persistence?: DurableFinanceStore;
  }) {
    this.#repo = options.repository;
    this.#paymentProvider = options.paymentProvider;
    this.#ledger = options.ledger ?? new FinancialLedger();
    this.#refundPolicy = options.refundPolicy ?? new CourseRefundPolicyEngine();
    this.#persistence = options.persistence;
  }

  public get ledger(): FinancialLedger {
    return this.#ledger;
  }

  public get paymentProvider(): PaymentProvider {
    return this.#paymentProvider;
  }

  /**
   * Evaluates and initiates a safe course refund.
   */
  public async requestRefund(input: RefundRequestInput): Promise<RefundRecord> {
    if (!input.actor.roles.includes("STUDENT") && !input.actor.roles.includes("ADMIN")) {
      throw new AppError("FORBIDDEN", 403, "Only the student or an admin can request a refund");
    }

    const order = await this.#repo.order(input.orderId);
    if (!order) {
      throw new AppError("ORDER_NOT_FOUND", 404, "Order not found");
    }

    if (order.studentId !== input.actor.userId && !input.actor.roles.includes("ADMIN")) {
      throw new AppError("FORBIDDEN", 403, "You can only request refunds for your own orders");
    }

    // Check existing refund
    const existingRefundId = this.#orderRefundStore.get(order.orderId);
    const existingRefund = this.#persistence
      ? await this.#persistence.refundByOrder(order.orderId)
      : existingRefundId
        ? this.#refundsStore.get(existingRefundId)
        : undefined;

    // Look up learning progress for this student and course
    const course = await this.#repo.course(order.courseId);
    if (!course) {
      throw new AppError("COURSE_NOT_FOUND", 404, "Course not found");
    }

    const progressPercent = this.#persistence
      ? await this.#persistence.progressPercent(order.studentId, order.courseId)
      : 0;

    const evaluation = this.#refundPolicy.evaluate({
      orderState: order.state,
      paidAt: order.paidAt,
      progressPercent,
      ...(existingRefund?.status ? { existingRefundStatus: existingRefund.status } : {}),
    });

    if (!evaluation.eligible) {
      throw new AppError("REFUND_NOT_ELIGIBLE", 422, evaluation.userSafeExplanation);
    }

    let refundId: string = randomUUID();
    const now = new Date();
    const amountMinor = Number(order.price);
    if (this.#persistence) refundId = await this.#persistence.claimRefund(order.orderId, refundId, now);
    const claimed = this.#persistence ? await this.#persistence.refundByOrder(order.orderId) : undefined;
    if (claimed) return claimed;

    // 1. Process refund with payment provider
    const refundProviderResult = await this.#paymentProvider.initiateRefund({
      transactionId: order.paidEventId,
      orderId: order.orderId,
      amount: amountMinor,
      currency: order.currency,
      reason: input.reason,
    });
    if (!refundProviderResult.success) {
      const rejected: RefundRecord = {
        refundId,
        orderId: order.orderId,
        studentId: order.studentId,
        courseId: order.courseId,
        amount: amountMinor,
        currency: order.currency,
        reason: input.reason,
        status: "REJECTED",
        progressPercentAtRequest: progressPercent,
        requestedAt: now,
        processedAt: now,
        failureReason: "PAYMENT_PROVIDER_REJECTED_REFUND",
      };
      await this.#persistence?.persistRefund(rejected, refundProviderResult.refundTransactionId, []);
      this.#refundsStore.set(refundId, rejected);
      this.#orderRefundStore.set(order.orderId, refundId);
      return rejected;
    }

    // 2. Revoke Entitlement safely
    const entitlement = await this.#repo.entitlement(order.studentId, order.courseId);
    if (entitlement && entitlement.state === "ACTIVE") {
      const revoked = {
        ...entitlement,
        state: "REVOKED" as const,
        version: entitlement.version + 1,
        updatedAt: now,
      };
      if (typeof this.#repo.updateEntitlement === "function") {
        await this.#repo.updateEntitlement(revoked, entitlement.version);
      } else {
        await this.#repo.grantEntitlement(revoked);
      }
    }

    // 3. Record Double-Entry Ledger Transactions
    const commission = await this.#repo.commissionAt(order.paidAt ?? now);
    const tx = this.#ledger.recordRefundSettlement({
      refundId,
      orderId: order.orderId,
      courseId: order.courseId,
      studentId: order.studentId,
      lecturerId: course.ownerLecturerId,
      amountMinor,
      currency: order.currency,
      occurredAt: now,
      policy: {
        ...DEFAULT_FINANCE_POLICY,
        platformFeeBasisPoints: commission.basisPoints,
        lecturerShareBasisPoints: 10_000 - commission.basisPoints,
      },
    });

    for (const entry of tx.entries) {
      const list = this.#ledgerEntriesStore.get(entry.accountId) ?? [];
      list.push(entry);
      this.#ledgerEntriesStore.set(entry.accountId, list);
    }

    // 4. Save Refund Record
    const record: RefundRecord = {
      refundId,
      orderId: order.orderId,
      studentId: order.studentId,
      courseId: order.courseId,
      amount: amountMinor,
      currency: order.currency,
      reason: input.reason,
      status: "PROCESSED",
      progressPercentAtRequest: progressPercent,
      requestedAt: now,
      processedAt: now,
    };

    this.#refundsStore.set(refundId, record);
    this.#orderRefundStore.set(order.orderId, refundId);
    await this.#persistence?.persistRefund(record, refundProviderResult.refundTransactionId, tx.entries);

    return record;
  }

  /**
   * Retrieves aggregated revenue for an authorized lecturer.
   */
  public getLecturerRevenue(input: {
    lecturerId: string;
    periodMonth: string;
    actor: ActorContext;
  }): Promise<LecturerRevenueSummary> {
    const isOwner = input.actor.userId === input.lecturerId && input.actor.roles.includes("LECTURER");
    const isAdmin = input.actor.roles.includes("ADMIN");

    if (!isOwner && !isAdmin) {
      return Promise.reject(new AppError("FORBIDDEN", 403, "Access to lecturer revenue denied"));
    }

    const entries = this.#ledgerEntriesStore.get(input.lecturerId) ?? [];
    const periodEntries = entries.filter((e) => e.bucket.startsWith(input.periodMonth));

    let grossRevenue = 0;
    let netEarnings = 0;
    let totalOrders = 0;

    const lecturerBps = this.#ledger.policy.lecturerShareBasisPoints;
    for (const e of periodEntries) {
      if (e.entryType === "LECTURER_REVENUE") {
        if (e.direction === "CREDIT") {
          netEarnings += e.amount;
          grossRevenue += Math.round((e.amount * 10000) / lecturerBps);
          totalOrders += 1;
        } else {
          netEarnings -= e.amount;
          grossRevenue -= Math.round((e.amount * 10000) / lecturerBps);
        }
      }
    }

    const platformFee = Math.max(0, grossRevenue - netEarnings);

    return Promise.resolve({
      lecturerId: input.lecturerId,
      periodMonth: input.periodMonth,
      grossRevenue,
      platformFee,
      netEarnings,
      totalOrders,
      currency: "VND",
    });
  }

  /**
   * Creates a payout batch in CREATED status without disbursing funds immediately.
   */
  public async createPayoutBatch(input: {
    lecturerId: string;
    periodMonth: string;
    actor: ActorContext;
  }): Promise<LecturerPayoutBatch> {
    if (!input.actor.roles.includes("ADMIN") && input.actor.userId !== input.lecturerId) {
      throw new AppError("FORBIDDEN", 403, "Cannot create payout batch for another user");
    }

    const revenue = await this.getLecturerRevenue({
      lecturerId: input.lecturerId,
      periodMonth: input.periodMonth,
      actor: input.actor,
    });

    if (revenue.netEarnings <= 0) {
      throw new AppError("NO_PAYOUT_BALANCE", 422, "No positive net balance to disburse for this period");
    }

    const batchId = randomUUID();
    const now = new Date();

    const batch: LecturerPayoutBatch = {
      batchId,
      lecturerId: input.lecturerId,
      periodMonth: input.periodMonth,
      totalAmount: revenue.netEarnings,
      currency: revenue.currency,
      status: "CREATED",
      ledgerRef: "",
      createdAt: now,
    };

    this.#payoutsStore.set(batchId, batch);
    return batch;
  }

  /**
   * Approves a payout batch for submission to payment provider.
   */
  public async approvePayoutBatch(input: {
    batchId: string;
    actor: ActorContext;
  }): Promise<LecturerPayoutBatch> {
    if (!input.actor.roles.includes("ADMIN")) {
      throw new AppError("ADMIN_REQUIRED", 403, "Only administrators can approve payout batches");
    }

    const batch = this.#payoutsStore.get(input.batchId);
    if (!batch) throw new AppError("PAYOUT_NOT_FOUND", 404, "Payout batch not found");
    if (batch.status !== "CREATED") {
      throw new AppError("INVALID_STATE", 409, `Cannot approve payout batch in status ${batch.status}`);
    }

    const updated: LecturerPayoutBatch = {
      ...batch,
      status: "APPROVED",
    };

    this.#payoutsStore.set(input.batchId, updated);
    return Promise.resolve(updated);
  }

  /**
   * Submits approved payout to external provider and transitions to PROCESSING.
   */
  public async submitPayoutToProvider(input: {
    batchId: string;
    actor: ActorContext;
    payoutProvider: PayoutProvider;
    bankAccount?: {
      accountNumber: string;
      bankCode: string;
      beneficiaryName: string;
    };
  }): Promise<LecturerPayoutBatch> {
    if (!input.actor.roles.includes("ADMIN")) {
      throw new AppError("ADMIN_REQUIRED", 403, "Only administrators can submit payouts");
    }

    const batch = this.#payoutsStore.get(input.batchId);
    if (!batch) throw new AppError("PAYOUT_NOT_FOUND", 404, "Payout batch not found");

    if (
      batch.status === "SUBMITTED_TO_PROVIDER" ||
      batch.status === "PROCESSING" ||
      batch.status === "PAID"
    ) {
      // Idempotent retry: Return already submitted/paid batch without double paying or double ledger debit
      return batch;
    }
    if (batch.status !== "APPROVED") {
      throw new AppError(
        "INVALID_STATE",
        409,
        `Payout batch must be APPROVED before submitting (currently ${batch.status})`,
      );
    }

    // Record payout in double-entry ledger upon provider dispatch
    const tx = this.#ledger.recordLecturerPayout({
      batchId: batch.batchId,
      lecturerId: batch.lecturerId,
      amountMinor: batch.totalAmount,
      currency: batch.currency,
      occurredAt: new Date(),
    });

    for (const entry of tx.entries) {
      const list = this.#ledgerEntriesStore.get(entry.accountId) ?? [];
      list.push(entry);
      this.#ledgerEntriesStore.set(entry.accountId, list);
    }

    const response = await input.payoutProvider.submitPayout({
      batchId: batch.batchId,
      lecturerId: batch.lecturerId,
      amountMinor: batch.totalAmount,
      currency: batch.currency,
      bankAccount: input.bankAccount,
    });

    const updated: LecturerPayoutBatch = {
      ...batch,
      status: response.status,
      providerPayoutId: response.providerPayoutId,
      ledgerRef: tx.transactionId,
      submittedAt: response.submittedAt,
    };

    this.#payoutsStore.set(input.batchId, updated);
    return updated;
  }

  /**
   * Reconciles payout with provider, handling status updates, discrepancy detection, and ledger reversals.
   */
  public async reconcilePayoutWithProvider(input: {
    batchId: string;
    payoutProvider: PayoutProvider;
  }): Promise<LecturerPayoutBatch> {
    const batch = this.#payoutsStore.get(input.batchId);
    if (!batch) throw new AppError("PAYOUT_NOT_FOUND", 404, "Payout batch not found");
    if (!batch.providerPayoutId) {
      throw new AppError("NOT_SUBMITTED", 422, "Payout has not been submitted to a provider");
    }

    const result = await input.payoutProvider.reconcilePayout(batch.providerPayoutId);

    // Case 1: Local PAID but Provider FAILED -> Critical Discrepancy
    if (batch.status === "PAID" && result.status === "FAILED") {
      const updated: LecturerPayoutBatch = {
        ...batch,
        status: "RECONCILIATION_REQUIRED",
        failureReason: `DISCREPANCY: Local status was PAID but provider reported FAILED (${result.failureReason ?? "EXTERNAL_ERROR"})`,
      };
      this.#payoutsStore.set(input.batchId, updated);
      return updated;
    }

    // Case 2: Local PROCESSING and Provider PAID -> Settle
    if (result.status === "PAID") {
      const updated: LecturerPayoutBatch = {
        ...batch,
        status: "PAID",
        settledAt: result.settledAt ?? new Date(),
      };
      this.#payoutsStore.set(input.batchId, updated);
      return updated;
    }

    // Case 3: Local PROCESSING/SUBMITTED and Provider FAILED -> Revert ledger
    if (result.status === "FAILED") {
      if (batch.status === "FAILED") {
        return batch; // Duplicate callback, already handled
      }
      if (result.failureReason === "PAYOUT_NOT_FOUND_AT_PROVIDER") {
        const updated: LecturerPayoutBatch = {
          ...batch,
          status: "RECONCILIATION_REQUIRED",
          failureReason: "Payout record missing at provider; flagged for manual review",
        };
        this.#payoutsStore.set(input.batchId, updated);
        return updated;
      }

      // Revert ledger transaction on bank rejection
      const reversalBucket = new Date().toISOString().slice(0, 10);
      const lecturerEntries = this.#ledgerEntriesStore.get(batch.lecturerId) ?? [];
      lecturerEntries.push({
        accountId: batch.lecturerId,
        bucket: reversalBucket,
        entryId: randomUUID(),
        entryType: "LECTURER_PAYOUT",
        direction: "CREDIT", // Re-credit lecturer payable
        amount: batch.totalAmount,
        currency: batch.currency,
        referenceType: "PAYOUT",
        referenceId: batch.batchId,
        description: `Reversal of failed payout batch ${batch.batchId}: ${result.failureReason ?? "PROVIDER_REJECTED"}`,
        createdAt: new Date(),
      });
      this.#ledgerEntriesStore.set(batch.lecturerId, lecturerEntries);

      const updated: LecturerPayoutBatch = {
        ...batch,
        status: "FAILED",
        failureReason: result.failureReason ?? "EXTERNAL_REJECTION",
      };
      this.#payoutsStore.set(input.batchId, updated);
      return updated;
    }

    return batch;
  }

  public getPayoutBatch(batchId: string): LecturerPayoutBatch | undefined {
    return this.#payoutsStore.get(batchId);
  }

  /**
   * Legacy helper to disburse and settle payout in one step (retained for backward compatibility).
   */
  public async generateLecturerPayout(input: {
    lecturerId: string;
    periodMonth: string;
    actor: ActorContext;
  }): Promise<LecturerPayoutBatch> {
    if (!input.actor.roles.includes("ADMIN")) {
      throw new AppError("ADMIN_REQUIRED", 403, "Only administrators can disburse lecturer payout batches");
    }

    const revenue = await this.getLecturerRevenue({
      lecturerId: input.lecturerId,
      periodMonth: input.periodMonth,
      actor: input.actor,
    });

    if (revenue.netEarnings <= 0) {
      throw new AppError("NO_PAYOUT_BALANCE", 422, "No positive net balance to disburse for this period");
    }

    const batchId = randomUUID();
    const now = new Date();

    const tx = this.#ledger.recordLecturerPayout({
      batchId,
      lecturerId: input.lecturerId,
      amountMinor: revenue.netEarnings,
      currency: revenue.currency,
      occurredAt: now,
    });

    for (const entry of tx.entries) {
      const list = this.#ledgerEntriesStore.get(entry.accountId) ?? [];
      list.push(entry);
      this.#ledgerEntriesStore.set(entry.accountId, list);
    }

    const batch: LecturerPayoutBatch = {
      batchId,
      lecturerId: input.lecturerId,
      periodMonth: input.periodMonth,
      totalAmount: revenue.netEarnings,
      currency: revenue.currency,
      status: "SETTLED",
      ledgerRef: tx.transactionId,
      createdAt: now,
      settledAt: now,
    };

    this.#payoutsStore.set(batchId, batch);
    return batch;
  }

  /**
   * Helper to manually feed a settled payment into the ledger store for testing/reconciliation.
   */
  public recordPayment(input: {
    orderId: string;
    courseId: string;
    studentId: string;
    lecturerId: string;
    amountMinor: number;
    currency: string;
    occurredAt?: Date;
    policy?: FinancePolicyConfig;
  }) {
    const tx = this.#ledger.recordPaymentSettlement(input);
    for (const entry of tx.entries) {
      const list = this.#ledgerEntriesStore.get(entry.accountId) ?? [];
      list.push(entry);
      this.#ledgerEntriesStore.set(entry.accountId, list);
    }
    return tx;
  }

  readonly #processedWebhooks: Map<string, { orderId: string; amount: number; currency: string }> = new Map();

  /**
   * Securely verifies incoming provider payment webhooks and detects payload collisions.
   */
  public async processPaymentWebhook(
    headers: Record<string, string | undefined>,
    rawBody: string | Buffer,
  ): Promise<PaymentWebhookResult> {
    const result = await this.#paymentProvider.verifyWebhook(headers, rawBody);
    if (!result.valid) {
      throw new AppError("INVALID_PAYMENT_WEBHOOK", 401, "Webhook signature verification failed");
    }

    const existing = this.#processedWebhooks.get(result.transactionId);
    if (existing) {
      if (
        existing.orderId !== result.orderId ||
        existing.amount !== result.amount ||
        existing.currency !== result.currency
      ) {
        console.warn(
          JSON.stringify({
            eventType: "APPSEC_AUDIT_PAYLOAD_COLLISION",
            severity: "HIGH",
            transactionId: result.transactionId,
            existingOrderId: existing.orderId,
            incomingOrderId: result.orderId,
            existingAmount: existing.amount,
            incomingAmount: result.amount,
            existingCurrency: existing.currency,
            incomingCurrency: result.currency,
          }),
        );
        throw new AppError(
          "PROVIDER_TRANSACTION_CONFLICT",
          409,
          `Transaction payload conflict detected for transaction ${result.transactionId}`,
        );
      }
      return result;
    }

    this.#processedWebhooks.set(result.transactionId, {
      orderId: result.orderId,
      amount: result.amount,
      currency: result.currency,
    });

    return result;
  }
}
