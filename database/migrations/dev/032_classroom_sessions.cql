-- P7.15B Classroom session authoring and schedule publication tables (Q-CLS-009/Q-CLS-010). Migrator role only.
-- sessions_by_class and schedule_manifest_by_class are reviewed physical helpers under Q-CLS-009.
CREATE TABLE IF NOT EXISTS classroom_keyspace.session_by_id (
  session_id uuid,
  class_id uuid,
  title text,
  start_at timestamp,
  end_at timestamp,
  mode text,
  status text,
  timezone text,
  meeting_provider text,
  meeting_url text,
  location text,
  schedule_version bigint,
  record_version bigint,
  created_at timestamp,
  updated_at timestamp,
  PRIMARY KEY (session_id)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS classroom_keyspace.sessions_by_class_date (
  class_id uuid,
  session_date date,
  start_at timestamp,
  session_id uuid,
  end_at timestamp,
  title text,
  mode text,
  status text,
  timezone text,
  meeting_provider text,
  location text,
  session_version bigint,
  PRIMARY KEY ((class_id, session_date), start_at, session_id)
)
WITH CLUSTERING ORDER BY (start_at ASC, session_id ASC)
AND compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS classroom_keyspace.sessions_by_class (
  class_id uuid,
  start_at timestamp,
  session_id uuid,
  end_at timestamp,
  status text,
  session_version bigint,
  PRIMARY KEY (class_id, start_at, session_id)
)
WITH CLUSTERING ORDER BY (start_at ASC, session_id ASC)
AND compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS classroom_keyspace.schedule_manifest_by_class (
  class_id uuid,
  schedule_version bigint,
  session_count int,
  manifest_checksum text,
  first_start_at timestamp,
  last_end_at timestamp,
  published_at timestamp,
  PRIMARY KEY (class_id)
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};
