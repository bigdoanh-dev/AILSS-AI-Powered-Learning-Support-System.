import { createHmac } from "node:crypto";
import { z } from "zod";

export const completionSchema = z.object({ completed: z.boolean() }).strict();
export type CompletionRequest = z.infer<typeof completionSchema>;

export interface Progress {
  studentId: string;
  courseId: string;
  progressVersion: number;
  courseContentVersion: number;
  completedCount: number;
  publishedTotal: number;
  percent: number;
  completedAt?: Date;
  updatedAt: Date;
  lastOperationId?: string;
  lastEventId?: string;
}

export interface ProgressReceipt {
  fingerprint: string;
  operationId: string;
  eventId: string;
  occurredAt: string;
  response?: ReturnType<typeof progressDto>;
  noOp?: boolean;
}

export const progressDto = (p: Progress) => ({
  courseId: p.courseId,
  progressVersion: p.progressVersion,
  courseContentVersion: p.courseContentVersion,
  completedCount: p.completedCount,
  publishedTotal: p.publishedTotal,
  percent: p.percent,
  completed: p.publishedTotal > 0 && p.completedCount === p.publishedTotal,
  ...(p.completedAt ? { completedAt: p.completedAt.toISOString() } : {}),
  updatedAt: p.updatedAt.toISOString(),
});

export const progressFingerprint = (secret: string, value: object) =>
  createHmac("sha256", secret).update(JSON.stringify(value)).digest("hex");
