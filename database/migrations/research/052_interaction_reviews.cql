CREATE TABLE IF NOT EXISTS interaction_keyspace.review_locator_by_id (review_id uuid PRIMARY KEY,student_id uuid,course_id uuid,canonical_version bigint,updated_at timestamp);
CREATE TABLE IF NOT EXISTS interaction_keyspace.review_timeline_bounds_by_course (course_id uuid PRIMARY KEY,earliest_month date,latest_month date,version bigint,updated_at timestamp);
CREATE TABLE IF NOT EXISTS interaction_keyspace.rating_contribution_by_course_review (course_id uuid,review_id uuid,applied_review_version bigint,applied_active boolean,applied_rating int,last_operation_id uuid,updated_at timestamp,PRIMARY KEY ((course_id),review_id));
CREATE TABLE IF NOT EXISTS interaction_keyspace.rating_mutation_by_course (course_id uuid PRIMARY KEY,operation_id uuid,expires_at timestamp,updated_at timestamp);
ALTER TABLE interaction_keyspace.rating_summary_by_course ADD IF NOT EXISTS last_operation_id uuid;
ALTER TABLE interaction_keyspace.review_by_student_course ADD IF NOT EXISTS pending_operation_id uuid;
ALTER TABLE interaction_keyspace.review_by_student_course ADD IF NOT EXISTS pending_expected_version bigint;
