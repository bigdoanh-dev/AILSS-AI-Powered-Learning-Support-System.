-- Persist course description and bounded raster cover across clients.
ALTER TABLE learning_keyspace.course_by_id ADD IF NOT EXISTS description text;
ALTER TABLE learning_keyspace.course_by_id ADD IF NOT EXISTS cover_data_url text;
