import { z } from "zod";
import { body as sanitize } from "../model.js";
export const createReviewSchema = z
  .object({ rating: z.number().int().min(1).max(5), body: z.string() })
  .strict();
export const patchReviewSchema = z
  .object({ rating: z.number().int().min(1).max(5).optional(), body: z.string().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
export const reviewBody = (v: string) => sanitize(v);
export interface Review {
  reviewId: string;
  courseId: string;
  authorId: string;
  rating: number;
  body: string | null;
  state: "ACTIVE" | "DELETED_BY_AUTHOR" | "HIDDEN_BY_MODERATOR";
  version: number;
  createdAt: Date;
  updatedAt: Date;
  pendingOperationId?: string;
  pendingExpectedVersion?: number;
}
export const reviewDto = (r: Review) => ({
  reviewId: r.reviewId,
  courseId: r.courseId,
  authorId: r.authorId,
  rating: r.rating,
  body: r.state === "ACTIVE" ? r.body : null,
  state: r.state,
  version: r.version,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
