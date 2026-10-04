import type { AssistantMode, ToolCall, ToolResult } from "./model.js";
import { AppError } from "../../../../packages/http/src/index.js";
import { randomUUID } from "node:crypto";
import type { AssistantRepository } from "./repository.js";

async function requestProvider(endpoint: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(endpoint, init);
    } catch (error) {
      const timedOut =
        init.signal?.aborted ||
        (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"));
      const cause = error instanceof Error ? error.cause : undefined;
      const connectCode = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
      if (
        attempt === 0 &&
        !timedOut &&
        ["EAI_AGAIN", "ENOTFOUND", "ECONNREFUSED", "UND_ERR_CONNECT_TIMEOUT"].includes(String(connectCode))
      ) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        if (!init.signal?.aborted) continue;
      }
      throw new AppError(
        timedOut ? "AI_PROVIDER_TIMEOUT" : "AI_PROVIDER_NETWORK_ERROR",
        503,
        "The assistant service is temporarily unavailable",
        true,
      );
    }
    if (response.ok) return response;

    // A transient upstream outage can be brief. Reuse the same deadline and
    // retry once; do not retry rate limits or authentication/configuration errors.
    if (attempt === 0 && [502, 503, 504].includes(response.status) && !init.signal?.aborted) {
      await response.body?.cancel().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 350));
      if (init.signal?.aborted)
        throw new AppError(
          "AI_PROVIDER_TIMEOUT",
          503,
          "The assistant service is temporarily unavailable",
          true,
        );
      continue;
    }

    throw new AppError(
      [401, 403].includes(response.status)
        ? "AI_PROVIDER_CONFIGURATION_ERROR"
        : `AI_PROVIDER_HTTP_${String(response.status)}`,
      503,
      "The assistant service is temporarily unavailable",
      response.status === 429 || response.status >= 500,
    );
  }

  throw new AppError(
    "AI_PROVIDER_UNAVAILABLE",
    503,
    "The assistant service is temporarily unavailable",
    true,
  );
}

async function readProviderJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw invalidProviderResponse();
  }
}

