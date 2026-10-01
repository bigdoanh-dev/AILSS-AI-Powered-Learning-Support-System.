import { createHash } from "node:crypto";
import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";

const LQ = "LOCAL_QUORUM" as const;
const LS = "LOCAL_SERIAL" as const;
const day = (value: Date) => types.LocalDate.fromString(value.toISOString().slice(0, 10));
const shard = (id: unknown) => Number.parseInt(String(id).replaceAll("-", "").slice(-2), 16) % 16;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const timestamp = (value: unknown) => {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error("INVALID_FINANCE_DATE");
  return value;
};

/** Rebuild report projections only; never charges, refunds, or changes canonical orders. */
export async function reconcileRevenueProjection(
  db: CassandraClient,
  options: { force?: boolean; now?: Date; from?: Date } = {},
) {
  const now = timestamp(options.now ?? new Date());
  const start = timestamp(options.from ?? new Date(now.getTime() - 90 * 86_400_000));
  if (start.getTime() > now.getTime()) throw new Error("INVALID_FINANCE_BACKFILL_RANGE");
  const control = (
    await db.execute(
      "SELECT status,backfill_through,updated_at FROM finance_projection_control WHERE projection_name=?",
      ["REVENUE_V1"],
      LQ,
    )
  )[0];
  const through: unknown = control?.backfill_through;
  if (
    !options.force &&
    control?.status === "READY" &&
    through instanceof Date &&
    day(through).toString() >= day(now).toString()
  )
    return { status: "CURRENT" as const };
  // First-time historical initialization remains an explicit operator command.
  if (!options.force && !(through instanceof Date)) return { status: "UNINITIALIZED" as const };
  const updatedAt: unknown = control?.updated_at;
  if (
    control?.status === "BACKFILLING" &&
    updatedAt instanceof Date &&
    now.getTime() - updatedAt.getTime() < 30 * 60_000
  )
    return { status: "BUSY" as const };
  const claimed = control
    ? await db.execute(
        "UPDATE finance_projection_control SET status='BACKFILLING',updated_at=? WHERE projection_name=? IF status=? AND updated_at=?",
        [now, "REVENUE_V1", control.status, updatedAt ?? null],
        LQ,
        LS,
      )
    : await db.execute(
        "INSERT INTO finance_projection_control (projection_name,status,updated_at) VALUES (?,'BACKFILLING',?) IF NOT EXISTS",
        ["REVENUE_V1", now],
        LQ,
        LS,
      );
  if (claimed[0]?.["[applied]"] !== true) return { status: "BUSY" as const };

  async function eachPage(query: string, visit: (row: types.Row) => Promise<void>) {
    let pageState: string | undefined;
    do {
      const page = await db.executePage(query, [], LQ, 500, pageState);
      for (const row of page.rows) await visit(row);
      pageState = page.pageState;
    } while (pageState);
  }
  let payments = 0,
    refunds = 0;
  let earliest = day(start).toString();
  try {
    await eachPage(
      "SELECT order_id,student_id,course_id,offering_id,paid_event_id,price_snapshot,currency,state,paid_at FROM order_by_id",
      async (row) => {
        if (
          !row.paid_event_id ||
          !row.paid_at ||
          !["PAID_PENDING_ENTITLEMENT", "ENTITLED"].includes(String(row.state))
        )
          return;
        if (row.currency !== "VND") throw new Error("UNSUPPORTED_FINANCE_CURRENCY");
        const occurredAt = timestamp(row.paid_at);
        await db.execute(
          "INSERT INTO revenue_payment_fact_by_event (payment_event_id,bucket_day,shard,occurred_at,order_id) VALUES (?,?,?,?,?) IF NOT EXISTS",
          [row.paid_event_id, day(occurredAt), shard(row.paid_event_id), occurredAt, row.order_id],
          LQ,
          LS,
        );
        const guard = (
          await db.execute(
            "SELECT bucket_day,shard,occurred_at,order_id FROM revenue_payment_fact_by_event WHERE payment_event_id=?",
            [row.paid_event_id],
            LQ,
          )
        )[0];
        if (!guard || String(guard.order_id) !== String(row.order_id))
          throw new Error("FINANCE_PAYMENT_GUARD_CONFLICT");
        // Reuse the durable guard coordinates, including old backfills. A new
        // shard/time would create a second row for the same paid event.
        await db.execute(
          "INSERT INTO revenue_payment_facts_by_day_shard (bucket_day,shard,occurred_at,order_id,payment_event_id,provider_transaction_id,student_id,course_id,offering_id,gross_minor,currency) VALUES (?,?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS",
          [
            guard.bucket_day,
            guard.shard,
            guard.occurred_at,
            row.order_id,
            row.paid_event_id,
            null,
            row.student_id,
            row.course_id,
            row.offering_id,
            types.Long.fromString(String(row.price_snapshot)),
            row.currency,
          ],
          LQ,
          LS,
        );
        const bucketText = String(guard.bucket_day);
        if (bucketText < earliest) earliest = bucketText;
        payments += 1;
      },
    );
    await eachPage(
      "SELECT refund_id,order_id,course_id,amount,currency,status,requested_at,processed_at FROM course_refund_by_id",
      async (row) => {
        if (!row.refund_id || !row.requested_at) return;
        if (row.currency !== "VND") throw new Error("UNSUPPORTED_FINANCE_CURRENCY");
        const occurredAt = timestamp(row.processed_at ?? row.requested_at);
        await db.execute(
          "INSERT INTO revenue_refund_fact_by_id (refund_id,bucket_day,shard,occurred_at,order_id,status) VALUES (?,?,?,?,?,?) IF NOT EXISTS",
          [
            row.refund_id,
            day(timestamp(row.requested_at)),
            shard(row.refund_id),
            occurredAt,
            row.order_id,
            row.status,
          ],
          LQ,
          LS,
        );
        const guard = (
          await db.execute(
            "SELECT bucket_day,shard,occurred_at,order_id FROM revenue_refund_fact_by_id WHERE refund_id=?",
            [row.refund_id],
            LQ,
          )
        )[0];
        if (!guard || String(guard.order_id) !== String(row.order_id))
          throw new Error("FINANCE_REFUND_GUARD_CONFLICT");
        await db.execute(
          "INSERT INTO revenue_refund_facts_by_day_shard (bucket_day,shard,occurred_at,refund_id,order_id,provider_refund_id,course_id,amount_minor,currency,status) VALUES (?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS",
          [
            guard.bucket_day,
            guard.shard,
            guard.occurred_at,
            row.refund_id,
            row.order_id,
            null,
            row.course_id,
            row.amount,
            row.currency,
            row.status,
          ],
          LQ,
          LS,
        );
        if (row.status === "PROCESSED")
          await db.execute(
            "UPDATE revenue_refund_facts_by_day_shard SET status='PROCESSED' WHERE bucket_day=? AND shard=? AND occurred_at=? AND refund_id=?",
            [guard.bucket_day, guard.shard, guard.occurred_at, row.refund_id],
            LQ,
          );
        const bucketText = String(guard.bucket_day);
        if (bucketText < earliest) earliest = bucketText;
        refunds += 1;
      },
    );
    const daily: string[] = [];
    for (
      let cursor = new Date(`${earliest}T00:00:00Z`);
      cursor <= now;
      cursor = new Date(cursor.getTime() + 86_400_000)
    ) {
      const bucket = day(cursor);
      let paymentCount = 0n,
        refundCount = 0n,
        gross = 0n,
        refund = 0n;
      for (let index = 0; index < 16; index += 1) {
        const paid = await db.execute(
          "SELECT gross_minor,currency FROM revenue_payment_facts_by_day_shard WHERE bucket_day=? AND shard=?",
          [bucket, index],
          LQ,
        );
        const refunded = await db.execute(
          "SELECT amount_minor,currency,status FROM revenue_refund_facts_by_day_shard WHERE bucket_day=? AND shard=?",
          [bucket, index],
          LQ,
        );
        for (const row of paid) {
          if (row.currency !== "VND") throw new Error("UNSUPPORTED_FINANCE_CURRENCY");
          paymentCount += 1n;
          gross += BigInt(String(row.gross_minor));
        }
        for (const row of refunded) {
          if (row.currency !== "VND") throw new Error("UNSUPPORTED_FINANCE_CURRENCY");
          refundCount += 1n;
          if (row.status === "PROCESSED") refund += BigInt(String(row.amount_minor));
        }
      }
      const checksum = hash({
        paymentCount: String(paymentCount),
        refundCount: String(refundCount),
        gross: String(gross),
        refund: String(refund),
      });
      await db.execute(
        "INSERT INTO finance_reconciliation_by_day (bucket_day,payment_fact_count,refund_fact_count,gross_minor,refund_minor,currency,status,checksum,reconciled_at) VALUES (?,?,?,?,?,'VND','MATCHED',?,?)",
        [
          bucket,
          types.Long.fromString(String(paymentCount)),
          types.Long.fromString(String(refundCount)),
          types.Long.fromString(String(gross)),
          types.Long.fromString(String(refund)),
          checksum,
          now,
        ],
        LQ,
      );
      daily.push(checksum);
    }
    const completed = await db.execute(
      "UPDATE finance_projection_control SET status='READY',backfill_through=?,last_reconciled_at=?,checksum=?,updated_at=? WHERE projection_name=? IF status='BACKFILLING' AND updated_at=?",
      [now, now, hash({ payments, refunds, daily }), now, "REVENUE_V1", now],
      LQ,
      LS,
    );
    if (completed[0]?.["[applied]"] !== true) throw new Error("FINANCE_RECONCILIATION_LEASE_LOST");
    return { status: "READY" as const, payments, refunds, reconciledDays: daily.length };
  } catch (error) {
    await db.execute(
      "UPDATE finance_projection_control SET status='FAILED',updated_at=? WHERE projection_name=? IF status='BACKFILLING' AND updated_at=?",
      [now, "REVENUE_V1", now],
      LQ,
      LS,
    );
    throw error;
  }
}
