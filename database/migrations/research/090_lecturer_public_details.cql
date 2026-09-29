ALTER TABLE identity_keyspace.public_lecturer_by_id ADD IF NOT EXISTS experience text;
ALTER TABLE identity_keyspace.public_lecturer_by_id ADD IF NOT EXISTS education text;
ALTER TABLE identity_keyspace.public_lecturer_by_id ADD IF NOT EXISTS achievements text;
ALTER TABLE identity_keyspace.public_lecturer_by_id ADD IF NOT EXISTS avatar_public boolean;
