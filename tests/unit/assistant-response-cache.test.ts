import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AssistantOrchestrator,
  ToolRunner,
  responseCacheKey,
  type AssistantDomainClient,
  type AssistantLlmProvider,
  type AssistantRepository,
  type AssistantResponseCache,
  type ConversationMessage,
  type ConversationSummary,
} from "../../apps/ai-service/src/assistant/index.js";

function fixture(options: { outage?: boolean; ttlSeconds?: number; content?: string } = {}) {
  let now = Date.now();
  let calls = 0;
  const entries = new Map<string, { content: string; expires: number }>();
  const conversations = new Map<string, ConversationSummary>();
  const messages = new Map<string, ConversationMessage[]>();
  const repository = {
    createConversation: async (input: {
      conversationId: string;
      userId: string;
      role: "ADMIN";
      mode: "ADMIN_SUPPORT";
      title: string;
      now: Date;
    }) => {
      const summary = { ...input, createdAt: input.now, updatedAt: input.now };
      conversations.set(input.conversationId, summary);
      return summary;
    },
    getConversation: async (id: string) => conversations.get(id) ?? null,
    touchConversation: async () => undefined,
    appendMessage: async (input: {
      messageId: string;
      conversationId: string;
      sender: "USER" | "ASSISTANT";
      content: string;
      now: Date;
    }) => {
      const message = { ...input, createdAt: input.now };
      const list = messages.get(input.conversationId) ?? [];
      list.push(message);
      messages.set(input.conversationId, list);
      return message;
    },
    getRecentMessages: async (id: string) => messages.get(id) ?? [],
  } as unknown as AssistantRepository;
  const cache: AssistantResponseCache = {
    get: async (key) => {
      if (options.outage) throw new Error("Cassandra unavailable");
      const entry = entries.get(key);
      return entry && entry.expires > now ? entry.content : null;
    },
    set: async (key, content, ttlSeconds) => {
      if (options.outage) throw new Error("Cassandra unavailable");
      entries.set(key, { content, expires: now + ttlSeconds * 1000 });
    },
  };
  const provider: AssistantLlmProvider = {
    generate: async () => {
      calls += 1;
      return {
        content: options.content ?? `answer ${String(calls)}`,
        usage: { inputTokens: 10, outputTokens: 2 },
      };
    },
  };
  const orchestrator = new AssistantOrchestrator({
    repository,
    toolRunner: new ToolRunner({} as AssistantDomainClient),
    domainClient: {} as AssistantDomainClient,
    llmProvider: provider,
    responseCache: cache,
    responseCacheTtlSeconds: options.ttlSeconds ?? 86_400,
    providerIdentity: "openai:example:model-v1",
    tenantId: "tenant-a",
    now: () => new Date(now),
  });
  const chat = (userId: string, message = "Where is the dashboard?") =>
    orchestrator.chat({ userId, role: "ADMIN" }, { mode: "ADMIN_SUPPORT", message });
  return {
    chat,
    entries,
    get calls() {
      return calls;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("assistant response cache", () => {
  it("uses the model on miss and returns the same content on hit with fresh response IDs", async () => {
    const f = fixture();
    const userId = randomUUID();
    const first = await f.chat(userId);
    const second = await f.chat(userId);
    expect(f.calls).toBe(1);
    expect(second.content).toBe(first.content);
    expect(second.messageId).not.toBe(first.messageId);
    expect(second.conversationId).not.toBe(first.conversationId);
  });

  it("expires entries at the configured TTL", async () => {
    const f = fixture({ ttlSeconds: 5 });
    const userId = randomUUID();
    await f.chat(userId);
    f.advance(5_001);
    const response = await f.chat(userId);
    expect(response.content).toBe("answer 2");
    expect(f.calls).toBe(2);
  });

  it("separates users and changed prompts", async () => {
    const f = fixture();
    const firstUser = randomUUID();
    await f.chat(firstUser);
    await f.chat(randomUUID());
    await f.chat(firstUser, "Where is moderation?");
    expect(f.calls).toBe(3);
  });

  it("fails open when cache reads and writes fail", async () => {
    const f = fixture({ outage: true });
    const userId = randomUUID();
    await f.chat(userId);
    await f.chat(userId);
    expect(f.calls).toBe(2);
  });

  it("does not store provider refusals", async () => {
    const f = fixture({ content: "I cannot help with that request." });
    const userId = randomUUID();
    await f.chat(userId);
    await f.chat(userId);
    expect(f.entries.size).toBe(0);
    expect(f.calls).toBe(2);
  });

  it("hashes history, system prompt, model, permission scope and tenant", () => {
    const request = {
      systemPrompt: "system v1",
      messages: [{ role: "user" as const, content: "hello" }],
      availableTools: [],
      temperature: 0.2,
      maxTokens: 100,
    };
    const base = { tenantId: "a", userId: "user", role: "ADMIN", providerIdentity: "model-a", request };
    const key = responseCacheKey(base);
    expect(responseCacheKey({ ...base, tenantId: "b" })).not.toBe(key);
    expect(responseCacheKey({ ...base, userId: "other" })).not.toBe(key);
    expect(responseCacheKey({ ...base, role: "STUDENT" })).not.toBe(key);
    expect(responseCacheKey({ ...base, courseId: "course" })).not.toBe(key);
    expect(responseCacheKey({ ...base, providerIdentity: "model-b" })).not.toBe(key);
    expect(responseCacheKey({ ...base, request: { ...request, systemPrompt: "system v2" } })).not.toBe(key);
    expect(
      responseCacheKey({
        ...base,
        request: {
          ...request,
          messages: [...request.messages, { role: "assistant" as const, content: "history" }],
        },
      }),
    ).not.toBe(key);
  });
});
