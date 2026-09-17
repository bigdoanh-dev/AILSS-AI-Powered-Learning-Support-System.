import { createHash } from "node:crypto";
import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import { AppError } from "../../../../packages/http/src/index.js";
import { crashAfter } from "./crash-injection.js";

export const recoveryShard = (id: string) => (createHash("sha256").update(id).digest()[0] ?? 0) % 16;
export interface RecoveryCandidate {
  transactionId: string;
  orderId: string;
  fingerprint: string;
  recoveryMac: string;
  receivedAt: Date;
  paidEventId: string;
  correlationId: string;
  amount: number;
  state: string;
  nextAttemptAt: Date;
  leaseUntil: Date;
  leaseFence: number;
  retryCount: number;
}
const columns =
  "transaction_id,order_id,fingerprint,recovery_mac,received_at,paid_event_id,correlation_id,amount,state,next_attempt_at,lease_until,lease_fence,retry_count";
const uuid = (id: string) => types.Uuid.fromString(id);
const long = (n: number) => types.Long.fromNumber(n);
const unavailable = () =>
  new AppError("PAYMENT_UNAVAILABLE", 503, "Payment processing is temporarily unavailable", true);
function decode(r: Record<string, unknown>): RecoveryCandidate {
  return {
    transactionId: String(r.transaction_id),
    orderId: String(r.order_id),
    fingerprint: String(r.fingerprint),
    recoveryMac: String(r.recovery_mac),
    receivedAt: r.received_at as Date,
    paidEventId: String(r.paid_event_id),
    correlationId: String(r.correlation_id),
    amount: Number(String(r.amount)),
    state: String(r.state),
    nextAttemptAt: r.next_attempt_at as Date,
    leaseUntil: r.lease_until as Date,
    leaseFence: Number(String(r.lease_fence)),
    retryCount: Number(r.retry_count),
  };
}
/** Q-LRN-026: fixed exact-shard partitions; no time-window discovery cutoff. */
export class SepayRecoveryRepository {
  constructor(private readonly db: CassandraClient) {}
  async ensure(
    input: Pick<
      RecoveryCandidate,
      | "transactionId"
      | "orderId"
      | "fingerprint"
      | "recoveryMac"
      | "receivedAt"
      | "paidEventId"
      | "correlationId"
      | "amount"
    >,
  ): Promise<RecoveryCandidate> {
    try {
      await this.db.execute(
        `INSERT INTO sepay_recovery_by_shard (shard,transaction_id,order_id,fingerprint,recovery_mac,received_at,paid_event_id,correlation_id,amount,state,next_attempt_at,lease_until,lease_fence,retry_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'READY',?,?,0,0,?,?) IF NOT EXISTS`,
        [
          recoveryShard(input.transactionId),
          input.transactionId,
          uuid(input.orderId),
          input.fingerprint,
          input.recoveryMac,
          input.receivedAt,
          uuid(input.paidEventId),
          uuid(input.correlationId),
          long(input.amount),
          input.receivedAt,
          new Date(0),
          input.receivedAt,
          input.receivedAt,
        ],
        "LOCAL_QUORUM",
        "LOCAL_SERIAL",
      );
      crashAfter("A_CANDIDATE", {
        transactionId: input.transactionId,
        orderId: input.orderId,
        paidEventId: input.paidEventId,
        correlationId: input.correlationId,
        fingerprint: input.fingerprint,
        receivedAt: input.receivedAt.toISOString(),
        shard: recoveryShard(input.transactionId),
      });
      const row = await this.get(input.transactionId);
      if (!row) throw unavailable();
      if (row.orderId !== input.orderId || row.amount !== input.amount) {
        console.warn(
          JSON.stringify({
            eventType: "APPSEC_AUDIT_PAYLOAD_COLLISION",
            severity: "HIGH",
            transactionId: input.transactionId,
            existingOrderId: row.orderId,
            incomingOrderId: input.orderId,
            existingAmount: row.amount,
            incomingAmount: input.amount,
            correlationId: input.correlationId,
          }),
        );
        throw new AppError(
          "PROVIDER_TRANSACTION_CONFLICT",
          409,
          "Payment could not be accepted: payload collision detected for transaction",
        );
      }
      if (
        row.fingerprint !== input.fingerprint ||
        row.recoveryMac !== input.recoveryMac ||
        row.paidEventId !== input.paidEventId
      )
        throw new AppError("PAYMENT_REPLAY_CONFLICT", 409, "Payment could not be accepted");
      return row;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw unavailable();
    }
  }
  async get(id: string) {
    const rows = await this.db.execute(
      `SELECT ${columns} FROM sepay_recovery_by_shard WHERE shard=? AND transaction_id=?`,
      [recoveryShard(id), id],
      "LOCAL_QUORUM",
    );
    return rows[0] ? decode(rows[0]) : undefined;
  }
  async page(shard: number, after?: string): Promise<RecoveryCandidate[]> {
    if (!Number.isInteger(shard) || shard < 0 || shard > 15) throw new Error("INVALID_RECOVERY_SHARD");
    const rows = await this.db.execute(
      `SELECT ${columns} FROM sepay_recovery_by_shard WHERE shard=?${after ? " AND transaction_id>?" : ""} LIMIT 25`,
      after ? [shard, after] : [shard],
      "LOCAL_QUORUM",
    );
    return rows.map(decode);
  }
  async claim(row: RecoveryCandidate, owner: string, now: Date) {
    if (row.state === "MANUAL_REVIEW" || row.nextAttemptAt > now || row.leaseUntil > now) return false;
    const r = await this.db.execute(
      "UPDATE sepay_recovery_by_shard SET state='RUNNING',lease_owner=?,lease_until=?,lease_fence=?,updated_at=? WHERE shard=? AND transaction_id=? IF state=? AND lease_fence=? AND lease_until=?",
      [
        owner,
        new Date(now.getTime() + 15000),
        long(row.leaseFence + 1),
        now,
        recoveryShard(row.transactionId),
        row.transactionId,
        row.state,
        long(row.leaseFence),
        row.leaseUntil,
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return r[0]?.["[applied]"] === true;
  }
  async finish(
    row: RecoveryCandidate,
    owner: string,
    now: Date,
    disposition: "COMPLETE" | "RETRY" | "MANUAL_REVIEW",
  ) {
    const key = [recoveryShard(row.transactionId), row.transactionId, owner, long(row.leaseFence + 1)];
    if (disposition === "COMPLETE") {
      await this.db.execute(
        "DELETE FROM sepay_recovery_by_shard WHERE shard=? AND transaction_id=? IF lease_owner=? AND lease_fence=?",
        key,
        "LOCAL_QUORUM",
        "LOCAL_SERIAL",
      );
      return;
    }
    const next = new Date(now.getTime() + Math.min(60000, 1000 * 2 ** Math.min(row.retryCount, 6)));
    await this.db.execute(
      "UPDATE sepay_recovery_by_shard SET state=?,next_attempt_at=?,lease_until=?,lease_owner=null,retry_count=?,updated_at=? WHERE shard=? AND transaction_id=? IF lease_owner=? AND lease_fence=?",
      [
        disposition === "MANUAL_REVIEW" ? disposition : "READY",
        next,
        new Date(0),
        row.retryCount + 1,
        now,
        ...key,
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
  }
}
