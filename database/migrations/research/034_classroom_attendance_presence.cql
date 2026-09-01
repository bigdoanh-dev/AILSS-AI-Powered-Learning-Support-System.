-- P7.18 Q-CLS-014/Q-CLS-015/Q-CLS-016. Classroom migrator role only.
CREATE TABLE IF NOT EXISTS classroom_keyspace.attendance_by_session (
  session_id uuid,
  student_id uuid,
  attendance_status text,
  source text,
  first_joined_at timestamp,
  last_joined_at timestamp,
  last_left_at timestamp,
  last_seen_at timestamp,
  connected_duration_seconds bigint,
  presence_state text,
  attendance_version bigint,
  updated_at timestamp,
  PRIMARY KEY ((session_id), student_id)
) WITH CLUSTERING ORDER BY (student_id ASC)
  AND compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS classroom_keyspace.attendance_by_student_bucket (
  student_id uuid,
  year_month date,
  start_at timestamp,
  session_id uuid,
  class_id uuid,
  title text,
  mode text,
  attendance_status text,
  first_joined_at timestamp,
  last_joined_at timestamp,
  last_left_at timestamp,
  last_seen_at timestamp,
  connected_duration_seconds bigint,
  attendance_version bigint,
  PRIMARY KEY ((student_id, year_month), start_at, session_id)
) WITH CLUSTERING ORDER BY (start_at DESC, session_id ASC)
  AND compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS classroom_keyspace.presence_checkpoint_by_session_student (
  session_id uuid,
  student_id uuid,
  presence_state text,
  active_connection_count int,
  first_joined_at timestamp,
  last_joined_at timestamp,
  last_left_at timestamp,
  last_seen_at timestamp,
  accumulated_duration_seconds bigint,
  checkpoint_version bigint,
  updated_at timestamp,
  PRIMARY KEY ((session_id, student_id))
) WITH default_time_to_live = 2592000
  AND compaction = {'class': 'TimeWindowCompactionStrategy'};
