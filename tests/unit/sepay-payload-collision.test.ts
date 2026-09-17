import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { SepayRecoveryRepository } from "../../apps/learning-service/src/commerce/recovery-repository.js";
import { LearningCommerceService } from "../../apps/learning-service/src/commerce/service.js";
import { LearningFinanceService } from "../../apps/learning-service/src/finance/finance-service.js";
import { SepayPaymentProvider } from "../../apps/learning-service/src/finance/payment-provider.js";
import type { CassandraClient } from "../../packages/cassandra/src/index.js";
import type { LearningCommerceRepository } from "../../apps/learning-service/src/commerce/repository.js";
import type { CommerceClassroomClient } from "../../apps/learning-service/src/commerce/classroom-client.js";
import type { ClassroomOfferingContextClient } from "../../apps/learning-service/src/classroom-client.js";

describe("SePay webhook & payment payload collision detection (P0)", () => {
  it("SepayRecoveryRepository.ensure rejects colliding payload for identical transactionId with PROVIDER_TRANSACTION_CONFLICT", async () => {
    const transactionId = "TX-999888";
    const originalOrderId = randomUUID();
    const collidingOrderId = randomUUID();
    const now = new Date();

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Mock DB where ensure INSERT succeeds, then get returns existing candidate
    const execute = vi.fn().mockImplementation((query: string) => {
      if (typeof query === "string" && query.includes("SELECT")) {
        return Promise.resolve([
          {
            shard: 0,
            transaction_id: transactionId,
            order_id: originalOrderId,
            fingerprint: "orig-fp",
            recovery_mac: "orig-mac",
            received_at: now,
            paid_event_id: randomUUID(),
            correlation_id: randomUUID(),
            amount: 500000,
            state: "READY",
            next_attempt_at: now,
            lease_until: new Date(0),
            lease_fence: 0,
            retry_count: 0,
          },
        ]);
      }
      return Promise.resolve([{ "[applied]": false }]);
    });

    const repo = new SepayRecoveryRepository({ execute } as unknown as CassandraClient);

    // Call ensure with colliding amount (200000 vs 500000)
    await expect(
      repo.ensure({
        transactionId,
        orderId: originalOrderId,
        fingerprint: "tampered-fp",
        recoveryMac: "tampered-mac",
        receivedAt: now,
        paidEventId: randomUUID(),
        correlationId: randomUUID(),
        amount: 200000,
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_TRANSACTION_CONFLICT",
      status: 409,
    });

    // Call ensure with colliding orderId
    await expect(
      repo.ensure({
        transactionId,
        orderId: collidingOrderId,
        fingerprint: "tampered-fp",
        recoveryMac: "tampered-mac",
        receivedAt: now,
        paidEventId: randomUUID(),
        correlationId: randomUUID(),
        amount: 500000,
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_TRANSACTION_CONFLICT",
      status: 409,
    });

    // Verify AppSec audit log was emitted
    expect(warnSpy).toHaveBeenCalled();
    const warnCall = warnSpy.mock.calls.find((call) =>
      typeof call[0] === "string" && call[0].includes("APPSEC_AUDIT_PAYLOAD_COLLISION"),
    );
    expect(warnCall).toBeDefined();

    warnSpy.mockRestore();
  });

  it("LearningCommerceService.receiveSepay intercepts payload collision before processing", async () => {
    const transactionId = "TX-COLLIDE-01";
    const originalOrderId = randomUUID();
    const collidingOrderId = randomUUID();

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const mockRecovery = {
      get: vi.fn().mockResolvedValue({
        transactionId,
        orderId: originalOrderId,
        amount: 350000,
        state: "READY",
      }),
      ensure: vi.fn(),
    } as unknown as SepayRecoveryRepository;

    const mockRepo = {
      order: vi.fn().mockResolvedValue({
        orderId: collidingOrderId,
        currency: "VND",
        price: "350000",
        state: "PENDING",
        paidEventId: randomUUID(),
      }),
    } as unknown as LearningCommerceRepository;

    const service = new LearningCommerceService(
      mockRepo,
      {} as CommerceClassroomClient,
      {} as ClassroomOfferingContextClient,
      "test-secret-12345678901234567890",
      mockRecovery,
    );

    // Mock environment for sepayConfig
    const prevEnv = { ...process.env };
    process.env.PAYMENT_MODE = "sepay";
    process.env.SEPAY_WEBHOOK_API_KEY = "12345678901234567890123456789012";
    process.env.SEPAY_ACCOUNT_NUMBER = "123456";
    process.env.SEPAY_BANK = "MBBank";
    process.env.SEPAY_ACCOUNT_NAME = "AILSS";

    try {
      await expect(
        service.receiveSepay(
          {
            id: 12345,
            accountNumber: "123456",
            transferType: "in",
            transferAmount: 350000,
            content: `AILSS${collidingOrderId.replaceAll("-", "").toUpperCase()}`,
            code: null,
            referenceCode: "REF123",
          },
          randomUUID(),
        ),
      ).rejects.toMatchObject({
        code: "PROVIDER_TRANSACTION_CONFLICT",
        status: 409,
      });

      expect(warnSpy).toHaveBeenCalled();
    } finally {
      process.env = prevEnv;
      warnSpy.mockRestore();
    }
  });

  it("LearningFinanceService.processPaymentWebhook rejects colliding payload and accepts exact replay", async () => {
    const webhookSecret = "super-secret-sepay-key-32-chars!!";
    const provider = new SepayPaymentProvider(webhookSecret);
    const financeService = new LearningFinanceService({
      repository: {} as LearningCommerceRepository,
      paymentProvider: provider,
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const headers = { authorization: `Apikey ${webhookSecret}` };
    const initialPayload = JSON.stringify({
      id: "SEPAY-TX-1001",
      orderId: "ORDER-A1",
      transferAmount: 250000,
      currency: "VND",
      transactionDate: new Date().toISOString(),
    });

    // First attempt succeeds
    const firstResult = await financeService.processPaymentWebhook(headers, initialPayload);
    expect(firstResult.valid).toBe(true);
    expect(firstResult.orderId).toBe("ORDER-A1");
    expect(firstResult.amount).toBe(250000);

    // Exact identical replay succeeds
    const replayResult = await financeService.processPaymentWebhook(headers, initialPayload);
    expect(replayResult.valid).toBe(true);
    expect(replayResult.transactionId).toBe("SEPAY-TX-1001");

    // Colliding payload with changed amount
    const collidingAmountPayload = JSON.stringify({
      id: "SEPAY-TX-1001",
      orderId: "ORDER-A1",
      transferAmount: 999000,
      currency: "VND",
      transactionDate: new Date().toISOString(),
    });

    await expect(
      financeService.processPaymentWebhook(headers, collidingAmountPayload),
    ).rejects.toMatchObject({
      code: "PROVIDER_TRANSACTION_CONFLICT",
      status: 409,
    });

    // Colliding payload with changed orderId
    const collidingOrderPayload = JSON.stringify({
      id: "SEPAY-TX-1001",
      orderId: "ORDER-B2",
      transferAmount: 250000,
      currency: "VND",
      transactionDate: new Date().toISOString(),
    });

    await expect(
      financeService.processPaymentWebhook(headers, collidingOrderPayload),
    ).rejects.toMatchObject({
      code: "PROVIDER_TRANSACTION_CONFLICT",
      status: 409,
    });

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
