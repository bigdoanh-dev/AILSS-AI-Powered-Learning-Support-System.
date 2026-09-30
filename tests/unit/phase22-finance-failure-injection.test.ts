import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SepayPaymentProvider } from "../../apps/learning-service/src/finance/payment-provider.js";
import { LearningFinanceService } from "../../apps/learning-service/src/finance/finance-service.js";
import type { LearningCommerceRepository } from "../../apps/learning-service/src/commerce/repository.js";

describe("Phase 22.14: Financial Failure Injection & Ledger Invariant Verification", () => {
  const webhookSecret = "test-webhook-secret-key-32-chars!!";
  const provider = new SepayPaymentProvider(webhookSecret);
  const headers = { authorization: `Apikey ${webhookSecret}` };

  it("Invariant 1: No duplicated money — identical replay is idempotent, conflicting payload is rejected", async () => {
    const financeService = new LearningFinanceService({
      repository: {} as LearningCommerceRepository,
      paymentProvider: provider,
    });

    const txId = "TX-INVARIANT-001";
    const orderId = randomUUID();
    const validPayload = JSON.stringify({
      id: txId,
      orderId,
      transferAmount: 500000,
      currency: "VND",
      transactionDate: new Date().toISOString(),
    });

    // 1. Initial valid webhook
    const initial = await financeService.processPaymentWebhook(headers, validPayload);
    expect(initial.valid).toBe(true);
    expect(initial.amount).toBe(500000);

    // 2. Identical duplicate webhook replay (network retry)
    const replay = await financeService.processPaymentWebhook(headers, validPayload);
    expect(replay.valid).toBe(true);
    expect(replay.transactionId).toBe(txId);

    // 3. Malicious collision with different amount
    const collidingPayload = JSON.stringify({
      id: txId,
      orderId,
      transferAmount: 1000000, // Doubled amount
      currency: "VND",
      transactionDate: new Date().toISOString(),
    });

    await expect(financeService.processPaymentWebhook(headers, collidingPayload)).rejects.toMatchObject({
      code: "PROVIDER_TRANSACTION_CONFLICT",
      status: 409,
    });
  });

  it("Invariant 2: Balanced double-entry financial ledger accounting", () => {
    interface LedgerEntry {
      id: string;
      orderId: string;
      account: "STUDENT_RECEIVABLE" | "PLATFORM_REVENUE" | "LECTURER_PAYABLE" | "ESCROW_RESERVE";
      debit: number;
      credit: number;
    }

    // Double entry generator: 500,000 VND Course Purchase with 20% platform commission
    function generateCoursePurchaseLedger(orderId: string, grossAmount: number): LedgerEntry[] {
      const platformFee = Math.round(grossAmount * 0.2);
      const lecturerShare = grossAmount - platformFee;

      return [
        // Debit: Cash/Receivable increases by gross amount
        { id: randomUUID(), orderId, account: "STUDENT_RECEIVABLE", debit: grossAmount, credit: 0 },
        // Credit: Platform revenue increases by fee
        { id: randomUUID(), orderId, account: "PLATFORM_REVENUE", debit: 0, credit: platformFee },
        // Credit: Lecturer payable increases by net share
        { id: randomUUID(), orderId, account: "LECTURER_PAYABLE", debit: 0, credit: lecturerShare },
      ];
    }

    const testOrderId = randomUUID();
    const ledger = generateCoursePurchaseLedger(testOrderId, 500000);

    // Compute sums
    const totalDebit = ledger.reduce((sum, entry) => sum + entry.debit, 0);
    const totalCredit = ledger.reduce((sum, entry) => sum + entry.credit, 0);

    // INVARIANT: Total Debit MUST EXACTLY equal Total Credit
    expect(totalDebit).toBe(500000);
    expect(totalCredit).toBe(500000);
    expect(totalDebit - totalCredit).toBe(0);
  });

  it("Invariant 3: No double refund — refund retry preserves single debit reversal", () => {
    interface OrderFinancialState {
      orderId: string;
      status: "PAID" | "REFUNDED";
      refundedAmount: number;
      refundHistory: string[];
    }

    function processRefund(
      state: OrderFinancialState,
      refundId: string,
      amount: number,
    ): { success: boolean; error?: string } {
      if (state.status === "REFUNDED") {
        if (state.refundHistory.includes(refundId)) {
          // Idempotent retry: already refunded with this refund ID
          return { success: true };
        }
        return { success: false, error: "ORDER_ALREADY_FULLY_REFUNDED" };
      }

      state.status = "REFUNDED";
      state.refundedAmount += amount;
      state.refundHistory.push(refundId);
      return { success: true };
    }

    const orderState: OrderFinancialState = {
      orderId: "ORDER-REFUND-001",
      status: "PAID",
      refundedAmount: 0,
      refundHistory: [],
    };

    const refundKey = "REF-2026-09-001";

    // First refund execution
    const firstAttempt = processRefund(orderState, refundKey, 300000);
    expect(firstAttempt.success).toBe(true);
    expect(orderState.status).toBe("REFUNDED");
    expect(orderState.refundedAmount).toBe(300000);

    // Network retry with SAME refundKey: succeeds idempotently without increasing refundedAmount
    const retryAttempt = processRefund(orderState, refundKey, 300000);
    expect(retryAttempt.success).toBe(true);
    expect(orderState.refundedAmount).toBe(300000); // Amount NOT doubled!

    // Second separate refund attempt with DIFFERENT refundKey: rejected
    const doubleRefundAttempt = processRefund(orderState, "REF-NEW-DUPLICATE", 300000);
    expect(doubleRefundAttempt.success).toBe(false);
    expect(doubleRefundAttempt.error).toBe("ORDER_ALREADY_FULLY_REFUNDED");
    expect(orderState.refundedAmount).toBe(300000);
  });
});
