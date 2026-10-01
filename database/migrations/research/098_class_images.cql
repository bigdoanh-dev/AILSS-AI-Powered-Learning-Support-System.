-- Add bounded class photo and cover data URLs to the canonical class record.
ALTER TABLE classroom_keyspace.class_by_id ADD IF NOT EXISTS photo_data_url text;
ALTER TABLE classroom_keyspace.class_by_id ADD IF NOT EXISTS cover_data_url text;
