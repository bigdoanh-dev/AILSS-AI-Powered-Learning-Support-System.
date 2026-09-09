CREATE TABLE IF NOT EXISTS learning_keyspace.sepay_transaction_by_id (
  transaction_id text PRIMARY KEY,
  order_id uuid,
  fingerprint text,
  received_at timestamp
);
CREATE TABLE IF NOT EXISTS learning_keyspace.sepay_payment_by_order (
  order_id uuid PRIMARY KEY,
  transaction_id text,
  received_at timestamp
);
