-- Phase 16B & 17 AI Assistant Platform Foundation and Persistence
CREATE TABLE IF NOT EXISTS ai_keyspace.assistant_conversation_by_id (
  conversation_id uuid PRIMARY KEY,
  user_id uuid,
  role text,
  mode text,
  course_id uuid,
  title text,
  created_at timestamp,
  updated_at timestamp
);

CREATE TABLE IF NOT EXISTS ai_keyspace.assistant_conversations_by_user (
  user_id uuid,
  updated_at timestamp,
  conversation_id uuid,
  role text,
  mode text,
  title text,
  PRIMARY KEY ((user_id), updated_at, conversation_id)
) WITH CLUSTERING ORDER BY (updated_at DESC, conversation_id ASC);

CREATE TABLE IF NOT EXISTS ai_keyspace.assistant_messages_by_conversation (
  conversation_id uuid,
  created_at timestamp,
  message_id uuid,
  sender text,
  content text,
  tool_calls text,
  tool_results text,
  citations text,
  PRIMARY KEY ((conversation_id), created_at, message_id)
) WITH CLUSTERING ORDER BY (created_at ASC, message_id ASC);

CREATE TABLE IF NOT EXISTS ai_keyspace.assistant_tool_invocation (
  conversation_id uuid,
  occurred_at timestamp,
  invocation_id uuid,
  user_id uuid,
  tool_name text,
  status text,
  execution_time_ms int,
  error_code text,
  PRIMARY KEY ((conversation_id), occurred_at, invocation_id)
) WITH CLUSTERING ORDER BY (occurred_at ASC, invocation_id ASC);
