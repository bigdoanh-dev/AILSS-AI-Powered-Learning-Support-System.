-- P10.3 additive Q-ASMT-008 permanent AI import receipt authority.
CREATE TABLE IF NOT EXISTS assessment_keyspace.ai_draft_import_by_id (
  import_operation_id uuid PRIMARY KEY,
  draft_id uuid,
  approved_draft_version bigint,
  request_fingerprint text,
  quiz_id uuid,
  quiz_version bigint,
  status text,
  response_json text,
  command_state text,
  created_at timestamp,
  updated_at timestamp
);
