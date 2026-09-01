-- P7.14 CourseOffering foundation: Q-LRN-017..Q-LRN-021.
CREATE TABLE IF NOT EXISTS learning_keyspace.offering_by_id (
  offering_id uuid PRIMARY KEY,
  course_id uuid,
  owner_lecturer_id uuid,
  offering_type text,
  class_id uuid,
  title text,
  state text,
  price decimal,
  currency text,
  sales_start_at timestamp,
  sales_end_at timestamp,
  record_version bigint,
  created_at timestamp,
  updated_at timestamp,
  published_at timestamp
);

CREATE TABLE IF NOT EXISTS learning_keyspace.offerings_by_course (
  course_id uuid,
  updated_at timestamp,
  offering_id uuid,
  owner_lecturer_id uuid,
  offering_type text,
  class_id uuid,
  title text,
  state text,
  price decimal,
  currency text,
  offering_version bigint,
  PRIMARY KEY (course_id, updated_at, offering_id)
) WITH CLUSTERING ORDER BY (updated_at DESC, offering_id ASC);

CREATE TABLE IF NOT EXISTS learning_keyspace.offering_by_class (
  class_id uuid PRIMARY KEY,
  offering_id uuid,
  course_id uuid,
  state text,
  offering_version bigint,
  claimed_at timestamp
);

CREATE TABLE IF NOT EXISTS learning_keyspace.public_offerings_by_type_bucket (
  offering_type text,
  year_month date,
  shard tinyint,
  published_at timestamp,
  offering_id uuid,
  course_id uuid,
  class_id uuid,
  title text,
  price decimal,
  currency text,
  sales_start_at timestamp,
  sales_end_at timestamp,
  offering_version bigint,
  PRIMARY KEY ((offering_type, year_month, shard), published_at, offering_id)
) WITH CLUSTERING ORDER BY (published_at DESC, offering_id ASC)
  AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': '1'};

-- Q-LRN-020 owner-local helper. It contains bounds only, never a public offering copy.
CREATE TABLE IF NOT EXISTS learning_keyspace.offering_catalog_bounds_by_type (
  offering_type text PRIMARY KEY,
  newest_year_month date,
  oldest_year_month date,
  updated_at timestamp
);

CREATE TABLE IF NOT EXISTS learning_keyspace.offerings_by_lecturer (
  lecturer_id uuid,
  updated_at timestamp,
  offering_id uuid,
  course_id uuid,
  offering_type text,
  class_id uuid,
  title text,
  state text,
  offering_version bigint,
  PRIMARY KEY (lecturer_id, updated_at, offering_id)
) WITH CLUSTERING ORDER BY (updated_at DESC, offering_id ASC);
