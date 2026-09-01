-- Generated from locked Phase 4 table specifications. Do not edit without ADR/schema review.

CREATE TABLE IF NOT EXISTS assessment_keyspace.quiz_by_id (
  quiz_id uuid,
  target_type text,
  target_id uuid,
  owner_id uuid,
  state text,
  current_version bigint,
  opens_at timestamp,
  closes_at timestamp,
  duration_seconds int,
  attempt_limit int,
  record_version bigint,
  updated_at timestamp,
  PRIMARY KEY (quiz_id)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS assessment_keyspace.questions_by_quiz_version (
  quiz_id uuid,
  quiz_version bigint,
  question_order int,
  question_id uuid,
  prompt text,
  question_type text,
  options_json text,
  correct_answer_json text,
  points decimal,
  checksum text,
  PRIMARY KEY ((quiz_id, quiz_version), question_order, question_id)
)
WITH CLUSTERING ORDER BY (question_order ASC, question_id ASC)
AND compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS assessment_keyspace.attempt_by_id (
  attempt_id uuid,
  student_id uuid,
  quiz_id uuid,
  quiz_version bigint,
  attempt_no int,
  state text,
  started_at timestamp,
  deadline_at timestamp,
  submitted_at timestamp,
  submit_key text,
  answer_checksum text,
  version bigint,
  PRIMARY KEY (attempt_id)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS assessment_keyspace.attempts_by_student_quiz (
  student_id uuid,
  quiz_id uuid,
  attempt_no int,
  attempt_id uuid,
  state text,
  started_at timestamp,
  deadline_at timestamp,
  attempt_version bigint,
  PRIMARY KEY ((student_id, quiz_id), attempt_no)
)
WITH CLUSTERING ORDER BY (attempt_no DESC)
AND compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS assessment_keyspace.result_by_attempt (
  attempt_id uuid,
  student_id uuid,
  quiz_id uuid,
  quiz_version bigint,
  score decimal,
  max_score decimal,
  grading_checksum text,
  submit_key text,
  result_version bigint,
  created_at timestamp,
  PRIMARY KEY (attempt_id)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS assessment_keyspace.results_by_quiz_bucket (
  quiz_id uuid,
  year_month date,
  shard tinyint,
  submitted_at timestamp,
  attempt_id uuid,
  student_id uuid,
  score decimal,
  max_score decimal,
  result_version bigint,
  PRIMARY KEY ((quiz_id, year_month, shard), submitted_at, attempt_id)
)
WITH CLUSTERING ORDER BY (submitted_at DESC, attempt_id ASC)
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': '1'};

CREATE TABLE IF NOT EXISTS assessment_keyspace.quizzes_by_target_state (
  target_type text,
  target_id uuid,
  state text,
  opens_at timestamp,
  quiz_id uuid,
  title text,
  closes_at timestamp,
  quiz_version bigint,
  PRIMARY KEY ((target_type, target_id, state), opens_at, quiz_id)
)
WITH CLUSTERING ORDER BY (opens_at DESC, quiz_id ASC)
AND compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS assessment_keyspace.pending_event_by_id (
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

CREATE TABLE IF NOT EXISTS assessment_keyspace.pending_events_by_due_bucket (
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

CREATE TABLE IF NOT EXISTS assessment_keyspace.idempotency_by_scope_key (
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
