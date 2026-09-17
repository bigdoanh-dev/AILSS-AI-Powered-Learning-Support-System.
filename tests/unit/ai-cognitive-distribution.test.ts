import { afterEach, expect, it, vi } from "vitest";
import { createQuizJobSchema, approvalSchema } from "../../apps/ai-service/src/quiz/model.js";
import { validateObjectiveQuiz } from "../../packages/contracts/src/objective-v1.js";
import { DeterministicQuizProvider, HttpQuizProvider } from "../../apps/ai-worker/src/provider.js";
const cognitiveDistribution = { RECOGNITION: 1, UNDERSTANDING: 1, APPLICATION: 1, ADVANCED_APPLICATION: 1 };
const request = {
  idempotencyKey: "levels-test",
  sourceText: "Python lists are mutable.",
  questionCount: 4,
  questionTypes: ["TRUE_FALSE"],
  difficulty: "MEDIUM",
  cognitiveDistribution,
};
const body = {
  documentId: "11111111-1111-4111-8111-111111111111",
  targetType: "COURSE",
  targetId: "11111111-1111-4111-8111-111111111111",
  questionCount: 4,
  questionTypes: ["TRUE_FALSE"],
  difficulty: "MEDIUM",
  cognitiveDistribution,
};
afterEach(() => vi.unstubAllGlobals());
it("accepts a distribution and retains backward compatibility", () => {
  expect(createQuizJobSchema.parse(body).cognitiveDistribution).toEqual(cognitiveDistribution);
  expect(createQuizJobSchema.safeParse({ ...body, cognitiveDistribution: undefined }).success).toBe(true);
});
it.each([-1, 0.5, 2, 51])("rejects invalid counts or mismatched total: %s", (n) => {
  expect(
    createQuizJobSchema.safeParse({
      ...body,
      cognitiveDistribution: { ...cognitiveDistribution, RECOGNITION: n },
    }).success,
  ).toBe(false);
});
it("requires every generated question to satisfy the exact requested distribution and retains levels for approval", async () => {
  const { quiz } = await new DeterministicQuizProvider().generate(request);
  const expected = { count: 4, types: request.questionTypes, cognitiveDistribution };
  const parsed = validateObjectiveQuiz(quiz, expected);
  expect(approvalSchema.parse({ reviewedDraft: parsed }).reviewedDraft).toEqual(parsed);
  expect(() =>
    validateObjectiveQuiz(
      { ...parsed, questions: parsed.questions.map((q) => ({ ...q, cognitiveLevel: "RECOGNITION" })) },
      expected,
    ),
  ).toThrow("COGNITIVE_DISTRIBUTION_MISMATCH");
  expect(() =>
    validateObjectiveQuiz(
      { ...parsed, questions: parsed.questions.map(({ cognitiveLevel: _, ...q }) => q) },
      expected,
    ),
  ).toThrow("COGNITIVE_DISTRIBUTION_MISMATCH");
});
it("sends pedagogical definitions and exact counts to the real provider", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ choices: [{ message: { content: "{}" } }] }));
  vi.stubGlobal("fetch", fetchMock);
  await new HttpQuizProvider({
    endpoint: "https://provider.invalid/chat",
    model: "test",
    apiKey: "test",
    timeoutMs: 1000,
  }).generate(request);
  const call = fetchMock.mock.calls[0] as [string, { body: string }] | undefined;
  if (!call) throw new Error("Provider was not called");
  const payload = JSON.parse(call[1].body) as { messages: [{ content: string }, { content: string }] };
  expect(JSON.parse(payload.messages[1].content).cognitiveDistribution).toEqual(cognitiveDistribution);
  expect(payload.messages[0].content).toContain("ADVANCED_APPLICATION: analyze a multi-step scenario");
});
