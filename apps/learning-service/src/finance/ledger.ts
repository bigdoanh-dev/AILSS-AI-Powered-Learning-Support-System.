import { randomUUID } from "node:crypto";

export type LedgerEntryType =
  | "PAYMENT_SETTLED"
  | "PLATFORM_COMMISSION"
  | "LECTURER_REVENUE"
  | "STUDENT_REFUND"
  | "LECTURER_PAYOUT";

export type LedgerDirection = "DEBIT" | "CREDIT";

export interface LedgerEntry {
  readonly accountId: string;
  readonly bucket: string; // YYYY-MM-DD
  readonly entryId: string;
  readonly entryType: LedgerEntryType;
  readonly direction: LedgerDirection;
  readonly amount: number; // integer minor units (always positive)
  readonly currency: string;
  readonly referenceType: "ORDER" | "REFUND" | "PAYOUT";
  readonly referenceId: string;
  readonly description: string;
  readonly metadata?: Record<string, unknown>;
  readonly createdAt: Date;
}

export interface LedgerTransaction {
  readonly transactionId: string;
  readonly entries: readonly LedgerEntry[];
  readonly balanced: boolean;
}

// Standard platform account UUIDs
export const PLATFORM_CASH_ACCOUNT_ID = "00000000-0000-4000-8000-000000000001";
export const PLATFORM_REVENUE_ACCOUNT_ID = "00000000-0000-4000-8000-000000000002";

export function formatBucketDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

import { DEFAULT_FINANCE_POLICY, type FinancePolicyConfig } from "./refund-policy.js";

export class FinancialLedger {
  readonly #policy: FinancePolicyConfig;

  public constructor(policy?: FinancePolicyConfig) {
    this.#policy = policy ?? DEFAULT_FINANCE_POLICY;
  }

  public get policy(): FinancePolicyConfig {
    return this.#policy;
  }

  /**
   * Records a settled course payment.
   * Splits platform commission and lecturer payable using integer basis points.
   * Double-entry invariant: Debit(Cash) = Credit(Platform Revenue) + Credit(Lecturer Payable).
   */
  public recordPaymentSettlement(input: {
    orderId: string;
    courseId: string;
    studentId: string;
    lecturerId: string;
    amountMinor: number;
    currency: string;
    occurredAt?: Date;
    policy?: FinancePolicyConfig;
  }): LedgerTransaction {
    const occurredAt = input.occurredAt ?? new Date();
    const bucket = formatBucketDate(occurredAt);
    const txId = randomUUID();
    const activePolicy = input.policy ?? this.#policy;

    const platformCommission = Math.floor(
      (input.amountMinor * activePolicy.platformFeeBasisPoints) / 10000,
    );
    const lecturerShare = input.amountMinor - platformCommission;

    const entries: LedgerEntry[] = [
      // 1. Debit Cash (Asset increases)
      {
        accountId: PLATFORM_CASH_ACCOUNT_ID,
        bucket,
        entryId: randomUUID(),
        entryType: "PAYMENT_SETTLED",
        direction: "DEBIT",
        amount: input.amountMinor,
        currency: input.currency,
        referenceType: "ORDER",
        referenceId: input.orderId,
        description: `Payment collected for order ${input.orderId}`,
        metadata: { courseId: input.courseId, studentId: input.studentId },
        createdAt: occurredAt,
      },
      // 2. Credit Platform Revenue (Revenue increases)
      {
        accountId: PLATFORM_REVENUE_ACCOUNT_ID,
        bucket,
        entryId: randomUUID(),
        entryType: "PLATFORM_COMMISSION",
        direction: "CREDIT",
        amount: platformCommission,
        currency: input.currency,
        referenceType: "ORDER",
        referenceId: input.orderId,
        description: `Platform fee (20%) for order ${input.orderId}`,
        metadata: { courseId: input.courseId },
        createdAt: occurredAt,
      },
      // 3. Credit Lecturer Payable (Liability increases)
      {
        accountId: input.lecturerId,
        bucket,
        entryId: randomUUID(),
        entryType: "LECTURER_REVENUE",
        direction: "CREDIT",
        amount: lecturerShare,
        currency: input.currency,
        referenceType: "ORDER",
        referenceId: input.orderId,
        description: `Lecturer earnings (80%) for order ${input.orderId}`,
        metadata: { courseId: input.courseId, studentId: input.studentId },
        createdAt: occurredAt,
      },
    ];

    const balanced = this.verifyBalance(entries);
    return { transactionId: txId, entries, balanced };
  }

