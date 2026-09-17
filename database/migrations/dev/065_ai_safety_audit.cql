-- Phase 18A AI Safety Audit & Policy Evaluation Log
CREATE TABLE IF NOT EXISTS ai_keyspace.assistant_safety_audit_by_conversation (
  conversation_id uuid,
  evaluated_at timestamp,
  audit_id uuid,
  user_id uuid,
  role text,
  mode text,
  policy_id text,
  decision text,
  reason_code text,
  user_safe_explanation text,
  affected_tools set<text>,
  metadata_json text,
  PRIMARY KEY ((conversation_id), evaluated_at, audit_id)
) WITH CLUSTERING ORDER BY (evaluated_at DESC, audit_id ASC)
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': '1'};
