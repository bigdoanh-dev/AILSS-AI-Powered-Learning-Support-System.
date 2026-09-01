/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/restrict-template-expressions */
import { Router, type Request } from "express";
import { z } from "zod";
import { AppError, currentRequestContext } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import { createReviewSchema, patchReviewSchema, reviewBody } from "./model.js";
import type { ReviewService } from "./service.js";
export function reviewRouter(service: ReviewService, verify: (t: string) => Promise<ActorContext>): Router {
  const r = Router();
  r.get("/api/v1/courses/:courseId/reviews", async (req, res, next) => {
    try {
      const c = ctx(),
        token = optional(req),
        limit = parseLimit(req.query.limit),
        result = await service.list(
          id(req.params.courseId),
          token,
          c.correlationId,
          limit,
          typeof req.query.cursor === "string" ? req.query.cursor : undefined,
        );
      res.json({
        data: result.items,
        ratingSummary: result.ratingSummary,
        meta: { requestId: c.requestId, timestamp: new Date().toISOString(), page: result.page },
      });
    } catch (e) {
      next(e);
    }
  });
  r.post("/api/v1/courses/:courseId/reviews", async (req, res, next) => {
    try {
      const c = ctx(),
        token = header(req, "x-actor-context"),
        actor = await verified(token, verify, c.correlationId),
        v = createReviewSchema.parse(req.body),
        result = await service.create({
          courseId: id(req.params.courseId),
          rating: v.rating,
          body: reviewBody(v.body),
          key: key(req),
          actor,
          actorToken: token,
          correlationId: c.correlationId,
          requestId: c.requestId,
        });
      send(res, result);
    } catch (e) {
      next(map(e));
    }
  });
  const mutate = (kind: "PATCH" | "DELETE") => async (req: any, res: any, next: any) => {
    try {
      const c = ctx(),
        actor = await verified(header(req, "x-actor-context"), verify, c.correlationId),
        v = kind === "PATCH" ? patchReviewSchema.parse(req.body) : {},
        result = await service.mutate({
          reviewId: id(req.params.reviewId),
          kind,
          ...("rating" in v && v.rating !== undefined ? { rating: v.rating } : {}),
          ...("body" in v && v.body !== undefined ? { body: reviewBody(v.body) } : {}),
          expected: match(req),
          key: key(req),
          actor,
          requestId: c.requestId,
        });
      send(res, result);
    } catch (e) {
      next(map(e));
    }
  };
  r.patch("/api/v1/reviews/:reviewId", mutate("PATCH"));
  r.delete("/api/v1/reviews/:reviewId", mutate("DELETE"));
  return r;
}
const send = (res: any, r: any) =>
    r.replay
      ? res.set("etag", `"v${r.version}"`).status(r.status).type("json").send(r.body)
      : r.status === 204
        ? res.status(204).send()
        : res.set("etag", `"v${r.version}"`).status(r.status).type("json").send(r.body),
  ctx = () => {
    const c = currentRequestContext();
    if (!c) throw new Error("NO_CONTEXT");
    return c;
  },
  id = (v: unknown) => z.string().uuid().parse(v),
  headers = (r: Request, n: string) =>
    r.rawHeaders.flatMap((v, i) => (i % 2 === 0 && v.toLowerCase() === n ? [r.rawHeaders[i + 1] ?? ""] : [])),
  header = (r: Request, n: string) => {
    const v = headers(r, n);
    if (v.length !== 1 || !v[0])
      throw new AppError(
        n === "idempotency-key" ? "INVALID_IDEMPOTENCY_KEY" : "INVALID_ACCESS_TOKEN",
        n === "idempotency-key" ? 400 : 401,
        "Required header missing",
      );
    return v[0];
  },
  optional = (r: Request) => headers(r, "x-actor-context")[0],
  key = (r: Request) => header(r, "idempotency-key"),
  match = (r: Request) => {
    const m = /^"v([1-9][0-9]*)"$/u.exec(r.header("if-match") ?? "");
    if (!m) throw new AppError("INVALID_PRECONDITION", 400, "Invalid If-Match");
    return Number(m[1]);
  },
  parseLimit = (v: unknown) => {
    const n = v === undefined ? 20 : Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 100) throw new AppError("INVALID_QUERY", 400, "Invalid limit");
    return n;
  };
async function verified(t: string, v: (x: string) => Promise<ActorContext>, c: string) {
  try {
    const a = await v(t);
    if (a.correlationId !== c) throw new Error();
    return a;
  } catch {
    throw new AppError("INVALID_ACCESS_TOKEN", 401, "Invalid authentication");
  }
}
function map(e: unknown) {
  if (e instanceof AppError) return e;
  if (e instanceof z.ZodError) return new AppError("INVALID_REQUEST", 422, "Invalid request");
  if (e instanceof Error && e.message === "INVALID_COMMENT_BODY")
    return new AppError("INVALID_REVIEW_BODY", 422, "Invalid review body");
  return e;
}
