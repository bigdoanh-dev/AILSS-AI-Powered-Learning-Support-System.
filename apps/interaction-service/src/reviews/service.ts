/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unnecessary-type-assertion */
import { createHmac, randomUUID } from "node:crypto";
import { AppError } from "../../../../packages/http/src/index.js";
import type { ActorContext } from "../../../../packages/security/src/index.js";
import type { EligibilityClient } from "../eligibility.js";
import type { InteractionRepository } from "../repository.js";
import { reviewDto, type Review } from "./model.js";
import type { ReviewRepository } from "./repository.js";
export class ReviewService {
  constructor(
    private reviews: ReviewRepository,
    private commands: InteractionRepository,
    private eligibility: EligibilityClient,
    private secret: string,
  ) {}
  async list(
    courseId: string,
    actorToken: string | undefined,
    correlationId: string,
    limit: number,
    cursor?: string,
  ) {
    if (!(await this.eligibility.review(courseId, false, actorToken, correlationId))) throw notFound();
    const b = await this.reviews.bounds(courseId),
      summary = await this.reviews.summary(courseId);
    if (!b)
      return { items: [], ratingSummary: rating(summary), page: { limit, hasMore: false, nextCursor: null } };
    const c = cursor
      ? decode(this.secret, cursor, courseId, limit)
      : { month: b.latest, snapshot: new Date().toISOString(), lastCreated: "", lastId: "" };
    const all = await this.reviews.list(courseId, c.month, new Date(c.snapshot)),
      filtered = all.filter(
        (r) =>
          r.state === "ACTIVE" &&
          (!c.lastCreated ||
            r.createdAt.toISOString() < c.lastCreated ||
            (r.createdAt.toISOString() === c.lastCreated && r.reviewId > c.lastId)),
      ),
      items: Review[] = [];
    for (const p of filtered) {
      const canonical = await this.reviews.canonical(p.authorId, p.courseId);
      if (
        canonical?.reviewId === p.reviewId &&
        canonical.state === "ACTIVE" &&
        canonical.version === p.version
      )
        items.push(canonical);
      if (items.length === limit) break;
    }
    const last = items.at(-1),
      moreCurrent = filtered.length > items.length,
      previous = prevMonth(c.month),
      older = !moreCurrent && previous >= b.earliest,
      hasMore = moreCurrent || older,
      nextCursor = hasMore
        ? encode(this.secret, {
            courseId,
            limit,
            month: moreCurrent ? c.month : previous,
            snapshot: c.snapshot,
            lastCreated: moreCurrent && last ? last.createdAt.toISOString() : "",
            lastId: moreCurrent && last ? last.reviewId : "",
          })
        : null;
    return {
      items: items.map(reviewDto),
      ratingSummary: rating(summary),
      page: { limit, hasMore, nextCursor },
    };
  }
  async create(input: {
    courseId: string;
    rating: number;
    body: string;
    key: string;
    actor: ActorContext;
    actorToken: string;
    correlationId: string;
    requestId: string;
  }) {
    student(input.actor);
    const c = await this.begin("INT-06", input.actor.userId, input.courseId, input.key, {
      method: "POST",
      courseId: input.courseId,
      rating: input.rating,
      body: input.body,
    });
    if (c.replay) return c;
    if (!(await this.eligibility.review(input.courseId, true, input.actorToken, input.correlationId)))
      throw new AppError("REVIEW_NOT_ELIGIBLE", 403, "Review eligibility required");
    let r = await this.reviews.canonical(input.actor.userId, input.courseId);
    if (r) {
      if (r.state === "DELETED_BY_AUTHOR") throw conflict("REVIEW_ALREADY_DELETED");
      throw conflict("REVIEW_ALREADY_EXISTS");
    }
    const now = new Date(),
      value: Review = {
        reviewId: c.resourceId,
        courseId: input.courseId,
        authorId: input.actor.userId,
        rating: input.rating,
        body: input.body,
        state: "ACTIVE",
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
    if (!(await this.reviews.create(value))) {
      r = await this.reviews.canonical(input.actor.userId, input.courseId);
      if (r?.reviewId !== value.reviewId) throw conflict("REVIEW_ALREADY_EXISTS");
    }
    await this.reviews.locate(value);
    await this.reviews.project(value);
    await this.reviews.includeMonth(value.courseId, month(value.createdAt), now);
    await this.reviews.reconcile(value, c.operationId, now);
    await this.reviews.prepareEvent(value.reviewId, value, now, input.correlationId);
    const response = envelope(value, input.requestId, false);
    await this.finish(c, 201, value.version, response);
    return { status: 201, version: value.version, body: JSON.stringify(response), replayed: false };
  }
  async mutate(input: {
    reviewId: string;
    kind: "PATCH" | "DELETE";
    rating?: number;
    body?: string;
    expected: number;
    key: string;
    actor: ActorContext;
    requestId: string;
  }) {
    student(input.actor);
    const c = await this.begin(
      input.kind === "PATCH" ? "INT-07" : "INT-08",
      input.actor.userId,
      input.reviewId,
      input.key,
      {
        method: input.kind,
        reviewId: input.reviewId,
        rating: input.rating,
        body: input.body,
        expected: input.expected,
      },
      input.reviewId,
    );
    if (c.replay) return c;
    const loc = await this.reviews.locator(input.reviewId);
    if (!loc) throw notFound();
    let old = await this.reviews.canonical(loc.studentId, loc.courseId);
    if (!old || old.reviewId !== input.reviewId) throw notFound();
    if (old.authorId !== input.actor.userId)
      throw new AppError("REVIEW_OWNER_REQUIRED", 403, "Review owner required");
    if (old.version !== input.expected) throw conflict("VERSION_CONFLICT");
    const noOp =
      input.kind === "PATCH" &&
      (input.rating ?? old.rating) === old.rating &&
      (input.body ?? old.body) === old.body;
    if (noOp) {
      const response = envelope(old, input.requestId, true);
      await this.finish(c, 200, old.version, response);
      return { status: 200, version: old.version, body: JSON.stringify(response), replayed: false };
    }
    if (old.state !== "ACTIVE") throw conflict("REVIEW_ALREADY_DELETED");
    const now = new Date(),
      value: Review = {
        ...old,
        rating: input.rating ?? old.rating,
        body: input.kind === "DELETE" ? null : (input.body ?? old.body),
        state: input.kind === "DELETE" ? "DELETED_BY_AUTHOR" : "ACTIVE",
        version: old.version + 1,
        updatedAt: now,
      };
    if (!(await this.reviews.mutate(value, old.version, c.operationId))) {
      old = await this.reviews.canonical(loc.studentId, loc.courseId);
      if (old?.pendingOperationId !== c.operationId) throw conflict("VERSION_CONFLICT");
    }
    const canonical = await this.reviews.canonical(loc.studentId, loc.courseId);
    if (!canonical) throw new Error("REVIEW_READBACK_MISSING");
    await this.reviews.locate(canonical);
    await this.reviews.project(canonical);
    if (canonical.rating !== old.rating || canonical.state !== old.state)
      await this.reviews.reconcile(canonical, c.operationId, now);
    const response = envelope(canonical, input.requestId, false);
    await this.finish(c, input.kind === "DELETE" ? 204 : 200, canonical.version, response);
    return {
      status: input.kind === "DELETE" ? 204 : 200,
      version: canonical.version,
      body: input.kind === "DELETE" ? "" : JSON.stringify(response),
      replayed: false,
    };
  }
  private async begin(
    api: string,
    actor: string,
    resource: string,
    key: string,
    input: object,
    stable?: string,
  ) {
    const scope = `${api}:${actor}:${resource}`,
      hash = keyHash(this.secret, key),
      fingerprint = sum(this.secret, input);
    let r = await this.commands.receipt(scope, hash, key);
    if (!r) {
      const op = randomUUID(),
        id = stable ?? randomUUID();
      if (await this.commands.reserve(scope, hash, key, op, id, fingerprint, new Date()))
        return { scope, hash, key, operationId: op, resourceId: id, fingerprint };
      r = await this.commands.receipt(scope, hash, key);
    }
    if (!r) throw new Error("RECEIPT_AMBIGUOUS");
    if (r.fingerprint !== fingerprint) throw conflict("IDEMPOTENCY_CONFLICT");
    if (r.status === "COMPLETE" && r.body)
      return {
        scope,
        hash,
        key,
        operationId: r.operationId,
        resourceId: r.resourceId,
        fingerprint,
        replay: true,
        status: r.responseStatus,
        version: r.resultVersion,
        body: r.body,
      };
    return { scope, hash, key, operationId: r.operationId, resourceId: r.resourceId, fingerprint };
  }
  private async finish(c: any, status: number, version: number, response: object) {
    const raw = JSON.stringify(response);
    await this.commands.complete(
      c.scope,
      c.hash,
      c.key,
      c.operationId,
      status,
      version,
      raw,
      sum("response", response),
      new Date(),
    );
  }
}
const rating = (s: { count: number; sum: number }) => ({
    reviewCount: s.count,
    averageRating: s.count === 0 ? null : (s.sum / s.count).toFixed(2),
  }),
  envelope = (r: Review, requestId: string, noOp: boolean) => ({
    data: reviewDto(r),
    meta: { requestId, timestamp: new Date().toISOString(), ...(noOp ? { noOp: true } : {}) },
  }),
  student = (a: ActorContext) => {
    if (!a.roles.includes("STUDENT")) throw new AppError("STUDENT_REQUIRED", 403, "Student required");
  },
  conflict = (code: string) => new AppError(code, 409, code),
  notFound = () => new AppError("RESOURCE_NOT_FOUND", 404, "Resource not found"),
  sum = (s: string, v: object) => createHmac("sha256", s).update(JSON.stringify(v)).digest("hex"),
  keyHash = (s: string, v: string) => {
    const b = createHmac("sha256", s).update(v).digest()[0] ?? 0;
    return b > 127 ? b - 256 : b;
  },
  month = (d: Date) => d.toISOString().slice(0, 7) + "-01",
  prevMonth = (v: string) => {
    const d = new Date(v + "T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() - 1);
    return month(d);
  };
function encode(secret: string, v: object) {
  const raw = Buffer.from(JSON.stringify(v)).toString("base64url");
  return raw + "." + sum(secret, { raw });
}
function decode(secret: string, v: string, courseId: string, limit: number) {
  const [a, b] = v.split(".");
  if (!a || b !== sum(secret, { raw: a })) throw new AppError("INVALID_CURSOR", 400, "Invalid cursor");
  const x = JSON.parse(Buffer.from(a, "base64url").toString()) as any;
  if (x.courseId !== courseId || x.limit !== limit)
    throw new AppError("INVALID_CURSOR", 400, "Invalid cursor");
  return x;
}
