-- Generated from locked Phase 4 table specifications. Do not edit without ADR/schema review.

CREATE TABLE IF NOT EXISTS identity_keyspace.user_by_id (
  user_id uuid,
  email_masked text,
  display_name text,
  role text,
  status text,
  lecturer_verified boolean,
  token_version int,
  profile_version bigint,
  created_at timestamp,
  updated_at timestamp,
  PRIMARY KEY (user_id)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS identity_keyspace.credential_by_email (
  normalized_email text,
  user_id uuid,
  password_hash text,
  credential_version bigint,
  status text,
  created_at timestamp,
  updated_at timestamp,
  PRIMARY KEY (normalized_email)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS identity_keyspace.session_by_id (
  session_id uuid,
  user_id uuid,
  token_family_id uuid,
  refresh_fingerprint text,
  generation int,
  state text,
  expires_at timestamp,
  revoked_at timestamp,
  version bigint,
  created_at timestamp,
  PRIMARY KEY (session_id)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS identity_keyspace.sessions_by_user_bucket (
  user_id uuid,
  year_month date,
  created_at timestamp,
  session_id uuid,
  state text,
  expires_at timestamp,
  version bigint,
  PRIMARY KEY ((user_id, year_month), created_at, session_id)
)
WITH CLUSTERING ORDER BY (created_at DESC, session_id ASC)
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': '1'};

CREATE TABLE IF NOT EXISTS identity_keyspace.users_by_role_status_bucket (
  role text,
  status text,
  shard tinyint,
  updated_at timestamp,
  user_id uuid,
  display_name text,
  lecturer_verified boolean,
  profile_version bigint,
  PRIMARY KEY ((role, status, shard), updated_at, user_id)
)
WITH CLUSTERING ORDER BY (updated_at DESC, user_id ASC)
AND compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS identity_keyspace.public_lecturer_by_id (
  lecturer_id uuid,
  display_name text,
  bio text,
  avatar_object_key text,
  verified boolean,
  profile_version bigint,
  updated_at timestamp,
  PRIMARY KEY (lecturer_id)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS identity_keyspace.pending_event_by_id (
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

CREATE TABLE IF NOT EXISTS identity_keyspace.pending_events_by_due_bucket (
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

CREATE TABLE IF NOT EXISTS identity_keyspace.idempotency_by_scope_key (
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
