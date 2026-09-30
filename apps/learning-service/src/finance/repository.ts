import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import type { LedgerEntry } from "./ledger.js";
import type { RefundRecord } from "./finance-service.js";

const LQ = "LOCAL_QUORUM" as const;
const LS = "LOCAL_SERIAL" as const;
const uuid = (value: string) => types.Uuid.fromString(value);
const day = (value: string) => types.LocalDate.fromString(value);
const long = (value: number) => types.Long.fromNumber(value);

export interface DurableFinanceStore {
  claimRefund(orderId: string, refundId: string, requestedAt: Date): Promise<string>;
  refundByOrder(orderId: string): Promise<RefundRecord | undefined>;
  progressPercent(studentId: string, courseId: string): Promise<number>;
  persistRefund(
    record: RefundRecord,
    providerRefundId: string,
    entries: readonly LedgerEntry[],
  ): Promise<void>;
}

export class CassandraFinanceRepository implements DurableFinanceStore {
  public constructor(private readonly db: CassandraClient) {}

  async claimRefund(orderId: string, refundId: string, requestedAt: Date): Promise<string> {
    await this.db.execute(
      `INSERT INTO course_refund_by_order (order_id,refund_id,status,requested_at) VALUES (?,?,'PENDING',?) IF NOT EXISTS`,
      [uuid(orderId), uuid(refundId), requestedAt],
      LQ,
      LS,
    );
    const row = (
      await this.db.execute(
        `SELECT refund_id FROM course_refund_by_order WHERE order_id=?`,
        [uuid(orderId)],
        LQ,
      )
    )[0];
    if (!row) throw new Error("REFUND_CLAIM_UNAVAILABLE");
    return String(row.refund_id);
  }

  async refundByOrder(orderId: string): Promise<RefundRecord | undefined> {
    const locator = (
      await this.db.execute(
        `SELECT refund_id FROM course_refund_by_order WHERE order_id=?`,
        [uuid(orderId)],
        LQ,
      )
    )[0];
    if (!locator) return undefined;
    const row = (
      await this.db.execute(
        `SELECT refund_id,order_id,student_id,course_id,amount,currency,reason,status,progress_percent_at_request,requested_at,processed_at,failure_reason FROM course_refund_by_id WHERE refund_id=?`,
        [locator.refund_id],
        LQ,
      )
    )[0];
    if (!row) return undefined;
    return {
      refundId: String(row.refund_id),
      orderId: String(row.order_id),
      studentId: String(row.student_id),
      courseId: String(row.course_id),
      amount: Number(String(row.amount)),
      currency: String(row.currency),
      reason: String(row.reason),
      status: String(row.status) as RefundRecord["status"],
      progressPercentAtRequest: Number(row.progress_percent_at_request),
      requestedAt: new Date(String(row.requested_at)),
      ...(row.processed_at ? { processedAt: new Date(String(row.processed_at)) } : {}),
      ...(row.failure_reason ? { failureReason: String(row.failure_reason) } : {}),
    };
  }

  async progressPercent(studentId: string, courseId: string): Promise<number> {
    const row = (
      await this.db.execute(
        `SELECT percent FROM progress_by_student_course WHERE student_id=? AND course_id=?`,
        [uuid(studentId), uuid(courseId)],
        LQ,
      )
    )[0];
    if (!row) return 0;
    const percent = Number(row.percent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100)
      throw new Error("INVALID_PROGRESS_PROJECTION");
    return percent;
  }

  async persistRefund(
    record: RefundRecord,
    providerRefundId: string,
    entries: readonly LedgerEntry[],
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO course_refund_by_id (refund_id,order_id,student_id,course_id,amount,currency,reason,status,progress_percent_at_request,requested_at,processed_at,failure_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        uuid(record.refundId),
        uuid(record.orderId),
        uuid(record.studentId),
        uuid(record.courseId),
        long(record.amount),
        record.currency,
        record.reason,
        record.status,
        record.progressPercentAtRequest,
        record.requestedAt,
        record.processedAt ?? null,
        record.failureReason ?? null,
      ],
      LQ,
    );
    for (const entry of entries)
      await this.db.execute(
        `INSERT INTO financial_ledger_entries (account_id,bucket,entry_id,entry_type,direction,amount,currency,reference_type,reference_id,description,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS`,
        [
          uuid(entry.accountId),
          day(entry.bucket),
          uuid(entry.entryId),
          entry.entryType,
          entry.direction,
          long(entry.amount),
          entry.currency,
          entry.referenceType,
          entry.referenceId,
          entry.description,
          JSON.stringify(entry.metadata ?? {}),
          entry.createdAt,
        ],
        LQ,
        LS,
      );
    const shard = Number.parseInt(record.refundId.replaceAll("-", "").slice(-2), 16) % 16;
    await this.db.execute(
      `INSERT INTO revenue_refund_fact_by_id (refund_id,bucket_day,shard,occurred_at,order_id,status) VALUES (?,?,?,?,?,?) IF NOT EXISTS`,
      [
        uuid(record.refundId),
        day(record.requestedAt.toISOString().slice(0, 10)),
        shard,
        record.processedAt ?? record.requestedAt,
        uuid(record.orderId),
        record.status,
      ],
      LQ,
      LS,
    );
    await this.db.execute(
      `INSERT INTO revenue_refund_facts_by_day_shard (bucket_day,shard,occurred_at,refund_id,order_id,provider_refund_id,course_id,amount_minor,currency,status) VALUES (?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS`,
      [
        day(record.requestedAt.toISOString().slice(0, 10)),
        shard,
        record.processedAt ?? record.requestedAt,
        uuid(record.refundId),
        uuid(record.orderId),
        providerRefundId,
        uuid(record.courseId),
        long(record.amount),
        record.currency,
        record.status,
      ],
      LQ,
      LS,
    );
    await this.db.execute(
      `UPDATE course_refund_by_order SET status=? WHERE order_id=?`,
      [record.status, uuid(record.orderId)],
      LQ,
    );
  }
}
