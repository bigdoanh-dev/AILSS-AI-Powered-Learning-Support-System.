ALTER TABLE assessment_keyspace.result_by_attempt ADD IF NOT EXISTS manual_score decimal;
ALTER TABLE assessment_keyspace.result_by_attempt ADD IF NOT EXISTS teacher_feedback text;
ALTER TABLE assessment_keyspace.result_by_attempt ADD IF NOT EXISTS graded_by text;
ALTER TABLE assessment_keyspace.result_by_attempt ADD IF NOT EXISTS graded_at timestamp;
ALTER TABLE assessment_keyspace.result_by_attempt ADD IF NOT EXISTS grading_status text;
