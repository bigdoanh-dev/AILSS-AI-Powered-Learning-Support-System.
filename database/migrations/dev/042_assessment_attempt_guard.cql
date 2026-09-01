-- P8.2 additive physical helper governed by Q-ASMT-004.
CREATE TABLE IF NOT EXISTS assessment_keyspace.attempt_guard_by_student_quiz (
  student_id uuid,
  quiz_id uuid,
  active_attempt_id uuid,
  active_attempt_no int,
  attempts_started int,
  holder_operation_id uuid,
  guard_version bigint,
  updated_at timestamp,
  PRIMARY KEY ((student_id, quiz_id))
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

GRANT SELECT, MODIFY ON TABLE assessment_keyspace.attempt_guard_by_student_quiz TO svc_assessment;
