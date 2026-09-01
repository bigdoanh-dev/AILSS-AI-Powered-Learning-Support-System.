ALTER TABLE assessment_keyspace.attempt_by_id ADD IF NOT EXISTS pending_submit_operation_id uuid;
ALTER TABLE assessment_keyspace.attempt_by_id ADD IF NOT EXISTS pending_submit_received_at timestamp;
ALTER TABLE assessment_keyspace.attempt_by_id ADD IF NOT EXISTS pending_answer_checksum text;
ALTER TABLE assessment_keyspace.attempt_by_id ADD IF NOT EXISTS pending_grading_checksum text;
ALTER TABLE assessment_keyspace.attempt_by_id ADD IF NOT EXISTS pinned_question_count int;
ALTER TABLE assessment_keyspace.attempt_by_id ADD IF NOT EXISTS pinned_snapshot_checksum text;
ALTER TABLE assessment_keyspace.result_by_attempt ADD IF NOT EXISTS answer_count int;
ALTER TABLE assessment_keyspace.result_by_attempt ADD IF NOT EXISTS result_items_checksum text;
ALTER TABLE assessment_keyspace.result_by_attempt ADD IF NOT EXISTS grading_algorithm_version text;
CREATE TABLE IF NOT EXISTS assessment_keyspace.result_items_by_attempt (
  attempt_id uuid, question_order int, question_id uuid, question_type text,
  submitted_answer_json text, awarded_points decimal, grading_outcome text, result_version bigint,
  PRIMARY KEY ((attempt_id), question_order, question_id)
) WITH CLUSTERING ORDER BY (question_order ASC, question_id ASC)
AND compaction = {'class': 'SizeTieredCompactionStrategy'};
GRANT SELECT, MODIFY ON TABLE assessment_keyspace.result_items_by_attempt TO svc_assessment;
