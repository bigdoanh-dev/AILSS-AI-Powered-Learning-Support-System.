import { describe, expect, it } from "vitest";
import { isOrderPending, order } from "../src/commerce";

const pending = {
  orderId: "11111111-1111-4111-8111-111111111111",
  courseId: "22222222-2222-4222-8222-222222222222",
  offeringId: "33333333-3333-4333-8333-333333333333",
  offeringType: "SELF_PACED",
  state: "PENDING",
  fulfillmentState: "NOT_STARTED",
  price: "490000",
  currency: "VND",
  paymentMode: "sepay",
  payment: {
    bank: "MBBank",
    accountNumber: "123456",
    accountName: "AILSS",
    content: "AILSS11111111111141118111111111111111",
    qrUrl: "https://qr.sepay.vn/img?acc=123456",
  },
};

describe("mobile checkout order", () => {
  it("uses the authoritative payment details and tracks pending state", () => {
    const result = order(pending);
    expect(result.payment?.content).toBe(pending.payment.content);
    expect(isOrderPending(result)).toBe(true);
    expect(isOrderPending(order({ ...pending, state: "ENTITLED" }))).toBe(false);
  });

  it("rejects unsafe QR URLs and invalid order states", () => {
    expect(() =>
      order({ ...pending, payment: { ...pending.payment, qrUrl: "http://qr.sepay.vn/img" } }),
    ).toThrow();
    expect(() =>
      order({ ...pending, payment: { ...pending.payment, qrUrl: "https://evil.example/img" } }),
    ).toThrow();
    expect(() => order({ ...pending, state: "PAID" })).toThrow();
  });
});
