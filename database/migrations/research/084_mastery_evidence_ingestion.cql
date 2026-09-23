-- Phase 40 Revision H: authoritative mastery evidence ingestion and recovery state.
CREATE TABLE IF NOT EXISTS learning_keyspace.mastery_evidence_by_student_course (
  student_id uuid,
  course_id uuid,
  learning_outcome_id text,
  concept_id text,
  occurred_at timestamp,
  event_id uuid,
  tenant_id uuid,
  source_type text,
  source_id text,
  raw_score_percent double,
  schema_version text,
  correlation_id uuid,
  PRIMARY KEY ((student_id, course_id), learning_outcome_id, concept_id, occurred_at, event_id)
) WITH CLUSTERING ORDER BY (learning_outcome_id ASC, concept_id ASC, occurred_at DESC, event_id ASC)
  AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': '7'};

CREATE TABLE IF NOT EXISTS learning_keyspace.mastery_ingestion_by_event (
  event_id uuid PRIMARY KEY,
  state text,
  student_id uuid,
  course_id uuid,
  source_type text,
  retry_count int,
  last_error text,
  correlation_id uuid,
  received_at timestamp,
  processed_at timestamp,
  updated_at timestamp
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

