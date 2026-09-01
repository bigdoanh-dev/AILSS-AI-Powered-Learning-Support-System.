import { describe, expect, it } from "vitest";
import {
  createReviewSchema,
  patchReviewSchema,
  reviewBody,
  reviewDto,
} from "../../apps/interaction-service/src/reviews/model.js";

describe("Phase 9.2 review primitives", () => {
  it("enforces strict rating and patch DTOs", () => {
    expect(createReviewSchema.parse({ rating: 5, body: "good" }).rating).toBe(5);
    expect(() => createReviewSchema.parse({ rating: 0, body: "bad" })).toThrow();
    expect(() => createReviewSchema.parse({ rating: 5, body: "ok", state: "ACTIVE" })).toThrow();
    expect(() => patchReviewSchema.parse({})).toThrow();
  });
  it("reuses canonical text normalization and rejects controls", () => {
    expect(reviewBody("Cafe\u0301\r\nline")).toBe("Café\nline");
    expect(() => reviewBody("bad\0body")).toThrow("INVALID_COMMENT_BODY");
  });
  it("does not expose recovery metadata and hides deleted text", () => {
    const value = reviewDto({
      reviewId: "r",
      courseId: "c",
      authorId: "a",
      rating: 4,
      body: "private",
      state: "DELETED_BY_AUTHOR",
      version: 2,
      createdAt: new Date(0),
      updatedAt: new Date(1),
      pendingOperationId: "internal",
    });
    expect(value.body).toBeNull();
    expect(value).not.toHaveProperty("pendingOperationId");
  });
});
