import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import type {
  AssistantMode,
  AssistantRole,
  Citation,
  ConversationMessage,
  ConversationSender,
  ConversationSummary,
  ToolCall,
  ToolResult,
} from "./model.js";

const LOCAL_QUORUM = "LOCAL_QUORUM" as const;
const uuid = (value: string) => types.Uuid.fromString(value);

export interface CreateConversationInput {
  readonly conversationId: string;
  readonly userId: string;
  readonly role: AssistantRole;
  readonly mode: AssistantMode;
  readonly courseId?: string;
  readonly title: string;
  readonly now: Date;
}

export interface AppendMessageInput {
  readonly messageId: string;
  readonly conversationId: string;
  readonly sender: ConversationSender;
  readonly content: string;
  readonly toolCalls?: readonly ToolCall[];
  readonly toolResults?: readonly ToolResult[];
  readonly citations?: readonly Citation[];
  readonly now: Date;
}

export interface LogToolInvocationInput {
  readonly conversationId: string;
  readonly invocationId: string;
  readonly userId: string;
  readonly toolName: string;
  readonly status: "SUCCESS" | "FAILED" | "REJECTED";
  readonly executionTimeMs: number;
  readonly errorCode?: string;
  readonly now: Date;
}

export class AssistantRepository {
  public constructor(private readonly client: CassandraClient) {}

  public async getConversation(conversationId: string): Promise<ConversationSummary | null> {
    const rows = await this.client.execute(
      `SELECT conversation_id, user_id, role, mode, course_id, title, created_at, updated_at
       FROM ai_keyspace.assistant_conversation_by_id
       WHERE conversation_id = ?`,
      [uuid(conversationId)],
      LOCAL_QUORUM,
    );
    const row = rows[0];
    if (!row) return null;

    const courseVal = row.get("course_id") as types.Uuid | null | undefined;
    const createdAtVal: unknown = row.get("created_at");
    const updatedAtVal: unknown = row.get("updated_at");

    return {
      conversationId: String(row.get("conversation_id")),
      userId: String(row.get("user_id")),
      role: row.get("role") as AssistantRole,
      mode: row.get("mode") as AssistantMode,
      ...(courseVal ? { courseId: courseVal.toString() } : {}),
      title: String(row.get("title") ?? "Untitled Conversation"),
      createdAt: createdAtVal instanceof Date ? createdAtVal : new Date(String(createdAtVal)),
      updatedAt: updatedAtVal instanceof Date ? updatedAtVal : new Date(String(updatedAtVal)),
    };
  }

