-- Single bounded tenant CAS row: tenant and per-course reservations change
-- atomically, without counters or unsafe cross-partition compensation.
CREATE TABLE IF NOT EXISTS learning_keyspace.media_quota_by_tenant (
  tenant_id uuid PRIMARY KEY, revision bigint, payload text
);
GRANT SELECT ON TABLE learning_keyspace.media_quota_by_tenant TO svc_media_worker;
GRANT MODIFY ON TABLE learning_keyspace.media_quota_by_tenant TO svc_media_worker;
