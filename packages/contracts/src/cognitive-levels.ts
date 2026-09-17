import { z } from "zod";

export const cognitiveLevels = [
  "RECOGNITION",
  "UNDERSTANDING",
  "APPLICATION",
  "ADVANCED_APPLICATION",
] as const;
export const cognitiveLevelSchema = z.enum(cognitiveLevels);
export const cognitiveDistributionSchema = z
  .object({
    RECOGNITION: z.number().int().min(0).max(50),
    UNDERSTANDING: z.number().int().min(0).max(50),
    APPLICATION: z.number().int().min(0).max(50),
    ADVANCED_APPLICATION: z.number().int().min(0).max(50),
  })
  .strict();
export type CognitiveDistribution = z.infer<typeof cognitiveDistributionSchema>;
export const hasValidDistribution = (value: {
  questionCount: number;
  cognitiveDistribution?: CognitiveDistribution | undefined;
}) =>
  !value.cognitiveDistribution ||
  Object.values(value.cognitiveDistribution).reduce((sum, count) => sum + count, 0) === value.questionCount;
