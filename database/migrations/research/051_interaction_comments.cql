CREATE TABLE IF NOT EXISTS interaction_keyspace.comment_timeline_bounds_by_target (
  target_type text,
  target_id uuid,
  earliest_day date,
  latest_day date,
  version bigint,
  updated_at timestamp,
  PRIMARY KEY ((target_type, target_id))
);

ALTER TABLE interaction_keyspace.idempotency_by_scope_key ADD IF NOT EXISTS request_fingerprint text;
ALTER TABLE interaction_keyspace.idempotency_by_scope_key ADD IF NOT EXISTS command_state text;
ALTER TABLE interaction_keyspace.idempotency_by_scope_key ADD IF NOT EXISTS result_version bigint;
ALTER TABLE interaction_keyspace.idempotency_by_scope_key ADD IF NOT EXISTS response_status int;
ALTER TABLE interaction_keyspace.idempotency_by_scope_key ADD IF NOT EXISTS response_body_json text;
ALTER TABLE interaction_keyspace.idempotency_by_scope_key ADD IF NOT EXISTS response_checksum text;
ALTER TABLE interaction_keyspace.idempotency_by_scope_key ADD IF NOT EXISTS updated_at timestamp;
ALTER TABLE interaction_keyspace.comment_by_id ADD IF NOT EXISTS pending_operation_id uuid;
ALTER TABLE interaction_keyspace.comment_by_id ADD IF NOT EXISTS pending_operation_kind text;
ALTER TABLE interaction_keyspace.comment_by_id ADD IF NOT EXISTS pending_expected_version bigint;
ALTER TABLE interaction_keyspace.comment_by_id ADD IF NOT EXISTS pending_content_checksum text;
