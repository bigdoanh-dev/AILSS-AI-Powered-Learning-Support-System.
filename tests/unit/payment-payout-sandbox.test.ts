import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SepayPaymentProvider } from "../../apps/learning-service/src/finance/payment-provider.js";
import {
  InMemoryPayoutIdempotencyStore,
  ProductionPayoutProvider,
} from "../../apps/learning-service/src/finance/payout-provider.js";

describe("Phase 23H & 23I: Real Payment (SePay) & Payout Provider Sandboxes", () => {
  const sepaySecret = "super-secret-sepay-key-32chars!";
  const paymentProvider = new SepayPaymentProvider(sepaySecret);

  describe("SepayPaymentProvider: Webhook Sandbox Invariants", () => {
    const validHeaders = { authorization: `Apikey ${sepaySecret}` };

    it("accepts well-formed VND transaction webhook with valid signature", async () => {
      const orderId = randomUUID();
      const payload = JSON.stringify({
        id: "TX-SEPAY-101",
        orderId,
        transferAmount: 250000,
        currency: "VND",
        transactionDate: new Date().toISOString(),
      });

      const result = await paymentProvider.verifyWebhook(validHeaders, payload);
      expect(result.valid).toBe(true);
      expect(result.eventType).toBe("PAYMENT_SUCCEEDED");
      expect(result.orderId).toBe(orderId);
      expect(result.amount).toBe(250000);
      expect(result.currency).toBe("VND");
    });

    it("rejects zero or negative payment amounts", async () => {
      const payloadZero = JSON.stringify({
        id: "TX-ZERO",
        orderId: randomUUID(),
        transferAmount: 0,
        currency: "VND",
      });
      const resultZero = await paymentProvider.verifyWebhook(validHeaders, payloadZero);
      expect(resultZero.valid).toBe(false);
      expect(resultZero.eventType).toBe("PAYMENT_FAILED");

      const payloadNegative = JSON.stringify({
        id: "TX-NEG",
        orderId: randomUUID(),
        transferAmount: -50000,
        currency: "VND",
      });
      const resultNeg = await paymentProvider.verifyWebhook(validHeaders, payloadNegative);
      expect(resultNeg.valid).toBe(false);
      expect(resultNeg.eventType).toBe("PAYMENT_FAILED");
    });

    it("rejects wrong or unsupported currencies (e.g. USD when VND is expected)", async () => {
      const payloadUsd = JSON.stringify({
        id: "TX-USD",
        orderId: randomUUID(),
        transferAmount: 100,
        currency: "USD",
      });
      const result = await paymentProvider.verifyWebhook(validHeaders, payloadUsd);
      expect(result.valid).toBe(false);
      expect(result.eventType).toBe("PAYMENT_FAILED");
    });

    it("rejects callbacks missing required orderId", async () => {
      const payloadNoOrder = JSON.stringify({
        id: "TX-NO-ORDER",
        transferAmount: 100000,
        currency: "VND",
      });
      const result = await paymentProvider.verifyWebhook(validHeaders, payloadNoOrder);
      expect(result.valid).toBe(false);
      expect(result.eventType).toBe("PAYMENT_FAILED");
    });
  });

  describe("ProductionPayoutProvider: Payout Submission & Webhook Reconciliation", () => {
    const payoutSecret = "payout-hmac-secret-key-prod!!";
    const idempotencyStore = new InMemoryPayoutIdempotencyStore();
    const payoutProvider = new ProductionPayoutProvider({
      apiKey: "test-api-key",
      secretKey: payoutSecret,
      idempotencyStore,
    });

    it("guarantees payout submission idempotency — replayed request returns identical payout record", async () => {
      const batchId = `batch-${Date.now().toString()}`;
      const lecturerId = randomUUID();

      const req = {
        batchId,
        lecturerId,
        amountMinor: 5000000,
        currency: "VND",
      };

      // 1. Initial submission
      const firstSubmission = await payoutProvider.submitPayout(req);
      expect(firstSubmission.status).toBe("PROCESSING");
      expect(firstSubmission.providerPayoutId).toMatch(/^pout_prod_/u);

      // 2. Replay submission
      const replayedSubmission = await payoutProvider.submitPayout(req);
      expect(replayedSubmission.providerPayoutId).toBe(firstSubmission.providerPayoutId);
      expect(replayedSubmission.status).toBe(firstSubmission.status);
    });

    it("verifies webhook HMAC signature and reconciles settlement status", async () => {
      const providerPayoutId = "pout_prod_mock123";
      const payload = {
        providerPayoutId,
        batchId: "batch-1",
        status: "PAID",
      };

      const validSig = createHmac("sha256", payoutSecret).update(JSON.stringify(payload)).digest("hex");

      const reconciled = await payoutProvider.verifyWebhook(payload, validSig);
      expect(reconciled.providerPayoutId).toBe(providerPayoutId);
      expect(reconciled.status).toBe("PAID");
      expect(reconciled.settledAt).toBeInstanceOf(Date);
    });

    it("rejects payout webhook with invalid signature", async () => {
      const payload = { providerPayoutId: "pout_1", status: "PAID" };
      await expect(payoutProvider.verifyWebhook(payload, "invalid-bad-signature")).rejects.toMatchObject({
        code: "INVALID_PAYOUT_WEBHOOK_SIGNATURE",
      });
    });
  });
});
