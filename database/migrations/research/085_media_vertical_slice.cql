-- Phase 42: metadata only; bytes remain in private S3-compatible object storage.
CREATE TABLE IF NOT EXISTS learning_keyspace.media_queue_day_by_tenant (
  tenant_id uuid, job_day date, PRIMARY KEY ((tenant_id), job_day)
);
GRANT SELECT ON TABLE learning_keyspace.media_queue_day_by_tenant TO svc_media_worker;
CREATE TABLE IF NOT EXISTS learning_keyspace.media_asset_by_tenant_id (
  tenant_id uuid, media_asset_id uuid, revision bigint, payload text,
  PRIMARY KEY ((tenant_id, media_asset_id))
) WITH compaction = {'class':'SizeTieredCompactionStrategy'};
CREATE TABLE IF NOT EXISTS learning_keyspace.media_asset_by_lesson (
  tenant_id uuid, lesson_id uuid, media_asset_id uuid,
  PRIMARY KEY ((tenant_id, lesson_id))
) WITH compaction = {'class':'SizeTieredCompactionStrategy'};
CREATE TABLE IF NOT EXISTS learning_keyspace.media_job_by_day_shard (
  tenant_id uuid, job_day date, shard int, media_asset_id uuid,
  revision bigint, attempts int, lease uuid, lease_until timestamp,
  PRIMARY KEY ((tenant_id, job_day, shard), media_asset_id)
) WITH compaction = {'class':'TimeWindowCompactionStrategy','compaction_window_unit':'DAYS','compaction_window_size':'1'};
GRANT SELECT ON TABLE learning_keyspace.media_asset_by_tenant_id TO svc_media_worker;
GRANT MODIFY ON TABLE learning_keyspace.media_asset_by_tenant_id TO svc_media_worker;
GRANT SELECT ON TABLE learning_keyspace.media_job_by_day_shard TO svc_media_worker;
GRANT MODIFY ON TABLE learning_keyspace.media_job_by_day_shard TO svc_media_worker;
-- Publication and media-reference writes share an authoritative course fence.
ALTER TABLE learning_keyspace.course_by_id ADD IF NOT EXISTS media_write_token uuid;
ALTER TABLE learning_keyspace.course_by_id ADD IF NOT EXISTS media_write_until timestamp;
