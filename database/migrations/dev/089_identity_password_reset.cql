-- One short-lived challenge per account email. OTPs and verified reset tokens are
-- stored only as keyed HMACs; Cassandra removes all challenge data after 15 minutes.
CREATE TABLE IF NOT EXISTS identity_keyspace.password_reset_by_email (
  normalized_email text,
  user_id uuid,
  otp_hmac text,
  verified_token_hmac text,
  token_version int,
  credential_version bigint,
  attempts int,
  issued_at timestamp,
  sent_at timestamp,
  expires_at timestamp,
  PRIMARY KEY (normalized_email)
)
WITH default_time_to_live = 900;
