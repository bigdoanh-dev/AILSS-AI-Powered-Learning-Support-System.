-- Assistant token usage is partitioned by user and UTC day to bound partition growth.
-- A unique usage_id preserves multiple calls with the same timestamp.
CREATE KEYSPACE IF NOT EXISTS ai_service WITH replication = {'class':'NetworkTopologyStrategy','ailss_dc':3} AND durable_writes = true;

CREATE TABLE IF NOT EXISTS ai_service.ai_token_usage (
  user_id uuid,
  usage_day date,
  timestamp timestamp,
  usage_id uuid,
  session_id uuid,
  provider text,
  prompt_tokens int,
  completion_tokens int,
  PRIMARY KEY ((user_id, usage_day), timestamp, usage_id)
) WITH CLUSTERING ORDER BY (timestamp DESC, usage_id ASC);
