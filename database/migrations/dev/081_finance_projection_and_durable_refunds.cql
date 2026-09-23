-- Authoritative, query-first finance projection and durable refund workflow.
-- Facts are immutable and idempotent by business event id. Day + shard bounds every dashboard read.
CREATE TABLE IF NOT EXISTS learning_keyspace.revenue_payment_facts_by_day_shard (
  bucket_day date,
  shard tinyint,
  occurred_at timestamp,
  order_id uuid,
  payment_event_id uuid,
  provider_transaction_id text,
  student_id uuid,
  course_id uuid,
  offering_id uuid,
  gross_minor bigint,
  currency text,
  PRIMARY KEY ((bucket_day, shard), occurred_at, order_id)
) WITH CLUSTERING ORDER BY (occurred_at DESC, order_id ASC)
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': '1'};

CREATE TABLE IF NOT EXISTS learning_keyspace.revenue_payment_fact_by_event (
  payment_event_id uuid PRIMARY KEY,
  bucket_day date,
  shard tinyint,
  occurred_at timestamp,
  order_id uuid
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.revenue_refund_facts_by_day_shard (
  bucket_day date,
  shard tinyint,
  occurred_at timestamp,
  refund_id uuid,
  order_id uuid,
  provider_refund_id text,
  course_id uuid,
  amount_minor bigint,
  currency text,
  status text,
  PRIMARY KEY ((bucket_day, shard), occurred_at, refund_id)
) WITH CLUSTERING ORDER BY (occurred_at DESC, refund_id ASC)
AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': '1'};

CREATE TABLE IF NOT EXISTS learning_keyspace.revenue_refund_fact_by_id (
  refund_id uuid PRIMARY KEY,
  bucket_day date,
  shard tinyint,
  occurred_at timestamp,
  order_id uuid,
  status text
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.finance_projection_control (
  projection_name text PRIMARY KEY,
  status text,
  backfill_through timestamp,
  last_reconciled_at timestamp,
  checksum text,
  updated_at timestamp
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};

CREATE TABLE IF NOT EXISTS learning_keyspace.finance_reconciliation_by_day (
  bucket_day date PRIMARY KEY,
  payment_fact_count bigint,
  refund_fact_count bigint,
  gross_minor bigint,
  refund_minor bigint,
  currency text,
  status text,
  checksum text,
  reconciled_at timestamp
) WITH compaction = {'class': 'SizeTieredCompactionStrategy'};
