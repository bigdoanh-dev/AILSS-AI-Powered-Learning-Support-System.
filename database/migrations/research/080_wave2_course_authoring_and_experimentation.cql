-- Phase 40 Wave 2: Course Authoring Studio V2, Assessment Question Bank V2, Curriculum Intelligence, Fleet Operations and Product Experimentation

-- 1. Course Authoring Studio V2
CREATE TABLE IF NOT EXISTS learning_keyspace.course_authoring_drafts (
  draft_id uuid,
  course_id uuid,
  tenant_id uuid,
  version int,
  status text,
  title text,
  description text,
  modules_json text,
  prerequisite_graph_json text,
  outcomes_json text,
  created_by uuid,
  updated_at timestamp,
  published_at timestamp,
  PRIMARY KEY ((tenant_id, course_id), draft_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.course_published_snapshots (
  course_id uuid,
  tenant_id uuid,
  version int,
  snapshot_hash text,
  course_data_json text,
  published_by uuid,
  published_at timestamp,
  PRIMARY KEY ((tenant_id, course_id), version)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

-- 2. Assessment Question Bank V2 & Item Analysis
CREATE TABLE IF NOT EXISTS assessment_keyspace.question_bank_items_v2 (
  item_id uuid,
  tenant_id uuid,
  course_id uuid,
  author_id uuid,
  title text,
  content text,
  question_type text,
  options_json text,
  correct_answer text,
  rubric_json text,
  learning_outcome_ids list<text>,
  status text,
  ai_generated boolean,
  approved_by uuid,
  approved_at timestamp,
  created_at timestamp,
  PRIMARY KEY ((tenant_id, course_id), item_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS assessment_keyspace.item_analysis_metrics (
  item_id uuid,
  tenant_id uuid,
  course_id uuid,
  attempts_count int,
  correct_count int,
  difficulty_p double,
  discrimination_d double,
  distractor_efficiency_json text,
  last_calculated_at timestamp,
  PRIMARY KEY ((tenant_id, course_id), item_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

-- 3. Curriculum Intelligence
CREATE TABLE IF NOT EXISTS learning_keyspace.curriculum_intelligence_graphs (
  graph_id uuid,
  tenant_id uuid,
  program_id text,
  academic_year text,
  curriculum_graph_json text,
  outcome_coverage_json text,
  generated_at timestamp,
  PRIMARY KEY ((tenant_id, program_id), graph_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

-- 4. Institutional Fleet Operations
CREATE TABLE IF NOT EXISTS identity_keyspace.fleet_operation_templates (
  template_id uuid,
  template_name text,
  template_version int,
  config_payload_json text,
  author_id uuid,
  created_at timestamp,
  PRIMARY KEY ((template_name), template_version)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS identity_keyspace.fleet_operation_audit (
  operation_id uuid,
  actor_id uuid,
  template_id uuid,
  target_tenant_ids list<uuid>,
  dry_run boolean,
  status text,
  diff_summary_json text,
  executed_at timestamp,
  PRIMARY KEY ((status), operation_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

-- 5. Product Experimentation Framework
CREATE TABLE IF NOT EXISTS learning_keyspace.product_experiments (
  experiment_id text,
  tenant_id uuid,
  feature_key text,
  status text,
  rollout_percentage int,
  variants_json text,
  sensitive_scope_guard text,
  created_at timestamp,
  updated_at timestamp,
  PRIMARY KEY ((tenant_id), experiment_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.experiment_exposures (
  experiment_id text,
  user_id uuid,
  tenant_id uuid,
  assigned_variant text,
  exposed_at timestamp,
  PRIMARY KEY ((tenant_id, experiment_id), user_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};
