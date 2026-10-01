CREATE TABLE IF NOT EXISTS learning_keyspace.course_categories (
  catalog text,
  category_id uuid,
  name text,
  PRIMARY KEY (catalog, category_id)
);
