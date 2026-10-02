import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HttpAssistantLlmProvider,
  IntegrationOnlyAssistantLlmProvider,
} from "../../apps/ai-service/src/assistant/llm-provider.js";

const request = {
  systemPrompt: "Answer the learner with verified material.",
  messages: [{ role: "user" as const, content: "Explain quorum consistency." }],
  availableTools: [],
};

describe("assistant LLM provider failure handling", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([401, 403])(
    "reports provider HTTP %s as configuration failure without leaking its response",
    async (status) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private key detail", { status })));
      const provider = new HttpAssistantLlmProvider({
        endpoint: "https://provider.example.invalid/v1/chat/completions",
        apiKey: "test-key",
        model: "test-model",
      });
      await expect(provider.generate(request)).rejects.toMatchObject({
        code: "AI_PROVIDER_CONFIGURATION_ERROR",
        status: 503,
        retryable: false,
      });
    },
  );

  it("does not call the provider with an empty key", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const provider = new HttpAssistantLlmProvider({
      endpoint: "https://provider.example.invalid/v1/chat/completions",
      apiKey: "",
      model: "test-model",
    });
    await expect(provider.generate(request)).rejects.toMatchObject({
      code: "AI_PROVIDER_CONFIGURATION_ERROR",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("includes authoritative course and progress evidence in Gemini system instructions", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        Response.json({ candidates: [{ content: { parts: [{ text: "Grounded answer" }] } }] }),
      );
    vi.stubGlobal("fetch", fetch);
    const provider = new HttpAssistantLlmProvider({
      endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
      apiKey: "test-key",
      model: "gemini-3.8-flash",
    });
    await provider.generate({
      ...request,
      messages: [...request.messages, { role: "system", content: "Verified progress: 2 of 6 lessons." }],
    });
    const init = fetch.mock.calls[0]?.[1] as RequestInit;
    if (typeof init.body !== "string") throw new Error("Expected JSON request body");
    expect(JSON.parse(init.body) as unknown).toMatchObject({
      systemInstruction: {
        parts: [{ text: request.systemPrompt }, { text: "Verified progress: 2 of 6 lessons." }],
      },
      contents: [{ role: "user", parts: [{ text: "Explain quorum consistency." }] }],
    });
  });

  it.each([
    [
      "Google Gemini",
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    ],
    ["OpenAI-compatible", "https://provider.example.invalid/v1/chat/completions"],
  ])(
    "maps %s upstream HTTP failures to a retryable service-unavailable error",
    async (_provider, endpoint) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response("private upstream details", {
            status: 503,
            statusText: "Service Unavailable",
          }),
        ),
      );
      const provider = new HttpAssistantLlmProvider({ endpoint, apiKey: "test-key", model: "test-model" });
      await expect(provider.generate(request)).rejects.toMatchObject({
        code: "AI_PROVIDER_HTTP_503",
        status: 503,
        retryable: true,
        message: "The assistant service is temporarily unavailable",
      });
    },
  );

  it("maps network and timeout failures to a retryable service-unavailable error without leaking details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("private network details")));
    const provider = new HttpAssistantLlmProvider({
      endpoint: "https://provider.example.invalid/v1/chat/completions",
      apiKey: "test-key",
      model: "test-model",
    });
    await expect(provider.generate(request)).rejects.toMatchObject({
      code: "AI_PROVIDER_NETWORK_ERROR",
      status: 503,
      retryable: true,
    });
  });

  it("rejects malformed provider responses without inventing an assistant answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));
    const provider = new HttpAssistantLlmProvider({
      endpoint: "https://provider.example.invalid/v1/chat/completions",
      apiKey: "test-key",
      model: "test-model",
    });
    await expect(provider.generate(request)).rejects.toMatchObject({
      code: "AI_PROVIDER_INVALID_RESPONSE",
      status: 503,
      retryable: true,
    });
  });

  it.each([
    [
      "Gemini",
      "https://generativelanguage.googleapis.com/v1beta/models/test:generateContent",
      {
        candidates: [{ content: { parts: [{ text: "   " }] } }],
      },
    ],
    [
      "OpenAI-compatible",
      "https://provider.example.invalid/v1/chat/completions",
      {
        choices: [{ message: { content: "   " } }],
      },
    ],
  ])("rejects an empty successful %s response", async (_provider, endpoint, payload) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 })));
    const provider = new HttpAssistantLlmProvider({ endpoint, apiKey: "test-key", model: "test-model" });
    await expect(provider.generate(request)).rejects.toMatchObject({
      code: "AI_PROVIDER_INVALID_RESPONSE",
      status: 503,
      retryable: true,
      message: "The assistant service is temporarily unavailable",
    });
  });
});

describe("integration-only assistant model boundary", () => {
  const provider = new IntegrationOnlyAssistantLlmProvider();

  it("fails closed when actual grounded tool results are absent or failed", async () => {
    await expect(provider.generate(request)).rejects.toMatchObject({
      code: "AI_INTEGRATION_GROUNDING_UNAVAILABLE",
      status: 503,
      retryable: true,
    });
    await expect(
      provider.generate({
        ...request,
        integrationContext: {
          mode: "STUDY_BUDDY",
          toolResults: [
            {
              toolCallId: "material",
              name: "search_course_materials",
              result: [],
              error: "RAG_TOOL_UNAVAILABLE",
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "AI_INTEGRATION_GROUNDING_UNAVAILABLE", status: 503 });
  });

  it("returns only supplied study material and adaptive values without fabricating citations", async () => {
    const completion = await provider.generate({
      ...request,
      integrationContext: {
        mode: "STUDY_BUDDY",
        toolResults: [
          {
            toolCallId: "material",
            name: "search_course_materials",
            result: [
              {
                title: "Quorum notes",
                sectionTitle: "Read repair",
                contentSnippet: "The read quorum overlaps the write quorum.",
              },
            ],
          },
          {
            toolCallId: "mastery",
            name: "get_student_mastery",
            result: [{ conceptId: "concept-1", masteryState: "DEVELOPING", masteryScore: 0.42 }],
          },
          {
            toolCallId: "plan",
            name: "get_recommended_learning_path",
            result: { items: [{ title: "Review quorum", action: "Revisit the lesson" }] },
          },
        ],
      },
    });

    expect(completion.content).toContain("The read quorum overlaps the write quorum.");
    expect(completion.content).toContain("DEVELOPING — score 0.42");
    expect(completion.content).toContain("Review quorum — Revisit the lesson");
    expect(completion).not.toHaveProperty("citations");
    expect(completion.content).not.toContain("unprovided course");
  });

  it("grounds adaptive-only replies in successful mastery and study-plan tools without requiring a material search", async () => {
    const completion = await provider.generate({
      ...request,
      integrationContext: {
        mode: "STUDY_BUDDY",
        toolResults: [
          {
            toolCallId: "mastery",
            name: "get_student_mastery",
            result: [{ conceptId: "partitioning", masteryState: "DEVELOPING", masteryScore: 0.58 }],
          },
          {
            toolCallId: "plan",
            name: "get_recommended_learning_path",
            result: { items: [{ title: "Review partitions", action: "Complete the lesson" }] },
          },
        ],
      },
    });

    expect(completion.content).toContain("DEVELOPING — score 0.58");
    expect(completion.content).toContain("Review partitions — Complete the lesson");
    expect(completion).not.toHaveProperty("citations");
  });
});
