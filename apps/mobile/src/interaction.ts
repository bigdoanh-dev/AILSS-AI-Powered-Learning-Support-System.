import { ApiError, record, string } from "./api";

export interface Review {
  reviewId: string;
  courseId: string;
  authorId: string;
  rating: number;
  body: string | null;
  state: "ACTIVE" | "DELETED_BY_AUTHOR" | "HIDDEN_BY_MODERATOR" | string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface RatingSummary {
  reviewCount: number;
  ratingSum: number;
  average: number;
}

export interface ReviewListResponse {
  items: Review[];
  ratingSummary: RatingSummary;
  nextCursor: string | null;
}

export interface Comment {
  commentId: string;
  resourceType: "COURSE" | "CLASS" | string;
  resourceId: string;
  parentId: string | null;
  authorId: string;
  body: string | null;
  state: "ACTIVE" | "DELETED_BY_AUTHOR" | "HIDDEN_BY_MODERATOR" | string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CommentListResponse {
  items: Comment[];
  nextCursor: string | null;
}

function parseNumber(value: unknown): number {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  throw new ApiError("invalid");
}

export function review(value: unknown): Review {
  const data = record(value);
  const rating = parseNumber(data.rating);
  if (rating < 1 || rating > 5) throw new ApiError("invalid");
  const version = parseNumber(data.version);

  return {
    reviewId: string(data.reviewId),
    courseId: string(data.courseId),
    authorId: string(data.authorId),
    rating,
    body: data.body === null || data.body === undefined ? null : string(data.body),
    state: string(data.state),
    version,
    createdAt: string(data.createdAt),
    updatedAt: string(data.updatedAt),
  };
}

export function reviews(value: unknown): Review[] {
  if (Array.isArray(value)) {
    return value.map(review);
  }
  const data = record(value);
  if (Array.isArray(data.items)) {
    return data.items.map(review);
  }
  if (Array.isArray(data.data)) {
    return data.data.map(review);
  }
  throw new ApiError("invalid");
}

export function ratingSummary(value: unknown): RatingSummary {
  const data = record(value);
  const reviewCount = parseNumber(data.reviewCount ?? data.count ?? 0);
  let average = 0;
  if (data.average !== undefined && data.average !== null) {
    average = parseNumber(data.average);
  } else if (data.averageRating !== undefined && data.averageRating !== null) {
    average = parseNumber(data.averageRating);
  }
  const ratingSum = data.ratingSum !== undefined && data.ratingSum !== null ? parseNumber(data.ratingSum) : 0;
  return {
    reviewCount,
    ratingSum,
    average,
  };
}

export function reviewList(value: unknown): ReviewListResponse {
  if (Array.isArray(value)) {
    const items = value.map(review);
    const sum = items.reduce((acc, r) => acc + r.rating, 0);
    const average = items.length > 0 ? Number((sum / items.length).toFixed(1)) : 0;
    return {
      items,
      ratingSummary: {
        reviewCount: items.length,
        ratingSum: sum,
        average,
      },
      nextCursor: null,
    };
  }

  const rec = record(value);
  const rawItems = Array.isArray(rec.data) ? rec.data : Array.isArray(rec.items) ? rec.items : null;
  if (!rawItems) throw new ApiError("invalid");
  const items = rawItems.map(review);

  let rawSummary: RatingSummary;
  if (rec.ratingSummary) {
    rawSummary = ratingSummary(rec.ratingSummary);
  } else {
    const sum = items.reduce((acc, r) => acc + r.rating, 0);
    const average = items.length > 0 ? Number((sum / items.length).toFixed(1)) : 0;
    rawSummary = {
      reviewCount: items.length,
      ratingSum: sum,
      average,
    };
  }

  let nextCursor: string | null = null;
  if (rec.meta && typeof rec.meta === "object") {
    const meta = rec.meta as Record<string, unknown>;
    if (meta.page && typeof meta.page === "object") {
      const page = meta.page as Record<string, unknown>;
      if (typeof page.nextCursor === "string") nextCursor = page.nextCursor;
    } else if (typeof meta.nextCursor === "string") {
      nextCursor = meta.nextCursor;
    }
  }

  return {
    items,
    ratingSummary: rawSummary,
    nextCursor,
  };
}

export function comment(value: unknown): Comment {
  const data = record(value);
  const version = parseNumber(data.version);

  return {
    commentId: string(data.commentId),
    resourceType: string(data.resourceType),
    resourceId: string(data.resourceId),
    parentId: data.parentId === null || data.parentId === undefined ? null : string(data.parentId),
    authorId: string(data.authorId),
    body: data.body === null || data.body === undefined ? null : string(data.body),
    state: string(data.state),
    version,
    createdAt: string(data.createdAt),
    updatedAt: string(data.updatedAt),
  };
}

export function comments(value: unknown): Comment[] {
  if (Array.isArray(value)) {
    return value.map(comment);
  }
  const data = record(value);
  if (Array.isArray(data.items)) {
    return data.items.map(comment);
  }
  if (Array.isArray(data.data)) {
    return data.data.map(comment);
  }
  throw new ApiError("invalid");
}

export function commentList(value: unknown): CommentListResponse {
  if (Array.isArray(value)) {
    return {
      items: value.map(comment),
      nextCursor: null,
    };
  }
  const rec = record(value);
  const rawItems = Array.isArray(rec.data) ? rec.data : Array.isArray(rec.items) ? rec.items : null;
  if (!rawItems) throw new ApiError("invalid");
  const items = rawItems.map(comment);

  let nextCursor: string | null = null;
  if (rec.meta && typeof rec.meta === "object") {
    const meta = rec.meta as Record<string, unknown>;
    if (meta.page && typeof meta.page === "object") {
      const page = meta.page as Record<string, unknown>;
      if (typeof page.nextCursor === "string") nextCursor = page.nextCursor;
    } else if (typeof meta.nextCursor === "string") {
      nextCursor = meta.nextCursor;
    }
  }

  return {
    items,
    nextCursor,
  };
}

export function buildIfMatch(version: number): string {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("Invalid version for If-Match header");
  }
  return `"v${version}"`;
}

export function parseETagVersion(etag?: string | null): number | null {
  if (!etag) return null;
  const match = /^"?v([1-9][0-9]*)"?$/u.exec(etag.trim());
  return match ? Number(match[1]) : null;
}

export function validateReviewInput(rating: number, body: string): { valid: boolean; error?: string } {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { valid: false, error: "Đánh giá sao phải từ 1 đến 5 sao." };
  }
  const trimmed = body.trim();
  if (trimmed.length < 1) {
    return { valid: false, error: "Vui lòng nhập nội dung đánh giá." };
  }
  if (trimmed.length > 4000) {
    return { valid: false, error: "Nội dung đánh giá không vượt quá 4000 ký tự." };
  }
  return { valid: true };
}

export function validateCommentInput(body: string): { valid: boolean; error?: string } {
  const trimmed = body.trim();
  if (trimmed.length < 1) {
    return { valid: false, error: "Vui lòng nhập nội dung bình luận." };
  }
  if (trimmed.length > 4000) {
    return { valid: false, error: "Nội dung bình luận không vượt quá 4000 ký tự." };
  }
  return { valid: true };
}

export function isAuthor(item: { authorId: string }, currentUserId?: string): boolean {
  if (!currentUserId) return false;
  return item.authorId === currentUserId;
}
