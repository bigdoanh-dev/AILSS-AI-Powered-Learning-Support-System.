import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
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
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(secret).digest(), nonce),
    ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]),
    tag = cipher.getAuthTag();
  return Buffer.concat([nonce, tag, ciphertext]).toString("base64url");
}
export function decodeCursor(secret: string, value: string) {
  try {
    if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error();
    const packed = Buffer.from(value, "base64url");
    if (packed.length < 29 || packed.toString("base64url") !== value) throw new Error();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      createHash("sha256").update(secret).digest(),
      packed.subarray(0, 12),
    );
    decipher.setAuthTag(packed.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString("utf8"),
    ) as unknown;
  } catch {
    throw new Error("INVALID_CURSOR");
  }
}
