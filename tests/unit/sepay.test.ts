import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticateSepay,
  paymentContent,
  paymentOrderId,
  sepaySchema,
} from "../../apps/learning-service/src/commerce/sepay.js";
import { LearningCommerceService } from "../../apps/learning-service/src/commerce/service.js";
import type { LearningCommerceRepository } from "../../apps/learning-service/src/commerce/repository.js";
import type { CommerceClassroomClient } from "../../apps/learning-service/src/commerce/classroom-client.js";
import type { ClassroomOfferingContextClient } from "../../apps/learning-service/src/classroom-client.js";
const id = "00000000-0000-4000-8000-000000000001";
const transaction = {
  id: 123,
  transferType: "in" as const,
  accountNumber: "123456",
  transferAmount: 490000,
  content: paymentContent(id),
};
beforeEach(() => {
  vi.stubEnv("SEPAY_WEBHOOK_API_KEY", "a".repeat(32));
  vi.stubEnv("SEPAY_ACCOUNT_NUMBER", "123456");
  vi.stubEnv("SEPAY_BANK", "MB");
  vi.stubEnv("SEPAY_ACCOUNT_NAME", "AILSS");
});
afterEach(() => vi.unstubAllEnvs());
function setup() {
  const order = {
    orderId: id,
    price: "490000.00",
    currency: "VND",
    state: "PENDING",
    version: 1,
    paidEventId: id,
    studentId: id,
    courseId: id,
    offeringId: id,
    paidAt: undefined as Date | undefined,
  };
  let receipt: { transactionId: string; receivedAt: Date } | undefined;
  const repo = {
    order: vi.fn(async () => ({ ...order })),
    claimSepayTransaction: vi.fn(
      async (txn: string) => (receipt ??= { transactionId: txn, receivedAt: new Date() }),
    ),
    prepareEvent: vi.fn(async () => {}),
    transitionPayment: vi.fn(async (_: unknown, _success: boolean, at: Date) => {
      order.state = "PAID_PENDING_ENTITLEMENT";
      order.paidAt = at;
      return true;
    }),
    readyEvent: vi.fn(async () => {}),
  };
  const service = new LearningCommerceService(
    repo as unknown as LearningCommerceRepository,
    {} as CommerceClassroomClient,
    {} as ClassroomOfferingContextClient,
    "test",
  );
  return { order, repo, service };
}
describe("SePay settlement", () => {
  it("requires configured API key and exact credentials", () => {
    expect(() => authenticateSepay(undefined)).toThrow();
    expect(() => authenticateSepay(`Bearer ${"a".repeat(32)}`)).toThrow();
    expect(() => authenticateSepay(`Apikey ${"b".repeat(32)}`)).toThrow();
    expect(() => authenticateSepay(`Apikey ${"a".repeat(32)}`)).not.toThrow();
    vi.stubEnv("SEPAY_WEBHOOK_API_KEY", "");
    expect(() => authenticateSepay("")).toThrow();
  });
  it("extracts one exact order token, rejecting ambiguity and substrings", () => {
    expect(paymentOrderId(`Chuyen tien ${paymentContent(id)} cam on`)).toBe(id);
    expect(paymentOrderId(`X${paymentContent(id)}`)).toBeUndefined();
    expect(paymentOrderId(`${paymentContent(id)}A`)).toBeUndefined();
    expect(paymentOrderId(`${paymentContent(id)} ${paymentContent(id)}`)).toBeUndefined();
  });
  it("rejects malformed and non-integer transfer amounts", () => {
    for (const amount of [-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1, "490000"])
      expect(sepaySchema.safeParse({ ...transaction, transferAmount: amount }).success).toBe(false);
  });
  it("does not mutate orders for outgoing or unrelated transfers", async () => {
    const { service, repo } = setup();
    for (const txn of [
      { ...transaction, transferType: "out" as const },
      { ...transaction, accountNumber: "other" },
      { ...transaction, content: "unrelated" },
    ])
      expect(await service.receiveSepay(txn, id)).toEqual({ success: true, processed: false });
    expect(repo.transitionPayment).not.toHaveBeenCalled();
  });
  it("rejects incorrect amount, currency and terminal failed orders", async () => {
    const { service, order, repo } = setup();
    await expect(service.receiveSepay({ ...transaction, transferAmount: 490001 }, id)).rejects.toThrow();
    order.currency = "USD";
    await expect(service.receiveSepay(transaction, id)).rejects.toThrow();
    order.currency = "VND";
    order.state = "PAYMENT_FAILED";
    await expect(service.receiveSepay(transaction, id)).rejects.toThrow();
    expect(repo.transitionPayment).not.toHaveBeenCalled();
  });
  it("settles once and recovers event publication on retry after a crash", async () => {
    const { service, repo } = setup();
    repo.readyEvent.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(service.receiveSepay(transaction, id)).rejects.toThrow();
    expect(await service.receiveSepay(transaction, id)).toEqual({ success: true, processed: true });
    expect(repo.transitionPayment).toHaveBeenCalledTimes(1);
    expect(repo.prepareEvent).toHaveBeenCalledTimes(1);
    expect(repo.readyEvent.mock.calls[0]).toEqual(repo.readyEvent.mock.calls[1]);
  });
  it("flags a second transfer for the same order for manual review", async () => {
    const { service, repo } = setup();
    await service.receiveSepay(transaction, id);
    await expect(service.receiveSepay({ ...transaction, id: 124 }, id)).rejects.toThrow(
      "Additional transfer",
    );
    expect(repo.transitionPayment).toHaveBeenCalledTimes(1);
  });
});

import express from "express";
import { learningCommerceRouter } from "../../apps/learning-service/src/commerce/router.js";
import { errorMiddleware, requestContextMiddleware } from "../../packages/http/src/index.js";
it("HTTP webhook rejects unauthenticated or malformed input and acknowledges valid receipt", async () => {
  const { service, repo } = setup();
  const verify = async () => {
    throw new Error("User authentication must not be used by webhook");
  };
  const app = express();
  app.use(requestContextMiddleware(), express.json());
  app.use(
    learningCommerceRouter(service, {
      enroll: verify,
      myCourses: verify,
      roster: verify,
      orderCreate: verify,
      orderRead: verify,
      payment: verify,
    }),
  );
  app.use(errorMiddleware);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing listener");
  const url = `http://127.0.0.1:${String(address.port)}/api/v1/payments/sepay/webhook`;
  try {
    const post = (body: unknown, authorization = "") =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization },
        body: JSON.stringify(body),
      });
    expect((await post(transaction)).status).toBe(401);
    expect(repo.transitionPayment).not.toHaveBeenCalled();
    expect(
      (await post({ ...transaction, transferAmount: "490000" }, `Apikey ${"a".repeat(32)}`)).status,
    ).toBe(422);
    const response = await post(transaction, `Apikey ${"a".repeat(32)}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, processed: true });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
