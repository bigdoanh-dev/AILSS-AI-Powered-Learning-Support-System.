-- P7.19 CLS-19 note persistence under existing Q-CLS-014/Q-CLS-015.
ALTER TABLE classroom_keyspace.attendance_by_session
  ADD IF NOT EXISTS manual_note text;

ALTER TABLE classroom_keyspace.attendance_by_student_bucket
  ADD IF NOT EXISTS manual_note text;
