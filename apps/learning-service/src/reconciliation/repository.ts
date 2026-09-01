import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";

const LOCAL_QUORUM = "LOCAL_QUORUM" as const;
const LOCAL_SERIAL = "LOCAL_SERIAL" as const;
const SHARD_COUNT = 16;
const RUN_LIMIT = 50;
const LEASE_MILLISECONDS = 15_000;

const uuid = (value: string) => types.Uuid.fromString(value);
const long = (value: number) => types.Long.fromNumber(value);
const day = (value: string) => types.LocalDate.fromString(value);

export interface ReconciliationWork {
  readonly operationId: string;
  readonly projectionName: string;
  readonly canonicalId: string;
  readonly canonicalVersion: number;
  readonly checksum: string;
  readonly dueDay: string;
  readonly shard: number;
  readonly nextAttemptAt: Date;
  readonly retryCount: number;
  readonly dueState: "READY" | "RUNNING";
  readonly dueLeaseFence: number;
  readonly dueLeaseUntil?: Date;
  readonly operationState: "READY" | "RUNNING" | "COMPLETE";
  readonly operationLeaseFence: number;
  readonly operationLeaseUntil?: Date;
  readonly operationNextAttemptAt: Date;
  readonly projectionVersion: number;
}

interface ScheduleInput {
  readonly operationId: string;
  readonly projectionName: string;
  readonly canonicalId: string;
  readonly canonicalVersion: number;
  readonly checksum: string;
  readonly now: Date;
  readonly shard: number;
}

export class LearningReconciliationRepository {
  public constructor(private readonly db: CassandraClient) {}

