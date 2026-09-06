/* eslint-disable @typescript-eslint/no-non-null-assertion, @typescript-eslint/restrict-template-expressions */
import { z } from "zod";
export interface ProviderRequest {
  idempotencyKey: string;
  sourceText: string;
  questionCount: number;
  questionTypes: readonly string[];
  difficulty: string;
}
export interface ProviderResult {
  quiz: unknown;
  inputUnits: number;
  outputUnits: number;
  provider: string;
  model: string;
}
export interface QuizProvider {
  generate(request: ProviderRequest): Promise<ProviderResult>;
}
export class ProviderFailure extends Error {
  constructor(
    public readonly code: "RATE_LIMITED" | "PROVIDER_UNAVAILABLE" | "AMBIGUOUS_TIMEOUT" | "INVALID_RESPONSE",
    public readonly retryable: boolean,
  ) {
    super(code);
  }
}
const response = z
  .object({
    choices: z
      .array(z.object({ message: z.object({ content: z.string() }).passthrough() }).passthrough())
      .min(1),
    usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative().default(0),
        completion_tokens: z.number().int().nonnegative().default(0),
      })
      .default({ prompt_tokens: 0, completion_tokens: 0 }),
  })
  .passthrough();
export class HttpQuizProvider implements QuizProvider {
  constructor(
    private readonly options: { endpoint: string; model: string; apiKey: string; timeoutMs: number },
  ) {}
  async generate(request: ProviderRequest): Promise<ProviderResult> {
    let result: Response;
    try {
      result = await fetch(this.options.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": request.idempotencyKey,
        },
        body: JSON.stringify({
          model: this.options.model,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: "Return only a strict objective-v1 quiz JSON object. Never include commentary.",
            },
            {
              role: "user",
              content: JSON.stringify({
                source: request.sourceText,
                questionCount: request.questionCount,
                questionTypes: request.questionTypes,
                difficulty: request.difficulty,
              }),
            },
          ],
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (e) {
      if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError"))
        throw new ProviderFailure("AMBIGUOUS_TIMEOUT", true);
      throw new ProviderFailure("PROVIDER_UNAVAILABLE", true);
    }
    if (result.status === 429) throw new ProviderFailure("RATE_LIMITED", true);
    if (result.status >= 500) throw new ProviderFailure("PROVIDER_UNAVAILABLE", true);
    if (!result.ok) throw new ProviderFailure("INVALID_RESPONSE", false);
    try {
      const parsed = response.parse(await result.json()),
        content = parsed.choices[0]!.message.content;
      return {
        quiz: JSON.parse(content),
        inputUnits: parsed.usage.prompt_tokens,
        outputUnits: parsed.usage.completion_tokens,
        provider: new URL(this.options.endpoint).hostname,
        model: this.options.model,
      };
    } catch {
      throw new ProviderFailure("INVALID_RESPONSE", false);
    }
  }
}
export class DeterministicQuizProvider implements QuizProvider {
  async generate(r: ProviderRequest): Promise<ProviderResult> {
    const pause = /\[TEST_PAUSE_PROVIDER_MS=(\d{1,5})\]/u.exec(r.sourceText)?.[1];
    if (pause) await new Promise((resolve) => setTimeout(resolve, Math.min(Number(pause), 10_000)));
    if (r.sourceText.includes("[TEST_INVALID_PROVIDER]"))
      return {
        quiz: { schemaVersion: "objective-v1", title: "Invalid test fixture", questions: [] },
        inputUnits: r.sourceText.length,
        outputUnits: 0,
        provider: "deterministic-test",
        model: "objective-v1-invalid-fixture",
      };
    const questions = Array.from({ length: r.questionCount }, (_, i) => {
      const type = r.questionTypes[i % r.questionTypes.length]!;
      const base = { id: `q${i + 1}`, order: i + 1, text: `Deterministic question ${i + 1}`, points: "1.00" };
      if (type === "TRUE_FALSE") return { ...base, type, correctAnswer: { value: true } };
      if (type === "SHORT_ANSWER") return { ...base, type, correctAnswer: { acceptedAnswer: "answer" } };
      const options = [
        { id: "a", text: "Answer A" },
        { id: "b", text: "Answer B" },
      ];
      return type === "SINGLE_CHOICE"
        ? { ...base, type, options, correctAnswer: { optionId: "a" } }
        : { ...base, type, options, correctAnswer: { optionIds: ["a"] } };
    });
    return {
      quiz: { schemaVersion: "objective-v1", title: "Deterministic acceptance quiz", questions },
      inputUnits: r.sourceText.length,
      outputUnits: questions.length,
      provider: "deterministic-test",
      model: "objective-v1-fake",
    };
  }
}
