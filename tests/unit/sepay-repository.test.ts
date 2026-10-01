import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { LearningCommerceRepository } from "../../apps/learning-service/src/commerce/repository.js";
import type { CassandraClient } from "../../packages/cassandra/src/index.js";

describe("SePay durable claim classification", () => {
  it("writes an idempotent payment fact guarded by the paid event", async () => {
    const orderId = randomUUID();
    const paidEventId = randomUUID();
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          order_id: orderId,
          bucket_day: "2026-09-10",
          shard: 3,
          occurred_at: new Date("2026-09-10T01:00:00Z"),
        },
      ])
      .mockResolvedValueOnce([]);
    const repo = new LearningCommerceRepository({ execute } as unknown as CassandraClient);

    await repo.ensureRevenuePaymentFact(
      {
        orderId,
        paidEventId,
        studentId: randomUUID(),
        courseId: randomUUID(),
        offeringId: randomUUID(),
        price: "490000",
        currency: "VND",
      } as never,
      "sepay-123",
      new Date("2026-09-22T01:00:00.000Z"),
    );

    expect(execute).toHaveBeenCalledTimes(3);
    expect(String(execute.mock.calls[0]?.[0])).toContain("IF NOT EXISTS");
    expect(String(execute.mock.calls[2]?.[0])).toContain("revenue_payment_facts_by_day_shard");
    const params = execute.mock.calls[2]?.[1] as unknown[];
    expect(String(params[0])).toBe("2026-09-10");
    expect(params[1]).toBe(3);
    expect(params[2]).toEqual(new Date("2026-09-10T01:00:00Z"));
  });

  it("aggregates only reconciled VND payment and refund facts", async () => {
    const now = new Date("2026-09-22T12:00:00.000Z");
    const orderId = randomUUID(),
      courseId = randomUUID(),
      lecturerId = randomUUID();
    const execute = vi.fn(async (query: string, params: unknown[]) => {
      if (query.includes("finance_projection_control"))
        return [
          { status: "READY", backfill_through: new Date("2026-09-22T13:00:00.000Z"), checksum: "sha256:ok" },
        ];
      if (query.includes("revenue_payment_facts"))
        return params[1] === 0
          ? [
              {
                gross_minor: "490000",
                currency: "VND",
                course_id: courseId,
                order_id: orderId,
                occurred_at: now,
              },
            ]
          : [];
      if (query.includes("revenue_refund_facts")) return [];
      if (query.includes("FROM course_by_id")) return [{ owner_lecturer_id: lecturerId, title: "Khóa học" }];
      if (query.includes("FROM order_by_id"))
        return [{ get: (name: string) => (name === "paid_at" ? now : undefined) }];
      if (query.includes("commission_policy_by_effective_at")) return [];
      return [];
    });
    const repo = new LearningCommerceRepository({ execute } as unknown as CassandraClient);

    await expect(repo.revenueDashboard("today", now)).resolves.toMatchObject({
      dataSource: "AUTHORITATIVE_PAYMENT_REFUND_PROJECTION",
      grossMinor: "490000",
      netMinor: "490000",
      orderCount: 1,
      completeness: { status: "READY", checksum: "sha256:ok" },
    });
  });

  it("fails closed while the authoritative revenue projection is unavailable", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const repo = new LearningCommerceRepository({ execute } as unknown as CassandraClient);

    await expect(repo.revenueDashboard("30d")).rejects.toMatchObject({
      code: "REVENUE_PROJECTION_NOT_READY",
      status: 503,
      retryable: true,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

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
