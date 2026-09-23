import { AppError } from "../../packages/http/src/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authenticateSepay,
  paymentMode,
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
  vi.stubEnv("PAYMENT_MODE", "sepay");
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
  const fingerprints = new Map<string, string>();
  const repo = {
    order: vi.fn(async () => ({ ...order })),
    claimSepayTransaction: vi.fn(async (txn: string, _order: string, fingerprint: string) => {
      if (fingerprints.has(txn) && fingerprints.get(txn) !== fingerprint)
        throw new Error("SEPAY_TRANSACTION_CONFLICT");
      fingerprints.set(txn, fingerprint);
      return (receipt ??= { transactionId: txn, receivedAt: new Date() });
    }),
    prepareEvent: vi.fn(async () => {}),
    ensureRevenuePaymentFact: vi.fn(async () => {}),
    transitionPayment: vi.fn(async (_: unknown, _success: boolean, at: Date) => {
      order.state = "PAID_PENDING_ENTITLEMENT";
      order.paidAt = at;
      return true;
    }),
    readyEvent: vi.fn(async () => {}),
  };
  const recovery = {
    ensure: vi.fn(
      async (
        candidate: Parameters<
          NonNullable<ConstructorParameters<typeof LearningCommerceService>[4]>["ensure"]
        >[0],
      ) => ({
        ...candidate,
        state: "READY",
        leaseFence: 0,
        retryCount: 0,
        nextAttemptAt: candidate.receivedAt,
        leaseUntil: new Date(0),
      }),
    ),
  };
  const service = new LearningCommerceService(
    repo as unknown as LearningCommerceRepository,
    {} as CommerceClassroomClient,
    {} as ClassroomOfferingContextClient,
    "test",
    recovery as unknown as NonNullable<ConstructorParameters<typeof LearningCommerceService>[4]>,
  );
  return { order, repo, service, recovery };
}
describe("SePay settlement", () => {
  it.each(["simulation", "sepay"])(
    "keeps historical fractional pricing behind the %s boundary",
    async (mode) => {
      vi.stubEnv("PAYMENT_MODE", mode);
      vi.stubEnv("NODE_ENV", "test");
      let command: Record<string, unknown>;
      let stored: unknown;
      const repo = {
        reserve: vi.fn(async (_scope, _hash, _key, operationId, resourceId, receipt) => {
          command = { operationId, resourceId, receipt, status: "PENDING" };
        }),
        command: vi.fn(async () => command),
        order: vi.fn(async () => stored),
        offering: vi.fn(async () => ({
          offeringId: id,
          courseId: id,
          offeringType: "SELF_PACED",
          state: "PUBLISHED",
          price: "120.50",
          currency: "VND",
        })),
        claimOrderRequest: vi.fn(
          async (_student: string, _hash: number, _key: string, orderId: string) => orderId,
        ),
        createOrder: vi.fn(async (order) => {
          stored = order;
        }),
        complete: vi.fn(async () => {}),
      };
      const service = new LearningCommerceService(
        repo as unknown as LearningCommerceRepository,
        {} as CommerceClassroomClient,
        {} as ClassroomOfferingContextClient,
        "test",
      );
      const result = service.createOrder({
        actor: {
          userId: id,
          roles: ["STUDENT"],
          sessionId: id,
          tokenVersion: 0,
          correlationId: id,
          issuedAt: 0,
          expiresAt: 60,
        },
        request: { offeringId: id },
        key: "currency-regression",
        correlationId: id,
      });
      if (mode === "simulation") {
        await expect(result).resolves.toMatchObject({
          order: { price: "120.50", currency: "VND", state: "PENDING" },
        });
        expect(repo.createOrder).toHaveBeenCalledOnce();
      } else {
        await expect(result).rejects.toMatchObject({ code: "PAYMENT_CURRENCY_UNSUPPORTED", status: 422 });
        expect(repo.createOrder).not.toHaveBeenCalled();
      }
    },
  );

  it("persists candidate before canonical claims and blocks claims on candidate failure", async () => {
    const { service, repo, recovery } = setup();
    await service.receiveSepay(transaction, id);
    expect(recovery.ensure.mock.invocationCallOrder[0]).toBeLessThan(
      repo.claimSepayTransaction.mock.invocationCallOrder[0] ?? Infinity,
    );
    const failed = setup();
    failed.recovery.ensure.mockRejectedValueOnce(
      new AppError("PAYMENT_UNAVAILABLE", 503, "Unavailable", true),
    );
    await expect(failed.service.receiveSepay(transaction, id)).rejects.toMatchObject({
      code: "PAYMENT_UNAVAILABLE",
      status: 503,
    });
    expect(failed.repo.claimSepayTransaction).not.toHaveBeenCalled();
    const invalid = setup();
    await expect(
      invalid.service.receiveSepay({ ...transaction, transferAmount: 1 }, id),
    ).rejects.toMatchObject({ status: 422 });
    expect(invalid.recovery.ensure).not.toHaveBeenCalled();
    const tampered = setup();
    tampered.recovery.ensure.mockImplementationOnce(async (candidate) => ({
      ...candidate,
      recoveryMac: "tampered",
      state: "READY",
      leaseFence: 0,
      retryCount: 0,
      nextAttemptAt: candidate.receivedAt,
      leaseUntil: new Date(0),
    }));
    await expect(tampered.service.receiveSepay(transaction, id)).rejects.toMatchObject({
      code: "PAYMENT_REQUIRES_REVIEW",
      status: 409,
    });
    expect(tampered.repo.claimSepayTransaction).not.toHaveBeenCalled();
  });

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
      await expect(service.receiveSepay(txn, id)).rejects.toThrow("Payment could not be accepted");
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
  it("rejects unknown orders with the same response as wrong amount", async () => {
    const { service, repo } = setup();
    repo.order.mockResolvedValueOnce(undefined as never);
    await expect(service.receiveSepay(transaction, id)).rejects.toThrow("Payment could not be accepted");
    expect(repo.claimSepayTransaction).not.toHaveBeenCalled();
  });
  it("rejects changed replay, tolerates delayed identical delivery and already-entitled replay", async () => {
    const { service, order, repo } = setup();
    await service.receiveSepay(transaction, id);
    await expect(service.receiveSepay({ ...transaction, referenceCode: "changed" }, id)).rejects.toThrow();
    order.state = "ENTITLED";
    await service.receiveSepay(transaction, id);
    await service.receiveSepay(transaction, id);
    expect(repo.transitionPayment).toHaveBeenCalledTimes(1);
    expect(repo.prepareEvent).toHaveBeenCalledTimes(1);
  });
  it("requires explicit mode and denies simulation on real deployments", () => {
    vi.stubEnv("PAYMENT_MODE", "");
    expect(paymentMode).toThrow();
    vi.stubEnv("PAYMENT_MODE", "simulation");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AILSS_PROFILE", "demo");
    expect(paymentMode).toThrow();
    vi.stubEnv("AILSS_PROFILE", "dev-async");
    expect(paymentMode).toThrow();
    vi.stubEnv("NODE_ENV", "development");
    expect(paymentMode()).toBe("simulation");
    expect(() => authenticateSepay(`Apikey ${"a".repeat(32)}`)).toThrow();
    vi.stubEnv("PAYMENT_MODE", "sepay");
    expect(paymentMode()).toBe("sepay");
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
  app.use(requestContextMiddleware(), express.json({ limit: "16kb" }));
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
      (await post({ ...transaction, content: "x".repeat(20000) }, `Apikey ${"a".repeat(32)}`)).status,
    ).toBe(413);
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

it("HTTP revenue dashboard propagates the retryable fail-closed response", async () => {
  const correlationId = "00000000-0000-4000-8000-000000000002";
  const revenueDashboard = vi.fn(async () => {
    throw new AppError(
      "REVENUE_PROJECTION_NOT_READY",
      503,
      "Revenue reporting is unavailable until the authoritative payment and refund projection is ready",
      true,
    );
  });
  const verify = async () => ({
    userId: id,
    roles: ["ADMIN"],
    sessionId: id,
    tokenVersion: 1,
    correlationId,
    issuedAt: 1,
    expiresAt: 2,
  });
  const app = express();
  app.use(requestContextMiddleware(), express.json({ limit: "16kb" }));
  app.use(
    learningCommerceRouter(
      { revenueDashboard } as unknown as LearningCommerceService,
      {
        enroll: verify,
        myCourses: verify,
        roster: verify,
        orderCreate: verify,
        orderRead: verify,
        payment: verify,
        dashboardRevenue: verify,
      },
    ),
  );
  app.use(errorMiddleware);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing listener");
  try {
    const response = await fetch(
      `http://127.0.0.1:${String(address.port)}/api/v1/admin/dashboard/revenue?range=30d`,
      { headers: { "x-actor-context": "signed", "x-correlation-id": correlationId } },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "REVENUE_PROJECTION_NOT_READY", retryable: true },
    });
    expect(revenueDashboard).toHaveBeenCalledTimes(1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
