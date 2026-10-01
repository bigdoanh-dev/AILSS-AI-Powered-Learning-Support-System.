import { ApiError, record, string } from "./api";

export type OrderState = "PENDING" | "PAYMENT_FAILED" | "PAID_PENDING_ENTITLEMENT" | "ENTITLED";
export type PaymentMode = "simulation" | "sepay";

export interface Order {
  orderId: string;
  courseId: string;
  offeringId: string;
  offeringType: string;
  state: OrderState;
  fulfillmentState: string;
  price: string;
  currency: string;
  paymentMode: PaymentMode;
  payment?: {
    bank: string;
    accountNumber: string;
    accountName: string;
    content: string;
    qrUrl: string;
  };
}

export function order(value: unknown): Order {
  const item = record(value);
  const state = string(item.state);
  const paymentMode = string(item.paymentMode);
  if (!["PENDING", "PAYMENT_FAILED", "PAID_PENDING_ENTITLEMENT", "ENTITLED"].includes(state))
    throw new ApiError("invalid");
  if (paymentMode !== "simulation" && paymentMode !== "sepay") throw new ApiError("invalid");
  const payment = item.payment == null ? undefined : record(item.payment);
  const result: Order = {
    orderId: string(item.orderId),
    courseId: string(item.courseId),
    offeringId: string(item.offeringId),
    offeringType: string(item.offeringType),
    state: state as OrderState,
    fulfillmentState: string(item.fulfillmentState),
    price: string(item.price),
    currency: string(item.currency),
    paymentMode,
  };
  if (payment) {
    const qrUrl = string(payment.qrUrl);
    let url: URL;
    try {
      url = new URL(qrUrl);
    } catch {
      throw new ApiError("invalid");
    }
    if (url.protocol !== "https:" || url.hostname !== "qr.sepay.vn") throw new ApiError("invalid");
    result.payment = {
      bank: string(payment.bank),
      accountNumber: string(payment.accountNumber),
      accountName: string(payment.accountName),
      content: string(payment.content),
      qrUrl,
    };
  }
  return result;
}

export function isOrderPending(value: Order): boolean {
  return (
    (value.state === "PENDING" || value.state === "PAID_PENDING_ENTITLEMENT") &&
    value.fulfillmentState !== "REFUND_REQUIRED"
  );
}
