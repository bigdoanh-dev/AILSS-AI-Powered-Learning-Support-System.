import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const questionType = z.enum(["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"]);
export const createQuizJobSchema = z
  .object({
    documentId: z.string().uuid(),
    targetType: z.enum(["COURSE", "CLASS"]),
    targetId: z.string().uuid(),
    questionCount: z.number().int().min(1).max(50),
    questionTypes: z
      .array(questionType)
      .min(1)
      .max(4)
      .refine((v) => new Set(v).size === v.length),
    difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
  })
  .strict();
export type CreateQuizJob = z.infer<typeof createQuizJobSchema>;
export const states = ["QUEUED", "PROCESSING", "VALIDATING", "AI_DRAFT", "FAILED", "CANCELLED"] as const;
export type QuizJobState = (typeof states)[number];
export const listSchema = z
  .object({
    state: z.enum(states),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().max(2048).optional(),
  })
  .strict();
export interface QuizJob {
  jobId: string;
  lecturerId: string;
  documentId: string;
  targetType: "COURSE" | "CLASS";
  targetId: string;
  state: QuizJobState;
  operationId: string;
  version: number;
  constraints: CreateQuizJob;
  generationEventId: string;
  draftId?: string;
  failureCode?: string;
  createdAt: Date;
  updatedAt: Date;
}
export const sha256 = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
export const generationIds = () => ({
  jobId: randomUUID(),
  operationId: randomUUID(),
  eventId: randomUUID(),
});
export const jobDto = (j: QuizJob) => ({
  jobId: j.jobId,
  jobKind: "QUIZ_GENERATION",
  targetType: j.targetType,
  targetId: j.targetId,
  documentId: j.documentId,
  state: j.state,
  version: j.version,
  ...(j.draftId ? { draftId: j.draftId } : {}),
  ...(j.failureCode ? { failureCode: j.failureCode } : {}),
  createdAt: j.createdAt.toISOString(),
  updatedAt: j.updatedAt.toISOString(),
});
export function encodeCursor(secret: string, value: object) {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url"),
    sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}
export function decodeCursor(secret: string, value: string) {
  const [body, sig, ...rest] = value.split(".");
  if (!body || !sig || rest.length) throw new Error("INVALID_CURSOR");
  const expected = createHmac("sha256", secret).update(body).digest(),
    actual = Buffer.from(sig, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error("INVALID_CURSOR");
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as unknown;
}
