-- Generated from locked Phase 4 table specifications. Do not edit without ADR/schema review.

CREATE TABLE IF NOT EXISTS ai_keyspace.ai_job_by_id (
  job_id uuid,
  lecturer_id uuid,
  target_type text,
  target_id uuid,
  document_id uuid,
  state text,
  operation_id uuid,
  attempt_count int,
  version bigint,
  failure_code text,
  created_at timestamp,
  updated_at timestamp,
  PRIMARY KEY (job_id)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS ai_keyspace.ai_jobs_by_lecturer_bucket (
  lecturer_id uuid,
  state text,
  year_month date,
  created_at timestamp,
  job_id uuid,
  target_type text,
  target_id uuid,
  job_version bigint,
  PRIMARY KEY ((lecturer_id, state, year_month), created_at, job_id)
)
WITH CLUSTERING ORDER BY (created_at DESC, job_id ASC)
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': '1'};

CREATE TABLE IF NOT EXISTS ai_keyspace.ai_draft_by_job (
  job_id uuid,
  draft_version bigint,
  source_checksum text,
  validation_status text,
  draft_object_key text,
  question_count int,
  state text,
  created_at timestamp,
  PRIMARY KEY (job_id, draft_version)
)
WITH CLUSTERING ORDER BY (draft_version DESC)
AND compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS ai_keyspace.document_by_id (
  document_id uuid,
  owner_id uuid,
  object_key text,
  checksum text,
  mime text,
  size_bytes bigint,
  status text,
  malware_scan_status text,
  created_at timestamp,
  PRIMARY KEY (document_id)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS ai_keyspace.ai_usage_by_user_day (
  user_id uuid,
  usage_day date,
  occurred_at timestamp,
  operation_id uuid,
  provider text,
  model text,
  input_units bigint,
  output_units bigint,
  cost_estimate decimal,
  state text,
  PRIMARY KEY ((user_id, usage_day), occurred_at, operation_id)
)
WITH CLUSTERING ORDER BY (occurred_at DESC, operation_id ASC)
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': '1'};

CREATE TABLE IF NOT EXISTS ai_keyspace.provider_operation_by_id (
  operation_id uuid,
  job_id uuid,
  state text,
  provider_attempt int,
  lease_owner text,
  lease_until timestamp,
  lease_fence bigint,
  request_checksum text,
  result_ref text,
  started_at timestamp,
  completed_at timestamp,
  PRIMARY KEY (operation_id)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS ai_keyspace.pending_event_by_id (
  event_id uuid,
  event_type text,
  aggregate_id uuid,
  aggregate_version bigint,
  state text,
  next_attempt_at timestamp,
  retry_count int,
  lease_fence bigint,
  created_at timestamp,
  published_at timestamp,
  PRIMARY KEY (event_id)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS ai_keyspace.pending_events_by_due_bucket (
  due_day date,
  shard tinyint,
  next_attempt_at timestamp,
  event_id uuid,
  event_type text,
  aggregate_id uuid,
  aggregate_version bigint,
  payload_json text,
  state text,
  retry_count int,
  lease_owner text,
  lease_until timestamp,
  lease_fence bigint,
  created_at timestamp,
  PRIMARY KEY ((due_day, shard), next_attempt_at, event_id)
)
WITH CLUSTERING ORDER BY (next_attempt_at ASC, event_id ASC)
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': '1'};

CREATE TABLE IF NOT EXISTS ai_keyspace.reconcile_operation_by_id (
  operation_id uuid,
  projection_name text,
  canonical_id uuid,
  canonical_version bigint,
  projection_version bigint,
  checksum text,
  state text,
  retry_count int,
  next_attempt_at timestamp,
  last_error text,
  updated_at timestamp,
  PRIMARY KEY (operation_id)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS ai_keyspace.reconcile_by_due_bucket (
  due_day date,
  shard tinyint,
  next_attempt_at timestamp,
  operation_id uuid,
  projection_name text,
  canonical_id uuid,
  canonical_version bigint,
  state text,
  PRIMARY KEY ((due_day, shard), next_attempt_at, operation_id)
)
WITH CLUSTERING ORDER BY (next_attempt_at ASC, operation_id ASC)
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': '1'};

CREATE TABLE IF NOT EXISTS ai_keyspace.idempotency_by_scope_key (
  scope text,
  key_hash tinyint,
  idempotency_key text,
  operation_id uuid,
  resource_id uuid,
  result_code int,
  status text,
  result_checksum text,
  created_at timestamp,
  expires_at timestamp,
  PRIMARY KEY ((scope, key_hash), idempotency_key)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};
