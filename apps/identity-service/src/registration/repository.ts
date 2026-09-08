import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import type { EventEnvelope } from "../../../../packages/contracts/src/index.js";
import type { RegisteredAccount } from "./model.js";
import { identitySearchShard, type AdminProjectionRow } from "../admin/model.js";

const LOCAL_QUORUM = "LOCAL_QUORUM" as const;
const LOCAL_SERIAL = "LOCAL_SERIAL" as const;
const long = (value: number) => types.Long.fromNumber(value);
const uuid = (value: string) => types.Uuid.fromString(value);

function wasApplied(rows: readonly types.Row[]): boolean {
  return Boolean(rows[0]?.get("[applied]"));
}

function text(row: types.Row, name: string): string {
  const value: unknown = row.get(name);
  if (value === null || value === undefined) throw new Error(`MISSING_${name.toUpperCase()}`);
  if (typeof value === "string") return value;
  if (value instanceof types.Uuid) return value.toString();
  throw new Error(`INVALID_${name.toUpperCase()}`);
}

function date(row: types.Row, name: string): Date {
  const value: unknown = row.get(name);
  if (!(value instanceof Date)) throw new Error(`INVALID_${name.toUpperCase()}`);
  return value;
}

function numberValue(row: types.Row, name: string): number {
  const value: unknown = row.get(name);
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber(): number }).toNumber();
  }
  return Number(value);
}

export interface IdempotencyRecord {
  readonly operationId: string;
  readonly resourceId: string;
  readonly resultCode: number;
  readonly status: string;
  readonly requestChecksum: string;
  readonly createdAt: Date;
}

export interface CredentialReservation {
  readonly userId: string;
  readonly status: string;
}

export interface OutboxLocation {
  readonly dueDay: string;
  readonly shard: number;
  readonly nextAttemptAt: Date;
  readonly eventId: string;
}

export interface DueOutboxEvent extends OutboxLocation {
  readonly event: EventEnvelope;
  readonly state: string;
  readonly retryCount: number;
  readonly leaseFence: number;
  readonly leaseUntil?: Date;
}

export class IdentityRegistrationRepository {
  public constructor(private readonly client: CassandraClient) {}

