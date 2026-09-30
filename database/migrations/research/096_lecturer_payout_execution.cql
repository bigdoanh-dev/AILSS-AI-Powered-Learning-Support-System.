ALTER TABLE learning_keyspace.payout_instruction_by_month ADD IF NOT EXISTS approved_by uuid;
ALTER TABLE learning_keyspace.payout_instruction_by_month ADD IF NOT EXISTS approved_at timestamp;
ALTER TABLE learning_keyspace.payout_instruction_by_month ADD IF NOT EXISTS provider_reference text;
ALTER TABLE learning_keyspace.payout_instruction_by_month ADD IF NOT EXISTS failure_reason text;
ALTER TABLE learning_keyspace.payout_instruction_by_month ADD IF NOT EXISTS updated_at timestamp;

CREATE TABLE IF NOT EXISTS learning_keyspace.payout_audit_by_instruction (
  instruction_id uuid,
  event_id uuid,
  state text,
  actor_id uuid,
  reason text,
  occurred_at timestamp,
  PRIMARY KEY ((instruction_id), event_id)
);
