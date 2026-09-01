import { z } from "zod";

const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/u);
const text = z.string().trim().min(1).max(4_000);
const points = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/u)
  .refine((v) => Number(v) > 0);
const option = z.object({ id, text: z.string().trim().min(1).max(1_000) }).strict();
const base = { id, order: z.number().int().min(1).max(50), text, points };
const single = z
  .object({
    ...base,
    type: z.literal("SINGLE_CHOICE"),
    options: z.array(option).min(2).max(10),
    correctAnswer: z.object({ optionId: id }).strict(),
  })
  .strict();
const multiple = z
  .object({
    ...base,
    type: z.literal("MULTIPLE_CHOICE"),
    options: z.array(option).min(2).max(10),
    correctAnswer: z.object({ optionIds: z.array(id).min(1).max(10) }).strict(),
  })
  .strict();
const truth = z
  .object({
    ...base,
    type: z.literal("TRUE_FALSE"),
    correctAnswer: z.object({ value: z.boolean() }).strict(),
  })
  .strict();
const short = z
  .object({
    ...base,
    type: z.literal("SHORT_ANSWER"),
    correctAnswer: z.object({ acceptedAnswer: z.string().trim().min(1).max(1_000) }).strict(),
  })
  .strict();
const question = z.discriminatedUnion("type", [single, multiple, truth, short]);
export const objectiveQuizSchema = z
  .object({
    schemaVersion: z.literal("objective-v1"),
    title: z.string().trim().min(1).max(300),
    questions: z.array(question).min(1).max(50),
  })
  .strict()
  .superRefine((quiz, ctx) => {
    const ids = new Set<string>(),
      orders = new Set<number>();
    quiz.questions.forEach((q, i) => {
      if (ids.has(q.id))
        ctx.addIssue({ code: "custom", path: ["questions", i, "id"], message: "duplicate question id" });
      ids.add(q.id);
      if (orders.has(q.order))
        ctx.addIssue({ code: "custom", path: ["questions", i, "order"], message: "duplicate order" });
      orders.add(q.order);
      if ("options" in q) {
        const optionIds = new Set(q.options.map((o) => o.id));
        if (optionIds.size !== q.options.length)
          ctx.addIssue({ code: "custom", path: ["questions", i, "options"], message: "duplicate option id" });
        const answers = q.type === "SINGLE_CHOICE" ? [q.correctAnswer.optionId] : q.correctAnswer.optionIds;
        if (new Set(answers).size !== answers.length || answers.some((a) => !optionIds.has(a)))
          ctx.addIssue({
            code: "custom",
            path: ["questions", i, "correctAnswer"],
            message: "invalid exact option answer",
          });
      }
    });
    if ([...orders].some((v) => v < 1 || v > quiz.questions.length))
      ctx.addIssue({ code: "custom", path: ["questions"], message: "orders must be contiguous" });
  });
export type ObjectiveQuiz = z.infer<typeof objectiveQuizSchema>;
export function validateObjectiveQuiz(value: unknown, expected: { count: number; types: readonly string[] }) {
  const quiz = objectiveQuizSchema.parse(value);
  if (quiz.questions.length !== expected.count) throw new Error("QUESTION_COUNT_MISMATCH");
  if (quiz.questions.some((q) => !expected.types.includes(q.type))) throw new Error("QUESTION_TYPE_MISMATCH");
  return quiz;
}
