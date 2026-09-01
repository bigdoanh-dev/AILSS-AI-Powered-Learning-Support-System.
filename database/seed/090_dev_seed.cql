-- Synthetic identifiers only. This seed intentionally contains no credentials or real PII.
INSERT INTO identity_keyspace.user_by_id
  (user_id,email_masked,display_name,role,status,lecturer_verified,token_version,profile_version,created_at,updated_at)
VALUES
  (11111111-1111-4111-8111-111111111111,'s***@example.test','Synthetic Student','STUDENT','ACTIVE',false,1,1,toTimestamp(now()),toTimestamp(now()));
