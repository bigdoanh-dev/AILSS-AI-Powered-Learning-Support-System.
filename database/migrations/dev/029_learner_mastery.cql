-- Phase 19B/C Learner Concept Mastery, Adaptive Graphs and Recommendation Feedback
CREATE TABLE IF NOT EXISTS learning_keyspace.learner_concept_mastery (
  student_id uuid,
  course_id uuid,
  concept_id text,
  concept_name text,
  mastery_score int,
  confidence_score int,
  evidence_count int,
  bloom_level text,
  last_assessed_at timestamp,
  last_evidence_source text,
  PRIMARY KEY ((student_id, course_id), concept_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.course_prerequisite_graph (
  course_id uuid,
  concept_id text,
  prerequisite_concept_id text,
  strength text,
  PRIMARY KEY ((course_id), concept_id, prerequisite_concept_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.learner_recommendation_feedback (
  student_id uuid,
  recommendation_id uuid,
  course_id uuid,
  feedback_type text,
  comment text,
  created_at timestamp,
  PRIMARY KEY ((student_id), recommendation_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};
