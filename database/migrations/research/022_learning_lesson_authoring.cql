-- P7.13 additive Learning-owned schema remediation.
-- Q-LRN-007: point lookup for the current immutable lesson version.
CREATE TABLE IF NOT EXISTS learning_keyspace.lesson_current_by_id (
  lesson_id uuid PRIMARY KEY,
  lesson_version bigint,
  course_id uuid,
  updated_at timestamp
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

-- Q-LRN-015: one bounded copy-on-write builder per Course. The service uses
-- a TTL on each reservation so an abandoned builder cannot block forever.
CREATE TABLE IF NOT EXISTS learning_keyspace.content_mutation_by_course (
  course_id uuid PRIMARY KEY,
  operation_id uuid,
  source_content_version bigint,
  target_content_version bigint,
  expires_at timestamp,
  updated_at timestamp
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};
