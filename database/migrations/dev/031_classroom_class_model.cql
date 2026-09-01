-- P7.15A additive P7.12C class model columns. Migrator role only.
ALTER TABLE classroom_keyspace.class_by_id ADD IF NOT EXISTS class_kind text;
ALTER TABLE classroom_keyspace.class_by_id ADD IF NOT EXISTS schedule_state text;
ALTER TABLE classroom_keyspace.class_by_id ADD IF NOT EXISTS schedule_version bigint;
ALTER TABLE classroom_keyspace.class_by_id ADD IF NOT EXISTS max_members int;
ALTER TABLE classroom_keyspace.membership_by_class_student ADD IF NOT EXISTS source text;
ALTER TABLE classroom_keyspace.membership_by_class_student ADD IF NOT EXISTS offering_id uuid;
ALTER TABLE classroom_keyspace.membership_by_class_student ADD IF NOT EXISTS enrollment_id uuid;
ALTER TABLE classroom_keyspace.membership_by_class_student ADD IF NOT EXISTS schedule_reservation_id uuid;
