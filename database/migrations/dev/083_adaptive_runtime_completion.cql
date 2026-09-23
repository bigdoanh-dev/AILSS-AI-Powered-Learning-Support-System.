-- Phase 40 Revision G: durable adaptive-learning runtime fields.
ALTER TABLE learning_keyspace.mastery_v2_by_student_concept ADD IF NOT EXISTS policy_version text;
ALTER TABLE learning_keyspace.mastery_v2_by_student_concept ADD IF NOT EXISTS updated_at timestamp;

ALTER TABLE learning_keyspace.study_plan_items_status ADD IF NOT EXISTS plan_id uuid;
ALTER TABLE learning_keyspace.study_plan_items_status ADD IF NOT EXISTS course_id uuid;
ALTER TABLE learning_keyspace.study_plan_items_status ADD IF NOT EXISTS completed_at timestamp;
ALTER TABLE learning_keyspace.study_plan_items_status ADD IF NOT EXISTS reason_code text;
ALTER TABLE learning_keyspace.study_plan_items_status ADD IF NOT EXISTS source_recommendation text;
