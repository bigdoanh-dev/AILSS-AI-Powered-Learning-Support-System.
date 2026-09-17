import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  cognitiveDistributionSchema,
  hasValidDistribution,
} from "../../../../packages/contracts/src/cognitive-levels.js";
import { objectiveQuizSchema, type ObjectiveQuiz } from "../../../../packages/contracts/src/objective-v1.js";

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
    cognitiveDistribution: cognitiveDistributionSchema.optional(),
  })
  .strict()
  .refine(hasValidDistribution, {
    message: "Cognitive distribution must sum to questionCount",
    path: ["cognitiveDistribution"],
  });
export type CreateQuizJob = z.infer<typeof createQuizJobSchema>;
export const states = [
  "QUEUED",
  "PROCESSING",
  "VALIDATING",
  "AI_DRAFT",
  "FAILED",
  "APPROVED",
  "CANCELLED",
] as const;
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
export const approvalSchema = z.object({ reviewedDraft: objectiveQuizSchema }).strict();
export type ApprovalRequest = { reviewedDraft: ObjectiveQuiz };
export interface ApprovalResponse {
  jobId: string;
  draftId: string;
  state: "APPROVED";
  approvedDraftVersion: 2;
  assessment: { quizId: string; quizVersion: 1; status: "DRAFT" };
}

export const ASSESSMENT_AI_IMPORT_NAMESPACE = "d2c62169-6dd9-5a04-b04d-39f739f7c51a";
export function uuidV5(namespace: string, name: string): string {
  const namespaceBytes = Buffer.from(namespace.replaceAll("-", ""), "hex");
  if (namespaceBytes.length !== 16) throw new Error("INVALID_UUID_NAMESPACE");
  const bytes = createHash("sha1").update(namespaceBytes).update(name).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
