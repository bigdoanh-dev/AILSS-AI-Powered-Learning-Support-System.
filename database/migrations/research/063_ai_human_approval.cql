-- P10.3 additive Q-AI-003/Q-AI-006 approval and recovery authority.
CREATE TABLE IF NOT EXISTS ai_keyspace.ai_job_by_draft (
  draft_id uuid PRIMARY KEY,
  job_id uuid,
  lecturer_id uuid,
  generated_draft_version bigint,
  generated_draft_checksum text,
  created_at timestamp
);

CREATE TABLE IF NOT EXISTS ai_keyspace.ai_approval_by_draft (
  draft_id uuid PRIMARY KEY,
  operation_id uuid,
  idempotency_key text,
  actor_id uuid,
  fingerprint text,
  generated_draft_checksum text,
  approved_draft_checksum text,
  approved_object_key text,
  import_operation_id uuid,
  assessment_quiz_id uuid,
  assessment_quiz_version bigint,
  assessment_status text,
  response_json text,
  state text,
  version bigint,
  created_at timestamp,
  updated_at timestamp
);
