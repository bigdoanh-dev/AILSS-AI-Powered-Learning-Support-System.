import { describe, expect, it, vi } from "vitest";
import type { CassandraClient } from "../../packages/cassandra/src/index.js";
import { AssistantRepository } from "../../apps/ai-service/src/assistant/repository.js";

const conversationId = "00000000-0000-4000-8000-000000000100";
const messageIds = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
] as const;

function row(values: Record<string, unknown>) {
  return { get: (name: string): unknown => values[name] };
}

describe("AssistantRepository conversation history", () => {
  it("reads the latest N Cassandra rows and returns them in chronological order", async () => {
    // The older message is outside the requested window. The two newer messages
    // share a timestamp, so message_id is needed for deterministic ordering.
    const newestFirst = [
      row({
        message_id: messageIds[2], conversation_id: conversationId,
        created_at: new Date("2026-09-23T10:01:00.000Z"), sender: "ASSISTANT",
        content: "Latest reply", tool_calls: null, tool_results: null,
        citations: '[{"title":"Source"}]',
      }),
      row({
        message_id: messageIds[1], conversation_id: conversationId,
        created_at: new Date("2026-09-23T10:01:00.000Z"), sender: "USER",
        content: "Latest question", tool_calls: null, tool_results: null, citations: null,
      }),
    ];
    const execute = vi.fn().mockResolvedValue(newestFirst);
    const repository = new AssistantRepository({ execute } as unknown as CassandraClient);

    const messages = await repository.getRecentMessages(conversationId, 2);

    expect(execute).toHaveBeenCalledOnce();
    const [cql, params, consistency] = execute.mock.calls[0] as [string, readonly unknown[], string];
    expect(cql).toMatch(/WHERE conversation_id = \?\s+ORDER BY created_at DESC, message_id DESC\s+LIMIT \?/);
    expect(String(params[0])).toBe(conversationId);
    expect(params[1]).toBe(2);
    expect(consistency).toBe("LOCAL_QUORUM");
    expect(messages.map((message) => message.messageId)).toEqual([messageIds[1], messageIds[2]]);
    expect(messages.map((message) => message.content)).toEqual(["Latest question", "Latest reply"]);
    expect(messages[1]?.citations).toEqual([{ title: "Source" }]);
  });

  it("returns an empty history for a new conversation", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const repository = new AssistantRepository({ execute } as unknown as CassandraClient);
    await expect(repository.getRecentMessages(conversationId)).resolves.toEqual([]);
  });
});
