-- Phase 19A Course Release Versioning, Immutability and Student Enrollment Pinning
CREATE TABLE IF NOT EXISTS learning_keyspace.course_releases_by_version (
  course_id uuid,
  version int,
  status text,
  title text,
  syllabus_json text,
  content_hash text,
  change_log text,
  published_by uuid,
  published_at timestamp,
  PRIMARY KEY ((course_id), version)
) WITH CLUSTERING ORDER BY (version DESC)
AND compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.enrollment_version_by_student_course (
  student_id uuid,
  course_id uuid,
  pinned_version int,
  enrolled_at timestamp,
  last_upgraded_at timestamp,
  auto_upgrade_policy text,
  PRIMARY KEY ((student_id), course_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};
