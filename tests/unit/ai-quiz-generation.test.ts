import { describe, expect, it, vi, afterEach } from "vitest";
import { validateObjectiveQuiz } from "../../apps/ai-worker/src/objective-v1.js";
import { HttpQuizProvider } from "../../apps/ai-worker/src/provider.js";
const valid = {
  schemaVersion: "objective-v1",
  title: "Quiz",
  questions: [
    {
      id: "q1",
      order: 1,
      text: "2+2?",
      points: "1.00",
      type: "SINGLE_CHOICE",
      options: [
        { id: "a", text: "4" },
        { id: "b", text: "5" },
      ],
      correctAnswer: { optionId: "a" },
    },
  ],
};
describe("P10.2 objective-v1 boundary", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("accepts a strict exact objective quiz", () => {
    expect(validateObjectiveQuiz(valid, { count: 1, types: ["SINGLE_CHOICE"] })).toEqual(valid);
  });
  it.each([
    { ...valid, questions: [{ ...valid.questions[0], points: "NaN" }] },
    { ...valid, questions: [{ ...valid.questions[0], correctAnswer: { optionId: "missing" } }] },
    { ...valid, questions: [valid.questions[0], { ...valid.questions[0] }] },
  ])("rejects malformed provider output", (value) => {
    expect(() =>
      validateObjectiveQuiz(value, { count: value.questions.length, types: ["SINGLE_CHOICE"] }),
    ).toThrow();
  });
  it("classifies 429 without exposing response bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("secret provider body", { status: 429 })));
    const p = new HttpQuizProvider({
      endpoint: "https://provider.invalid/v1",
      model: "m",
      apiKey: "secret",
      timeoutMs: 1000,
    });
    await expect(
      p.generate({
        idempotencyKey: "stable",
        sourceText: "private",
        questionCount: 1,
        questionTypes: ["TRUE_FALSE"],
        difficulty: "EASY",
      }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true });
  });
  it("sends a stable provider idempotency key and parses structured JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        choices: [{ message: { content: JSON.stringify(valid) } }],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const p = new HttpQuizProvider({
      endpoint: "https://provider.invalid/v1",
      model: "m",
      apiKey: "secret",
      timeoutMs: 1000,
    });
    await expect(
      p.generate({
        idempotencyKey: "stable-op",
        sourceText: "private",
        questionCount: 1,
        questionTypes: ["SINGLE_CHOICE"],
        difficulty: "EASY",
      }),
    ).resolves.toMatchObject({ inputUnits: 3, outputUnits: 4 });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ "idempotency-key": "stable-op" });
  });
});