  public async schedule(input: ScheduleInput): Promise<void> {
    if (input.shard < 0 || input.shard >= SHARD_COUNT) throw new Error("INVALID_RECONCILIATION_SHARD");
    const dueDay = input.now.toISOString().slice(0, 10);
    await this.db.execute(
      `INSERT INTO reconcile_operation_by_id
       (operation_id,projection_name,canonical_id,canonical_version,projection_version,checksum,state,retry_count,next_attempt_at,lease_fence,updated_at)
       VALUES (?,?,?,?,0,?,'READY',0,?,0,?) IF NOT EXISTS`,
      [
        uuid(input.operationId),
        input.projectionName,
        uuid(input.canonicalId),
        long(input.canonicalVersion),
        input.checksum,
        input.now,
        input.now,
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    await this.insertDue(input, dueDay, input.now, 0, 0);
  }

  public async listDue(now: Date): Promise<readonly ReconciliationWork[]> {
    const work: ReconciliationWork[] = [];
    // Q-LRN-016: bounded exact partitions only (today/yesterday x 16 shards).
    for (let offset = 0; offset <= 1 && work.length < RUN_LIMIT; offset += 1) {
      const current = new Date(now);
      current.setUTCDate(current.getUTCDate() - offset);
      const dueDay = current.toISOString().slice(0, 10);
      for (let shard = 0; shard < SHARD_COUNT && work.length < RUN_LIMIT; shard += 1) {
        const rows = await this.db.execute(
          `SELECT due_day,shard,next_attempt_at,operation_id,projection_name,canonical_id,
                  canonical_version,state,retry_count,lease_fence,lease_until
           FROM reconcile_by_due_bucket
           WHERE due_day=? AND shard=? AND next_attempt_at<=? LIMIT 25`,
          [day(dueDay), shard, now],
          LOCAL_QUORUM,
        );
        for (const row of rows) {
          const dueState = text(row, "state");
          if (dueState !== "READY" && dueState !== "RUNNING") continue;
          const operationId = text(row, "operation_id");
          const operation = await this.getOperation(operationId);
          if (!operation) continue;
          const operationState = text(operation, "state");
          if (operationState !== "READY" && operationState !== "RUNNING" && operationState !== "COMPLETE")
            continue;
          work.push({
            operationId,
            projectionName: text(row, "projection_name"),
            canonicalId: text(row, "canonical_id"),
            canonicalVersion: numberValue(row, "canonical_version"),
            checksum: text(operation, "checksum"),
            dueDay,
            shard,
            nextAttemptAt: date(row, "next_attempt_at"),
            retryCount: nullableNumber(row, "retry_count") ?? 0,
            dueState,
            dueLeaseFence: nullableNumber(row, "lease_fence") ?? 0,
            ...optionalDate(row, "lease_until", "dueLeaseUntil"),
            operationState,
            operationLeaseFence: nullableNumber(operation, "lease_fence") ?? 0,
            ...optionalDate(operation, "lease_until", "operationLeaseUntil"),
            operationNextAttemptAt: date(operation, "next_attempt_at"),
            projectionVersion: nullableNumber(operation, "projection_version") ?? 0,
          });
          if (work.length === RUN_LIMIT) break;
        }
      }
    }
    return work;
  }

  public async claim(item: ReconciliationWork, owner: string, now: Date): Promise<boolean> {
    if (!leaseAvailable(item.dueState, item.dueLeaseUntil, now)) return false;
    if (!leaseAvailable(item.operationState, item.operationLeaseUntil, now)) return false;
    const leaseUntil = new Date(now.getTime() + LEASE_MILLISECONDS);
    const dueApplied = await this.claimDue(item, owner, leaseUntil, item.dueLeaseFence + 1);
    if (!dueApplied) return false;
    // Cross-partition outcome remains recoverable: a failed second claim leaves a finite due lease.
    return this.claimOperation(item, owner, now, leaseUntil, item.operationLeaseFence + 1);
  }

  public async complete(item: ReconciliationWork, version: number, now: Date): Promise<void> {
    const rows = await this.db.execute(
      `UPDATE reconcile_operation_by_id
       SET state='COMPLETE',projection_version=?,lease_owner=null,lease_until=null,updated_at=?
       WHERE operation_id=? IF state='RUNNING' AND lease_fence=?`,
      [long(version), now, uuid(item.operationId), long(item.operationLeaseFence + 1)],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    if (!applied(rows)) throw new Error("RECONCILIATION_FENCE_LOST");
    await this.deleteDue(item, "RUNNING", item.dueLeaseFence + 1);
  }

  public async retry(item: ReconciliationWork, errorCode: string, next: Date): Promise<void> {
    const operationFence = item.operationLeaseFence + 1;
    const rows = await this.db.execute(
      `UPDATE reconcile_operation_by_id
       SET state='READY',retry_count=?,next_attempt_at=?,last_error=?,lease_owner=null,lease_until=null,updated_at=?
       WHERE operation_id=? IF state='RUNNING' AND lease_fence=?`,
      [item.retryCount + 1, next, errorCode, new Date(), uuid(item.operationId), long(operationFence)],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    if (!applied(rows)) throw new Error("RECONCILIATION_FENCE_LOST");
    // next_attempt_at is a clustering key: retry must move the due row.
    await this.deleteDue(item, "RUNNING", item.dueLeaseFence + 1);
    await this.insertDue(
      {
        operationId: item.operationId,
        projectionName: item.projectionName,
        canonicalId: item.canonicalId,
        canonicalVersion: item.canonicalVersion,
        checksum: item.checksum,
        now: next,
        shard: item.shard,
      },
      next.toISOString().slice(0, 10),
      next,
      item.retryCount + 1,
      operationFence,
    );
  }

  public async discardCompleted(item: ReconciliationWork): Promise<void> {
    await this.deleteDue(item, item.dueState, item.dueLeaseFence);
  }

  private async getOperation(operationId: string): Promise<types.Row | undefined> {
    const rows = await this.db.execute(
      `SELECT operation_id,projection_name,canonical_id,canonical_version,projection_version,
              checksum,state,retry_count,next_attempt_at,lease_fence,lease_until
       FROM reconcile_operation_by_id WHERE operation_id=?`,
      [uuid(operationId)],
      LOCAL_QUORUM,
    );
    return rows[0];
  }

  private async claimDue(
    item: ReconciliationWork,
    owner: string,
    leaseUntil: Date,
    fence: number,
  ): Promise<boolean> {
    const base = `UPDATE reconcile_by_due_bucket
                  SET state='RUNNING',lease_owner=?,lease_until=?,lease_fence=?
                  WHERE due_day=? AND shard=? AND next_attempt_at=? AND operation_id=?`;
    const params: unknown[] = [
      owner,
      leaseUntil,
      long(fence),
      day(item.dueDay),
      item.shard,
      item.nextAttemptAt,
      uuid(item.operationId),
    ];
    const rows =
      item.dueState === "READY"
        ? await this.db.execute(
            `${base} IF state='READY' AND lease_fence=?`,
            [...params, long(item.dueLeaseFence)],
            LOCAL_QUORUM,
            LOCAL_SERIAL,
          )
        : await this.db.execute(
            `${base} IF state='RUNNING' AND lease_fence=? AND lease_until=?`,
            [...params, long(item.dueLeaseFence), item.dueLeaseUntil],
            LOCAL_QUORUM,
            LOCAL_SERIAL,
          );
    return applied(rows);
  }

  private async claimOperation(
    item: ReconciliationWork,
    owner: string,
    now: Date,
    leaseUntil: Date,
    fence: number,
  ): Promise<boolean> {
    const base = `UPDATE reconcile_operation_by_id
                  SET state='RUNNING',lease_owner=?,lease_until=?,lease_fence=?,updated_at=?
                  WHERE operation_id=?`;
    const params: unknown[] = [owner, leaseUntil, long(fence), now, uuid(item.operationId)];
    const rows =
      item.operationState === "READY"
        ? await this.db.execute(
            `${base} IF state='READY' AND lease_fence=?`,
            [...params, long(item.operationLeaseFence)],
            LOCAL_QUORUM,
            LOCAL_SERIAL,
          )
        : await this.db.execute(
            `${base} IF state='RUNNING' AND lease_fence=? AND lease_until=?`,
            [...params, long(item.operationLeaseFence), item.operationLeaseUntil],
            LOCAL_QUORUM,
            LOCAL_SERIAL,
          );
    return applied(rows);
  }

  private async deleteDue(
    item: ReconciliationWork,
    state: "READY" | "RUNNING",
    fence: number,
  ): Promise<void> {
    await this.db.execute(
      `DELETE FROM reconcile_by_due_bucket
       WHERE due_day=? AND shard=? AND next_attempt_at=? AND operation_id=? IF state=? AND lease_fence=?`,
      [day(item.dueDay), item.shard, item.nextAttemptAt, uuid(item.operationId), state, long(fence)],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
  }

  private async insertDue(
    input: ScheduleInput,
    dueDay: string,
    nextAttemptAt: Date,
    retryCount: number,
    fence: number,
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO reconcile_by_due_bucket
       (due_day,shard,next_attempt_at,operation_id,projection_name,canonical_id,canonical_version,state,retry_count,lease_fence)
       VALUES (?,?,?,?,?,?,?,'READY',?,?) IF NOT EXISTS`,
      [
        day(dueDay),
        input.shard,
        nextAttemptAt,
        uuid(input.operationId),
        input.projectionName,
        uuid(input.canonicalId),
        long(input.canonicalVersion),
        retryCount,
        long(fence),
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
  }
}

function applied(rows: readonly types.Row[]): boolean {
  return rows[0]?.get("[applied]") === true;
}

function text(row: types.Row, name: string): string {
  const value: unknown = row.get(name);
  if (typeof value === "string") return value;
  if (value instanceof types.Uuid) return value.toString();
  throw new Error(`INVALID_${name.toUpperCase()}`);
}

function date(row: types.Row, name: string): Date {
  const value: unknown = row.get(name);
  if (value instanceof Date) return value;
  throw new Error(`INVALID_${name.toUpperCase()}`);
}

function nullableNumber(row: types.Row, name: string): number | undefined {
  const value: unknown = row.get(name);
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "object" && "toNumber" in value) return (value as { toNumber(): number }).toNumber();
  throw new Error(`INVALID_${name.toUpperCase()}`);
}

function numberValue(row: types.Row, name: string): number {
  const result = nullableNumber(row, name);
  if (result === undefined) throw new Error(`INVALID_${name.toUpperCase()}`);
  return result;
}

function optionalDate<Key extends string>(
  row: types.Row,
  name: string,
  key: Key,
): { [Property in Key]?: Date } {
  const value: unknown = row.get(name);
  return value instanceof Date ? ({ [key]: value } as { [Property in Key]?: Date }) : {};
}

function leaseAvailable(state: string, leaseUntil: Date | undefined, now: Date): boolean {
  return state === "READY" || (state === "RUNNING" && leaseUntil !== undefined && leaseUntil <= now);
}
