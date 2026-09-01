-- P8.1 additive Q-ASMT-001/Q-ASMT-007 correctness remediation.
ALTER TABLE assessment_keyspace.quiz_by_id ADD IF NOT EXISTS title text;
ALTER TABLE assessment_keyspace.quiz_by_id ADD IF NOT EXISTS created_at timestamp;
ALTER TABLE assessment_keyspace.quiz_by_id ADD IF NOT EXISTS question_count int;
ALTER TABLE assessment_keyspace.quiz_by_id ADD IF NOT EXISTS snapshot_checksum text;
ALTER TABLE assessment_keyspace.quiz_by_id ADD IF NOT EXISTS snapshot_ready boolean;
ALTER TABLE assessment_keyspace.quiz_by_id ADD IF NOT EXISTS pending_operation_id uuid;
ALTER TABLE assessment_keyspace.quiz_by_id ADD IF NOT EXISTS pending_version bigint;
ALTER TABLE assessment_keyspace.quiz_by_id ADD IF NOT EXISTS pending_question_count int;
ALTER TABLE assessment_keyspace.quiz_by_id ADD IF NOT EXISTS pending_snapshot_checksum text;

CREATE TABLE IF NOT EXISTS assessment_keyspace.quizzes_by_target_state_v2 (
  target_type text,
  target_id uuid,
  state text,
  sort_at timestamp,
  quiz_id uuid,
  title text,
  opens_at timestamp,
  closes_at timestamp,
  quiz_version bigint,
  record_version bigint,
  PRIMARY KEY ((target_type, target_id, state), sort_at, quiz_id)
)
WITH CLUSTERING ORDER BY (sort_at DESC, quiz_id ASC)
AND compaction = {'class': 'SizeTieredCompactionStrategy'};
