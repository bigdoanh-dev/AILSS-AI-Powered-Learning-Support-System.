/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../packages/cassandra/src/index.js";
import type { EventEnvelope } from "../../../packages/contracts/src/index.js";
const uuid = (v: string) => types.Uuid.fromString(v),
  long = (v: number) => types.Long.fromNumber(v),
  day = (d: Date) => types.LocalDate.fromString(d.toISOString().slice(0, 10));
export interface WorkerJob {
  jobId: string;
  lecturerId: string;
  documentId: string;
  targetType: string;
  targetId: string;
  state: string;
  operationId: string;
  version: number;
  constraints: { questionCount: number; questionTypes: string[]; difficulty: string };
  createdAt: Date;
  generatedEventId?: string;
  draftId?: string;
}
export class QuizWorkerRepository {
  constructor(private readonly db: CassandraClient) {}
  async job(id: string): Promise<WorkerJob | undefined> {
    const r = (
      await this.db.execute("SELECT * FROM ai_job_by_id WHERE job_id=?", [uuid(id)], "LOCAL_QUORUM")
    )[0];
    if (!r || String(r.job_kind) !== "QUIZ_GENERATION") return;
    return {
      jobId: String(r.job_id),
      lecturerId: String(r.lecturer_id),
      documentId: String(r.document_id),
      targetType: String(r.target_type),
      targetId: String(r.target_id),
      state: String(r.state),
      operationId: String(r.operation_id),
      version: Number(r.version),
      constraints: JSON.parse(String(r.constraints_json)),
      createdAt: new Date(String(r.created_at)),
      ...(r.generated_event_id ? { generatedEventId: String(r.generated_event_id) } : {}),
      ...(r.draft_id ? { draftId: String(r.draft_id) } : {}),
    };
  }
  async source(id: string) {
    const r = (
      await this.db.execute(
        "SELECT owner_id,status,extraction_object_key,extraction_checksum FROM document_by_id WHERE document_id=?",
        [uuid(id)],
        "LOCAL_QUORUM",
      )
    )[0];
    return r
      ? {
          ownerId: String(r.owner_id),
          status: String(r.status),
          key: String(r.extraction_object_key),
          checksum: String(r.extraction_checksum),
        }
      : undefined;
  }
  async transition(j: WorkerJob, next: string, now: Date) {
    const r = await this.db.execute(
      "UPDATE ai_job_by_id SET state=?,version=?,updated_at=? WHERE job_id=? IF state=? AND version=?",
      [next, long(j.version + 1), now, uuid(j.jobId), j.state, long(j.version)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    if (r[0]?.["[applied]"] === true) await this.syncProjection(j.jobId);
    return r[0]?.["[applied]"] === true;
  }
  async syncProjection(jobId: string) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const j = await this.job(jobId);
      if (!j) return;
      const month = types.LocalDate.fromString(j.createdAt.toISOString().slice(0, 7) + "-01");
      await this.db.execute(
        "INSERT INTO ai_jobs_by_lecturer_bucket (lecturer_id,state,year_month,created_at,job_id,target_type,target_id,job_version) VALUES (?,?,?,?,?,?,?,?)",
        [
          uuid(j.lecturerId),
          j.state,
          month,
          j.createdAt,
          uuid(j.jobId),
          j.targetType,
          uuid(j.targetId),
          long(j.version),
        ],
        "LOCAL_QUORUM",
      );
      for (const state of ["QUEUED", "PROCESSING", "VALIDATING", "AI_DRAFT", "FAILED", "CANCELLED"]) {
        if (state === j.state) continue;
        await this.db.execute(
          "DELETE FROM ai_jobs_by_lecturer_bucket WHERE lecturer_id=? AND state=? AND year_month=? AND created_at=? AND job_id=?",
          [uuid(j.lecturerId), state, month, j.createdAt, uuid(j.jobId)],
          "LOCAL_QUORUM",
        );
      }
      const latest = await this.job(jobId);
      if (latest?.version === j.version) return;
    }
    throw new Error("PROJECTION_CONTENTION");
  }
  async acquire(
    operationId: string,
    jobId: string,
    requestHash: string,
    providerKey: string,
    owner: string,
    now: Date,
  ) {
    await this.db.execute(
      "INSERT INTO provider_operation_by_id (operation_id,job_id,state,provider_attempt,lease_owner,lease_until,lease_fence,request_checksum,provider_idempotency_key,started_at,updated_at) VALUES (?,?,'CLAIMED',1,?,?,1,?,?,?,?) IF NOT EXISTS",
      [
        uuid(operationId),
        uuid(jobId),
        owner,
        new Date(now.getTime() + 60000),
        requestHash,
        providerKey,
        now,
        now,
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    const r = (
      await this.db.execute(
        "SELECT * FROM provider_operation_by_id WHERE operation_id=?",
        [uuid(operationId)],
        "LOCAL_QUORUM",
      )
    )[0];
    if (!r || String(r.job_id) !== jobId || String(r.request_checksum) !== requestHash)
      throw new Error("PROVIDER_FENCE_BINDING_MISMATCH");
    return {
      state: String(r.state),
      fence: Number(r.lease_fence),
      ...(r.result_ref ? { resultRef: String(r.result_ref) } : {}),
      ...(r.result_checksum ? { resultChecksum: String(r.result_checksum) } : {}),
      provider: String(r.provider ?? ""),
      model: String(r.model ?? ""),
      inputUnits: Number(r.input_units ?? 0),
      outputUnits: Number(r.output_units ?? 0),
    };
  }
  async providerResult(
    operationId: string,
    fence: number,
    result: {
      ref: string;
      checksum: string;
      provider: string;
      model: string;
      inputUnits: number;
      outputUnits: number;
    },
    now: Date,
  ) {
    const r = await this.db.execute(
      "UPDATE provider_operation_by_id SET state='RESULT_STORED',result_ref=?,result_checksum=?,provider=?,model=?,input_units=?,output_units=?,completed_at=?,updated_at=? WHERE operation_id=? IF state='CLAIMED' AND lease_fence=?",
      [
        result.ref,
        result.checksum,
        result.provider,
        result.model,
        long(result.inputUnits),
        long(result.outputUnits),
        now,
        now,
        uuid(operationId),
        long(fence),
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return r[0]?.["[applied]"] === true;
  }
  async saveDraft(
    j: WorkerJob,
    draft: {
      id: string;
      key: string;
      checksum: string;
      sourceChecksum: string;
      bytes: number;
      count: number;
    },
    now: Date,
  ) {
    await this.db.execute(
      "INSERT INTO ai_draft_by_job (job_id,draft_version,draft_id,source_checksum,validation_status,draft_object_key,draft_checksum,content_bytes,question_count,state,created_at) VALUES (?,1,?,?,'VALID',?,?,?,?,'AI_DRAFT',?) IF NOT EXISTS",
      [
        uuid(j.jobId),
        uuid(draft.id),
        draft.sourceChecksum,
        draft.key,
        draft.checksum,
        long(draft.bytes),
        draft.count,
        now,
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    await this.db.execute(
      "INSERT INTO ai_job_by_draft (draft_id,job_id,lecturer_id,generated_draft_version,generated_draft_checksum,created_at) VALUES (?,?,?,1,?,?) IF NOT EXISTS",
      [uuid(draft.id), uuid(j.jobId), uuid(j.lecturerId), draft.checksum, now],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
  }
  async commitDraft(j: WorkerJob, draftId: string, eventId: string, now: Date) {
    const r = await this.db.execute(
      "UPDATE ai_job_by_id SET state='AI_DRAFT',draft_id=?,generated_event_id=?,version=?,updated_at=? WHERE job_id=? IF state='VALIDATING' AND version=?",
      [uuid(draftId), uuid(eventId), long(j.version + 1), now, uuid(j.jobId), long(j.version)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    if (r[0]?.["[applied]"] === true) await this.syncProjection(j.jobId);
    return r[0]?.["[applied]"] === true;
  }
  async finalizeUsage(
    j: WorkerJob,
    u: { provider: string; model: string; inputUnits: number; outputUnits: number },
    now: Date,
  ) {
    const op = (
      await this.db.execute(
        "SELECT state,reserved_units,usage_day FROM ai_usage_operation_by_id WHERE operation_id=?",
        [uuid(j.operationId)],
        "LOCAL_QUORUM",
      )
    )[0];
    if (!op || String(op.state) === "CONSUMED") return;
    const applied = await this.db.execute(
      "UPDATE ai_usage_operation_by_id SET state='CONSUMED',input_units=?,output_units=?,provider=?,model=?,updated_at=? WHERE operation_id=? IF state='RESERVED'",
      [long(u.inputUnits), long(u.outputUnits), u.provider, u.model, now, uuid(j.operationId)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    if (applied[0]?.["[applied]"] !== true) return;
    for (let attempt = 0; attempt < 8; attempt++) {
      const quota = (
        await this.db.execute(
          "SELECT reserved,consumed,version FROM ai_quota_by_user_day WHERE user_id=? AND usage_day=?",
          [uuid(j.lecturerId), op.usage_day],
          "LOCAL_QUORUM",
        )
      )[0];
      if (!quota) throw new Error("QUOTA_AGGREGATE_MISSING");
      const moved = await this.db.execute(
        "UPDATE ai_quota_by_user_day SET reserved=?,consumed=?,version=?,updated_at=? WHERE user_id=? AND usage_day=? IF version=?",
        [
          Math.max(0, Number(quota.reserved) - Number(op.reserved_units)),
          Number(quota.consumed) + Number(op.reserved_units),
          long(Number(quota.version) + 1),
          now,
          uuid(j.lecturerId),
          op.usage_day,
          long(Number(quota.version)),
        ],
        "LOCAL_QUORUM",
        "LOCAL_SERIAL",
      );
      if (moved[0]?.["[applied]"] === true) break;
      if (attempt === 7) throw new Error("QUOTA_FINALIZATION_CONTENTION");
    }
    await this.db.execute(
      "INSERT INTO ai_usage_by_user_day (user_id,usage_day,occurred_at,operation_id,provider,model,input_units,output_units,state) VALUES (?,?,?,?,?,?,?,?,'CONSUMED') IF NOT EXISTS",
      [
        uuid(j.lecturerId),
        op.usage_day,
        now,
        uuid(j.operationId),
        u.provider,
        u.model,
        long(u.inputUnits),
        long(u.outputUnits),
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
  }
  async prepare(event: EventEnvelope, now: Date) {
    const shard = (Buffer.from(event.eventId.replaceAll("-", ""), "hex")[0] ?? 0) % 16;
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
  async fail(j: WorkerJob, code: string, eventId: string, correlationId: string, now: Date) {
    const current = await this.job(j.jobId);
    if (
      !current ||
      current.state === "CANCELLED" ||
      current.state === "AI_DRAFT" ||
      current.state === "FAILED"
    )
      return;
    const r = await this.db.execute(
      "UPDATE ai_job_by_id SET state='FAILED',failure_code=?,version=?,updated_at=? WHERE job_id=? IF state=? AND version=?",
      [code, long(current.version + 1), now, uuid(j.jobId), current.state, long(current.version)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    if (r[0]?.["[applied]"] === true) {
      await this.syncProjection(j.jobId);
      await this.prepare(
        {
          specVersion: "1.0",
          eventId,
          eventType: "ai.job.failed.v1",
          occurredAt: now.toISOString(),
          producer: "ai-worker",
          correlationId,
          aggregate: { type: "AI_JOB", id: j.jobId, version: current.version + 1 },
          data: { jobId: j.jobId, failureCode: code },
        },
        now,
      );
    }
  }
}
