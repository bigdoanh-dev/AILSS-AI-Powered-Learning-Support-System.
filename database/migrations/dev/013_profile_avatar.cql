USE identity_keyspace;
CREATE TABLE IF NOT EXISTS avatar_by_user (
  user_id uuid PRIMARY KEY,
  content_type text,
  image blob,
  updated_at timestamp
);