  public async beginIdempotency(input: {
    scope: string;
    keyHash: number;
    idempotencyKey: string;
    operationId: string;
    resourceId: string;
    requestChecksum: string;
    createdAt: Date;
    ttlSeconds: number;
  }): Promise<{ created: boolean; record: IdempotencyRecord }> {
    // Q-IDN-007: reserve the anonymous command key with LWT before any business mutation.
    const rows = await this.client.execute(
      `INSERT INTO idempotency_by_scope_key
       (scope,key_hash,idempotency_key,operation_id,resource_id,result_code,status,result_checksum,created_at,expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS USING TTL ?`,
      [
        input.scope,
        input.keyHash,
        input.idempotencyKey,
        uuid(input.operationId),
        uuid(input.resourceId),
        0,
        "IN_PROGRESS",
        input.requestChecksum,
        input.createdAt,
        new Date(input.createdAt.getTime() + input.ttlSeconds * 1_000),
        input.ttlSeconds,
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    const record = await this.getIdempotency(input.scope, input.keyHash, input.idempotencyKey);
    if (!record) throw new Error("IDEMPOTENCY_RESERVATION_MISSING");
    return { created: wasApplied(rows), record };
  }

  public async getIdempotency(
    scope: string,
    keyHash: number,
    idempotencyKey: string,
  ): Promise<IdempotencyRecord | undefined> {
    // Q-IDN-007: exact partition lookup; never scan idempotency records.
    const rows = await this.client.execute(
      `SELECT operation_id,resource_id,result_code,status,result_checksum,created_at
       FROM idempotency_by_scope_key
       WHERE scope=? AND key_hash=? AND idempotency_key=?`,
      [scope, keyHash, idempotencyKey],
      LOCAL_QUORUM,
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      operationId: text(row, "operation_id"),
      resourceId: text(row, "resource_id"),
      resultCode: numberValue(row, "result_code"),
      status: text(row, "status"),
      requestChecksum: text(row, "result_checksum"),
      createdAt: date(row, "created_at"),
    };
  }

  public async completeIdempotency(input: {
    scope: string;
    keyHash: number;
    idempotencyKey: string;
    operationId: string;
  }): Promise<void> {
    await this.client.execute(
      `UPDATE idempotency_by_scope_key SET status='COMPLETE', result_code=201
       WHERE scope=? AND key_hash=? AND idempotency_key=? IF operation_id=?`,
      [input.scope, input.keyHash, input.idempotencyKey, uuid(input.operationId)],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
  }

  public async failIdempotency(input: {
    scope: string;
    keyHash: number;
    idempotencyKey: string;
    operationId: string;
    resultCode: number;
  }): Promise<void> {
    await this.client.execute(
      `UPDATE idempotency_by_scope_key SET status='FAILED', result_code=?
       WHERE scope=? AND key_hash=? AND idempotency_key=? IF operation_id=?`,
      [input.resultCode, input.scope, input.keyHash, input.idempotencyKey, uuid(input.operationId)],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
  }

  public async reserveCredential(input: {
    normalizedEmail: string;
    userId: string;
    passwordHash: string;
    createdAt: Date;
  }): Promise<{ created: boolean; reservation: CredentialReservation }> {
    // Q-IDN-002: normalized email is the LWT-enforced physical uniqueness invariant.
    const rows = await this.client.execute(
      `INSERT INTO credential_by_email
       (normalized_email,user_id,password_hash,credential_version,status,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?) IF NOT EXISTS`,
      [
        input.normalizedEmail,
        uuid(input.userId),
        input.passwordHash,
        long(1),
        "RESERVED",
        input.createdAt,
        input.createdAt,
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    const reservation = await this.getCredential(input.normalizedEmail);
    if (!reservation) throw new Error("CREDENTIAL_RESERVATION_MISSING");
    return { created: wasApplied(rows), reservation };
  }

  public async getCredential(normalizedEmail: string): Promise<CredentialReservation | undefined> {
    // Q-IDN-002: prepared exact lookup by normalized_email.
    const rows = await this.client.execute(
      "SELECT user_id,status FROM credential_by_email WHERE normalized_email=?",
      [normalizedEmail],
      LOCAL_QUORUM,
    );
    const row = rows[0];
    return row ? { userId: text(row, "user_id"), status: text(row, "status") } : undefined;
  }

  public async activateCredential(normalizedEmail: string, userId: string, updatedAt: Date): Promise<void> {
    await this.client.execute(
      `UPDATE credential_by_email SET status='ACTIVE',updated_at=?
       WHERE normalized_email=? IF user_id=?`,
      [updatedAt, normalizedEmail, uuid(userId)],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
  }

  public async createUser(input: {
    account: RegisteredAccount;
    maskedEmail: string;
    normalizedEmail: string;
  }): Promise<void> {
    // Q-IDN-001: canonical registration write; credentials remain in Q-IDN-002.
    await this.client.execute(
      `INSERT INTO user_by_id
       (user_id,email_masked,normalized_email,display_name,role,status,lecturer_verified,token_version,credential_version,profile_version,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS`,
      [
        uuid(input.account.userId),
        input.maskedEmail,
        input.normalizedEmail,
        input.account.displayName,
        input.account.role,
        input.account.status,
        input.account.lecturerVerified,
        1,
        long(1),
        long(input.account.profileVersion),
        new Date(input.account.createdAt),
        new Date(input.account.createdAt),
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
  }

  public async getUser(userId: string): Promise<RegisteredAccount | undefined> {
    // Q-IDN-001: exact canonical lookup for idempotent outcome recovery.
    const rows = await this.client.execute(
      `SELECT user_id,display_name,role,status,lecturer_verified,profile_version,created_at
       FROM user_by_id WHERE user_id=?`,
      [uuid(userId)],
      LOCAL_QUORUM,
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      userId: text(row, "user_id"),
      displayName: text(row, "display_name"),
      role: text(row, "role") as RegisteredAccount["role"],
      status: "ACTIVE",
      lecturerVerified: false,
      profileVersion: numberValue(row, "profile_version"),
      createdAt: date(row, "created_at").toISOString(),
    };
  }

  public async getAdminProjection(account: RegisteredAccount): Promise<AdminProjectionRow | undefined> {
    const shard = identitySearchShard(account.userId);
    const updatedAt = new Date(account.createdAt);
    const rows = await this.client.execute(
      `SELECT role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version
       FROM users_by_role_status_bucket
       WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?`,
      [account.role, account.status, shard, updatedAt, uuid(account.userId)],
      LOCAL_QUORUM,
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      userId: text(row, "user_id"),
      displayName: text(row, "display_name"),
      role: text(row, "role") as AdminProjectionRow["role"],
      status: text(row, "status") as AdminProjectionRow["status"],
      lecturerVerified: Boolean(row.get("lecturer_verified")),
      profileVersion: numberValue(row, "profile_version"),
      updatedAt: date(row, "updated_at"),
      shard,
    };
  }

  public async insertAdminProjection(account: RegisteredAccount): Promise<boolean> {
    const rows = await this.client.execute(
      `INSERT INTO users_by_role_status_bucket
       (role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version)
       VALUES (?,?,?,?,?,?,?,?) IF NOT EXISTS`,
      [
        account.role,
        account.status,
        identitySearchShard(account.userId),
        new Date(account.createdAt),
        uuid(account.userId),
        account.displayName,
        account.lecturerVerified,
        long(account.profileVersion),
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    return wasApplied(rows);
  }

  public async prepareOutbox(event: EventEnvelope): Promise<OutboxLocation> {
    // Q-IDN-007: write the payload-bearing row first so PREPARED recovery never loses the event body.
    const occurredAt = new Date(event.occurredAt);
    const location = this.outboxLocation(event.eventId, occurredAt);
    await this.client.execute(
      `INSERT INTO pending_events_by_due_bucket
       (due_day,shard,next_attempt_at,event_id,event_type,aggregate_id,aggregate_version,payload_json,state,retry_count,lease_fence,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS`,
      [
        types.LocalDate.fromString(location.dueDay),
        location.shard,
        location.nextAttemptAt,
        uuid(event.eventId),
        event.eventType,
        uuid(event.aggregate.id),
        long(event.aggregate.version),
        JSON.stringify(event),
        "PREPARED",
        0,
        long(0),
        occurredAt,
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    await this.client.execute(
      `INSERT INTO pending_event_by_id
       (event_id,event_type,aggregate_id,aggregate_version,state,next_attempt_at,retry_count,lease_fence,created_at)
       VALUES (?,?,?,?,?,?,?,?,?) IF NOT EXISTS`,
      [
        uuid(event.eventId),
        event.eventType,
        uuid(event.aggregate.id),
        long(event.aggregate.version),
        "PREPARED",
        occurredAt,
        0,
        long(0),
        occurredAt,
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    return location;
  }

  public async markOutboxReady(location: OutboxLocation): Promise<void> {
    // Q-IDN-007: conditional promotion cannot regress PUBLISHED back to READY.
    await this.client.execute(
      `UPDATE pending_events_by_due_bucket SET state='READY'
       WHERE due_day=? AND shard=? AND next_attempt_at=? AND event_id=? IF state='PREPARED'`,
      [
        types.LocalDate.fromString(location.dueDay),
        location.shard,
        location.nextAttemptAt,
        uuid(location.eventId),
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    await this.client.execute(
      "UPDATE pending_event_by_id SET state='READY' WHERE event_id=? IF state='PREPARED'",
      [uuid(location.eventId)],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
  }

  public async listDue(now: Date, lookbackDays = 1): Promise<readonly DueOutboxEvent[]> {
    const result: DueOutboxEvent[] = [];
    for (let daysAgo = 0; daysAgo <= lookbackDays; daysAgo += 1) {
      const day = new Date(now);
      day.setUTCDate(day.getUTCDate() - daysAgo);
      const dueDay = day.toISOString().slice(0, 10);
      for (let shard = 0; shard < 16; shard += 1) {
        // Q-IDN-007 worker scan: bounded exact day/shard partitions and clustering range.
        const rows = await this.client.execute(
          `SELECT due_day,shard,next_attempt_at,event_id,payload_json,state,retry_count,lease_fence,lease_until
           FROM pending_events_by_due_bucket
           WHERE due_day=? AND shard=? AND next_attempt_at<=? LIMIT 25`,
          [types.LocalDate.fromString(dueDay), shard, now],
          LOCAL_QUORUM,
        );
        for (const row of rows) {
          const lease: unknown = row.get("lease_until");
          result.push({
            dueDay: String(row.get("due_day")),
            shard: numberValue(row, "shard"),
            nextAttemptAt: date(row, "next_attempt_at"),
            eventId: text(row, "event_id"),
            event: JSON.parse(text(row, "payload_json")) as EventEnvelope,
            state: text(row, "state"),
            retryCount: numberValue(row, "retry_count"),
            leaseFence: numberValue(row, "lease_fence"),
            ...(lease instanceof Date ? { leaseUntil: lease } : {}),
          });
        }
      }
    }
    return result.slice(0, 50);
  }

  public async claim(item: DueOutboxEvent, owner: string, now: Date, leaseMs: number): Promise<boolean> {
    const nextFence = item.leaseFence + 1;
    const rows = await this.client.execute(
      `UPDATE pending_events_by_due_bucket
       SET state='PUBLISHING',lease_owner=?,lease_until=?,lease_fence=?
       WHERE due_day=? AND shard=? AND next_attempt_at=? AND event_id=? IF state='READY'`,
      [
        owner,
        new Date(now.getTime() + leaseMs),
        long(nextFence),
        types.LocalDate.fromString(item.dueDay),
        item.shard,
        item.nextAttemptAt,
        uuid(item.eventId),
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    if (!wasApplied(rows)) return false;
    await this.client.execute(
      "UPDATE pending_event_by_id SET state='PUBLISHING',lease_fence=? WHERE event_id=?",
      [long(nextFence), uuid(item.eventId)],
      LOCAL_QUORUM,
    );
    return true;
  }

  public async recoverExpiredClaim(item: DueOutboxEvent): Promise<void> {
    const rows = await this.client.execute(
      `UPDATE pending_events_by_due_bucket SET state='READY',lease_owner=null,lease_until=null
       WHERE due_day=? AND shard=? AND next_attempt_at=? AND event_id=?
       IF state='PUBLISHING' AND lease_fence=?`,
      [
        types.LocalDate.fromString(item.dueDay),
        item.shard,
        item.nextAttemptAt,
        uuid(item.eventId),
        long(item.leaseFence),
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    if (wasApplied(rows)) {
      await this.client.execute(
        `UPDATE pending_event_by_id SET state='READY' WHERE event_id=?
         IF state='PUBLISHING' AND lease_fence=?`,
        [uuid(item.eventId), long(item.leaseFence)],
        LOCAL_QUORUM,
        LOCAL_SERIAL,
      );
    }
  }

  public async releaseForRetry(item: DueOutboxEvent, nextEligibleAt: Date): Promise<void> {
    const retryCount = item.retryCount + 1;
    const fence = item.leaseFence + 1;
    await this.client.execute(
      `UPDATE pending_events_by_due_bucket
       SET state='READY',retry_count=?,lease_owner=null,lease_until=?
       WHERE due_day=? AND shard=? AND next_attempt_at=? AND event_id=?
       IF state='PUBLISHING' AND lease_fence=?`,
      [
        retryCount,
        nextEligibleAt,
        types.LocalDate.fromString(item.dueDay),
        item.shard,
        item.nextAttemptAt,
        uuid(item.eventId),
        long(fence),
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    await this.client.execute(
      `UPDATE pending_event_by_id SET state='READY',retry_count=?,next_attempt_at=?
       WHERE event_id=? IF state='PUBLISHING' AND lease_fence=?`,
      [retryCount, nextEligibleAt, uuid(item.eventId), long(fence)],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
  }

  public async markPublished(item: DueOutboxEvent, publishedAt: Date): Promise<void> {
    const fence = item.leaseFence + 1;
    const rows = await this.client.execute(
      `UPDATE pending_event_by_id SET state='PUBLISHED',published_at=?
       WHERE event_id=? IF state='PUBLISHING' AND lease_fence=?`,
      [publishedAt, uuid(item.eventId), long(fence)],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
    if (!wasApplied(rows)) throw new Error("OUTBOX_PUBLISH_FENCE_LOST");
    // Q-IDN-007: the by-id row retains PUBLISHED state; remove the scheduling row so old
    // events cannot hide new work behind the bounded per-shard LIMIT.
    await this.client.execute(
      `DELETE FROM pending_events_by_due_bucket
       WHERE due_day=? AND shard=? AND next_attempt_at=? AND event_id=?
       IF state='PUBLISHING' AND lease_fence=?`,
      [
        types.LocalDate.fromString(item.dueDay),
        item.shard,
        item.nextAttemptAt,
        uuid(item.eventId),
        long(fence),
      ],
      LOCAL_QUORUM,
      LOCAL_SERIAL,
    );
  }

  private outboxLocation(eventId: string, occurredAt: Date): OutboxLocation {
    const shardByte = Buffer.from(eventId.replaceAll("-", ""), "hex")[0] ?? 0;
    return {
      dueDay: occurredAt.toISOString().slice(0, 10),
      shard: shardByte % 16,
      nextAttemptAt: occurredAt,
      eventId,
    };
  }
}
