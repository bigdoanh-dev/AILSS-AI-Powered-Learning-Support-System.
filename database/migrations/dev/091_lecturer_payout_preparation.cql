CREATE TABLE IF NOT EXISTS learning_keyspace.payout_account_by_lecturer (
  lecturer_id uuid PRIMARY KEY,
  bank_name text,
  account_number text,
  account_holder text,
  updated_at timestamp
);

CREATE TABLE IF NOT EXISTS learning_keyspace.payout_instruction_by_month (
  payout_month text,
  lecturer_id uuid,
  instruction_id uuid,
  amount_minor bigint,
  currency text,
  bank_name text,
  account_number text,
  account_holder text,
  status text,
  created_at timestamp,
  PRIMARY KEY ((payout_month), lecturer_id)
);
