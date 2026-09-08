-- Approved P12.2B: Q-IDN-008..010 and Q-IDN-007 command recovery.
CREATE TABLE IF NOT EXISTS identity_keyspace.lecturer_application_by_applicant (
 applicant_id uuid PRIMARY KEY, application_id uuid, payload_json text,
 status text, version int, submission_operation_id uuid, review_operation_id uuid
);
CREATE TABLE IF NOT EXISTS identity_keyspace.lecturer_application_locator_by_id (
 application_id uuid PRIMARY KEY, applicant_id uuid
);
CREATE TABLE IF NOT EXISTS identity_keyspace.pending_lecturer_applications_by_month_shard (
 submission_month date, shard tinyint, submitted_at timestamp, application_id uuid,
 applicant_id uuid, display_name_snapshot text, teaching_area text,
 PRIMARY KEY ((submission_month,shard),submitted_at,application_id)
) WITH CLUSTERING ORDER BY (submitted_at DESC, application_id ASC);
CREATE TABLE IF NOT EXISTS identity_keyspace.identity_commands_by_due_bucket (
 due_day date, shard tinyint, next_attempt_at timestamp, operation_id uuid,
 scope text, key_hash tinyint, idempotency_key text, intent_json text,
 lease_owner text, lease_until timestamp, fence int,
 PRIMARY KEY ((due_day,shard),next_attempt_at,operation_id)
) WITH CLUSTERING ORDER BY (next_attempt_at ASC,operation_id ASC);
