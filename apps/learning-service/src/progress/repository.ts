import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import type { EventEnvelope } from "../../../../packages/contracts/src/index.js";
import type { Progress, ProgressReceipt } from "./model.js";

const LQ = "LOCAL_QUORUM" as const,
  LS = "LOCAL_SERIAL" as const;
const uuid = (v: string) => types.Uuid.fromString(v),
  long = (v: number) => types.Long.fromNumber(v);
const day = (d: Date) => types.LocalDate.fromString(d.toISOString().slice(0, 10));
const shard = (id: string) => (Buffer.from(id.replaceAll("-", ""), "hex")[0] ?? 0) % 16;

export class LearningProgressRepository {
  constructor(private db: CassandraClient) {}
  async entitlement(studentId: string, courseId: string) {
    return (
      await this.db.execute(
        "SELECT state FROM entitlement_by_student_course WHERE student_id=? AND course_id=?",
        [uuid(studentId), uuid(courseId)],
        LQ,
      )
    )[0]?.state as string | undefined;
  }
  async course(courseId: string) {
    const r = (
      await this.db.execute(
        "SELECT state,content_version FROM course_by_id WHERE course_id=?",
        [uuid(courseId)],
        LQ,
      )
    )[0];
    return r ? { state: String(r.state), contentVersion: Number(r.content_version) } : undefined;
  }
  async lesson(lessonId: string) {
    const r = (
      await this.db.execute(
        "SELECT lesson_version,course_id FROM lesson_current_by_id WHERE lesson_id=?",
        [uuid(lessonId)],
        LQ,
      )
    )[0];
    return r ? { lessonVersion: Number(r.lesson_version), courseId: String(r.course_id) } : undefined;
  }
  async syllabus(courseId: string, version: number) {
    const rows = await this.db.execute(
      "SELECT lesson_id,state FROM lessons_by_course_version WHERE course_id=? AND content_version=? LIMIT 2000",
      [uuid(courseId), long(version)],
      LQ,
    );
    if (rows.length >= 2000) throw new Error("SYLLABUS_LIMIT_EXCEEDED");
    return rows.filter((r) => String(r.state) === "READY").map((r) => String(r.lesson_id));
  }
  async progress(studentId: string, courseId: string): Promise<Progress | undefined> {
    const r = (
      await this.db.execute(
        "SELECT progress_version,course_content_version,completed_count,published_total,percent,completed_at,updated_at,last_operation_id,last_event_id FROM progress_by_student_course WHERE student_id=? AND course_id=?",
        [uuid(studentId), uuid(courseId)],
        LQ,
      )
    )[0];
    return r
      ? {
          studentId,
          courseId,
          progressVersion: Number(r.progress_version),
          courseContentVersion: Number(r.course_content_version),
          completedCount: Number(r.completed_count),
          publishedTotal: Number(r.published_total),
          percent: Number(r.percent),
          ...(r.completed_at ? { completedAt: r.completed_at as Date } : {}),
          updatedAt: r.updated_at as Date,
          ...(r.last_operation_id ? { lastOperationId: String(r.last_operation_id) } : {}),
          ...(r.last_event_id ? { lastEventId: String(r.last_event_id) } : {}),
        }
      : undefined;
  }
  async completions(studentId: string, courseId: string) {
    const rows = await this.db.execute(
      "SELECT lesson_id,completed,completion_version,operation_id FROM lesson_completion_by_student_course WHERE student_id=? AND course_id=? LIMIT 2000",
      [uuid(studentId), uuid(courseId)],
      LQ,
    );
    if (rows.length >= 2000) throw new Error("COMPLETION_LIMIT_EXCEEDED");
    return rows.map((r) => ({
      lessonId: String(r.lesson_id),
      completed: r.completed === true,
      version: Number(r.completion_version),
      operationId: r.operation_id ? String(r.operation_id) : undefined,
    }));
  }
  async lock(studentId: string, courseId: string, operationId: string, now: Date) {
    const r = await this.db.execute(
      "INSERT INTO progress_mutation_by_student_course (student_id,course_id,operation_id,expires_at,updated_at) VALUES (?,?,?,?,?) IF NOT EXISTS USING TTL 30",
      [uuid(studentId), uuid(courseId), uuid(operationId), new Date(now.getTime() + 30000), now],
      LQ,
      LS,
    );
    return r[0]?.["[applied]"] === true || String(r[0]?.operation_id) === operationId;
  }
  async unlock(studentId: string, courseId: string, operationId: string) {
    await this.db.execute(
      "DELETE FROM progress_mutation_by_student_course WHERE student_id=? AND course_id=? IF operation_id=?",
      [uuid(studentId), uuid(courseId), uuid(operationId)],
      LQ,
      LS,
    );
  }
  async setCompletion(
    studentId: string,
    courseId: string,
    lessonId: string,
    lessonVersion: number,
    completed: boolean,
    operationId: string,
    now: Date,
    current?: { version: number },
  ) {
    const q = current
      ? "UPDATE lesson_completion_by_student_course SET completed=?,lesson_version=?,completed_at=?,completion_version=?,operation_id=? WHERE student_id=? AND course_id=? AND lesson_id=? IF completion_version=?"
      : "INSERT INTO lesson_completion_by_student_course (student_id,course_id,lesson_id,completed,lesson_version,completed_at,completion_version,operation_id) VALUES (?,?,?,?,?,?,1,?) IF NOT EXISTS";
    const p = current
      ? [
          completed,
          long(lessonVersion),
          completed ? now : null,
          long(current.version + 1),
          uuid(operationId),
          uuid(studentId),
          uuid(courseId),
          uuid(lessonId),
          long(current.version),
        ]
      : [
          uuid(studentId),
          uuid(courseId),
          uuid(lessonId),
          completed,
          long(lessonVersion),
          completed ? now : null,
          uuid(operationId),
        ];
    const r = await this.db.execute(q, p, LQ, LS);
    return r[0]?.["[applied]"] === true;
  }
  async writeProgress(p: Progress, operationId: string, eventId: string, expected: number | undefined) {
    const values = [
      long(p.progressVersion),
      long(p.courseContentVersion),
      p.completedCount,
      p.publishedTotal,
      p.percent,
      p.completedAt ?? null,
      p.updatedAt,
      uuid(operationId),
      uuid(eventId),
      uuid(p.studentId),
      uuid(p.courseId),
    ];
    const q =
      expected === undefined
        ? "INSERT INTO progress_by_student_course (progress_version,course_content_version,completed_count,published_total,percent,completed_at,updated_at,last_operation_id,last_event_id,student_id,course_id) VALUES (?,?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS"
        : "UPDATE progress_by_student_course SET progress_version=?,course_content_version=?,completed_count=?,published_total=?,percent=?,completed_at=?,updated_at=?,last_operation_id=?,last_event_id=? WHERE student_id=? AND course_id=? IF progress_version=?";
    const r = await this.db.execute(q, expected === undefined ? values : [...values, long(expected)], LQ, LS);
    return r[0]?.["[applied]"] === true;
  }
  async updateProjection(studentId: string, courseId: string, percent: number) {
    const e = (
      await this.db.execute(
        "SELECT enrolled_at FROM enrollment_by_student_course WHERE student_id=? AND course_id=?",
        [uuid(studentId), uuid(courseId)],
        LQ,
      )
    )[0];
    if (!e?.enrolled_at) return;
    const enrolled = e.enrolled_at as Date;
    await this.db.execute(
      "UPDATE courses_by_student_bucket SET progress_percent=? WHERE student_id=? AND state='ACTIVE' AND year_month=? AND enrolled_at=? AND course_id=?",
      [
        percent,
        uuid(studentId),
        types.LocalDate.fromString(enrolled.toISOString().slice(0, 7) + "-01"),
        enrolled,
        uuid(courseId),
      ],
      LQ,
    );
  }
  async reserve(
    scope: string,
    hash: number,
    key: string,
    operationId: string,
    lessonId: string,
    receipt: ProgressReceipt,
    now: Date,
  ) {
    const r = await this.db.execute(
      "INSERT INTO idempotency_by_scope_key (scope,key_hash,idempotency_key,operation_id,resource_id,result_code,status,result_checksum,created_at,expires_at) VALUES (?,?,?,?,?,0,'IN_PROGRESS',?,?,?) IF NOT EXISTS",
      [
        scope,
        hash,
        key,
        uuid(operationId),
        uuid(lessonId),
        JSON.stringify(receipt),
        now,
        new Date(now.getTime() + 86400000),
      ],
      LQ,
      LS,
    );
    return r[0]?.["[applied]"] === true;
  }
  async command(scope: string, hash: number, key: string) {
    const r = (
      await this.db.execute(
        "SELECT operation_id,status,result_checksum FROM idempotency_by_scope_key WHERE scope=? AND key_hash=? AND idempotency_key=?",
        [scope, hash, key],
        LQ,
      )
    )[0];
    return r
      ? {
          operationId: String(r.operation_id),
          status: String(r.status),
          receipt: JSON.parse(String(r.result_checksum)) as ProgressReceipt,
        }
      : undefined;
  }
  async save(
    scope: string,
    hash: number,
    key: string,
    operationId: string,
    receipt: ProgressReceipt,
    complete = false,
  ) {
    const r = await this.db.execute(
      `UPDATE idempotency_by_scope_key SET status='${complete ? "COMPLETE" : "IN_PROGRESS"}',result_code=?,result_checksum=? WHERE scope=? AND key_hash=? AND idempotency_key=? IF operation_id=?`,
      [complete ? 200 : 0, JSON.stringify(receipt), scope, hash, key, uuid(operationId)],
      LQ,
      LS,
    );
    if (r[0]?.["[applied]"] !== true) throw new Error("PROGRESS_COMMAND_CONFLICT");
  }
  async prepareEvent(
    eventId: string,
    courseId: string,
    version: number,
    studentId: string,
    percent: number,
    occurredAt: Date,
    correlationId: string,
  ) {
    const envelope: EventEnvelope = {
      specVersion: "1.0",
      eventId,
      eventType: "learning.progress.updated.v1",
      occurredAt: occurredAt.toISOString(),
      producer: "learning-service",
      correlationId,
      aggregate: { type: "COURSE_PROGRESS", id: courseId, version },
      data: { studentId, courseId, percent, version },
    };
    const s = shard(eventId);
    await this.db.execute(
      "INSERT INTO pending_events_by_due_bucket (due_day,shard,next_attempt_at,event_id,event_type,aggregate_id,aggregate_version,payload_json,state,retry_count,lease_fence,created_at) VALUES (?,?,?,?,?,?,?,?, 'PREPARED',0,0,?) IF NOT EXISTS",
      [
        day(occurredAt),
        s,
        occurredAt,
        uuid(eventId),
        "learning.progress.updated.v1",
        uuid(courseId),
        long(version),
        JSON.stringify(envelope),
        occurredAt,
      ],
      LQ,
      LS,
    );
    await this.db.execute(
      "INSERT INTO pending_event_by_id (event_id,event_type,aggregate_id,aggregate_version,state,next_attempt_at,retry_count,lease_fence,created_at) VALUES (?,?,?,?, 'PREPARED',?,0,0,?) IF NOT EXISTS",
      [uuid(eventId), "learning.progress.updated.v1", uuid(courseId), long(version), occurredAt, occurredAt],
      LQ,
      LS,
    );
  }
  async readyEvent(eventId: string, occurredAt: Date) {
    await this.db.execute(
      "UPDATE pending_events_by_due_bucket SET state='READY' WHERE due_day=? AND shard=? AND next_attempt_at=? AND event_id=? IF state='PREPARED'",
      [day(occurredAt), shard(eventId), occurredAt, uuid(eventId)],
      LQ,
      LS,
    );
    await this.db.execute(
      "UPDATE pending_event_by_id SET state='READY' WHERE event_id=? IF state='PREPARED'",
      [uuid(eventId)],
      LQ,
      LS,
    );
  }
}
