-- P9.2A: Q-LRN-011/Q-LRN-012 canonical progress and per-student/course mutation fence.
CREATE TABLE IF NOT EXISTS learning_keyspace.progress_mutation_by_student_course (
  student_id uuid,
  course_id uuid,
  operation_id uuid,
  expires_at timestamp,
  updated_at timestamp,
  PRIMARY KEY ((student_id, course_id))
);

ALTER TABLE learning_keyspace.progress_by_student_course ADD IF NOT EXISTS last_operation_id uuid;
ALTER TABLE learning_keyspace.progress_by_student_course ADD IF NOT EXISTS last_event_id uuid;
ALTER TABLE learning_keyspace.lesson_completion_by_student_course ADD IF NOT EXISTS operation_id uuid;
