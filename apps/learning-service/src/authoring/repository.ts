import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import type {
  AuthoringCourse,
  CommandIds,
  CommandReceipt,
  CoursePatchRequest,
  CourseWriteRequest,
} from "./model.js";
import { eventBucket } from "./model.js";
import { types } from "cassandra-driver";
import { registerCategory } from "../categories.js";
import type { EventEnvelope } from "../../../../packages/contracts/src/index.js";

export interface IdempotencyRecord {
  operationId: string;
  resourceId: string;
  status: string;
  receipt: CommandReceipt;
}
export interface DueLearningEvent {
  dueDay: string;
  shard: number;
  nextAttemptAt: Date;
  eventId: string;
  event: EventEnvelope;
  state: string;
  retryCount: number;
  leaseFence: number;
  leaseUntil?: Date;
}

export class LearningAuthoringRepository {
  public constructor(private readonly db: CassandraClient) {}

  public async listOwned(lecturerId: string): Promise<AuthoringCourse[]> {
    const rows = await this.db.execute(
      "SELECT course_id FROM courses_by_lecturer WHERE lecturer_id=? LIMIT 100",
      [types.Uuid.fromString(lecturerId)],
      "LOCAL_QUORUM",
    );
    const courses = await Promise.all(rows.map((row) => this.get(String(row.course_id))));
    return courses.filter((course): course is AuthoringCourse => !!course);
  }

