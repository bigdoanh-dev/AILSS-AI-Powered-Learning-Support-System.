-- Generated from locked Phase 4 table specifications. Do not edit without ADR/schema review.

CREATE TABLE IF NOT EXISTS classroom_keyspace.class_by_id (
  class_id uuid,
  owner_lecturer_id uuid,
  name text,
  linked_course_id uuid,
  state text,
  active_code_hash text,
  version bigint,
  created_at timestamp,
  updated_at timestamp,
  PRIMARY KEY (class_id)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS classroom_keyspace.class_by_active_code (
  normalized_code text,
  class_id uuid,
  state text,
  code_version bigint,
  expires_at timestamp,
  claimed_at timestamp,
  PRIMARY KEY (normalized_code)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS classroom_keyspace.membership_by_class_student (
  class_id uuid,
  student_id uuid,
  membership_id uuid,
  state text,
  joined_at timestamp,
  version bigint,
  PRIMARY KEY ((class_id, student_id))
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS classroom_keyspace.classes_by_student (
  student_id uuid,
  joined_at timestamp,
  class_id uuid,
  class_name text,
  membership_state text,
  membership_version bigint,
  PRIMARY KEY (student_id, joined_at, class_id)
)
WITH CLUSTERING ORDER BY (joined_at DESC, class_id ASC)
AND compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS classroom_keyspace.classes_by_lecturer (
  lecturer_id uuid,
  updated_at timestamp,
  class_id uuid,
  class_name text,
  state text,
  class_version bigint,
  PRIMARY KEY (lecturer_id, updated_at, class_id)
)
WITH CLUSTERING ORDER BY (updated_at DESC, class_id ASC)
AND compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS classroom_keyspace.students_by_class (
  class_id uuid,
  state text,
  shard tinyint,
  joined_at timestamp,
  student_id uuid,
  membership_version bigint,
  PRIMARY KEY ((class_id, state, shard), joined_at, student_id)
)
WITH CLUSTERING ORDER BY (joined_at DESC, student_id ASC)
AND compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS classroom_keyspace.announcements_by_class_bucket (
  class_id uuid,
  year_month date,
  created_at timestamp,
  announcement_id uuid,
  author_id uuid,
  title text,
  body_sanitized text,
  state text,
  version bigint,
  PRIMARY KEY ((class_id, year_month), created_at, announcement_id)
)
WITH CLUSTERING ORDER BY (created_at DESC, announcement_id ASC)
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': '1'};

CREATE TABLE IF NOT EXISTS classroom_keyspace.pending_event_by_id (
  event_id uuid,
  event_type text,
  aggregate_id uuid,
  aggregate_version bigint,
  state text,
  next_attempt_at timestamp,
  retry_count int,
  lease_fence bigint,
  created_at timestamp,
  published_at timestamp,
  PRIMARY KEY (event_id)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS classroom_keyspace.pending_events_by_due_bucket (
  due_day date,
  shard tinyint,
  next_attempt_at timestamp,
  event_id uuid,
  event_type text,
  aggregate_id uuid,
  aggregate_version bigint,
  payload_json text,
  state text,
  retry_count int,
  lease_owner text,
  lease_until timestamp,
  lease_fence bigint,
  created_at timestamp,
  PRIMARY KEY ((due_day, shard), next_attempt_at, event_id)
)
WITH CLUSTERING ORDER BY (next_attempt_at ASC, event_id ASC)
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': '1'};

CREATE TABLE IF NOT EXISTS classroom_keyspace.idempotency_by_scope_key (
  scope text,
  key_hash tinyint,
  idempotency_key text,
  operation_id uuid,
  resource_id uuid,
  result_code int,
  status text,
  result_checksum text,
  created_at timestamp,
  expires_at timestamp,
  PRIMARY KEY ((scope, key_hash), idempotency_key)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};
