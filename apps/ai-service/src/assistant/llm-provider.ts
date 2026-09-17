import type { ToolCall } from "./model.js";

export interface LlmMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly ToolCall[];
}

export interface LlmCompletionRequest {
  readonly systemPrompt: string;
  readonly messages: readonly LlmMessage[];
  readonly availableTools: readonly {
    readonly name: string;
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  }[];
  readonly temperature?: number;
  readonly maxTokens?: number;
}

export interface LlmCompletionResponse {
  readonly content: string;
  readonly toolCalls?: readonly ToolCall[];
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
}

export interface AssistantLlmProvider {
  generate(request: LlmCompletionRequest): Promise<LlmCompletionResponse>;
}

export class HttpAssistantLlmProvider implements AssistantLlmProvider {
  public constructor(
    private readonly options: {
      readonly endpoint: string;
      readonly apiKey: string;
      readonly model: string;
      readonly timeoutMs?: number;
    },
  ) {}

  public async generate(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    const isGoogle =
      new URL(this.options.endpoint).hostname === "generativelanguage.googleapis.com" &&
      this.options.endpoint.endsWith(":generateContent");

    if (isGoogle) {
      // Gemini native format
      const contents = request.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        }));

      const res = await fetch(this.options.endpoint, {
        method: "POST",
        headers: {
          "x-goog-api-key": this.options.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.systemPrompt }] },
          contents,
          generationConfig: {
            temperature: request.temperature ?? 0.3,
            maxOutputTokens: request.maxTokens ?? 2048,
          },
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 15000),
      });

      if (!res.ok) {
        throw new Error(`LLM provider error: ${String(res.status)} ${res.statusText}`);
      }

      const json = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };

      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      return {
        content: text,
        usage: {
          inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
        },
      };
    }

    // OpenAI-compatible format
    const messages = [
      { role: "system", content: request.systemPrompt },
      ...request.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    const res = await fetch(this.options.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.options.model,
        messages,
        temperature: request.temperature ?? 0.3,
        max_tokens: request.maxTokens ?? 2048,
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 15000),
    });

    if (!res.ok) {
      throw new Error(`LLM provider error: ${String(res.status)} ${res.statusText}`);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const text = json.choices?.[0]?.message?.content ?? "";
    return {
      content: text,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
    };
  }
}
