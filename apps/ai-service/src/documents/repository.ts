import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import type { EventEnvelope } from "../../../../packages/contracts/src/index.js";
import { eventShard, type DocumentRecord, type IdempotencyRecord, type IntentRequest } from "./model.js";

const uuid = (value: string) => types.Uuid.fromString(value);
const long = (value: number) => types.Long.fromNumber(value);
export class AiDocumentRepository {
  constructor(private readonly db: CassandraClient) {}
  async reserve(
    scope: string,
    hash: number,
    key: string,
    ids: { operationId: string; documentId: string },
    fp: string,
    now: Date,
  ) {
    const rows = await this.db.execute(
      "INSERT INTO idempotency_by_scope_key (scope,key_hash,idempotency_key,operation_id,resource_id,result_code,status,result_checksum,created_at,expires_at,request_fingerprint,response_status,response_body_json,updated_at) VALUES (?,?,?,?,?,0,'IN_PROGRESS','',?,?,?,?,null,?) IF NOT EXISTS",
      [
        scope,
        hash,
        key,
        uuid(ids.operationId),
        uuid(ids.documentId),
        now,
        new Date(now.getTime() + 86400000),
        fp,
        0,
        now,
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return rows[0]?.["[applied]"] === true;
  }
  async idempotency(scope: string, hash: number, key: string): Promise<IdempotencyRecord | undefined> {
    const rows = await this.db.execute(
      "SELECT operation_id,resource_id,request_fingerprint,status,response_status,response_body_json FROM idempotency_by_scope_key WHERE scope=? AND key_hash=? AND idempotency_key=?",
      [scope, hash, key],
      "LOCAL_QUORUM",
    );
    const r = rows[0];
    if (!r) return undefined;
    return {
      operationId: String(r.operation_id),
      resourceId: String(r.resource_id),
      fingerprint: String(r.request_fingerprint),
      status: String(r.status),
      ...(r.response_status ? { responseStatus: Number(r.response_status) } : {}),
      ...(r.response_body_json ? { responseBody: JSON.parse(String(r.response_body_json)) } : {}),
    };
  }
  async completeCommand(
    scope: string,
    hash: number,
    key: string,
    operationId: string,
    status: number,
    body: unknown,
  ) {
    const rows = await this.db.execute(
      "UPDATE idempotency_by_scope_key SET status='COMPLETE',result_code=?,response_status=?,response_body_json=?,updated_at=? WHERE scope=? AND key_hash=? AND idempotency_key=? IF operation_id=?",
      [status, status, JSON.stringify(body), new Date(), scope, hash, key, uuid(operationId)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    if (rows[0]?.["[applied]"] !== true) throw new Error("IDEMPOTENCY_COMPLETE_CONFLICT");
  }
  async createDocument(
    documentId: string,
    ownerId: string,
    key: string,
    input: IntentRequest,
    expires: Date,
    now: Date,
  ) {
    const rows = await this.db.execute(
      "INSERT INTO document_by_id (document_id,owner_id,object_key,file_name,declared_checksum,declared_mime,declared_size_bytes,status,malware_scan_status,version,upload_expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'UPLOAD_PENDING','NOT_AVAILABLE',1,?,?,?) IF NOT EXISTS",
      [
        uuid(documentId),
        uuid(ownerId),
        key,
        input.fileName,
        input.sha256,
        input.contentType,
        long(input.sizeBytes),
        expires,
        now,
        now,
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return rows[0]?.["[applied]"] === true;
  }
  async get(documentId: string): Promise<DocumentRecord | undefined> {
    const rows = await this.db.execute(
      "SELECT * FROM document_by_id WHERE document_id=?",
      [uuid(documentId)],
      "LOCAL_QUORUM",
    );
    const r = rows[0];
    if (!r) return undefined;
    return {
      documentId: String(r.document_id),
      ownerId: String(r.owner_id),
      objectKey: String(r.object_key),
      fileName: String(r.file_name),
      declaredChecksum: String(r.declared_checksum),
      declaredMime: String(r.declared_mime),
      declaredSizeBytes: Number(r.declared_size_bytes),
      ...(r.checksum ? { checksum: String(r.checksum) } : {}),
      ...(r.mime ? { mime: String(r.mime) } : {}),
      ...(r.size_bytes !== null && r.size_bytes !== undefined ? { sizeBytes: Number(r.size_bytes) } : {}),
      status: String(r.status) as DocumentRecord["status"],
      version: Number(r.version),
      uploadExpiresAt: new Date(String(r.upload_expires_at)),
      ...(r.operation_id ? { operationId: String(r.operation_id) } : {}),
      ...(r.job_id ? { jobId: String(r.job_id) } : {}),
      ...(r.event_id ? { eventId: String(r.event_id) } : {}),
      ...(r.extraction_object_key ? { extractionObjectKey: String(r.extraction_object_key) } : {}),
      ...(r.extraction_checksum ? { extractionChecksum: String(r.extraction_checksum) } : {}),
      ...(r.extracted_bytes !== null && r.extracted_bytes !== undefined
        ? { extractedBytes: Number(r.extracted_bytes) }
        : {}),
      ...(r.extracted_characters !== null && r.extracted_characters !== undefined
        ? { extractedCharacters: Number(r.extracted_characters) }
        : {}),
      ...(r.parser_version ? { parserVersion: String(r.parser_version) } : {}),
      ...(r.failure_code ? { failureCode: String(r.failure_code) } : {}),
      createdAt: new Date(String(r.created_at)),
      updatedAt: new Date(String(r.updated_at ?? r.created_at)),
    };
  }
  async queueExtraction(
    d: DocumentRecord,
    input: { sizeBytes: number; sha256: string; contentType: string },
    ids: { operationId: string; jobId: string; eventId: string },
    now: Date,
  ) {
    const rows = await this.db.execute(
      "UPDATE document_by_id SET checksum=?,mime=?,size_bytes=?,status='EXTRACTION_QUEUED',version=2,operation_id=?,job_id=?,event_id=?,updated_at=? WHERE document_id=? IF owner_id=? AND object_key=? AND status='UPLOAD_PENDING' AND version=1",
      [
        input.sha256,
        input.contentType,
        long(input.sizeBytes),
        uuid(ids.operationId),
        uuid(ids.jobId),
        uuid(ids.eventId),
        now,
        uuid(d.documentId),
        uuid(d.ownerId),
        d.objectKey,
      ],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    return rows[0]?.["[applied]"] === true;
  }
  async createJob(jobId: string, d: DocumentRecord, operationId: string, now: Date) {
    await this.db.execute(
      "INSERT INTO ai_job_by_id (job_id,lecturer_id,target_type,target_id,document_id,state,operation_id,attempt_count,version,job_kind,created_at,updated_at) VALUES (?,?,'DOCUMENT',?,?, 'QUEUED',?,0,1,'DOCUMENT_EXTRACTION',?,?) IF NOT EXISTS",
      [uuid(jobId), uuid(d.ownerId), uuid(d.documentId), uuid(d.documentId), uuid(operationId), now, now],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
  }
  async prepareEvent(event: EventEnvelope, now: Date) {
    const day = types.LocalDate.fromString(now.toISOString().slice(0, 10)),
      shard = eventShard(event.eventId);
    await this.db.execute(
      "INSERT INTO pending_event_by_id (event_id,event_type,aggregate_id,aggregate_version,state,next_attempt_at,retry_count,lease_fence,created_at) VALUES (?,?,?,?, 'PREPARED',?,0,0,?) IF NOT EXISTS",
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
      "INSERT INTO pending_events_by_due_bucket (due_day,shard,next_attempt_at,event_id,event_type,aggregate_id,aggregate_version,payload_json,state,retry_count,lease_fence,created_at) VALUES (?,?,?,?,?,?,?,?, 'PREPARED',0,0,?) IF NOT EXISTS",
      [
        day,
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
  async readyEvent(eventId: string, occurredAt: Date) {
    const day = types.LocalDate.fromString(occurredAt.toISOString().slice(0, 10)),
      shard = eventShard(eventId);
    await this.db.execute(
      "UPDATE pending_event_by_id SET state='READY' WHERE event_id=? IF state='PREPARED'",
      [uuid(eventId)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
    await this.db.execute(
      "UPDATE pending_events_by_due_bucket SET state='READY' WHERE due_day=? AND shard=? AND next_attempt_at=? AND event_id=? IF state='PREPARED'",
      [day, shard, occurredAt, uuid(eventId)],
      "LOCAL_QUORUM",
      "LOCAL_SERIAL",
    );
  }
}
