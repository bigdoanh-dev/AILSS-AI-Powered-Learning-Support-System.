import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decimalIsZero,
  defaultOfferingId,
  deterministicUuid,
  fulfillmentStates,
  orderCreateSchema,
  orderStates,
  paymentSchema,
} from "../../apps/learning-service/src/commerce/model.js";

describe("P7.17 Learning commerce contract", () => {
  it("locks strict Order and simulated-payment DTOs", () => {
    const offeringId = randomUUID();
    expect(orderCreateSchema.parse({ offeringId })).toEqual({ offeringId });
    expect(paymentSchema.parse({ outcome: "SUCCESS" })).toEqual({ outcome: "SUCCESS" });
    expect(() => orderCreateSchema.parse({ offeringId, price: "0" })).toThrow();
    expect(() => paymentSchema.parse({ outcome: "PAID" })).toThrow();
  });

  it("preserves canonical Order and separate fulfillment vocabularies", () => {
    expect(orderStates).toEqual(["PENDING", "PAYMENT_FAILED", "PAID_PENDING_ENTITLEMENT", "ENTITLED"]);
    expect(fulfillmentStates).toEqual(["NOT_STARTED", "PENDING", "IN_PROGRESS", "ACTIVE", "REFUND_REQUIRED"]);
  });

  it("matches the P7.14 deterministic default Offering namespace", () => {
    expect(defaultOfferingId("00000000-0000-4000-8000-000000000001")).toBe(
      "ccb79003-4a17-5d2c-824a-64ea256c0bcf",
    );
  });

  it("derives stable namespaced saga identities", () => {
    const value = deterministicUuid("secret", "order-enrollment", "order");
    expect(deterministicUuid("secret", "order-enrollment", "order")).toBe(value);
    expect(deterministicUuid("secret", "order-membership", "order")).not.toBe(value);
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  });

  it("compares FREE decimals without binary floating point", () => {
    expect(decimalIsZero("0")).toBe(true);
    expect(decimalIsZero("0.00")).toBe(true);
    expect(decimalIsZero("0.01")).toBe(false);
    expect(decimalIsZero("00")).toBe(false);
  });
});
