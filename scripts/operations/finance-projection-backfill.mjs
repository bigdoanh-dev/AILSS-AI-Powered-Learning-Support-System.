import cassandra from "cassandra-driver";
import { createHash } from "node:crypto";

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const contactPoints = required("CASSANDRA_CONTACT_POINTS").split(",").map((v) => v.trim());
const client = new cassandra.Client({
  contactPoints,
  localDataCenter: required("CASSANDRA_LOCAL_DC"),
  keyspace: process.env.CASSANDRA_KEYSPACE || "learning_keyspace",
  authProvider: new cassandra.auth.PlainTextAuthProvider(
    required("CASSANDRA_USERNAME"),
    required("CASSANDRA_PASSWORD"),
  ),
  queryOptions: { prepare: true, consistency: cassandra.types.consistencies.localQuorum },
});
const day = (date) => cassandra.types.LocalDate.fromString(date.toISOString().slice(0, 10));
const shard = (id) => Number.parseInt(String(id).replaceAll("-", "").slice(-2), 16) % 16;
const checksum = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function eachPage(cql, visit) {
  let pageState;
  do {
    const result = await client.execute(cql, [], { prepare: true, fetchSize: 500, pageState });
    for (const row of result.rows) await visit(row);
    pageState = result.pageState;
  } while (pageState);
}

async function backfillPayments() {
  let count = 0;
  await eachPage(
    "SELECT order_id,student_id,course_id,offering_id,paid_event_id,price_snapshot,currency,state,paid_at FROM order_by_id",
    async (row) => {
      if (!row.paid_event_id || !row.paid_at || !["PAID_PENDING_ENTITLEMENT", "ENTITLED"].includes(String(row.state))) return;
      const occurredAt = new Date(row.paid_at);
      const bucket = day(occurredAt);
      const factShard = shard(row.order_id);
      await client.execute(
        "INSERT INTO revenue_payment_fact_by_event (payment_event_id,bucket_day,shard,occurred_at,order_id) VALUES (?,?,?,?,?) IF NOT EXISTS",
        [row.paid_event_id, bucket, factShard, occurredAt, row.order_id],
        { prepare: true, serialConsistency: cassandra.types.consistencies.localSerial },
      );
      await client.execute(
        "INSERT INTO revenue_payment_facts_by_day_shard (bucket_day,shard,occurred_at,order_id,payment_event_id,provider_transaction_id,student_id,course_id,offering_id,gross_minor,currency) VALUES (?,?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS",
        [bucket, factShard, occurredAt, row.order_id, row.paid_event_id, null, row.student_id, row.course_id, row.offering_id, cassandra.types.Long.fromString(String(row.price_snapshot)), row.currency],
        { prepare: true, serialConsistency: cassandra.types.consistencies.localSerial },
      );
      count += 1;
    },
  );
  return count;
}

async function backfillRefunds() {
  let count = 0;
  await eachPage(
    "SELECT refund_id,order_id,course_id,amount,currency,status,requested_at,processed_at FROM course_refund_by_id",
    async (row) => {
      if (!row.refund_id || !row.requested_at) return;
      const occurredAt = new Date(row.processed_at || row.requested_at);
      const bucket = day(new Date(row.requested_at));
      const factShard = shard(row.refund_id);
      await client.execute(
        "INSERT INTO revenue_refund_fact_by_id (refund_id,bucket_day,shard,occurred_at,order_id,status) VALUES (?,?,?,?,?,?) IF NOT EXISTS",
        [row.refund_id, bucket, factShard, occurredAt, row.order_id, row.status],
        { prepare: true, serialConsistency: cassandra.types.consistencies.localSerial },
      );
      await client.execute(
        "INSERT INTO revenue_refund_facts_by_day_shard (bucket_day,shard,occurred_at,refund_id,order_id,provider_refund_id,course_id,amount_minor,currency,status) VALUES (?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS",
        [bucket, factShard, occurredAt, row.refund_id, row.order_id, null, row.course_id, row.amount, row.currency, row.status],
        { prepare: true, serialConsistency: cassandra.types.consistencies.localSerial },
      );
      count += 1;
    },
  );
  return count;
}

async function reconcileDate(date) {
  const bucket = day(date);
  let paymentFactCount = 0n, refundFactCount = 0n, grossMinor = 0n, refundMinor = 0n;
  for (let factShard = 0; factShard < 16; factShard += 1) {
    const payments = await client.execute(
      "SELECT gross_minor,currency FROM revenue_payment_facts_by_day_shard WHERE bucket_day=? AND shard=?",
      [bucket, factShard], { prepare: true },
    );
    for (const row of payments.rows) {
      if (String(row.currency) !== "VND") throw new Error(`Unsupported currency on ${String(bucket)}`);
      paymentFactCount += 1n; grossMinor += BigInt(String(row.gross_minor));
    }
    const refunds = await client.execute(
      "SELECT amount_minor,currency,status FROM revenue_refund_facts_by_day_shard WHERE bucket_day=? AND shard=?",
      [bucket, factShard], { prepare: true },
    );
    for (const row of refunds.rows) {
      if (String(row.currency) !== "VND") throw new Error(`Unsupported currency on ${String(bucket)}`);
      refundFactCount += 1n;
      if (String(row.status) === "PROCESSED") refundMinor += BigInt(String(row.amount_minor));
    }
  }
  const values = { paymentFactCount: String(paymentFactCount), refundFactCount: String(refundFactCount), grossMinor: String(grossMinor), refundMinor: String(refundMinor) };
  await client.execute(
    "INSERT INTO finance_reconciliation_by_day (bucket_day,payment_fact_count,refund_fact_count,gross_minor,refund_minor,currency,status,checksum,reconciled_at) VALUES (?,?,?,?,?,'VND','MATCHED',?,?)",
    [bucket, cassandra.types.Long.fromString(String(paymentFactCount)), cassandra.types.Long.fromString(String(refundFactCount)), cassandra.types.Long.fromString(String(grossMinor)), cassandra.types.Long.fromString(String(refundMinor)), checksum(values), new Date()],
    { prepare: true },
  );
  return values;
}

await client.connect();
try {
  const startedAt = new Date();
  await client.execute(
    "INSERT INTO finance_projection_control (projection_name,status,updated_at) VALUES ('REVENUE_V1','BACKFILLING',?)",
    [startedAt], { prepare: true },
  );
  const [payments, refunds] = await Promise.all([backfillPayments(), backfillRefunds()]);
  const start = process.env.FINANCE_BACKFILL_FROM ? new Date(`${process.env.FINANCE_BACKFILL_FROM}T00:00:00.000Z`) : new Date(Date.now() - 90 * 86_400_000);
  const through = new Date();
  const daily = [];
  for (let cursor = start; cursor <= through; cursor = new Date(cursor.getTime() + 86_400_000)) daily.push(await reconcileDate(cursor));
  const finalChecksum = checksum({ payments, refunds, daily });
  await client.execute(
    "UPDATE finance_projection_control SET status='READY',backfill_through=?,last_reconciled_at=?,checksum=?,updated_at=? WHERE projection_name='REVENUE_V1'",
    [through, through, finalChecksum, through], { prepare: true },
  );
  process.stdout.write(`${JSON.stringify({ status: "READY", payments, refunds, reconciledDays: daily.length, checksum: finalChecksum })}\n`);
} catch (error) {
  await client.execute(
    "UPDATE finance_projection_control SET status='FAILED',updated_at=? WHERE projection_name='REVENUE_V1'",
    [new Date()], { prepare: true },
  );
  throw error;
} finally {
  await client.shutdown();
}
