import { describe, expect, it } from "vitest";
import {
  DEFAULT_FINANCE_POLICY,
  FinancePolicyRegistry,
  platformFeeBasisPointsAt,
} from "../../apps/learning-service/src/finance/refund-policy.js";
import {
  FinancialLedger,
  PLATFORM_REVENUE_ACCOUNT_ID,
} from "../../apps/learning-service/src/finance/ledger.js";

describe("lecturer commission policy", () => {
  it("applies 15% to new sales while retaining 20% for earlier orders and refunds", () => {
    const oldOrder = new Date("2026-09-26T23:59:59Z");
    const newOrder = new Date("2026-09-27T00:00:00Z");
    expect(platformFeeBasisPointsAt(oldOrder)).toBe(2000);
    expect(platformFeeBasisPointsAt(newOrder)).toBe(1500);
    expect(DEFAULT_FINANCE_POLICY.platformFeeBasisPoints).toBe(1500);
    const registry = new FinancePolicyRegistry();
    expect(registry.getActiveVersion(oldOrder).policyVersion).toBe(1);
    expect(registry.getActiveVersion(newOrder).policyVersion).toBe(2);
    const ledger = new FinancialLedger();
    const base = {
      orderId: "11111111-1111-4111-8111-111111111111",
      courseId: "22222222-2222-4222-8222-222222222222",
      studentId: "33333333-3333-4333-8333-333333333333",
      lecturerId: "44444444-4444-4444-8444-444444444444",
      amountMinor: 100_000,
      currency: "VND",
    };
    const feeOf = (date: Date) =>
      ledger
        .recordPaymentSettlement({ ...base, occurredAt: date })
        .entries.find((entry) => entry.accountId === PLATFORM_REVENUE_ACCOUNT_ID)?.amount;
    expect(feeOf(oldOrder)).toBe(20_000);
    expect(feeOf(newOrder)).toBe(15_000);
  });
});