  /**
   * Records an approved course refund.
   * Reverses cash, platform fee, and lecturer payable.
   * Double-entry invariant: Credit(Cash) = Debit(Platform Revenue) + Debit(Lecturer Payable).
   */
  public recordRefundSettlement(input: {
    refundId: string;
    orderId: string;
    courseId: string;
    studentId: string;
    lecturerId: string;
    amountMinor: number;
    currency: string;
    occurredAt?: Date;
    policy?: FinancePolicyConfig;
  }): LedgerTransaction {
    const occurredAt = input.occurredAt ?? new Date();
    const bucket = formatBucketDate(occurredAt);
    const txId = randomUUID();
    const activePolicy = input.policy ?? this.#policy;

    const platformReversal = Math.floor(
      (input.amountMinor * activePolicy.platformFeeBasisPoints) / 10000,
    );
    const lecturerReversal = input.amountMinor - platformReversal;

    const entries: LedgerEntry[] = [
      // 1. Credit Cash (Asset decreases)
      {
        accountId: PLATFORM_CASH_ACCOUNT_ID,
        bucket,
        entryId: randomUUID(),
        entryType: "STUDENT_REFUND",
        direction: "CREDIT",
        amount: input.amountMinor,
        currency: input.currency,
        referenceType: "REFUND",
        referenceId: input.refundId,
        description: `Refund payout for order ${input.orderId}`,
        metadata: { courseId: input.courseId, studentId: input.studentId },
        createdAt: occurredAt,
      },
      // 2. Debit Platform Revenue (Revenue reduced)
      {
        accountId: PLATFORM_REVENUE_ACCOUNT_ID,
        bucket,
        entryId: randomUUID(),
        entryType: "PLATFORM_COMMISSION",
        direction: "DEBIT",
        amount: platformReversal,
        currency: input.currency,
        referenceType: "REFUND",
        referenceId: input.refundId,
        description: `Platform fee refund for order ${input.orderId}`,
        metadata: { courseId: input.courseId },
        createdAt: occurredAt,
      },
      // 3. Debit Lecturer Payable (Liability reduced)
      {
        accountId: input.lecturerId,
        bucket,
        entryId: randomUUID(),
        entryType: "LECTURER_REVENUE",
        direction: "DEBIT",
        amount: lecturerReversal,
        currency: input.currency,
        referenceType: "REFUND",
        referenceId: input.refundId,
        description: `Lecturer revenue reversal for refunded order ${input.orderId}`,
        metadata: { courseId: input.courseId, studentId: input.studentId },
        createdAt: occurredAt,
      },
    ];

    const balanced = this.verifyBalance(entries);
    return { transactionId: txId, entries, balanced };
  }

  /**
   * Records a lecturer payout settlement.
   * Debits Lecturer Payable, Credits Cash.
   */
  public recordLecturerPayout(input: {
    batchId: string;
    lecturerId: string;
    amountMinor: number;
    currency: string;
    occurredAt?: Date;
  }): LedgerTransaction {
    const occurredAt = input.occurredAt ?? new Date();
    const bucket = formatBucketDate(occurredAt);
    const txId = randomUUID();

    const entries: LedgerEntry[] = [
      {
        accountId: input.lecturerId,
        bucket,
        entryId: randomUUID(),
        entryType: "LECTURER_PAYOUT",
        direction: "DEBIT",
        amount: input.amountMinor,
        currency: input.currency,
        referenceType: "PAYOUT",
        referenceId: input.batchId,
        description: `Disbursed payout batch ${input.batchId}`,
        createdAt: occurredAt,
      },
      {
        accountId: PLATFORM_CASH_ACCOUNT_ID,
        bucket,
        entryId: randomUUID(),
        entryType: "LECTURER_PAYOUT",
        direction: "CREDIT",
        amount: input.amountMinor,
        currency: input.currency,
        referenceType: "PAYOUT",
        referenceId: input.batchId,
        description: `Bank transfer for payout batch ${input.batchId}`,
        createdAt: occurredAt,
      },
    ];

    const balanced = this.verifyBalance(entries);
    return { transactionId: txId, entries, balanced };
  }

  public verifyBalance(entries: readonly LedgerEntry[]): boolean {
    let totalDebit = 0;
    let totalCredit = 0;

    for (const e of entries) {
      if (e.direction === "DEBIT") {
        totalDebit += e.amount;
      } else {
        totalCredit += e.amount;
      }
    }

    return totalDebit === totalCredit;
  }
}
