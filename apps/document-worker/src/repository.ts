import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../packages/cassandra/src/index.js";
const uuid = (v: string) => types.Uuid.fromString(v),
  long = (v: number) => types.Long.fromNumber(v);
export interface WorkerDocument {
  documentId: string;
  ownerId: string;
  objectKey: string;
  checksum: string;
  mime: string;
  size: number;
  status: string;
  version: number;
  operationId: string;
  jobId: string;
  attemptCount: number;
}
export class DocumentWorkerRepository {
  constructor(private readonly db: CassandraClient) {}
  async get(id: string): Promise<WorkerDocument | undefined> {
    const r = (
      await this.db.execute(
        "SELECT document_id,owner_id,object_key,checksum,mime,size_bytes,status,version,operation_id,job_id FROM document_by_id WHERE document_id=?",
        [uuid(id)],
        "LOCAL_QUORUM",
      )
    )[0];
    if (!r) return;
    const job = (
      await this.db.execute(
        "SELECT attempt_count FROM ai_job_by_id WHERE job_id=?",
        [uuid(String(r.job_id))],
        "LOCAL_QUORUM",
      )
    )[0];
    return {
      documentId: String(r.document_id),
      ownerId: String(r.owner_id),
      objectKey: String(r.object_key),
      checksum: String(r.checksum),
      mime: String(r.mime),
      size: Number(r.size_bytes),
      status: String(r.status),
      version: Number(r.version),
      operationId: String(r.operation_id),
      jobId: String(r.job_id),
      attemptCount: Number(job?.attempt_count ?? 0),
    };
  }
  async claim(d: WorkerDocument, now: Date) {
    if (d.status === "EXTRACTING") {
      await this.db.execute(
        "UPDATE ai_job_by_id SET attempt_count=?,updated_at=? WHERE job_id=?",
        [d.attemptCount + 1, now, uuid(d.jobId)],
        "LOCAL_QUORUM",
      );
      return true;
    }
    const rows = await this.db.execute(
      "UPDATE document_by_id SET status='EXTRACTING',version=3,updated_at=? WHERE document_id=? IF status='EXTRACTION_QUEUED' AND version=2 AND operation_id=?",
      [now, uuid(d.documentId), uuid(d.operationId)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    if (rows[0]?.["[applied]"] === true) {
      await this.db.execute(
        "UPDATE ai_job_by_id SET state='PROCESSING',attempt_count=1,version=2,updated_at=? WHERE job_id=? IF state='QUEUED'",
        [now, uuid(d.jobId)],
        "LOCAL_QUORUM",
        "LOCAL_SERIAL",
      );
      return true;
    }
    return false;
  }
  async validating(d: WorkerDocument, now: Date) {
    await this.db.execute(
      "UPDATE ai_job_by_id SET state='VALIDATING',version=3,updated_at=? WHERE job_id=? IF state='PROCESSING'",
      [now, uuid(d.jobId)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
  }
  async success(
    d: WorkerDocument,
    result: { key: string; checksum: string; bytes: number; characters: number; parserVersion: string },
    now: Date,
  ) {
    const rows = await this.db.execute(
      "UPDATE document_by_id SET status='EXTRACTED',version=4,extraction_object_key=?,extraction_checksum=?,extracted_bytes=?,extracted_characters=?,parser_version=?,failure_code=null,updated_at=? WHERE document_id=? IF status='EXTRACTING' AND operation_id=?",
      [
        result.key,
        result.checksum,
        long(result.bytes),
        long(result.characters),
        result.parserVersion,
        now,
        uuid(d.documentId),
        uuid(d.operationId),
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    if (rows[0]?.["[applied]"] === true)
      await this.db.execute(
        "UPDATE ai_job_by_id SET state='COMPLETED',result_status='EXTRACTED',version=4,updated_at=? WHERE job_id=? IF state='VALIDATING'",
        [now, uuid(d.jobId)],
        "LOCAL_QUORUM",
        "LOCAL_SERIAL",
      );
    return rows[0]?.["[applied]"] === true;
  }
  async fail(d: WorkerDocument, code: string, quarantined: boolean, now: Date) {
    await this.db.execute(
      "UPDATE document_by_id SET status=?,version=4,failure_code=?,updated_at=? WHERE document_id=? IF operation_id=?",
      [quarantined ? "QUARANTINED" : "FAILED", code, now, uuid(d.documentId), uuid(d.operationId)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    await this.db.execute(
      "UPDATE ai_job_by_id SET state='FAILED',result_status=?,failure_code=?,version=4,updated_at=? WHERE job_id=?",
      [quarantined ? "QUARANTINED" : "FAILED", code, now, uuid(d.jobId)],
      "LOCAL_QUORUM",
    );
  }
}
