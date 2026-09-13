import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { LearningCommerceRepository } from "../../apps/learning-service/src/commerce/repository.js";
import type { CassandraClient } from "../../packages/cassandra/src/index.js";

describe("SePay durable claim classification", () => {
  it("classifies changed replay without claiming a second Order payment", async () => {
    const orderId = randomUUID();
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ order_id: orderId, fingerprint: "original" }]);
    const repo = new LearningCommerceRepository({ execute } as unknown as CassandraClient);
    await expect(repo.claimSepayTransaction("1", orderId, "tampered", new Date())).rejects.toMatchObject({
      code: "PAYMENT_REPLAY_CONFLICT",
      status: 409,
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });
  it("treats an unavailable claim read as retryable persistence failure", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const repo = new LearningCommerceRepository({ execute } as unknown as CassandraClient);
    await expect(repo.claimSepayTransaction("1", randomUUID(), "same", new Date())).rejects.toMatchObject({
      code: "PAYMENT_UNAVAILABLE",
      status: 503,
    });
  });
  it("identical replay preserves the first payment timestamp and LWT consistency", async () => {
    const orderId = randomUUID(),
      received_at = new Date("2026-09-10T00:00:00Z");
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ order_id: orderId, fingerprint: "same" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ transaction_id: "1", received_at }]);
    const repo = new LearningCommerceRepository({ execute } as unknown as CassandraClient);
    expect(await repo.claimSepayTransaction("1", orderId, "same", new Date())).toEqual({
      transactionId: "1",
      receivedAt: received_at,
    });
    expect(execute.mock.calls[0]?.slice(-2)).toEqual(["LOCAL_QUORUM", "LOCAL_SERIAL"]);
    expect(execute.mock.calls[2]?.slice(-2)).toEqual(["LOCAL_QUORUM", "LOCAL_SERIAL"]);
  });
});
