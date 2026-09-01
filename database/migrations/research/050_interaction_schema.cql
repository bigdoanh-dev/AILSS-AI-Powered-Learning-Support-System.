-- Generated from locked Phase 4 table specifications. Do not edit without ADR/schema review.

CREATE TABLE IF NOT EXISTS interaction_keyspace.comments_by_target_bucket (
  target_type text,
  target_id uuid,
  day_bucket date,
  shard tinyint,
  created_at timestamp,
  comment_id uuid,
  author_id uuid,
  parent_id uuid,
  body_sanitized text,
  state text,
  comment_version bigint,
  PRIMARY KEY ((target_type, target_id, day_bucket, shard), created_at, comment_id)
)
WITH CLUSTERING ORDER BY (created_at DESC, comment_id ASC)
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': '1'};

CREATE TABLE IF NOT EXISTS interaction_keyspace.comment_by_id (
  comment_id uuid,
  target_type text,
  target_id uuid,
  author_id uuid,
  parent_id uuid,
  body_sanitized text,
  state text,
  version bigint,
  created_at timestamp,
  updated_at timestamp,
  PRIMARY KEY (comment_id)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS interaction_keyspace.reviews_by_course_bucket (
  course_id uuid,
  year_month date,
  shard tinyint,
  created_at timestamp,
  review_id uuid,
  student_id uuid,
  rating int,
  body_sanitized text,
  state text,
  review_version bigint,
  PRIMARY KEY ((course_id, year_month, shard), created_at, review_id)
)
WITH CLUSTERING ORDER BY (created_at DESC, review_id ASC)
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': '1'};

CREATE TABLE IF NOT EXISTS interaction_keyspace.review_by_student_course (
  student_id uuid,
  course_id uuid,
  review_id uuid,
  rating int,
  body_sanitized text,
  state text,
  version bigint,
  created_at timestamp,
  updated_at timestamp,
  PRIMARY KEY ((student_id, course_id))
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS interaction_keyspace.report_by_id (
  report_id uuid,
  reporter_id uuid,
  target_type text,
  target_id uuid,
  reason text,
  state text,
  assignee_id uuid,
  decision text,
  version bigint,
  created_at timestamp,
  updated_at timestamp,
  PRIMARY KEY (report_id)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS interaction_keyspace.reports_by_status_bucket (
  state text,
  day_bucket date,
  shard tinyint,
  created_at timestamp,
  report_id uuid,
  target_type text,
  target_id uuid,
  priority int,
  report_version bigint,
  PRIMARY KEY ((state, day_bucket, shard), created_at, report_id)
)
WITH CLUSTERING ORDER BY (created_at ASC, report_id ASC)
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': '1'};

CREATE TABLE IF NOT EXISTS interaction_keyspace.rating_summary_by_course (
  course_id uuid,
  review_count bigint,
  rating_sum bigint,
  average double,
  source_watermark bigint,
  checksum text,
  version bigint,
  updated_at timestamp,
  PRIMARY KEY (course_id)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS interaction_keyspace.pending_event_by_id (
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

CREATE TABLE IF NOT EXISTS interaction_keyspace.pending_events_by_due_bucket (
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

CREATE TABLE IF NOT EXISTS interaction_keyspace.reconcile_operation_by_id (
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

CREATE TABLE IF NOT EXISTS interaction_keyspace.reconcile_by_due_bucket (
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

CREATE TABLE IF NOT EXISTS interaction_keyspace.idempotency_by_scope_key (
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
