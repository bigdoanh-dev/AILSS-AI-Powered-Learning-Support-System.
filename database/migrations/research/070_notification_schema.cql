-- Generated from locked Phase 4 table specifications. Do not edit without ADR/schema review.

CREATE TABLE IF NOT EXISTS notification_keyspace.notifications_by_user_bucket (
  user_id uuid,
  year_month date,
  created_at timestamp,
  notification_id uuid,
  event_id uuid,
  type text,
  title text,
  body text,
  read_at timestamp,
  PRIMARY KEY ((user_id, year_month), created_at, notification_id)
)
WITH CLUSTERING ORDER BY (created_at DESC, notification_id ASC)
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': '1'};

CREATE TABLE IF NOT EXISTS notification_keyspace.notification_dedup_by_event_user (
  event_id uuid,
  user_id uuid,
  notification_id uuid,
  state text,
  created_at timestamp,
  PRIMARY KEY ((event_id, user_id))
)
WITH compaction = {'class': 'SizeTieredCompactionStrategy'};
