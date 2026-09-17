import { z } from "zod";
import { cognitiveLevelSchema, cognitiveLevels, type CognitiveDistribution } from "./cognitive-levels.js";

const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/u);
const text = (max: number) => z.string().trim().min(1).max(max);
const points = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/u)
  .refine((value) => Number(value) > 0);
const option = z.object({ id, text: text(1_000) }).strict();
const base = {
  cognitiveLevel: cognitiveLevelSchema.optional(),
  id,
  order: z.number().int().min(1).max(50),
  text: text(4_000),
  points,
};
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
    correctAnswer: z.object({ acceptedAnswer: text(1_000) }).strict(),
  })
  .strict();

export const objectiveQuizSchema = z
  .object({
    schemaVersion: z.literal("objective-v1"),
    title: text(300),
    questions: z
      .array(z.discriminatedUnion("type", [single, multiple, truth, short]))
      .min(1)
      .max(50),
  })
  .strict()
  .superRefine((quiz, context) => {
    const ids = new Set<string>(),
      orders = new Set<number>();
    quiz.questions.forEach((question, index) => {
      if (ids.has(question.id))
        context.addIssue({
          code: "custom",
          path: ["questions", index, "id"],
          message: "duplicate question id",
        });
      ids.add(question.id);
      if (orders.has(question.order))
        context.addIssue({ code: "custom", path: ["questions", index, "order"], message: "duplicate order" });
      orders.add(question.order);
      if ("options" in question) {
        const optionIds = new Set(question.options.map((candidate) => candidate.id));
        if (optionIds.size !== question.options.length)
          context.addIssue({
            code: "custom",
            path: ["questions", index, "options"],
            message: "duplicate option id",
          });
        const answers =
          question.type === "SINGLE_CHOICE"
            ? [question.correctAnswer.optionId]
            : question.correctAnswer.optionIds;
        if (new Set(answers).size !== answers.length || answers.some((answer) => !optionIds.has(answer)))
          context.addIssue({
            code: "custom",
            path: ["questions", index, "correctAnswer"],
            message: "invalid exact option answer",
          });
      }
    });
    if ([...orders].some((value) => value < 1 || value > quiz.questions.length))
      context.addIssue({ code: "custom", path: ["questions"], message: "orders must be contiguous" });
  });

export type ObjectiveQuiz = z.infer<typeof objectiveQuizSchema>;

export function validateObjectiveQuiz(
  value: unknown,
  expected?: {
    count: number;
    types: readonly string[];
    cognitiveDistribution?: CognitiveDistribution | undefined;
  },
): ObjectiveQuiz {
  const quiz = objectiveQuizSchema.parse(value);
  if (expected && quiz.questions.length !== expected.count) throw new Error("QUESTION_COUNT_MISMATCH");
  if (expected && quiz.questions.some((question) => !expected.types.includes(question.type)))
    throw new Error("QUESTION_TYPE_MISMATCH");
  if (expected?.cognitiveDistribution) {
    for (const level of cognitiveLevels) {
      if (
        quiz.questions.filter((q) => q.cognitiveLevel === level).length !==
        expected.cognitiveDistribution[level]
      )
        throw new Error("COGNITIVE_DISTRIBUTION_MISMATCH");
    }
  }
  return quiz;
}
