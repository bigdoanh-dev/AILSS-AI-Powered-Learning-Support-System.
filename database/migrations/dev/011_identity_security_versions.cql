-- P7.6 additive security columns. Applied only by the migrator/bootstrap path.
ALTER TABLE identity_keyspace.user_by_id ADD IF NOT EXISTS normalized_email text;
ALTER TABLE identity_keyspace.user_by_id ADD IF NOT EXISTS credential_version bigint;
ALTER TABLE identity_keyspace.user_by_id ADD IF NOT EXISTS security_operation_id uuid;
ALTER TABLE identity_keyspace.session_by_id ADD IF NOT EXISTS auth_version int;
ALTER TABLE identity_keyspace.credential_by_email ADD IF NOT EXISTS security_operation_id uuid;
