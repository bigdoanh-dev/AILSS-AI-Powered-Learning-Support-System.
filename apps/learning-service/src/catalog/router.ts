import { Router } from "express";
import { z, ZodError } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import { normalizeSearchToken, parseCatalogQuery, parseSearchQueryInput } from "./model.js";
import type { LearningCatalogService } from "./service.js";

const uuidSchema = z.string().uuid();

export function learningCatalogRouter(
  service: LearningCatalogService,
  metrics: ReturnType<typeof createMetrics>,
): Router {
  const router = Router();

  // LRN-01: public published-course catalog for an exact category.
  router.get("/api/v1/courses", async (request, response, next): Promise<void> => {
    try {
      if (hasRequestBody(request))
        throw new AppError("CATALOG_BODY_NOT_ALLOWED", 422, "Request body is not allowed");
      let query;
      try {
        query = parseCatalogQuery(request.query);
      } catch (error) {
        throw validationError("CATALOG_VALIDATION_FAILED", "Catalog query validation failed", error);
      }
      const { requestId } = requireContext();
      const page = await service.catalog(query);
      response.status(200).json({
        data: page.items.map(summaryDto),
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
          pagination: { limit: query.limit, hasMore: page.hasMore, nextCursor: page.nextCursor },
        },
      });
      void metrics;
    } catch (error) {
      next(error);
    }
  });

  // LRN-02: limited normalized prefix search over published courses.
  router.get("/api/v1/courses/search", async (request, response, next): Promise<void> => {
    try {
      if (hasRequestBody(request))
        throw new AppError("SEARCH_BODY_NOT_ALLOWED", 422, "Request body is not allowed");
      let input;
      try {
        input = parseSearchQueryInput(request.query);
      } catch (error) {
        throw validationError("SEARCH_VALIDATION_FAILED", "Search query validation failed", error);
      }
      const token = normalizeSearchToken(input.q);
      if (!token) {
        throw new AppError(
          "SEARCH_VALIDATION_FAILED",
          422,
          "Search query must normalize to a 3-20 character token",
          false,
          [{ field: "q", reason: "must normalize to a 3-20 character token" }],
        );
      }
      const { requestId } = requireContext();
      const page = await service.search({
        token,
        limit: input.limit,
        ...(input.cursor ? { cursor: input.cursor } : {}),
      });
      response.status(200).json({
        data: page.items.map(summaryDto),
        meta: {
          requestId,
          timestamp: new Date().toISOString(),
          pagination: { limit: input.limit, hasMore: page.hasMore, nextCursor: page.nextCursor },
        },
      });
      void metrics;
    } catch (error) {
      next(error);
    }
  });

  // LRN-03: public detail of a published course.
  router.get("/api/v1/courses/:courseId", async (request, response, next): Promise<void> => {
    try {
      if (hasRequestBody(request))
        throw new AppError("DETAIL_BODY_NOT_ALLOWED", 422, "Request body is not allowed");
      const courseId = parseUuidParam(request.params.courseId, "INVALID_COURSE_ID");
      const { requestId } = requireContext();
      const detail = await service.detail(courseId);
      response
        .status(200)
        .json({ data: detailDto(detail), meta: { requestId, timestamp: new Date().toISOString() } });
      void metrics;
    } catch (error) {
      next(error);
    }
  });

  // LRN-04: public detail by normalized slug.
  router.get("/api/v1/courses/by-slug/:slug", async (request, response, next): Promise<void> => {
    try {
      if (hasRequestBody(request))
        throw new AppError("SLUG_BODY_NOT_ALLOWED", 422, "Request body is not allowed");
      const slug = typeof request.params.slug === "string" ? request.params.slug : "";
      if (!slug || slug.length > 120)
        throw new AppError("INVALID_SLUG", 400, "Slug must contain between 1 and 120 characters");
      const { requestId } = requireContext();
      const detail = await service.bySlug(slug);
      response
        .status(200)
        .json({ data: detailDto(detail), meta: { requestId, timestamp: new Date().toISOString() } });
      void metrics;
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function requireContext(): { requestId: string } {
  const context = currentRequestContext();
  if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
  return { requestId: context.requestId };
}

function parseUuidParam(value: string | string[] | undefined, code: string): string {
  const result = uuidSchema.safeParse(value);
  if (!result.success) throw new AppError(code, 400, "Resource ID must be a UUID");
  return result.data;
}

function summaryDto(summary: {
  courseId: string;
  title: string;
  slug: string;
  categoryId: string;
  lecturerId: string;
  priceType: string;
  price: string;
  currency: string;
  publishedAt: Date;
}) {
  return {
    courseId: summary.courseId,
    title: summary.title,
    slug: summary.slug,
    categoryId: summary.categoryId,
    lecturerId: summary.lecturerId,
    priceType: summary.priceType,
    price: summary.price,
    currency: summary.currency,
    publishedAt: summary.publishedAt.toISOString(),
  };
}

function detailDto(detail: {
  courseId: string;
  title: string;
  slug: string;
  categoryId: string;
  lecturerId: string;
  priceType: string;
  price: string;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    courseId: detail.courseId,
    title: detail.title,
    slug: detail.slug,
    categoryId: detail.categoryId,
    lecturerId: detail.lecturerId,
    priceType: detail.priceType,
    price: detail.price,
    currency: detail.currency,
    createdAt: detail.createdAt.toISOString(),
    updatedAt: detail.updatedAt.toISOString(),
  };
}

function hasRequestBody(request: { header(name: string): string | undefined }): boolean {
  const contentLength = request.header("content-length");
  return (
    request.header("transfer-encoding") !== undefined ||
    (contentLength !== undefined && contentLength !== "0")
  );
}

function validationError(code: string, message: string, error: unknown): AppError {
  if (!(error instanceof ZodError)) throw error;
  return new AppError(
    code,
    422,
    message,
    false,
    error.issues.map((issue) => ({ field: issue.path.join(".") || "request", reason: issue.message })),
  );
}
