-- Phase 39 Adaptive Learning V2, Teacher Copilot, Interventions and Institutional Management V2
CREATE TABLE IF NOT EXISTS learning_keyspace.mastery_v2_by_student_concept (
  student_id uuid,
  tenant_id uuid,
  course_id uuid,
  concept_id text,
  learning_outcome_id text,
  mastery_score int,
  mastery_state text,
  confidence_score int,
  evidence_count int,
  algorithm_version text,
  calculated_at timestamp,
  last_decay_at timestamp,
  explanation_json text,
  PRIMARY KEY ((student_id, course_id), concept_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.mastery_v2_history (
  student_id uuid,
  concept_id text,
  calculated_at timestamp,
  previous_state text,
  new_state text,
  evidence_ids list<text>,
  reason text,
  PRIMARY KEY ((student_id, concept_id), calculated_at)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.prerequisite_dag_edges_v2 (
  tenant_id uuid,
  course_id uuid,
  source_concept_id text,
  target_concept_id text,
  strength text,
  created_at timestamp,
  PRIMARY KEY ((tenant_id, course_id), source_concept_id, target_concept_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.study_plans_v2 (
  plan_id uuid,
  student_id uuid,
  tenant_id uuid,
  course_id uuid,
  week_start_date text,
  generated_at timestamp,
  overall_mastery int,
  plan_items_json text,
  PRIMARY KEY ((student_id, course_id), plan_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.study_plan_items_status (
  item_id uuid,
  student_id uuid,
  status text,
  action text,
  scheduled_date text,
  updated_at timestamp,
  PRIMARY KEY ((student_id), item_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.adaptive_recommendations_v2 (
  recommendation_id uuid,
  student_id uuid,
  course_id uuid,
  action text,
  target_id text,
  reason_code text,
  urgency_score int,
  created_at timestamp,
  PRIMARY KEY ((student_id), recommendation_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.copilot_drafts_by_teacher (
  draft_id uuid,
  tenant_id uuid,
  course_id uuid,
  teacher_id uuid,
  draft_type text,
  status text,
  draft_payload_json text,
  generated_at timestamp,
  approved_at timestamp,
  approved_by uuid,
  rejection_reason text,
  PRIMARY KEY ((tenant_id, teacher_id), draft_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.student_interventions (
  intervention_id uuid,
  tenant_id uuid,
  student_id uuid,
  course_id uuid,
  signal_type text,
  severity text,
  status text,
  notes text,
  assigned_by uuid,
  assigned_at timestamp,
  resolved_at timestamp,
  PRIMARY KEY ((tenant_id, student_id), intervention_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.institution_configs_v2 (
  tenant_id uuid,
  config_version int,
  config_snapshot_json text,
  changed_by uuid,
  changed_at timestamp,
  change_reason text,
  is_current boolean,
  PRIMARY KEY ((tenant_id), config_version)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.institution_integration_tests (
  tenant_id uuid,
  integration text,
  status text,
  latency_ms int,
  last_tested_at timestamp,
  details text,
  PRIMARY KEY ((tenant_id), integration)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};
