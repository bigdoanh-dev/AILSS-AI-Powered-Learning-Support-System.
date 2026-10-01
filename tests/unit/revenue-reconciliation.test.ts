import { describe, expect, it, vi } from "vitest";
import type { CassandraClient } from "../../packages/cassandra/src/index.js";
import { reconcileRevenueProjection } from "../../apps/learning-service/src/commerce/revenue-reconciliation.js";

const now = new Date("2026-10-01T12:00:00Z");
const old = new Date("2026-09-30T12:00:00Z");
const from = new Date("2026-10-01T00:00:00Z");
function fixture(control: unknown = { status: "READY", backfill_through: old, updated_at: old }) {
  const execute = vi.fn(async (query: string) => {
    if (query.startsWith("SELECT status,backfill_through")) return control ? [control] : [];
    if (query.includes(" IF ")) return [{ "[applied]": true }];
    return [];
  });
  const executePage = vi.fn(async () => ({ rows: [] }));
  return { execute, executePage, db: { execute, executePage } as unknown as CassandraClient };
}
describe("Revenue projection refresh across calendar days", () => {
  it("reconciles an initialized projection after month rollover before advancing its watermark", async () => {
    const f = fixture();
    await expect(reconcileRevenueProjection(f.db, { now, from })).resolves.toMatchObject({
      status: "READY",
      reconciledDays: 1,
    });
    const queries = f.execute.mock.calls.map(([query]) => query);
    expect(queries.filter((q) => q.startsWith("SELECT gross_minor"))).toHaveLength(16);
    expect(queries.filter((q) => q.startsWith("SELECT amount_minor"))).toHaveLength(16);
    expect(queries.findIndex((q) => q.includes("finance_reconciliation_by_day"))).toBeLessThan(
      queries.findIndex((q) => q.includes("SET status='READY'")),
    );
  });
  it("does not repeatedly rebuild a projection already current today", async () => {
    const f = fixture({ status: "READY", backfill_through: now, updated_at: now });
    await expect(reconcileRevenueProjection(f.db, { now })).resolves.toEqual({ status: "CURRENT" });
    expect(f.execute).toHaveBeenCalledTimes(1);
    expect(f.executePage).not.toHaveBeenCalled();
  });
  it("keeps first-time historical initialization an explicit operator action", async () => {
    const f = fixture(null);
    await expect(reconcileRevenueProjection(f.db, { now })).resolves.toEqual({ status: "UNINITIALIZED" });
    expect(f.executePage).not.toHaveBeenCalled();
  });
  it("does not run while another instance owns a recent backfill", async () => {
    const f = fixture({ status: "BACKFILLING", backfill_through: old, updated_at: now });
    await expect(reconcileRevenueProjection(f.db, { now })).resolves.toEqual({ status: "BUSY" });
    expect(f.executePage).not.toHaveBeenCalled();
  });
  it("does not mark incomplete data READY after a database failure", async () => {
    const f = fixture();
    f.executePage.mockRejectedValue(new Error("Database unavailable"));
    await expect(reconcileRevenueProjection(f.db, { now, from })).rejects.toThrow("Database unavailable");
    const queries = f.execute.mock.calls.map(([query]) => query);
    expect(queries.some((q) => q.includes("SET status='FAILED'"))).toBe(true);
    expect(queries.some((q) => q.includes("SET status='READY'"))).toBe(false);
  });
  it("uses existing payment guard coordinates and follows every source page without inserting a second shard", async () => {
    const f = fixture();
    const order = {
      order_id: "order-1",
      paid_event_id: "00000000-0000-4000-8000-00000000000f",
      paid_at: now,
      state: "ENTITLED",
      price_snapshot: "100000",
      currency: "VND",
      student_id: "student-1",
      course_id: "course-1",
      offering_id: "offering-1",
    };
    const legacyTime = new Date("2026-10-01T08:00:00Z");
    const execute = vi.fn(async (query: string, _params: readonly unknown[]) => {
      if (query.startsWith("SELECT bucket_day,shard,occurred_at"))
        return [{ bucket_day: "2026-10-01", shard: 3, occurred_at: legacyTime, order_id: "order-1" }];
      return f.execute(query);
    });
    const executePage = vi.fn(
      async (query: string, _params: unknown[], _consistency: string, _size: number, pageState?: string) => {
        if (!query.includes("FROM order_by_id")) return { rows: [] };
        return pageState ? { rows: [] } : { rows: [order], pageState: "next-page" };
      },
    );
    await reconcileRevenueProjection({ execute, executePage } as unknown as CassandraClient, { now, from });
    const fact = execute.mock.calls.find(([query]) =>
      query.includes("INSERT INTO revenue_payment_facts_by_day_shard"),
    );
    expect(fact?.[1].slice(0, 4)).toEqual(["2026-10-01", 3, legacyTime, "order-1"]);
    expect(executePage.mock.calls.some((call) => call[4] === "next-page")).toBe(true);
  });
});
