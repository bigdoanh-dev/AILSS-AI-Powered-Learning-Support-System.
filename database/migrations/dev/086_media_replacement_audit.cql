-- Phase 42 Revision B: keep the replacement event in the same LWT row as the
-- active lesson binding, so a successful switch cannot lose its audit record.
ALTER TABLE learning_keyspace.media_asset_by_lesson ADD IF NOT EXISTS replacement_history text;
