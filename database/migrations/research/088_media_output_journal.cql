-- Every rendition attempt records its exact derived objects before first PUT.
-- Existing media_queue_day_by_tenant indexes these day/shard partitions.
-- Keep resolved intents: a late PUT from a fenced owner can be removed again.
CREATE TABLE IF NOT EXISTS learning_keyspace.media_output_journal_by_day_shard (
  tenant_id uuid, job_day date, shard int, media_asset_id uuid, lease uuid,
  revision bigint, payload text,
  PRIMARY KEY ((tenant_id, job_day, shard), media_asset_id, lease)
);
GRANT SELECT ON TABLE learning_keyspace.media_output_journal_by_day_shard TO svc_media_worker;
GRANT MODIFY ON TABLE learning_keyspace.media_output_journal_by_day_shard TO svc_media_worker;
GRANT MODIFY ON TABLE learning_keyspace.media_queue_day_by_tenant TO svc_media_worker;
-- Required only to append failure audit under binding/history CAS.
GRANT SELECT ON TABLE learning_keyspace.media_asset_by_lesson TO svc_media_worker;
GRANT MODIFY ON TABLE learning_keyspace.media_asset_by_lesson TO svc_media_worker;
