-- P7.16 Student schedule/reservation tables (Q-CLS-011/012/013/017). Migrator role only.
CREATE TABLE IF NOT EXISTS classroom_keyspace.student_schedule_by_day (
  student_id uuid, schedule_day date, start_at timestamp, entry_id uuid, end_at timestamp,
  class_id uuid, class_name text, session_id uuid, offering_id uuid, reservation_id uuid,
  entry_state text, expires_at timestamp, schedule_version bigint, title text, mode text, timezone text,
  PRIMARY KEY ((student_id, schedule_day), start_at, entry_id)
) WITH CLUSTERING ORDER BY (start_at ASC, entry_id ASC);
CREATE TABLE IF NOT EXISTS classroom_keyspace.schedule_reservation_by_id (
  reservation_id uuid, student_id uuid, class_id uuid, offering_id uuid, operation_id uuid,
  state text, expires_at timestamp, segment_count int, schedule_version bigint, version bigint,
  terminal_reason text, order_id uuid, membership_id uuid, created_at timestamp, updated_at timestamp,
  PRIMARY KEY (reservation_id)
) WITH default_time_to_live = 604800;
CREATE TABLE IF NOT EXISTS classroom_keyspace.schedule_reservation_segments_by_id (
  reservation_id uuid, schedule_day date, start_at timestamp, session_id uuid, entry_id uuid,
  end_at timestamp, class_id uuid, class_name text, student_id uuid, offering_id uuid,
  title text, mode text, timezone text, schedule_version bigint,
  PRIMARY KEY (reservation_id, schedule_day, start_at, session_id)
) WITH CLUSTERING ORDER BY (schedule_day ASC, start_at ASC, session_id ASC)
AND default_time_to_live = 604800;
CREATE TABLE IF NOT EXISTS classroom_keyspace.student_schedule_guard (
  student_id uuid, holder_operation_id uuid, holder_reservation_id uuid, lease_until timestamp,
  lease_fence bigint, version bigint, updated_at timestamp, PRIMARY KEY (student_id)
);
CREATE TABLE IF NOT EXISTS classroom_keyspace.schedule_reservations_by_expiry_bucket (
  expiry_day date, shard tinyint, expires_at timestamp, reservation_id uuid, student_id uuid,
  state text, reservation_version bigint,
  PRIMARY KEY ((expiry_day, shard), expires_at, reservation_id)
) WITH CLUSTERING ORDER BY (expires_at ASC, reservation_id ASC);
ALTER TABLE classroom_keyspace.schedule_reservation_by_id WITH default_time_to_live = 604800;
ALTER TABLE classroom_keyspace.schedule_reservation_segments_by_id WITH default_time_to_live = 604800;
