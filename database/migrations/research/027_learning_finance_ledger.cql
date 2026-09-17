-- Phase 18B Immutable Double-Entry Financial Ledger, Safe Refunds, and Lecturer Payouts
CREATE TABLE IF NOT EXISTS learning_keyspace.financial_ledger_entries (
  account_id uuid,
  bucket date,
  entry_id uuid,
  entry_type text,
  direction text,
  amount bigint,
  currency text,
  reference_type text,
  reference_id text,
  description text,
  metadata_json text,
  created_at timestamp,
  PRIMARY KEY ((account_id, bucket), entry_id)
) WITH CLUSTERING ORDER BY (entry_id ASC)
AND compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.course_refund_by_id (
  refund_id uuid,
  order_id uuid,
  student_id uuid,
  course_id uuid,
  amount bigint,
  currency text,
  reason text,
  status text,
  progress_percent_at_request double,
  requested_at timestamp,
  processed_at timestamp,
  failure_reason text,
  PRIMARY KEY (refund_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.course_refund_by_order (
  order_id uuid,
  refund_id uuid,
  status text,
  requested_at timestamp,
  PRIMARY KEY (order_id)
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.lecturer_payout_batches (
  lecturer_id uuid,
  period_month text,
  batch_id uuid,
  total_amount bigint,
  currency text,
  status text,
  ledger_ref text,
  created_at timestamp,
  settled_at timestamp,
  PRIMARY KEY ((lecturer_id), period_month, batch_id)
) WITH CLUSTERING ORDER BY (period_month DESC, batch_id ASC)
AND compaction = {'class': 'SizeTieredCompactionStrategy'};