  public async reserve(
    scope: string,
    keyHash: number,
    key: string,
    ids: CommandIds,
    receipt: CommandReceipt,
    now: Date,
  ): Promise<boolean> {
    const rows = await this.db.execute(
      `INSERT INTO idempotency_by_scope_key
      (scope,key_hash,idempotency_key,operation_id,resource_id,result_code,status,result_checksum,created_at,expires_at)
      VALUES (?,?,?,?,?,0,'IN_PROGRESS',?,?,?) IF NOT EXISTS`,
      [
        scope,
        keyHash,
        key,
        types.Uuid.fromString(ids.operationId),
        types.Uuid.fromString(ids.courseId),
        JSON.stringify(receipt),
        now,
        new Date(now.getTime() + 86_400_000),
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return rows[0]?.["[applied]"] === true;
  }

  public async idempotency(
    scope: string,
    keyHash: number,
    key: string,
  ): Promise<IdempotencyRecord | undefined> {
    const rows = await this.db.execute(
      `SELECT operation_id,resource_id,status,result_checksum FROM idempotency_by_scope_key WHERE scope=? AND key_hash=? AND idempotency_key=?`,
      [scope, keyHash, key],
      "LOCAL_QUORUM",
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      operationId: String(row.operation_id),
      resourceId: String(row.resource_id),
      status: String(row.status),
      receipt: JSON.parse(String(row.result_checksum)) as CommandReceipt,
    };
  }

  public async complete(
    scope: string,
    keyHash: number,
    key: string,
    operationId: string,
    receipt: CommandReceipt,
  ): Promise<void> {
    await this.db.execute(
      `UPDATE idempotency_by_scope_key SET status='COMPLETE',result_code=200,result_checksum=? WHERE scope=? AND key_hash=? AND idempotency_key=? IF operation_id=?`,
      [JSON.stringify(receipt), scope, keyHash, key, types.Uuid.fromString(operationId)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
  }

  public async checkpoint(
    scope: string,
    keyHash: number,
    key: string,
    operationId: string,
    receipt: CommandReceipt,
  ): Promise<void> {
    const rows = await this.db.execute(
      `UPDATE idempotency_by_scope_key SET result_checksum=?
       WHERE scope=? AND key_hash=? AND idempotency_key=?
       IF operation_id=? AND status='IN_PROGRESS'`,
      [JSON.stringify(receipt), scope, keyHash, key, types.Uuid.fromString(operationId)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    if (rows[0]?.["[applied]"] !== true) throw new Error("IDEMPOTENCY_CHECKPOINT_CONFLICT");
  }

  public async prepareEvent(
    ids: CommandIds,
    lecturerId: string,
    occurredAt: Date,
    correlationId: string,
  ): Promise<void> {
    const envelope = {
      specVersion: "1.0",
      eventId: ids.eventId,
      eventType: "learning.course.created.v1",
      occurredAt: occurredAt.toISOString(),
      producer: "learning-service",
      correlationId,
      aggregate: { type: "COURSE", id: ids.courseId, version: 1 },
      data: { courseId: ids.courseId, lecturerId, version: 1 },
    };
    const dueDay = occurredAt.toISOString().slice(0, 10);
    const shard = eventBucket(ids.eventId);
    await this.db.execute(
      `INSERT INTO pending_events_by_due_bucket (due_day,shard,next_attempt_at,event_id,event_type,aggregate_id,aggregate_version,payload_json,state,retry_count,lease_fence,created_at) VALUES (?,?,?,?,?,?,?,?, 'PREPARED',0,0,?) IF NOT EXISTS`,
      [
        types.LocalDate.fromString(dueDay),
        shard,
        occurredAt,
        types.Uuid.fromString(ids.eventId),
        "learning.course.created.v1",
        types.Uuid.fromString(ids.courseId),
        types.Long.fromNumber(1),
        JSON.stringify(envelope),
        occurredAt,
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    await this.db.execute(
      `INSERT INTO pending_event_by_id (event_id,event_type,aggregate_id,aggregate_version,state,next_attempt_at,retry_count,lease_fence,created_at) VALUES (?,?,?,?, 'PREPARED',?,0,0,?) IF NOT EXISTS`,
      [
        types.Uuid.fromString(ids.eventId),
        "learning.course.created.v1",
        types.Uuid.fromString(ids.courseId),
        types.Long.fromNumber(1),
        occurredAt,
        occurredAt,
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
  }

  public async readyEvent(eventId: string, occurredAt: Date): Promise<void> {
    const dueDay = occurredAt.toISOString().slice(0, 10),
      shard = eventBucket(eventId);
    await this.db.execute(
      `UPDATE pending_events_by_due_bucket SET state='READY' WHERE due_day=? AND shard=? AND next_attempt_at=? AND event_id=? IF state='PREPARED'`,
      [types.LocalDate.fromString(dueDay), shard, occurredAt, types.Uuid.fromString(eventId)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    await this.db.execute(
      `UPDATE pending_event_by_id SET state='READY' WHERE event_id=? IF state='PREPARED'`,
      [types.Uuid.fromString(eventId)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
  }

  public async create(
    courseId: string,
    lecturerId: string,
    input: CourseWriteRequest,
    now: Date,
  ): Promise<boolean> {
    await registerCategory(this.db, input.categoryName);
    const rows = await this.db.execute(
      `INSERT INTO course_by_id (course_id,owner_lecturer_id,title,slug,category_id,state,content_version,record_version,price_type,price,currency,description,cover_data_url,created_at,updated_at) VALUES (?,?,?,?,?,'DRAFT',1,1,?,?,?,?,?,?,?) IF NOT EXISTS`,
      [
        types.Uuid.fromString(courseId),
        types.Uuid.fromString(lecturerId),
        input.title,
        input.slug,
        types.Uuid.fromString(input.categoryId),
        input.priceType,
        types.BigDecimal.fromString(input.price),
        input.currency,
        input.description ?? "",
        input.coverDataUrl ?? null,
        now,
        now,
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return rows[0]?.["[applied]"] === true;
  }

  public async get(courseId: string): Promise<AuthoringCourse | undefined> {
    const rows = await this.db.execute(
      `SELECT course_id,owner_lecturer_id,title,slug,category_id,state,content_version,record_version,price_type,price,currency,description,cover_data_url,created_at,updated_at,published_at FROM course_by_id WHERE course_id=?`,
      [types.Uuid.fromString(courseId)],
      "LOCAL_QUORUM",
    );
    const r = rows[0];
    if (!r) return undefined;
    return {
      courseId: String(r.course_id),
      ownerLecturerId: String(r.owner_lecturer_id),
      description: typeof r.description === "string" ? r.description : "",
      coverDataUrl: typeof r.cover_data_url === "string" ? r.cover_data_url : null,
      title: String(r.title),
      slug: String(r.slug),
      categoryId: String(r.category_id),
      state: String(r.state),
      contentVersion: Number(r.content_version),
      recordVersion: Number(r.record_version),
      priceType: String(r.price_type),
      price: String(r.price),
      currency: String(r.currency),
      createdAt: timestamp(r.created_at),
      updatedAt: timestamp(r.updated_at),
      ...(r.published_at ? { publishedAt: timestamp(r.published_at) } : {}),
    };
  }

  public async insertProjection(c: AuthoringCourse): Promise<void> {
    await this.db.execute(
      `INSERT INTO courses_by_lecturer (lecturer_id,updated_at,course_id,title,state,course_version) VALUES (?,?,?,?,?,?)`,
      [
        types.Uuid.fromString(c.ownerLecturerId),
        c.updatedAt,
        types.Uuid.fromString(c.courseId),
        c.title,
        c.state,
        types.Long.fromNumber(c.recordVersion),
      ],
      "LOCAL_QUORUM",
    );
  }
  public async deleteProjection(c: AuthoringCourse): Promise<void> {
    await this.db.execute(
      `DELETE FROM courses_by_lecturer WHERE lecturer_id=? AND updated_at=? AND course_id=?`,
      [types.Uuid.fromString(c.ownerLecturerId), c.updatedAt, types.Uuid.fromString(c.courseId)],
      "LOCAL_QUORUM",
    );
  }
  public async projectionMatches(c: AuthoringCourse): Promise<boolean> {
    const rows = await this.db.execute(
      `SELECT title,state,course_version FROM courses_by_lecturer WHERE lecturer_id=? AND updated_at=? AND course_id=?`,
      [types.Uuid.fromString(c.ownerLecturerId), c.updatedAt, types.Uuid.fromString(c.courseId)],
      "LOCAL_QUORUM",
    );
    const r = rows[0];
    return (
      !!r &&
      String(r.title) === c.title &&
      String(r.state) === c.state &&
      Number(r.course_version) === c.recordVersion
    );
  }

  public async update(current: AuthoringCourse, patch: CoursePatchRequest, now: Date): Promise<boolean> {
    await registerCategory(this.db, patch.categoryName);
    const next: AuthoringCourse = {
      ...current,
      description: patch.description ?? current.description ?? "",
      coverDataUrl: patch.coverDataUrl === undefined ? (current.coverDataUrl ?? null) : patch.coverDataUrl,
      title: patch.title ?? current.title,
      slug: patch.slug ?? current.slug,
      categoryId: patch.categoryId ?? current.categoryId,
      priceType: patch.priceType ?? current.priceType,
      price: patch.price ?? current.price,
      currency: patch.currency ?? current.currency,
      recordVersion: current.recordVersion + 1,
      updatedAt: now,
    };
    const rows = await this.db.execute(
      `UPDATE course_by_id SET title=?,slug=?,category_id=?,price_type=?,price=?,currency=?,description=?,cover_data_url=?,record_version=?,updated_at=? WHERE course_id=? IF owner_lecturer_id=? AND state='DRAFT' AND record_version=?`,
      [
        next.title,
        next.slug,
        types.Uuid.fromString(next.categoryId),
        next.priceType,
        types.BigDecimal.fromString(next.price),
        next.currency,
        next.description,
        next.coverDataUrl,
        types.Long.fromNumber(next.recordVersion),
        now,
        types.Uuid.fromString(current.courseId),
        types.Uuid.fromString(current.ownerLecturerId),
        types.Long.fromNumber(current.recordVersion),
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return rows[0]?.["[applied]"] === true;
  }

  public async paymentEventAt(eventId: string, occurredAt: Date): Promise<DueLearningEvent | undefined> {
    const dueDay = occurredAt.toISOString().slice(0, 10);
    const shard = eventBucket(eventId);
    const rows = await this.db.execute(
      "SELECT due_day,shard,next_attempt_at,event_id,payload_json,state,retry_count,lease_fence,lease_until FROM pending_events_by_due_bucket WHERE due_day=? AND shard=? AND next_attempt_at=? AND event_id=?",
      [types.LocalDate.fromString(dueDay), shard, occurredAt, types.Uuid.fromString(eventId)],
      "LOCAL_QUORUM",
    );
    const r = rows[0];
    if (!r) return undefined;
    return {
      dueDay,
      shard,
      nextAttemptAt: occurredAt,
      eventId,
      event: JSON.parse(String(r.payload_json)) as EventEnvelope,
      state: String(r.state),
      retryCount: Number(r.retry_count),
      leaseFence: Number(r.lease_fence ?? 0),
      ...(r.lease_until instanceof Date ? { leaseUntil: r.lease_until } : {}),
    };
  }
  public async paymentPublished(eventId: string): Promise<boolean> {
    const rows = await this.db.execute(
      "SELECT state FROM pending_event_by_id WHERE event_id=?",
      [types.Uuid.fromString(eventId)],
      "LOCAL_QUORUM",
    );
    return rows[0]?.state === "PUBLISHED";
  }

  public async listDue(now: Date): Promise<readonly DueLearningEvent[]> {
    const result: DueLearningEvent[] = [];
    for (let days = 0; days <= 1; days += 1) {
      const day = new Date(now);
      day.setUTCDate(day.getUTCDate() - days);
      const dueDay = day.toISOString().slice(0, 10);
      for (let shard = 0; shard < 16; shard += 1) {
        const rows = await this.db.execute(
          `SELECT due_day,shard,next_attempt_at,event_id,payload_json,state,retry_count,lease_fence,lease_until FROM pending_events_by_due_bucket WHERE due_day=? AND shard=? AND next_attempt_at<=? LIMIT 25`,
          [types.LocalDate.fromString(dueDay), shard, now],
          "LOCAL_QUORUM",
        );
        for (const r of rows) {
          const lease = r.lease_until as unknown;
          result.push({
            dueDay: String(r.due_day),
            shard: Number(r.shard),
            nextAttemptAt: r.next_attempt_at as Date,
            eventId: String(r.event_id),
            event: JSON.parse(String(r.payload_json)) as EventEnvelope,
            state: String(r.state),
            retryCount: Number(r.retry_count),
            leaseFence: Number(r.lease_fence ?? 0),
            ...(lease instanceof Date ? { leaseUntil: lease } : {}),
          });
        }
      }
    }
    return result.slice(0, 50);
  }
  public async claim(item: DueLearningEvent, owner: string, now: Date): Promise<boolean> {
    const fence = item.leaseFence + 1;
    const rows = await this.db.execute(
      `UPDATE pending_events_by_due_bucket SET state='PUBLISHING',lease_owner=?,lease_until=?,lease_fence=? WHERE due_day=? AND shard=? AND next_attempt_at=? AND event_id=? IF state='READY'`,
      [
        owner,
        new Date(now.getTime() + 15000),
        types.Long.fromNumber(fence),
        types.LocalDate.fromString(item.dueDay),
        item.shard,
        item.nextAttemptAt,
        types.Uuid.fromString(item.eventId),
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    if (rows[0]?.["[applied]"] !== true) return false;
    await this.db.execute(
      `UPDATE pending_event_by_id SET state='PUBLISHING',lease_fence=? WHERE event_id=?`,
      [types.Long.fromNumber(fence), types.Uuid.fromString(item.eventId)],
      "LOCAL_QUORUM",
    );
    return true;
  }
  public async retry(item: DueLearningEvent, next: Date): Promise<void> {
    const fence = item.leaseFence + 1;
    await this.db.execute(
      `UPDATE pending_events_by_due_bucket SET state='READY',retry_count=?,lease_owner=null,lease_until=? WHERE due_day=? AND shard=? AND next_attempt_at=? AND event_id=? IF state='PUBLISHING' AND lease_fence=?`,
      [
        item.retryCount + 1,
        next,
        types.LocalDate.fromString(item.dueDay),
        item.shard,
        item.nextAttemptAt,
        types.Uuid.fromString(item.eventId),
        types.Long.fromNumber(fence),
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    await this.db.execute(
      `UPDATE pending_event_by_id SET state='READY',retry_count=?,next_attempt_at=? WHERE event_id=? IF state='PUBLISHING' AND lease_fence=?`,
      [item.retryCount + 1, next, types.Uuid.fromString(item.eventId), types.Long.fromNumber(fence)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
  }
  public async recover(item: DueLearningEvent): Promise<void> {
    const rows = await this.db.execute(
      `UPDATE pending_events_by_due_bucket SET state='READY',lease_owner=null,lease_until=null WHERE due_day=? AND shard=? AND next_attempt_at=? AND event_id=? IF state='PUBLISHING' AND lease_fence=?`,
      [
        types.LocalDate.fromString(item.dueDay),
        item.shard,
        item.nextAttemptAt,
        types.Uuid.fromString(item.eventId),
        types.Long.fromNumber(item.leaseFence),
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    if (rows[0]?.["[applied]"] === true)
      await this.db.execute(
        `UPDATE pending_event_by_id SET state='READY' WHERE event_id=? IF state='PUBLISHING' AND lease_fence=?`,
        [types.Uuid.fromString(item.eventId), types.Long.fromNumber(item.leaseFence)],
        "LOCAL_QUORUM",
        "LOCAL_SERIAL",
      );
  }
  public async published(item: DueLearningEvent, now: Date): Promise<void> {
    const fence = item.leaseFence + 1;
    const rows = await this.db.execute(
      `UPDATE pending_event_by_id SET state='PUBLISHED',published_at=? WHERE event_id=? IF state='PUBLISHING' AND lease_fence=?`,
      [now, types.Uuid.fromString(item.eventId), types.Long.fromNumber(fence)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    if (rows[0]?.["[applied]"] !== true) throw new Error("OUTBOX_PUBLISH_FENCE_LOST");
    await this.db.execute(
      `DELETE FROM pending_events_by_due_bucket WHERE due_day=? AND shard=? AND next_attempt_at=? AND event_id=? IF state='PUBLISHING' AND lease_fence=?`,
      [
        types.LocalDate.fromString(item.dueDay),
        item.shard,
        item.nextAttemptAt,
        types.Uuid.fromString(item.eventId),
        types.Long.fromNumber(fence),
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
  }
}

function timestamp(value: unknown): Date {
  if (!(value instanceof Date)) throw new Error("INVALID_CASSANDRA_TIMESTAMP");
  return value;
}
