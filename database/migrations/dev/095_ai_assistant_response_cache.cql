-- Exact request hash, bounded by write TTL. No secondary index or unbounded partition.
CREATE TABLE IF NOT EXISTS ai_service.assistant_response_cache (
  cache_key text PRIMARY KEY,
  content text
);
