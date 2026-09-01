ALTER TABLE interaction_keyspace.report_by_id ADD IF NOT EXISTS pending_operation_id uuid;
ALTER TABLE interaction_keyspace.report_by_id ADD IF NOT EXISTS pending_expected_version bigint;
ALTER TABLE interaction_keyspace.report_by_id ADD IF NOT EXISTS moderator_id uuid;

CREATE TABLE IF NOT EXISTS interaction_keyspace.report_queue_bounds_by_state (
  state text PRIMARY KEY,
  earliest_day date,
  latest_day date,
  version bigint,
  updated_at timestamp
);
