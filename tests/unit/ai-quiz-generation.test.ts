import { describe, expect, it, vi, afterEach } from "vitest";
import { validateObjectiveQuiz } from "../../apps/ai-worker/src/objective-v1.js";
import { HttpQuizProvider } from "../../apps/ai-worker/src/provider.js";
import { decodeCursor, encodeCursor } from "../../apps/ai-service/src/quiz/model.js";
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
  it("maps Gemini native text and usage while excluding thought parts", async () => {
    const mock = vi
      .fn()
      .mockResolvedValue(
        Response.json({
          candidates: [
            {
              content: {
                parts: [{ thought: true, text: "private reasoning" }, { text: JSON.stringify(valid) }],
              },
            },
          ],
          usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 12 },
        }),
      );
    vi.stubGlobal("fetch", mock);
    const provider = new HttpQuizProvider({
      endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
      apiKey: "secret",
      model: "gemini-flash-latest",
      timeoutMs: 1000,
    });
    const result = await provider.generate({
      idempotencyKey: "native-test",
      sourceText: "lesson",
      questionCount: 1,
      questionTypes: ["SINGLE_CHOICE"],
      difficulty: "EASY",
    });
    expect(result).toMatchObject({ quiz: valid, inputUnits: 8, outputUnits: 12 });
    expect(mock.mock.calls[0]?.[1]?.headers).toMatchObject({ "x-goog-api-key": "secret" });
    expect(mock.mock.calls[0]?.[0]).not.toContain("secret");
    const body = JSON.parse(String(mock.mock.calls[0]?.[1]?.body));
    expect(body.generationConfig).toMatchObject({
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0 },
      temperature: 0.2,
      maxOutputTokens: 8192,
    });
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

describe("P10.2 opaque cursor", () => {
  it("rejects noncanonical base64url aliases even when they decode to identical bytes", () => {
    const cursor = encodeCursor("cursor-secret", { pageState: "xx" });
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const last = alphabet.indexOf(cursor.slice(-1));
    const alias = `${cursor.slice(0, -1)}${alphabet.charAt(last + 1)}`;
    expect(Buffer.from(alias, "base64url")).toEqual(Buffer.from(cursor, "base64url"));
    expect(() => decodeCursor("cursor-secret", alias)).toThrow("INVALID_CURSOR");
  });
  it("round-trips without exposing Cassandra paging state", () => {
    const value = { owner: "lecturer", pageState: "raw-secret-cassandra-state", exp: 42 },
      cursor = encodeCursor("cursor-secret", value);
    expect(cursor).not.toContain("raw-secret-cassandra-state");
    expect(Buffer.from(cursor, "base64url").toString("utf8")).not.toContain("raw-secret-cassandra-state");
    expect(decodeCursor("cursor-secret", cursor)).toEqual(value);
  });
  it("rejects tampering and a wrong key", () => {
    const cursor = encodeCursor("cursor-secret", { pageState: "state" }),
      tampered = `${cursor.slice(0, -1)}${cursor.endsWith("A") ? "B" : "A"}`;
    expect(() => decodeCursor("cursor-secret", tampered)).toThrow("INVALID_CURSOR");
    expect(() => decodeCursor("other-secret", cursor)).toThrow("INVALID_CURSOR");
  });
});
