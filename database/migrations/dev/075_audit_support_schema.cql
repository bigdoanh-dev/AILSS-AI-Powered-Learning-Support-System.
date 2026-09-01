-- Audit Worker-only support storage (ADR-06-07).
CREATE TABLE IF NOT EXISTS audit_support_keyspace.application_audit_by_day (
  event_day date,
  occurred_at timestamp,
  event_id uuid,
  actor_type text,
  actor_id text,
  action text,
  target_type text,
  target_id text,
  outcome text,
  request_id uuid,
  before_digest text,
  after_digest text,
  PRIMARY KEY (event_day, occurred_at, event_id)
) WITH CLUSTERING ORDER BY (occurred_at DESC, event_id ASC);

CREATE TABLE IF NOT EXISTS audit_support_keyspace.audit_dedup_by_event (
  event_id uuid PRIMARY KEY, applied_at timestamp, state text
);
