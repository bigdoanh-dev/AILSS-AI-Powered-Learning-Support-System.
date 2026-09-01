/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import type { EventEnvelope } from "../../../../packages/contracts/src/index.js";
import { eventShard, type DocumentRecord } from "../documents/model.js";
import type { CreateQuizJob, QuizJob, QuizJobState } from "./model.js";
const uuid = (v: string) => types.Uuid.fromString(v),
  long = (v: number) => types.Long.fromNumber(v),
  day = (d: Date) => types.LocalDate.fromString(d.toISOString().slice(0, 10));
export class AiQuizRepository {
  constructor(private readonly db: CassandraClient) {}
  async document(id: string): Promise<DocumentRecord | undefined> {
    const r = (
      await this.db.execute("SELECT * FROM document_by_id WHERE document_id=?", [uuid(id)], "LOCAL_QUORUM")
    )[0];
    if (!r) return;
    return {
      documentId: String(r.document_id),
      ownerId: String(r.owner_id),
      objectKey: String(r.object_key),
      fileName: String(r.file_name),
      declaredChecksum: String(r.declared_checksum),
      declaredMime: String(r.declared_mime),
      declaredSizeBytes: Number(r.declared_size_bytes),
      status: String(r.status) as DocumentRecord["status"],
      version: Number(r.version),
      uploadExpiresAt: new Date(String(r.upload_expires_at)),
      ...(r.extraction_object_key ? { extractionObjectKey: String(r.extraction_object_key) } : {}),
      ...(r.extraction_checksum ? { extractionChecksum: String(r.extraction_checksum) } : {}),
      createdAt: new Date(String(r.created_at)),
      updatedAt: new Date(String(r.updated_at ?? r.created_at)),
    };
  }
  async createJob(
    ids: { jobId: string; operationId: string; eventId: string },
    owner: string,
    body: CreateQuizJob,
    checksum: string,
    now: Date,
  ) {
    const r = await this.db.execute(
      "INSERT INTO ai_job_by_id (job_id,lecturer_id,target_type,target_id,document_id,state,operation_id,attempt_count,version,job_kind,constraints_json,constraints_checksum,generation_event_id,created_at,updated_at) VALUES (?,?,?,?,?,'QUEUED',?,0,1,'QUIZ_GENERATION',?,?,?, ?,?) IF NOT EXISTS",
      [
        uuid(ids.jobId),
        uuid(owner),
        body.targetType,
        uuid(body.targetId),
        uuid(body.documentId),
        uuid(ids.operationId),
        JSON.stringify(body),
        checksum,
        uuid(ids.eventId),
        now,
        now,
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return r[0]?.["[applied]"] === true;
  }
  async job(id: string): Promise<QuizJob | undefined> {
    const r = (
      await this.db.execute("SELECT * FROM ai_job_by_id WHERE job_id=?", [uuid(id)], "LOCAL_QUORUM")
    )[0];
    if (!r || String(r.job_kind) !== "QUIZ_GENERATION") return;
    return {
      jobId: String(r.job_id),
      lecturerId: String(r.lecturer_id),
      documentId: String(r.document_id),
      targetType: String(r.target_type) as QuizJob["targetType"],
      targetId: String(r.target_id),
      state: String(r.state) as QuizJobState,
      operationId: String(r.operation_id),
      version: Number(r.version),
      constraints: JSON.parse(String(r.constraints_json)),
      generationEventId: String(r.generation_event_id),
      ...(r.draft_id ? { draftId: String(r.draft_id) } : {}),
      ...(r.failure_code ? { failureCode: String(r.failure_code) } : {}),
      createdAt: new Date(String(r.created_at)),
      updatedAt: new Date(String(r.updated_at)),
    };
  }
  async project(j: QuizJob, state = j.state) {
    const month = types.LocalDate.fromString(j.createdAt.toISOString().slice(0, 7) + "-01");
    await this.db.execute(
      "INSERT INTO ai_jobs_by_lecturer_bucket (lecturer_id,state,year_month,created_at,job_id,target_type,target_id,job_version) VALUES (?,?,?,?,?,?,?,?)",
      [
        uuid(j.lecturerId),
        state,
        month,
        j.createdAt,
        uuid(j.jobId),
        j.targetType,
        uuid(j.targetId),
        long(j.version),
      ],
      "LOCAL_QUORUM",
    );
  }
  async moveProjection(j: QuizJob, next: QuizJobState, nextVersion: number) {
    const month = types.LocalDate.fromString(j.createdAt.toISOString().slice(0, 7) + "-01");
    await this.db.execute(
      "DELETE FROM ai_jobs_by_lecturer_bucket WHERE lecturer_id=? AND state=? AND year_month=? AND created_at=? AND job_id=?",
      [uuid(j.lecturerId), j.state, month, j.createdAt, uuid(j.jobId)],
      "LOCAL_QUORUM",
    );
    await this.db.execute(
      "INSERT INTO ai_jobs_by_lecturer_bucket (lecturer_id,state,year_month,created_at,job_id,target_type,target_id,job_version) VALUES (?,?,?,?,?,?,?,?)",
      [
        uuid(j.lecturerId),
        next,
        month,
        j.createdAt,
        uuid(j.jobId),
        j.targetType,
        uuid(j.targetId),
        long(nextVersion),
      ],
      "LOCAL_QUORUM",
    );
  }
  async cancel(j: QuizJob, now: Date) {
    const r = await this.db.execute(
      "UPDATE ai_job_by_id SET state='CANCELLED',version=?,updated_at=? WHERE job_id=? IF lecturer_id=? AND state=? AND version=?",
      [long(j.version + 1), now, uuid(j.jobId), uuid(j.lecturerId), j.state, long(j.version)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return r[0]?.["[applied]"] === true;
  }
  async list(owner: string, state: string, month: string, limit: number, pageState?: string) {
    return this.db.executePage(
      "SELECT created_at,job_id,target_type,target_id,job_version FROM ai_jobs_by_lecturer_bucket WHERE lecturer_id=? AND state=? AND year_month=?",
      [uuid(owner), state, types.LocalDate.fromString(month + "-01")],
      "LOCAL_QUORUM",
      limit,
      pageState,
    );
  }
  async drafts(jobId: string) {
    return this.db.execute(
      "SELECT draft_id,draft_version,validation_status,draft_object_key,question_count,state,created_at FROM ai_draft_by_job WHERE job_id=? LIMIT 20",
      [uuid(jobId)],
      "LOCAL_QUORUM",
    );
  }
  async usage(owner: string, date: Date) {
    return this.db.execute(
      "SELECT occurred_at,operation_id,provider,model,input_units,output_units,cost_estimate,state FROM ai_usage_by_user_day WHERE user_id=? AND usage_day=?",
      [uuid(owner), day(date)],
      "LOCAL_QUORUM",
    );
  }
  async prepare(event: EventEnvelope, now: Date) {
    const shard = eventShard(event.eventId);
    await this.db.execute(
      "INSERT INTO pending_event_by_id (event_id,event_type,aggregate_id,aggregate_version,state,next_attempt_at,retry_count,lease_fence,created_at) VALUES (?,?,?,?, 'READY',?,0,0,?) IF NOT EXISTS",
      [
        uuid(event.eventId),
        event.eventType,
        uuid(event.aggregate.id),
        long(event.aggregate.version),
        now,
        now,
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    await this.db.execute(
      "INSERT INTO pending_events_by_due_bucket (due_day,shard,next_attempt_at,event_id,event_type,aggregate_id,aggregate_version,payload_json,state,retry_count,lease_fence,created_at) VALUES (?,?,?,?,?,?,?,?, 'READY',0,0,?) IF NOT EXISTS",
      [
        day(now),
        shard,
        now,
        uuid(event.eventId),
        event.eventType,
        uuid(event.aggregate.id),
        long(event.aggregate.version),
        JSON.stringify(event),
        now,
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
  }
  async reserveQuota(owner: string, operationId: string, units: number, limit: number, now: Date) {
    const inserted = await this.db.execute(
      "INSERT INTO ai_usage_operation_by_id (operation_id,user_id,usage_day,state,reserved_units,occurred_at,updated_at) VALUES (?,?,?,'RESERVING',?,?,?) IF NOT EXISTS",
      [uuid(operationId), uuid(owner), day(now), units, now, now],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    if (inserted[0]?.["[applied]"] !== true) {
      const existing = (
        await this.db.execute(
          "SELECT user_id,state,reserved_units FROM ai_usage_operation_by_id WHERE operation_id=?",
          [uuid(operationId)],
          "LOCAL_QUORUM",
        )
      )[0];
      return (
        !!existing &&
        String(existing.user_id) === owner &&
        Number(existing.reserved_units) === units &&
        ["RESERVED", "CONSUMED"].includes(String(existing.state))
      );
    }
    await this.db.execute(
      "INSERT INTO ai_quota_by_user_day (user_id,usage_day,quota_limit,reserved,consumed,version,updated_at) VALUES (?,?,?,0,0,0,?) IF NOT EXISTS",
      [uuid(owner), day(now), limit, now],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    for (let attempt = 0; attempt < 8; attempt++) {
      const row = (
        await this.db.execute(
          "SELECT quota_limit,reserved,consumed,version FROM ai_quota_by_user_day WHERE user_id=? AND usage_day=?",
          [uuid(owner), day(now)],
          "LOCAL_QUORUM",
        )
      )[0];
      if (!row || Number(row.reserved) + Number(row.consumed) + units > Number(row.quota_limit)) {
        await this.db.execute(
          "UPDATE ai_usage_operation_by_id SET state='RELEASED',updated_at=? WHERE operation_id=? IF state='RESERVING'",
          [now, uuid(operationId)],
          "LOCAL_QUORUM",
          "LOCAL_SERIAL",
        );
        return false;
      }
      const applied = await this.db.execute(
        "UPDATE ai_quota_by_user_day SET reserved=?,version=?,updated_at=? WHERE user_id=? AND usage_day=? IF version=?",
        [
          Number(row.reserved) + units,
          long(Number(row.version) + 1),
          now,
          uuid(owner),
          day(now),
          long(Number(row.version)),
        ],
        "LOCAL_QUORUM",
        "LOCAL_SERIAL",
      );
      if (applied[0]?.["[applied]"] === true) {
        const completed = await this.db.execute(
          "UPDATE ai_usage_operation_by_id SET state='RESERVED',updated_at=? WHERE operation_id=? IF state='RESERVING'",
          [now, uuid(operationId)],
          "LOCAL_QUORUM",
          "LOCAL_SERIAL",
        );
        if (completed[0]?.["[applied]"] !== true) throw new Error("QUOTA_LEDGER_CONFLICT");
        return true;
      }
    }
    throw new Error("QUOTA_RESERVATION_CONTENTION");
  }
  async quota(owner: string, now: Date) {
    const r = (
      await this.db.execute(
        "SELECT quota_limit,reserved,consumed,updated_at FROM ai_quota_by_user_day WHERE user_id=? AND usage_day=?",
        [uuid(owner), day(now)],
        "LOCAL_QUORUM",
      )
    )[0];
    return r
      ? {
          day: now.toISOString().slice(0, 10),
          limit: Number(r.quota_limit),
          reserved: Number(r.reserved),
          consumed: Number(r.consumed),
          remaining: Math.max(0, Number(r.quota_limit) - Number(r.reserved) - Number(r.consumed)),
          updatedAt: new Date(String(r.updated_at)).toISOString(),
        }
      : { day: now.toISOString().slice(0, 10), limit: 0, reserved: 0, consumed: 0, remaining: 0 };
  }
  async releaseQuota(owner: string, operationId: string, now: Date) {
    const op = (
      await this.db.execute(
        "SELECT state,reserved_units,usage_day FROM ai_usage_operation_by_id WHERE operation_id=?",
        [uuid(operationId)],
        "LOCAL_QUORUM",
      )
    )[0];
    if (!op || String(op.state) === "RELEASED") return;
    const released = await this.db.execute(
      "UPDATE ai_usage_operation_by_id SET state='RELEASED',updated_at=? WHERE operation_id=? IF state='RESERVED'",
      [now, uuid(operationId)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    if (released[0]?.["[applied]"] !== true) return;
    for (let attempt = 0; attempt < 8; attempt++) {
      const q = (
        await this.db.execute(
          "SELECT reserved,version FROM ai_quota_by_user_day WHERE user_id=? AND usage_day=?",
          [uuid(owner), op.usage_day],
          "LOCAL_QUORUM",
        )
      )[0];
      if (!q) return;
      const moved = await this.db.execute(
        "UPDATE ai_quota_by_user_day SET reserved=?,version=?,updated_at=? WHERE user_id=? AND usage_day=? IF version=?",
        [
          Math.max(0, Number(q.reserved) - Number(op.reserved_units)),
          long(Number(q.version) + 1),
          now,
          uuid(owner),
          op.usage_day,
          long(Number(q.version)),
        ],
        "LOCAL_QUORUM",
        "LOCAL_SERIAL",
      );
      if (moved[0]?.["[applied]"] === true) return;
    }
    throw new Error("QUOTA_RELEASE_CONTENTION");
  }
}
