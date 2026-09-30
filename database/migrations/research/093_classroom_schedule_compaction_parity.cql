-- Reconcile the historical 033 profile difference without rewriting its locked checksum.
-- Reapplying the same table options is idempotent. Review populated tables before changing compaction.
ALTER TABLE classroom_keyspace.student_schedule_by_day
  WITH compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': '1'};
ALTER TABLE classroom_keyspace.schedule_reservations_by_expiry_bucket
  WITH compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': '1'};
