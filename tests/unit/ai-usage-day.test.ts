import { expect, it, vi } from "vitest";
import { aiUsageDay, aiUsageResetsAt } from "../../packages/contracts/src/ai-usage-day.js";
import { AiQuizRepository } from "../../apps/ai-service/src/quiz/repository.js";
import type { CassandraClient } from "../../packages/cassandra/src/index.js";
const owner = "11111111-1111-4111-8111-111111111111";
it.each([
  ["2026-09-14T16:59:59.999Z", "2026-09-14", "2026-09-14T17:00:00.000Z"],
  ["2026-09-14T17:00:00.000Z", "2026-09-15", "2026-09-15T17:00:00.000Z"],
  ["2026-12-31T17:00:00.000Z", "2027-01-01", "2027-01-01T17:00:00.000Z"],
])("uses Vietnam midnight for %s", (instant, day, reset) => {
  expect(aiUsageDay(new Date(instant))).toBe(day);
  expect(aiUsageResetsAt(new Date(instant))).toBe(reset);
});
it("reads real counters from the correct partition and selects a fresh day without deleting history", async () => {
  const execute = vi
    .fn()
    .mockResolvedValueOnce([{ quota_limit: 200, reserved: 4, consumed: 10, updated_at: new Date() }])
    .mockResolvedValueOnce([]);
  const repo = new AiQuizRepository({ execute } as unknown as CassandraClient);
  expect(await repo.quota(owner, new Date("2026-09-14T16:59:59Z"))).toMatchObject({
    day: "2026-09-14",
    remaining: 186,
    reserved: 4,
    consumed: 10,
  });
  expect(await repo.quota(owner, new Date("2026-09-14T17:00:00Z"))).toMatchObject({
    day: "2026-09-15",
    consumed: 0,
    reserved: 0,
    timeZone: "Asia/Ho_Chi_Minh",
  });
  expect(execute.mock.calls.map((call) => String((call[1] as unknown[])[1]))).toEqual([
    "2026-09-14",
    "2026-09-15",
  ]);
  expect(execute.mock.calls.every((call) => String(call[0]).startsWith("SELECT"))).toBe(true);
});
it("reserves new requests against the same Vietnam day used by usage reads", async () => {
  const execute = vi
    .fn()
    .mockImplementation((query: string) =>
      Promise.resolve(
        query.startsWith("SELECT quota_limit")
          ? [{ quota_limit: 200, reserved: 0, consumed: 0, version: 0 }]
          : [{ "[applied]": true }],
      ),
    );
  const repo = new AiQuizRepository({ execute } as unknown as CassandraClient);
  expect(await repo.reserveQuota(owner, owner, 10, 200, new Date("2026-09-14T17:00:00Z"))).toBe(true);
  expect(String((execute.mock.calls[0]?.[1] as unknown[])[2])).toBe("2026-09-15");
  expect(String((execute.mock.calls[1]?.[1] as unknown[])[1])).toBe("2026-09-15");
});
