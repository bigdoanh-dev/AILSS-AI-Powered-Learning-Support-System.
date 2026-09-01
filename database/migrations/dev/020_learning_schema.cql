-- Generated from locked Phase 4 table specifications. Do not edit without ADR/schema review.

CREATE TABLE IF NOT EXISTS learning_keyspace.course_by_id (
  course_id uuid,
  owner_lecturer_id uuid,
  title text,
  slug text,
  category_id uuid,
  state text,
  content_version bigint,
  record_version bigint,
  price_type text,
  price decimal,
  currency text,
  created_at timestamp,
  updated_at timestamp,
  PRIMARY KEY (course_id)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.course_by_slug (
  normalized_slug text,
  course_id uuid,
  state text,
  title text,
  category_id uuid,
  price_type text,
  price decimal,
  currency text,
  course_version bigint,
  updated_at timestamp,
  PRIMARY KEY (normalized_slug)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.published_courses_by_category_bucket (
  category_id uuid,
  year_month date,
  shard tinyint,
  published_at timestamp,
  course_id uuid,
  slug text,
  title text,
  lecturer_id uuid,
  price_type text,
  price decimal,
  currency text,
  course_version bigint,
  PRIMARY KEY ((category_id, year_month, shard), published_at, course_id)
)
WITH CLUSTERING ORDER BY (published_at DESC, course_id ASC)
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': '1'};

CREATE TABLE IF NOT EXISTS learning_keyspace.published_courses_by_search_token_bucket (
  token_prefix text,
  year_month date,
  shard tinyint,
  published_at timestamp,
  course_id uuid,
  slug text,
  title text,
  category_id uuid,
  course_version bigint,
  PRIMARY KEY ((token_prefix, year_month, shard), published_at, course_id)
)
WITH CLUSTERING ORDER BY (published_at DESC, course_id ASC)
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': '1'};

CREATE TABLE IF NOT EXISTS learning_keyspace.courses_by_lecturer (
  lecturer_id uuid,
  updated_at timestamp,
  course_id uuid,
  title text,
  state text,
  course_version bigint,
  PRIMARY KEY (lecturer_id, updated_at, course_id)
)
WITH CLUSTERING ORDER BY (updated_at DESC, course_id ASC)
AND compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.lessons_by_course_version (
  course_id uuid,
  content_version bigint,
  section_order int,
  lesson_order int,
  lesson_id uuid,
  section_title text,
  lesson_title text,
  state text,
  preview boolean,
  object_key text,
  lesson_version bigint,
  PRIMARY KEY ((course_id, content_version), section_order, lesson_order, lesson_id)
)
WITH CLUSTERING ORDER BY (section_order ASC, lesson_order ASC, lesson_id ASC)
AND compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.lesson_by_id_version (
  lesson_id uuid,
  lesson_version bigint,
  course_id uuid,
  content_version bigint,
  state text,
  preview boolean,
  title text,
  object_key text,
  checksum text,
  updated_at timestamp,
  PRIMARY KEY ((lesson_id, lesson_version))
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.enrollment_by_student_course (
  student_id uuid,
  course_id uuid,
  enrollment_id uuid,
  state text,
  source text,
  order_id uuid,
  enrolled_at timestamp,
  version bigint,
  PRIMARY KEY ((student_id, course_id))
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.courses_by_student_bucket (
  student_id uuid,
  state text,
  year_month date,
  enrolled_at timestamp,
  course_id uuid,
  title text,
  progress_percent double,
  enrollment_version bigint,
  PRIMARY KEY ((student_id, state, year_month), enrolled_at, course_id)
)
WITH CLUSTERING ORDER BY (enrolled_at DESC, course_id ASC)
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': '1'};

CREATE TABLE IF NOT EXISTS learning_keyspace.students_by_course_bucket (
  course_id uuid,
  state text,
  shard tinyint,
  enrolled_at timestamp,
  student_id uuid,
  enrollment_id uuid,
  enrollment_version bigint,
  PRIMARY KEY ((course_id, state, shard), enrolled_at, student_id)
)
WITH CLUSTERING ORDER BY (enrolled_at DESC, student_id ASC)
AND compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.progress_by_student_course (
  student_id uuid,
  course_id uuid,
  progress_version bigint,
  course_content_version bigint,
  completed_count int,
  published_total int,
  percent double,
  completed_at timestamp,
  updated_at timestamp,
  PRIMARY KEY ((student_id, course_id))
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.lesson_completion_by_student_course (
  student_id uuid,
  course_id uuid,
  lesson_id uuid,
  completed boolean,
  lesson_version bigint,
  completed_at timestamp,
  completion_version bigint,
  PRIMARY KEY ((student_id, course_id), lesson_id)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.order_by_id (
  order_id uuid,
  student_id uuid,
  course_id uuid,
  state text,
  price_snapshot decimal,
  currency text,
  request_key text,
  version bigint,
  created_at timestamp,
  updated_at timestamp,
  PRIMARY KEY (order_id)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.order_by_student_request (
  student_id uuid,
  request_key_hash tinyint,
  request_key text,
  order_id uuid,
  state text,
  created_at timestamp,
  expires_at timestamp,
  PRIMARY KEY ((student_id, request_key_hash), request_key)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.pending_event_by_id (
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

CREATE TABLE IF NOT EXISTS learning_keyspace.pending_events_by_due_bucket (
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

CREATE TABLE IF NOT EXISTS learning_keyspace.reconcile_operation_by_id (
  operation_id uuid,
  projection_name text,
  canonical_id uuid,
  canonical_version bigint,
  projection_version bigint,
  checksum text,
  state text,
  retry_count int,
  next_attempt_at timestamp,
  last_error text,
  updated_at timestamp,
  PRIMARY KEY (operation_id)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.reconcile_by_due_bucket (
  due_day date,
  shard tinyint,
  next_attempt_at timestamp,
  operation_id uuid,
  projection_name text,
  canonical_id uuid,
  canonical_version bigint,
  state text,
  PRIMARY KEY ((due_day, shard), next_attempt_at, operation_id)
)
WITH CLUSTERING ORDER BY (next_attempt_at ASC, operation_id ASC)
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': '1'};

CREATE TABLE IF NOT EXISTS learning_keyspace.idempotency_by_scope_key (
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
