-- Phase 18C Product Intelligence & Funnel Analytics Events
CREATE TABLE IF NOT EXISTS audit_keyspace.product_analytics_events_by_bucket (
  event_family text,
  bucket date,
  shard tinyint,
  occurred_at timestamp,
  event_id uuid,
  event_name text,
  actor_id uuid,
  actor_role text,
  session_id text,
  course_id uuid,
  payload_json text,
  PRIMARY KEY ((event_family, bucket, shard), occurred_at, event_id)
) WITH CLUSTERING ORDER BY (occurred_at DESC, event_id ASC)
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': '1'};