  public async createConversation(input: CreateConversationInput): Promise<ConversationSummary> {
    const convId = uuid(input.conversationId);
    const uId = uuid(input.userId);
    const courseIdUuid = input.courseId ? uuid(input.courseId) : null;

    // 1. Insert into assistant_conversation_by_id
    await this.client.execute(
      `INSERT INTO ai_keyspace.assistant_conversation_by_id (
         conversation_id, user_id, role, mode, course_id, title, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [convId, uId, input.role, input.mode, courseIdUuid, input.title, input.now, input.now],
      LOCAL_QUORUM,
    );

    // 2. Insert into assistant_conversations_by_user
    await this.client.execute(
      `INSERT INTO ai_keyspace.assistant_conversations_by_user (
         user_id, updated_at, conversation_id, role, mode, title
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [uId, input.now, convId, input.role, input.mode, input.title],
      LOCAL_QUORUM,
    );

    return {
      conversationId: input.conversationId,
      userId: input.userId,
      role: input.role,
      mode: input.mode,
      ...(input.courseId ? { courseId: input.courseId } : {}),
      title: input.title,
      createdAt: input.now,
      updatedAt: input.now,
    };
  }

  public async touchConversation(
    conversationId: string,
    userId: string,
    title: string,
    now: Date,
    courseId?: string,
  ): Promise<void> {
    const convId = uuid(conversationId);
    const uId = uuid(userId);
    const previous = await this.getConversation(conversationId);

    await this.client.execute(
      `UPDATE ai_keyspace.assistant_conversation_by_id
       SET updated_at = ?, title = ?, course_id = ?
       WHERE conversation_id = ?`,
      [now, title, courseId ? uuid(courseId) : null, convId],
      LOCAL_QUORUM,
    );

    // Move the list index row rather than accumulating one row per message.
    if (previous) {
      await this.client.execute(
        `INSERT INTO ai_keyspace.assistant_conversations_by_user (
           user_id, updated_at, conversation_id, role, mode, title
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [uId, now, convId, previous.role, previous.mode, title],
        LOCAL_QUORUM,
      );
      if (previous.updatedAt.getTime() !== now.getTime()) {
        await this.client.execute(
          `DELETE FROM ai_keyspace.assistant_conversations_by_user
           WHERE user_id = ? AND updated_at = ? AND conversation_id = ?`,
          [uId, previous.updatedAt, convId],
          LOCAL_QUORUM,
        );
      }
    }
  }

  public async listUserConversations(userId: string, limit = 20): Promise<ConversationSummary[]> {
    const rows = await this.client.execute(
      `SELECT conversation_id, user_id, updated_at, role, mode, title
       FROM ai_keyspace.assistant_conversations_by_user
       WHERE user_id = ?
       LIMIT ?`,
      [uuid(userId), Math.min(Math.max(limit * 25, 100), 500)],
      LOCAL_QUORUM,
    );

    const seen = new Set<string>();
    return rows
      .flatMap((r) => {
        const conversationId = String(r.get("conversation_id"));
        if (seen.has(conversationId)) return [];
        seen.add(conversationId);
        const updatedAtVal: unknown = r.get("updated_at");
        const date = updatedAtVal instanceof Date ? updatedAtVal : new Date(String(updatedAtVal));
        return [
          {
            conversationId,
            userId: String(r.get("user_id")),
            role: r.get("role") as AssistantRole,
            mode: r.get("mode") as AssistantMode,
            title: String(r.get("title") ?? "Untitled Conversation"),
            createdAt: date,
            updatedAt: date,
          },
        ];
      })
      .slice(0, limit);
  }

  public async appendMessage(input: AppendMessageInput): Promise<ConversationMessage> {
    const convId = uuid(input.conversationId);
    const msgId = uuid(input.messageId);
    const toolCallsJson = input.toolCalls ? JSON.stringify(input.toolCalls) : null;
    const toolResultsJson = input.toolResults ? JSON.stringify(input.toolResults) : null;
    const citationsJson = input.citations ? JSON.stringify(input.citations) : null;

    await this.client.execute(
      `INSERT INTO ai_keyspace.assistant_messages_by_conversation (
         conversation_id, created_at, message_id, sender, content, tool_calls, tool_results, citations
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [convId, input.now, msgId, input.sender, input.content, toolCallsJson, toolResultsJson, citationsJson],
      LOCAL_QUORUM,
    );

    return {
      messageId: input.messageId,
      conversationId: input.conversationId,
      sender: input.sender,
      content: input.content,
      ...(input.toolCalls ? { toolCalls: input.toolCalls } : {}),
      ...(input.toolResults ? { toolResults: input.toolResults } : {}),
      ...(input.citations ? { citations: input.citations } : {}),
      createdAt: input.now,
    };
  }

  public async getRecentMessages(conversationId: string, limit = 20): Promise<ConversationMessage[]> {
    const rows = await this.client.execute(
      `SELECT message_id, conversation_id, created_at, sender, content, tool_calls, tool_results, citations
       FROM ai_keyspace.assistant_messages_by_conversation
       WHERE conversation_id = ?
       ORDER BY created_at DESC, message_id DESC
       LIMIT ?`,
      [uuid(conversationId), limit],
      LOCAL_QUORUM,
    );

    // Cassandra stores this partition in ascending clustering order. Fetch the latest
    // rows first, then restore chronological order for the LLM and conversation UI.
    return rows
      .map((r) => {
        const createdAtVal: unknown = r.get("created_at");
        const toolCallsRaw: unknown = r.get("tool_calls");
        const toolResultsRaw: unknown = r.get("tool_results");
        const citationsRaw: unknown = r.get("citations");

        let toolCalls: readonly ToolCall[] | undefined;
        let toolResults: readonly ToolResult[] | undefined;
        let citations: readonly Citation[] | undefined;

        if (typeof toolCallsRaw === "string" && toolCallsRaw) {
          try {
            toolCalls = JSON.parse(toolCallsRaw) as readonly ToolCall[];
          } catch {
            toolCalls = undefined;
          }
        }
        if (typeof toolResultsRaw === "string" && toolResultsRaw) {
          try {
            toolResults = JSON.parse(toolResultsRaw) as readonly ToolResult[];
          } catch {
            toolResults = undefined;
          }
        }
        if (typeof citationsRaw === "string" && citationsRaw) {
          try {
            citations = JSON.parse(citationsRaw) as readonly Citation[];
          } catch {
            citations = undefined;
          }
        }

        return {
          messageId: String(r.get("message_id")),
          conversationId: String(r.get("conversation_id")),
          sender: r.get("sender") as ConversationSender,
          content: String(r.get("content") ?? ""),
          ...(toolCalls ? { toolCalls } : {}),
          ...(toolResults ? { toolResults } : {}),
          ...(citations ? { citations } : {}),
          createdAt: createdAtVal instanceof Date ? createdAtVal : new Date(String(createdAtVal)),
        };
      })
      .reverse();
  }

  public async logToolInvocation(input: LogToolInvocationInput): Promise<void> {
    const convId = uuid(input.conversationId);
    const invId = uuid(input.invocationId);
    const uId = uuid(input.userId);

    await this.client.execute(
      `INSERT INTO ai_keyspace.assistant_tool_invocation (
         conversation_id, occurred_at, invocation_id, user_id, tool_name, status, execution_time_ms, error_code
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        convId,
        input.now,
        invId,
        uId,
        input.toolName,
        input.status,
        input.executionTimeMs,
        input.errorCode ?? null,
      ],
      LOCAL_QUORUM,
    );
  }
}
