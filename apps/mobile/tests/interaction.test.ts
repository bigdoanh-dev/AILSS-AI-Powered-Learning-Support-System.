import { describe, it, expect } from "vitest";
import {
  review,
  reviews,
  reviewList,
  comment,
  commentList,
  buildIfMatch,
  parseETagVersion,
  validateReviewInput,
  validateCommentInput,
  isAuthor,
} from "../src/interaction";
import { ApiError } from "../src/api";

describe("interaction domain", () => {
  const sampleReview = {
    reviewId: "rev-101",
    courseId: "course-202",
    authorId: "user-303",
    rating: 5,
    body: "Khóa học rất hay và bổ ích!",
    state: "ACTIVE",
    version: 1,
    createdAt: "2026-09-15T07:00:00.000Z",
    updatedAt: "2026-09-15T07:00:00.000Z",
  };

  const sampleComment = {
    commentId: "cmt-101",
    resourceType: "COURSE",
    resourceId: "course-202",
    parentId: null,
    authorId: "user-303",
    body: "Em có câu hỏi về bài 1 ạ.",
    state: "ACTIVE",
    version: 1,
    createdAt: "2026-09-15T07:10:00.000Z",
    updatedAt: "2026-09-15T07:10:00.000Z",
  };

  describe("review decoder", () => {
    it("decodes a valid review object", () => {
      const parsed = review(sampleReview);
      expect(parsed.reviewId).toBe("rev-101");
      expect(parsed.rating).toBe(5);
      expect(parsed.body).toBe("Khóa học rất hay và bổ ích!");
      expect(parsed.version).toBe(1);
    });

    it("accepts null review body", () => {
      const parsed = review({ ...sampleReview, body: null });
      expect(parsed.body).toBeNull();
    });

    it("throws ApiError on rating < 1 or > 5", () => {
      expect(() => review({ ...sampleReview, rating: 0 })).toThrow(ApiError);
      expect(() => review({ ...sampleReview, rating: 6 })).toThrow(ApiError);
    });

    it("throws on missing required fields", () => {
      expect(() => review({ reviewId: "123" })).toThrow(ApiError);
      expect(() => review(null)).toThrow(ApiError);
    });
  });

  describe("reviews and reviewList decoders", () => {
    it("decodes reviews array from direct array, items or data wrapper", () => {
      expect(reviews([sampleReview])).toHaveLength(1);
      expect(reviews({ items: [sampleReview] })).toHaveLength(1);
      expect(reviews({ data: [sampleReview] })).toHaveLength(1);
    });

    it("decodes reviewList with ratingSummary and nextCursor", () => {
      const res = reviewList({
        data: [sampleReview],
        ratingSummary: {
          reviewCount: 10,
          ratingSum: 48,
          average: 4.8,
        },
        meta: {
          page: {
            nextCursor: "cursor-abc-123",
          },
        },
      });

      expect(res.items).toHaveLength(1);
      expect(res.ratingSummary.reviewCount).toBe(10);
      expect(res.ratingSummary.average).toBe(4.8);
      expect(res.nextCursor).toBe("cursor-abc-123");
    });
  });

  describe("comment and comments decoders", () => {
    it("decodes a valid comment", () => {
      const parsed = comment(sampleComment);
      expect(parsed.commentId).toBe("cmt-101");
      expect(parsed.parentId).toBeNull();
      expect(parsed.version).toBe(1);
    });

    it("decodes comment with parentId", () => {
      const parsed = comment({ ...sampleComment, parentId: "cmt-root" });
      expect(parsed.parentId).toBe("cmt-root");
    });

    it("decodes comment list with cursor", () => {
      const res = commentList({
        data: [sampleComment],
        meta: {
          nextCursor: "cmt-cursor-999",
        },
      });
      expect(res.items).toHaveLength(1);
      expect(res.nextCursor).toBe("cmt-cursor-999");
    });
  });

  describe("If-Match and ETag helpers", () => {
    it("builds exact If-Match header string", () => {
      expect(buildIfMatch(1)).toBe('"v1"');
      expect(buildIfMatch(5)).toBe('"v5"');
    });

    it("throws on invalid version for If-Match", () => {
      expect(() => buildIfMatch(0)).toThrow();
      expect(() => buildIfMatch(-1)).toThrow();
      expect(() => buildIfMatch(1.5)).toThrow();
    });

    it("parses ETag version safely", () => {
      expect(parseETagVersion('"v1"')).toBe(1);
      expect(parseETagVersion('"v42"')).toBe(42);
      expect(parseETagVersion("v3")).toBe(3);
      expect(parseETagVersion("invalid")).toBeNull();
      expect(parseETagVersion(null)).toBeNull();
    });
  });

  describe("validation helpers", () => {
    it("validates review input", () => {
      expect(validateReviewInput(5, "Tốt")).toEqual({ valid: true });
      expect(validateReviewInput(0, "Tốt").valid).toBe(false);
      expect(validateReviewInput(5, "").valid).toBe(false);
      expect(validateReviewInput(5, "   ").valid).toBe(false);
      expect(validateReviewInput(5, "a".repeat(4001)).valid).toBe(false);
    });

    it("validates comment input", () => {
      expect(validateCommentInput("Thắc mắc bài giảng")).toEqual({ valid: true });
      expect(validateCommentInput("").valid).toBe(false);
      expect(validateCommentInput("   ").valid).toBe(false);
      expect(validateCommentInput("a".repeat(4001)).valid).toBe(false);
    });

    it("checks author ownership accurately", () => {
      expect(isAuthor({ authorId: "user-123" }, "user-123")).toBe(true);
      expect(isAuthor({ authorId: "user-123" }, "user-456")).toBe(false);
      expect(isAuthor({ authorId: "user-123" }, undefined)).toBe(false);
    });
  });
});
