import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CassandraClient } from "../../packages/cassandra/src/index.js";
import { HttpAssistantLlmProvider } from "../../apps/ai-service/src/assistant/llm-provider.js";
import {
  AssistantRepository,
  type SaveTokenUsageInput,
} from "../../apps/ai-service/src/assistant/repository.js";

const userId = randomUUID();
const sessionId = randomUUID();
const request = {
  systemPrompt: "Help the learner.",
  messages: [{ role: "user" as const, content: "What is quorum?" }],
  availableTools: [],
  usageContext: { userId, sessionId },
};

describe("assistant token accounting", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("persists the actual provider counts once per result with distinct usage IDs", async () => {
    const saveTokenUsage = vi.fn((_input: SaveTokenUsageInput) => Promise.resolve());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "Quorum overlaps reads and writes." } }],
              usage: { prompt_tokens: 21, completion_tokens: 8 },
            }),
            { status: 200 },
          ),
        ),
      ),
    );
    const provider = new HttpAssistantLlmProvider({
      endpoint: "https://provider.example.invalid/v1/chat/completions",
      apiKey: "test-key",
      model: "test-model",
      tokenUsageRepository: { saveTokenUsage },
    });

    await provider.generate(request);
    await provider.generate(request);
    await vi.waitFor(() => expect(saveTokenUsage).toHaveBeenCalledTimes(2));
    const first = saveTokenUsage.mock.calls[0]?.[0];
    const second = saveTokenUsage.mock.calls[1]?.[0];
    expect(first).toMatchObject({
      userId,
      sessionId,
      provider: "openai-compatible",
      promptTokens: 21,
      completionTokens: 8,
    });
    expect(first?.timestamp).toBeInstanceOf(Date);
    expect(first?.usageId).not.toBe(second?.usageId);
  });

  it("does not fail the response when the asynchronous Cassandra write fails", async () => {
    const onTokenUsageError = vi.fn();
    const saveTokenUsage = vi.fn((_input: SaveTokenUsageInput) =>
      Promise.reject(new Error("database unavailable")),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "Quorum answer" }] } }],
            usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5 },
          }),
          { status: 200 },
        ),
      ),
    );
    const provider = new HttpAssistantLlmProvider({
      endpoint: "https://generativelanguage.googleapis.com/v1beta/models/test:generateContent",
      apiKey: "test-key",
      model: "test-model",
      tokenUsageRepository: { saveTokenUsage },
      onTokenUsageError,
    });

    await expect(provider.generate(request)).resolves.toMatchObject({ content: "Quorum answer" });
    await vi.waitFor(() => expect(onTokenUsageError).toHaveBeenCalledOnce());
    expect(saveTokenUsage).toHaveBeenCalledOnce();
    expect(saveTokenUsage.mock.calls[0]?.[0]).toMatchObject({
      provider: "gemini",
      promptTokens: 12,
      completionTokens: 5,
    });
  });

  it("does not invent usage for a response without provider token metadata", async () => {
    const saveTokenUsage = vi.fn((_input: SaveTokenUsageInput) => Promise.resolve());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: "Answer" } }] }), {
          status: 200,
        }),
      ),
    );
    const provider = new HttpAssistantLlmProvider({
      endpoint: "https://provider.example.invalid/v1/chat/completions",
      apiKey: "test-key",
      model: "test-model",
      tokenUsageRepository: { saveTokenUsage },
    });

    await expect(provider.generate(request)).resolves.not.toHaveProperty("usage");
    expect(saveTokenUsage).not.toHaveBeenCalled();
  });

  it("does not account token metadata from an unusable provider response", async () => {
    const saveTokenUsage = vi.fn((_input: SaveTokenUsageInput) => Promise.resolve());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "" } }],
            usage: { prompt_tokens: 9, completion_tokens: 2 },
          }),
          { status: 200 },
        ),
      ),
    );
    const provider = new HttpAssistantLlmProvider({
      endpoint: "https://provider.example.invalid/v1/chat/completions",
      apiKey: "test-key",
      model: "test-model",
      tokenUsageRepository: { saveTokenUsage },
    });

    await expect(provider.generate(request)).rejects.toBeDefined();
    expect(saveTokenUsage).not.toHaveBeenCalled();
  });

  it("records only the successful result after an upstream retry", async () => {
    const saveTokenUsage = vi.fn((_input: SaveTokenUsageInput) => Promise.resolve());
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "Answer" } }],
            usage: { prompt_tokens: 7, completion_tokens: 3 },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const provider = new HttpAssistantLlmProvider({
      endpoint: "https://provider.example.invalid/v1/chat/completions",
      apiKey: "test-key",
      model: "test-model",
      tokenUsageRepository: { saveTokenUsage },
    });

    await expect(provider.generate(request)).resolves.toMatchObject({ content: "Answer" });
    await vi.waitFor(() => expect(saveTokenUsage).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(saveTokenUsage.mock.calls[0]?.[0]).toMatchObject({
      promptTokens: 7,
      completionTokens: 3,
    });
  });

  it("writes the user and UTC day as a bounded Cassandra partition", async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const repository = new AssistantRepository({ execute } as unknown as CassandraClient);
    const usageId = randomUUID();
    await repository.saveTokenUsage({
      usageId,
      userId,
      sessionId,
      provider: "gemini",
      promptTokens: 12,
      completionTokens: 5,
      timestamp: new Date("2026-09-29T23:59:58.000Z"),
    });

    const [query, params, consistency] = execute.mock.calls[0] as [string, unknown[], string];
    expect(query).toContain("INSERT INTO ai_service.ai_token_usage");
    expect(String(params[0])).toBe(userId);
    expect(String(params[1])).toBe("2026-09-29");
    expect(String(params[3])).toBe(usageId);
    expect(String(params[4])).toBe(sessionId);
    expect(params.slice(5)).toEqual(["gemini", 12, 5]);
    expect(consistency).toBe("LOCAL_QUORUM");
  });
});
