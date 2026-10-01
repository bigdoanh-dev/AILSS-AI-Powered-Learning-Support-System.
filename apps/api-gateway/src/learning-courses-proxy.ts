import type { Request, RequestHandler } from "express";
import { z } from "zod";
import type { AppConfig } from "../../../packages/config/src/index.js";
import { AppError, currentRequestContext } from "../../../packages/http/src/index.js";
import { loadPublicKey, verifyAccessToken } from "../../../packages/security/src/index.js";
import { parseBearerAuthorization } from "./protected-identity-proxy.js";

const uuidSchema = z.string().uuid();

export interface LearningCoursesProxy {
  readonly catalog: RequestHandler;
  readonly categories: RequestHandler;
  readonly search: RequestHandler;
  readonly detail: RequestHandler;
  readonly bySlug: RequestHandler;
}

/**
 * Gateway edge for the public Learning course reads (LRN-01..04).
 * Optional Bearer: no Authorization header is anonymous; a supplied bearer MUST
 * verify (issuer/audience/kid/signature/expiry) or the request is rejected 401 —
 * an invalid credential is never silently downgraded to guest. The external JWT is
 * not propagated; Learning receives only the correlation id.
 */
export async function learningCoursesProxyFactory(config: AppConfig): Promise<LearningCoursesProxy> {
  if (!config.JWT_PUBLIC_KEY_PATH) throw new Error("Optional Bearer route requires JWT public key");
  const accessPublicKey = await loadPublicKey(config.JWT_PUBLIC_KEY_PATH);

  const guard = async (request: Request): Promise<void> => {
    if (!hasAuthorization(request)) return;
    try {
      await verifyAccessToken(parseBearerAuthorization(request), accessPublicKey, {
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
        kid: config.JWT_KID,
        clockToleranceSeconds: config.JWT_CLOCK_SKEW_SECONDS,
      });
    } catch {
      throw new AppError("INVALID_ACCESS_TOKEN", 401, "Invalid access token");
    }
  };

  const forward = async (
    request: Request,
    response: Parameters<RequestHandler>[1],
    path: string,
    query: URLSearchParams,
  ): Promise<void> => {
    const context = currentRequestContext();
    if (!context) throw new Error("REQUEST_CONTEXT_UNAVAILABLE");
    const url = new URL(path, config.LEARNING_SERVICE_URL);
    url.search = query.toString();
    const upstream = await fetch(url, {
      headers: { "x-correlation-id": context.correlationId },
      signal: AbortSignal.timeout(config.INTERNAL_HTTP_TIMEOUT_MS),
    });
    const contentType = upstream.headers.get("content-type");
    if (contentType) response.type(contentType);
    response.status(upstream.status).send(await upstream.text());
  };

  const wrap =
    (handler: (request: Request, response: Parameters<RequestHandler>[1]) => Promise<void>): RequestHandler =>
    async (request, response, next): Promise<void> => {
      try {
        await guard(request);
        await handler(request, response);
      } catch (error) {
        next(
          error instanceof AppError
            ? error
            : new AppError(
                "LEARNING_SERVICE_UNAVAILABLE",
                503,
                "Learning service is temporarily unavailable",
                true,
              ),
        );
      }
    };

  return {
    categories: wrap(async (request, response) => {
      assertAllowedQueryKeys(request, new Set());
      await forward(request, response, "/api/v1/course-categories", new URLSearchParams());
    }),
    catalog: wrap(async (request, response) => {
      assertAllowedQueryKeys(request, new Set(["categoryId", "limit", "cursor"]));
      const query = new URLSearchParams();
      const categoryId = queryString(request.query.categoryId);
      if (categoryId !== undefined) query.set("categoryId", categoryId);
      const limit = queryString(request.query.limit);
      if (limit !== undefined) query.set("limit", limit);
      const cursor = queryString(request.query.cursor);
      if (cursor !== undefined) query.set("cursor", cursor);
      await forward(request, response, "/api/v1/courses", query);
    }),
    search: wrap(async (request, response) => {
      assertAllowedQueryKeys(request, new Set(["q", "limit", "cursor"]));
      const query = new URLSearchParams();
      const q = queryString(request.query.q);
      if (q !== undefined) query.set("q", q);
      const limit = queryString(request.query.limit);
      if (limit !== undefined) query.set("limit", limit);
      const cursor = queryString(request.query.cursor);
      if (cursor !== undefined) query.set("cursor", cursor);
      await forward(request, response, "/api/v1/courses/search", query);
    }),
    detail: wrap(async (request, response) => {
      const courseId = parseUuid(request.params.courseId);
      await forward(
        request,
        response,
        `/api/v1/courses/${encodeURIComponent(courseId)}`,
        new URLSearchParams(),
      );
    }),
    bySlug: wrap(async (request, response) => {
      const slug = typeof request.params.slug === "string" ? request.params.slug : "";
      if (!slug || slug.length > 120)
        throw new AppError("INVALID_SLUG", 400, "Slug must contain between 1 and 120 characters");
      await forward(
        request,
        response,
        `/api/v1/courses/by-slug/${encodeURIComponent(slug)}`,
        new URLSearchParams(),
      );
    }),
  };
}

function hasAuthorization(request: Request): boolean {
  const header = request.header("authorization");
  return typeof header === "string" && header.trim().length > 0;
}

function queryString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseUuid(value: string | string[] | undefined): string {
  const result = uuidSchema.safeParse(value);
  if (!result.success) throw new AppError("INVALID_COURSE_ID", 400, "Course ID must be a UUID");
  return result.data;
}

function assertAllowedQueryKeys(request: Request, allowed: ReadonlySet<string>): void {
  if (Object.keys(request.query).some((key) => !allowed.has(key))) {
    throw new AppError("INVALID_QUERY", 422, "Query contains unsupported parameters");
  }
}
