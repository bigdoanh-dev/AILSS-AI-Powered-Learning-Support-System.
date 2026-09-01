-- P10.1 additive remediation under Q-AI-001/Q-AI-004/Q-AI-006.
ALTER TABLE ai_keyspace.document_by_id ADD IF NOT EXISTS file_name text;
ALTER TABLE ai_keyspace.document_by_id ADD IF NOT EXISTS declared_checksum text;
ALTER TABLE ai_keyspace.document_by_id ADD IF NOT EXISTS declared_mime text;
ALTER TABLE ai_keyspace.document_by_id ADD IF NOT EXISTS declared_size_bytes bigint;
ALTER TABLE ai_keyspace.document_by_id ADD IF NOT EXISTS version bigint;
ALTER TABLE ai_keyspace.document_by_id ADD IF NOT EXISTS upload_expires_at timestamp;
ALTER TABLE ai_keyspace.document_by_id ADD IF NOT EXISTS operation_id uuid;
ALTER TABLE ai_keyspace.document_by_id ADD IF NOT EXISTS job_id uuid;
ALTER TABLE ai_keyspace.document_by_id ADD IF NOT EXISTS event_id uuid;
ALTER TABLE ai_keyspace.document_by_id ADD IF NOT EXISTS extraction_object_key text;
ALTER TABLE ai_keyspace.document_by_id ADD IF NOT EXISTS extraction_checksum text;
ALTER TABLE ai_keyspace.document_by_id ADD IF NOT EXISTS extracted_bytes bigint;
ALTER TABLE ai_keyspace.document_by_id ADD IF NOT EXISTS extracted_characters bigint;
ALTER TABLE ai_keyspace.document_by_id ADD IF NOT EXISTS parser_version text;
ALTER TABLE ai_keyspace.document_by_id ADD IF NOT EXISTS failure_code text;
ALTER TABLE ai_keyspace.document_by_id ADD IF NOT EXISTS updated_at timestamp;

ALTER TABLE ai_keyspace.ai_job_by_id ADD IF NOT EXISTS job_kind text;
ALTER TABLE ai_keyspace.ai_job_by_id ADD IF NOT EXISTS result_status text;

ALTER TABLE ai_keyspace.idempotency_by_scope_key ADD IF NOT EXISTS request_fingerprint text;
ALTER TABLE ai_keyspace.idempotency_by_scope_key ADD IF NOT EXISTS response_status int;
ALTER TABLE ai_keyspace.idempotency_by_scope_key ADD IF NOT EXISTS response_body_json text;
ALTER TABLE ai_keyspace.idempotency_by_scope_key ADD IF NOT EXISTS updated_at timestamp;
