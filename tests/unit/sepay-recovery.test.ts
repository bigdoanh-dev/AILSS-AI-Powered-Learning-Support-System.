import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import {
  SepayRecoveryRepository,
  recoveryShard,
  type RecoveryCandidate,
} from "../../apps/learning-service/src/commerce/recovery-repository.js";
import { SepayRecoveryRunner } from "../../apps/learning-service/src/commerce/recovery-runner.js";
import type { CassandraClient } from "../../packages/cassandra/src/index.js";

it("does not claim when durable candidate insertion fails", async () => {
  const execute = vi.fn().mockRejectedValue(new Error("database unavailable"));
  const repo = new SepayRecoveryRepository({ execute } as unknown as CassandraClient);
  await expect(
    repo.ensure({
      transactionId: "123",
      orderId: randomUUID(),
      fingerprint: "accepted",
      recoveryMac: "accepted-mac",
      receivedAt: new Date(),
      paidEventId: randomUUID(),
      correlationId: randomUUID(),
      amount: 1000,
    }),
  ).rejects.toMatchObject({ code: "PAYMENT_UNAVAILABLE", status: 503, retryable: true });
  expect(execute).toHaveBeenCalledTimes(1);
});
it("uses stable exact shards and bounded keyset pages without day cutoff", async () => {
  const execute = vi.fn().mockResolvedValue([]);
  const repo = new SepayRecoveryRepository({ execute } as unknown as CassandraClient);
  expect(recoveryShard("123")).toBe(recoveryShard("123"));
  for (let i = 0; i < 100; i++) expect(recoveryShard(String(i))).toBeLessThan(16);
  await repo.page(3, "old-transaction");
  expect(execute.mock.calls[0]?.[0]).toContain("WHERE shard=? AND transaction_id>? LIMIT 25");
  expect(execute.mock.calls[0]?.[1]).toEqual([3, "old-transaction"]);
});
it("fences lease takeover and cleanup with canonical lease identity", async () => {
  const execute = vi.fn().mockResolvedValue([{ "[applied]": true }]);
  const repo = new SepayRecoveryRepository({ execute } as unknown as CassandraClient);
  const now = new Date();
  const row = {
    transactionId: "123",
    state: "RUNNING",
    nextAttemptAt: new Date(0),
    leaseUntil: new Date(0),
    leaseFence: 7,
    retryCount: 0,
  } as RecoveryCandidate;
  expect(await repo.claim(row, "worker", now)).toBe(true);
  expect(execute.mock.calls[0]?.[0]).toContain("IF state=? AND lease_fence=? AND lease_until=?");
  expect(execute.mock.calls[0]?.slice(-2)).toEqual(["LOCAL_QUORUM", "LOCAL_SERIAL"]);
  await repo.finish(row, "worker", now, "COMPLETE");
  expect(execute.mock.calls[1]?.[0]).toContain("IF lease_owner=? AND lease_fence=?");
  expect(String(execute.mock.calls[1]?.[1][3])).toBe("8");
});
it("traverses >50 old candidates and all shards despite leased/manual work", async () => {
  const seen: string[] = [];
  const old = new Date("2020-01-01T00:00:00Z");
  const rows = Array.from({ length: 60 }, (_, i) => ({
    transactionId: String(i).padStart(3, "0"),
    receivedAt: old,
    state: i === 0 ? "MANUAL_REVIEW" : "READY",
    leaseUntil: i === 1 ? new Date("2099-01-01") : old,
    nextAttemptAt: old,
    leaseFence: 0,
    retryCount: 0,
    orderId: randomUUID(),
    paidEventId: randomUUID(),
    correlationId: randomUUID(),
    fingerprint: "accepted",
    recoveryMac: "accepted-mac",
    amount: 1000,
  }));
  const page = vi.fn(async (shard: number, after?: string) =>
    shard === 0 ? rows.filter((r) => !after || r.transactionId > after).slice(0, 25) : [],
  );
  const claim = vi.fn(
    async (r: RecoveryCandidate) => r.state !== "MANUAL_REVIEW" && r.leaseUntil < new Date(),
  );
  const finish = vi.fn();
  const commerce = {
    resumeSepay: vi.fn(async (r: RecoveryCandidate) => {
      seen.push(r.transactionId);
      return { state: "ENTITLED", paidAt: old };
    }),
    fulfill: vi.fn(),
  };
  const runner = new SepayRecoveryRunner(
    { page, claim, finish } as unknown as ConstructorParameters<typeof SepayRecoveryRunner>[0],
    commerce as unknown as ConstructorParameters<typeof SepayRecoveryRunner>[1],
    { paymentPublished: vi.fn().mockResolvedValue(true) } as unknown as ConstructorParameters<
      typeof SepayRecoveryRunner
    >[2],
    {} as ConstructorParameters<typeof SepayRecoveryRunner>[3],
    { warn: vi.fn() } as unknown as ConstructorParameters<typeof SepayRecoveryRunner>[4],
  );
  for (let i = 0; i < 24; i++) await runner.tick();
  expect(new Set(page.mock.calls.map((c) => c[0])).size).toBe(16);
  expect(seen).toContain("059");
  expect(seen).not.toContain("000");
  expect(seen).not.toContain("001");
  expect(page.mock.calls.some((c) => c[1] === "024")).toBe(true);
  expect(finish.mock.calls.every((c) => c[3] === "COMPLETE")).toBe(true);
});
