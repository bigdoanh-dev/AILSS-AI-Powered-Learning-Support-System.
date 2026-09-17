USE identity_keyspace;

CREATE TABLE IF NOT EXISTS external_identity_by_provider_subject (
  provider text,
  provider_subject text,
  user_id uuid,
  email_at_link_time text,
  profile_snapshot text,
  created_at timestamp,
  last_login_at timestamp,
  PRIMARY KEY ((provider, provider_subject))
);

CREATE TABLE IF NOT EXISTS external_identities_by_user (
  user_id uuid,
  provider text,
  provider_subject text,
  email_at_link_time text,
  linked_at timestamp,
  PRIMARY KEY ((user_id), provider)
);
