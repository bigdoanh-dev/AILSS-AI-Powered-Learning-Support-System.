-- P10.2 additive remediation under Q-AI-001/002/003/005/007.
ALTER TABLE ai_keyspace.ai_job_by_id ADD IF NOT EXISTS constraints_json text;
ALTER TABLE ai_keyspace.ai_job_by_id ADD IF NOT EXISTS constraints_checksum text;
ALTER TABLE ai_keyspace.ai_job_by_id ADD IF NOT EXISTS generation_event_id uuid;
ALTER TABLE ai_keyspace.ai_job_by_id ADD IF NOT EXISTS generated_event_id uuid;
ALTER TABLE ai_keyspace.ai_job_by_id ADD IF NOT EXISTS draft_id uuid;

ALTER TABLE ai_keyspace.ai_draft_by_job ADD IF NOT EXISTS draft_id uuid;
ALTER TABLE ai_keyspace.ai_draft_by_job ADD IF NOT EXISTS draft_checksum text;
ALTER TABLE ai_keyspace.ai_draft_by_job ADD IF NOT EXISTS content_bytes bigint;

ALTER TABLE ai_keyspace.provider_operation_by_id ADD IF NOT EXISTS provider_idempotency_key text;
ALTER TABLE ai_keyspace.provider_operation_by_id ADD IF NOT EXISTS provider text;
ALTER TABLE ai_keyspace.provider_operation_by_id ADD IF NOT EXISTS model text;
ALTER TABLE ai_keyspace.provider_operation_by_id ADD IF NOT EXISTS result_checksum text;
ALTER TABLE ai_keyspace.provider_operation_by_id ADD IF NOT EXISTS input_units bigint;
ALTER TABLE ai_keyspace.provider_operation_by_id ADD IF NOT EXISTS output_units bigint;
ALTER TABLE ai_keyspace.provider_operation_by_id ADD IF NOT EXISTS safe_failure_code text;
ALTER TABLE ai_keyspace.provider_operation_by_id ADD IF NOT EXISTS updated_at timestamp;

CREATE TABLE IF NOT EXISTS ai_keyspace.ai_quota_by_user_day (
  user_id uuid,
  usage_day date,
  quota_limit int,
  reserved int,
  consumed int,
  version bigint,
  updated_at timestamp,
  PRIMARY KEY ((user_id, usage_day))
);

CREATE TABLE IF NOT EXISTS ai_keyspace.ai_usage_operation_by_id (
  operation_id uuid PRIMARY KEY,
  user_id uuid,
  usage_day date,
  state text,
  reserved_units int,
  input_units bigint,
  output_units bigint,
  provider text,
  model text,
  occurred_at timestamp,
  updated_at timestamp
);