function invalidProviderResponse(): AppError {
  return new AppError(
    "AI_PROVIDER_INVALID_RESPONSE",
    503,
    "The assistant service is temporarily unavailable",
    true,
  );
}

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
  readonly usageContext?: { readonly userId: string; readonly sessionId: string };
  /** In-process-only data for the explicitly enabled integration acceptance adapter. */
  readonly integrationContext?: {
    readonly mode: AssistantMode;
    readonly toolResults: readonly ToolResult[];
    readonly responseLanguage?: "vi" | "en";
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integrationFailure(): AppError {
  return new AppError(
    "AI_INTEGRATION_GROUNDING_UNAVAILABLE",
    503,
    "The integration assistant requires successful authorized tool results",
    true,
  );
}

/**
 * Deterministic, grounded model-boundary adapter for local integration acceptance only.
 * It cannot execute tools or supply citations; the orchestrator still validates citations
 * against the material results returned by the real authorized tools.
 */
export class IntegrationOnlyAssistantLlmProvider implements AssistantLlmProvider {
  public generate(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    return Promise.resolve().then(() => this.generateGrounded(request));
  }

  private generateGrounded(request: LlmCompletionRequest): LlmCompletionResponse {
    const context = request.integrationContext;
    if (!context) throw integrationFailure();
    const resultFor = (name: string) => context.toolResults.find((result) => result.name === name);
    const sections: string[] = [];

    if (context.mode === "STUDY_BUDDY") {
      const materialTool = resultFor("search_course_materials");
      if (materialTool) {
        if (materialTool.error || !Array.isArray(materialTool.result)) throw integrationFailure();
        const materials = materialTool.result.filter(isRecord);
        for (const material of materials.slice(0, 3)) {
          if (typeof material.title !== "string" || typeof material.contentSnippet !== "string") continue;
          const excerpt = material.contentSnippet.trim().replace(/\s+/gu, " ").slice(0, 700);
          if (!excerpt) continue;
          const section = typeof material.sectionTitle === "string" ? ` · ${material.sectionTitle}` : "";
          sections.push(`Tài liệu “${material.title}${section}” ghi: “${excerpt}”`);
        }
      }

      const masteryTool = resultFor("get_student_mastery");
      if (masteryTool) {
        if (masteryTool.error || !Array.isArray(masteryTool.result)) throw integrationFailure();
        const masteryRows = masteryTool.result.filter(isRecord).slice(0, 4);
        const facts = masteryRows
          .map((row) => {
            const name = [row.conceptName, row.learningOutcomeId, row.conceptId].find(
              (value): value is string => typeof value === "string" && value.length > 0,
            );
            const state = typeof row.masteryState === "string" ? row.masteryState : undefined;
            const score =
              typeof row.masteryScore === "number" && Number.isFinite(row.masteryScore)
                ? `score ${String(row.masteryScore)}`
                : undefined;
            return [name, state, score].filter(Boolean).join(" — ");
          })
          .filter(Boolean);
        if (facts.length) sections.push(`Kết quả mastery hiện có: ${facts.join("; ")}`);
      }

      const planTool = resultFor("get_recommended_learning_path");
      if (planTool) {
        if (planTool.error || !isRecord(planTool.result)) throw integrationFailure();
        const items = Array.isArray(planTool.result.items)
          ? planTool.result.items.filter(isRecord).slice(0, 4)
          : [];
        const nextSteps = items
          .map((item) => {
            const title = typeof item.title === "string" ? item.title : undefined;
            const action = typeof item.action === "string" ? item.action : undefined;
            const date = typeof item.scheduledDate === "string" ? item.scheduledDate : undefined;
            return [title, action, date].filter(Boolean).join(" — ");
          })
          .filter(Boolean);
        if (nextSteps.length) sections.push(`Mục trong Study Plan hiện tại: ${nextSteps.join("; ")}`);
      }
    } else if (context.mode === "STUDENT_ADVISOR") {
      const catalogTool = resultFor("search_courses");
      if (!catalogTool || catalogTool.error || !Array.isArray(catalogTool.result)) throw integrationFailure();
      const courses = catalogTool.result
        .filter(isRecord)
        .slice(0, 3)
        .flatMap((course) => {
          if (
            typeof course.title !== "string" ||
            typeof course.priceAmount !== "number" ||
            typeof course.priceCurrency !== "string"
          )
            return [];
          return [
            `${course.title} — ${course.priceAmount === 0 ? "miễn phí" : `${String(course.priceAmount)} ${course.priceCurrency}`}`,
          ];
        });
      if (!courses.length) throw integrationFailure();
      sections.push(`Kết quả thực tế từ danh mục khóa học: ${courses.join("; ")}`);
    } else {
      throw integrationFailure();
    }

    if (!sections.length) throw integrationFailure();
    return {
      content: `[Kiểm thử tích hợp — phản hồi xác định, không phải mô hình production]\n${sections.join("\n")}`,
    };
  }
}

export class HttpAssistantLlmProvider implements AssistantLlmProvider {
  public constructor(
    private readonly options: {
      readonly endpoint: string;
      readonly apiKey: string;
      readonly model: string;
      readonly timeoutMs?: number;
      readonly tokenUsageRepository?: Pick<AssistantRepository, "saveTokenUsage">;
      readonly onTokenUsageError?: (error: unknown) => void;
    },
  ) {}

  private saveUsage(
    request: LlmCompletionRequest,
    provider: string,
    usage: LlmCompletionResponse["usage"],
  ): void {
    const repository = this.options.tokenUsageRepository;
    const context = request.usageContext;
    if (!repository || !context || !usage) return;
    const input = {
      usageId: randomUUID(),
      userId: context.userId,
      sessionId: context.sessionId,
      provider,
      promptTokens: usage.inputTokens,
      completionTokens: usage.outputTokens,
      timestamp: new Date(),
    };
    // Persist after provider usage is known, without adding Cassandra latency to the answer.
    void Promise.resolve()
      .then(() => repository.saveTokenUsage(input))
      .catch((error: unknown) => {
        try {
          this.options.onTokenUsageError?.(error);
        } catch {
          // The observer must never turn a failed accounting write into an unhandled rejection.
        }
      });
  }

  public async generate(request: LlmCompletionRequest): Promise<LlmCompletionResponse> {
    if (!this.options.apiKey.trim() || ["<INJECTED>", "synthetic-api-key"].includes(this.options.apiKey))
      throw new AppError(
        "AI_PROVIDER_CONFIGURATION_ERROR",
        503,
        "The assistant provider is not configured",
        false,
      );
    const isGoogle =
      new URL(this.options.endpoint).hostname === "generativelanguage.googleapis.com" &&
      this.options.endpoint.endsWith(":generateContent");

    if (isGoogle) {
      const isGemini3 = /^gemini-3(?:[.-]|$)/u.test(this.options.model);
      // Gemini native format
      const contents = request.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        }));

      const res = await requestProvider(this.options.endpoint, {
        method: "POST",
        headers: {
          "x-goog-api-key": this.options.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              { text: request.systemPrompt },
              ...request.messages.filter((m) => m.role === "system").map((m) => ({ text: m.content })),
            ],
          },
          contents,
          generationConfig: {
            ...(isGemini3
              ? { thinkingConfig: { thinkingLevel: "low" } }
              : { temperature: request.temperature ?? 0.3 }),
            maxOutputTokens: request.maxTokens ?? 2048,
          },
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 15000),
      });

      const json = await readProviderJson<{
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      }>(res);

      const usage = validUsage(
        json.usageMetadata?.promptTokenCount,
        json.usageMetadata?.candidatesTokenCount,
      );
      const text =
        json.candidates?.[0]?.content?.parts
          ?.map((part) => (typeof part.text === "string" ? part.text : ""))
          .join("") ?? "";
      if (!text.trim()) throw invalidProviderResponse();
      this.saveUsage(request, "gemini", usage);
      return {
        content: text,
        ...(usage ? { usage } : {}),
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

    const res = await requestProvider(this.options.endpoint, {
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

    const json = await readProviderJson<{
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    }>(res);

    const usage = validUsage(json.usage?.prompt_tokens, json.usage?.completion_tokens);
    const text = json.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw invalidProviderResponse();
    this.saveUsage(request, "openai-compatible", usage);
    return {
      content: text,
      ...(usage ? { usage } : {}),
    };
  }
}

function validUsage(inputTokens: unknown, outputTokens: unknown): LlmCompletionResponse["usage"] {
  if (
    typeof inputTokens !== "number" ||
    typeof outputTokens !== "number" ||
    !Number.isSafeInteger(inputTokens) ||
    !Number.isSafeInteger(outputTokens) ||
    inputTokens < 0 ||
    outputTokens < 0
  )
    return undefined;
  return { inputTokens, outputTokens };
}
