import { AppError } from "../../../../packages/http/src/index.js";
import type { createMetrics } from "../../../../packages/observability/src/index.js";
import {
  COURSE_PUBLISHED_STATE,
  decodeCourseCursor,
  encodeCourseCursor,
  catalogFiltersHash,
  LEARNING_SHARD_COUNT,
  monthWindow,
  normalizeSlug,
  searchFiltersHash,
  searchTokenMatchesTitle,
  type CatalogQuery,
  type CourseCursorPayload,
  type CourseDetail,
  type CourseQueryKind,
  type CourseSummary,
  type SearchQuery,
  type ShardPosition,
} from "./model.js";
import type { CanonicalCourse, CatalogCandidate, SlugLookup } from "./repository.js";

export interface LearningCatalogStore {
  getCanonicalCourse(courseId: string): Promise<CanonicalCourse | undefined>;
  getSlugLookup(normalizedSlug: string): Promise<SlugLookup | undefined>;
  listCategoryPartition(input: {
    categoryId: string;
    month: string;
    shard: number;
    limit: number;
    position?: ShardPosition;
  }): Promise<readonly CatalogCandidate[]>;
  listSearchPartition(input: {
    token: string;
    month: string;
    shard: number;
    limit: number;
    position?: ShardPosition;
  }): Promise<readonly CatalogCandidate[]>;
}

export interface CoursePage {
  readonly items: readonly CourseSummary[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

interface TaggedCandidate {
  readonly candidate: CatalogCandidate;
  readonly partition: string;
}

export class LearningCatalogService {
  public constructor(
    private readonly store: LearningCatalogStore,
    private readonly cursorSecret: string,
    private readonly metrics: ReturnType<typeof createMetrics>,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (Buffer.byteLength(cursorSecret, "utf8") < 32) {
      throw new Error("Learning cursor secret must contain at least 32 bytes");
    }
  }

  public async catalog(query: CatalogQuery): Promise<CoursePage> {
    const stop = this.metrics.learningCatalogLatency.startTimer({ operation: "catalog" });
    try {
      const filtersHash = catalogFiltersHash(query.categoryId);
      let cursor: CourseCursorPayload | undefined;
      if (query.cursor) {
        try {
          cursor = decodeCourseCursor(
            this.cursorSecret,
            query.cursor,
            { kind: "catalog", filtersHash },
            Math.floor(this.now().getTime() / 1_000),
          );
        } catch {
          this.metrics.learningCatalogRequests.inc({ outcome: "invalid_cursor" });
          throw new AppError("INVALID_CURSOR", 400, "The catalog cursor is invalid or expired");
        }
        if (cursor.categoryId !== query.categoryId) {
          this.metrics.learningCatalogRequests.inc({ outcome: "invalid_cursor" });
          throw new AppError("INVALID_CURSOR", 400, "The catalog cursor is invalid or expired");
        }
      }
      const months = cursor?.months ?? monthWindow(this.now());
      const page = await this.#page({
        kind: "catalog",
        limit: query.limit,
        months: [...months],
        positions: { ...(cursor?.positions ?? {}) },
        filtersHash,
        cursorIdentity: { categoryId: query.categoryId },
        fetchPartition: (month, shard, limit, position) =>
          this.store.listCategoryPartition({
            categoryId: query.categoryId,
            month,
            shard,
            limit,
            ...(position ? { position } : {}),
          }),
        validatePredicate: (candidate, canonical) =>
          candidate.categoryId === query.categoryId && canonical.categoryId === query.categoryId,
        projectionLabel: "catalog",
      });
      this.metrics.learningCatalogRequests.inc({ outcome: "success" });
      return page;
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.metrics.learningCatalogRequests.inc({ outcome: "dependency_failure" });
      throw unavailable("LEARNING_CATALOG_UNAVAILABLE", "Course catalog is temporarily unavailable");
    } finally {
      stop();
    }
  }

  public async search(query: SearchQuery): Promise<CoursePage> {
    const stop = this.metrics.learningCatalogLatency.startTimer({ operation: "search" });
    try {
      const filtersHash = searchFiltersHash(query.token);
      let cursor: CourseCursorPayload | undefined;
      if (query.cursor) {
        try {
          cursor = decodeCourseCursor(
            this.cursorSecret,
            query.cursor,
            { kind: "search", filtersHash },
            Math.floor(this.now().getTime() / 1_000),
          );
        } catch {
          this.metrics.learningSearchRequests.inc({ outcome: "invalid_cursor" });
          throw new AppError("INVALID_CURSOR", 400, "The search cursor is invalid or expired");
        }
        if (cursor.token !== query.token) {
          this.metrics.learningSearchRequests.inc({ outcome: "invalid_cursor" });
          throw new AppError("INVALID_CURSOR", 400, "The search cursor is invalid or expired");
        }
      }
      const months = cursor?.months ?? monthWindow(this.now());
      const page = await this.#page({
        kind: "search",
        limit: query.limit,
        months: [...months],
        positions: { ...(cursor?.positions ?? {}) },
        filtersHash,
        cursorIdentity: { token: query.token },
        fetchPartition: (month, shard, limit, position) =>
          this.store.listSearchPartition({
            token: query.token,
            month,
            shard,
            limit,
            ...(position ? { position } : {}),
          }),
        validatePredicate: (_candidate, canonical) => searchTokenMatchesTitle(canonical.title, query.token),
        projectionLabel: "search",
      });
      this.metrics.learningSearchRequests.inc({ outcome: "success" });
      return page;
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.metrics.learningSearchRequests.inc({ outcome: "dependency_failure" });
      throw unavailable("LEARNING_SEARCH_UNAVAILABLE", "Course search is temporarily unavailable");
    } finally {
      stop();
    }
  }

  public async detail(courseId: string): Promise<CourseDetail> {
    const stop = this.metrics.learningCatalogLatency.startTimer({ operation: "detail" });
    try {
      const canonical = await this.store.getCanonicalCourse(courseId);
      if (!canonical || canonical.state !== COURSE_PUBLISHED_STATE) {
        this.metrics.learningCourseDetail.inc({ outcome: "not_found" });
        throw new AppError("COURSE_NOT_FOUND", 404, "Course was not found");
      }
      this.metrics.learningCourseDetail.inc({ outcome: "success" });
      return detailFromCanonical(canonical);
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.metrics.learningCourseDetail.inc({ outcome: "dependency_failure" });
      throw unavailable("LEARNING_DETAIL_UNAVAILABLE", "Course detail is temporarily unavailable");
    } finally {
      stop();
    }
  }

  public async bySlug(rawSlug: string): Promise<CourseDetail> {
    const stop = this.metrics.learningCatalogLatency.startTimer({ operation: "slug" });
    try {
      const normalized = normalizeSlug(rawSlug);
      if (!normalized) {
        this.metrics.learningSlugLookup.inc({ outcome: "not_found" });
        throw new AppError("COURSE_NOT_FOUND", 404, "Course was not found");
      }
      const lookup = await this.store.getSlugLookup(normalized);
      if (!lookup) {
        this.metrics.learningSlugLookup.inc({ outcome: "not_found" });
        throw new AppError("COURSE_NOT_FOUND", 404, "Course was not found");
      }
      const canonical = await this.store.getCanonicalCourse(lookup.courseId);
      if (
        !canonical ||
        canonical.state !== COURSE_PUBLISHED_STATE ||
        normalizeSlug(canonical.slug) !== normalized
      ) {
        this.metrics.learningSlugLookup.inc({ outcome: "not_found" });
        throw new AppError("COURSE_NOT_FOUND", 404, "Course was not found");
      }
      if (lookup.courseVersion !== canonical.recordVersion) {
        if (lookup.courseVersion > canonical.recordVersion) {
          this.metrics.learningProjectionAhead.inc({ projection: "slug" });
        } else {
          this.metrics.learningProjectionStale.inc({ projection: "slug" });
        }
        this.metrics.learningSlugLookup.inc({ outcome: "inconsistent" });
        throw unavailable(
          "LEARNING_PROJECTION_INCONSISTENT",
          "Course projection is temporarily inconsistent",
        );
      }
      this.metrics.learningSlugLookup.inc({ outcome: "success" });
      return detailFromCanonical(canonical);
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.metrics.learningSlugLookup.inc({ outcome: "dependency_failure" });
      throw unavailable("LEARNING_SLUG_UNAVAILABLE", "Slug lookup is temporarily unavailable");
    } finally {
      stop();
    }
  }

  async #page(input: {
    kind: CourseQueryKind;
    limit: number;
    months: readonly string[];
    positions: Record<string, ShardPosition>;
    filtersHash: string;
    cursorIdentity: { categoryId?: string; token?: string };
    fetchPartition: (
      month: string,
      shard: number,
      limit: number,
      position?: ShardPosition,
    ) => Promise<readonly CatalogCandidate[]>;
    validatePredicate: (candidate: CatalogCandidate, canonical: CanonicalCourse) => boolean;
    projectionLabel: string;
  }): Promise<CoursePage> {
    const shards = Array.from({ length: LEARNING_SHARD_COUNT }, (_, shard) => shard);
    const items: CourseSummary[] = [];
    const included = new Set<string>();
    const positions = { ...input.positions };
    const ceiling = Math.max(input.limit * 4, 40);
    let inspected = 0;
    let hasMore = false;

    for (;;) {
      const results = await Promise.all(
        input.months.flatMap((month) =>
          shards.map(async (shard) => {
            const partition = `${month}:${String(shard)}`;
            // Fetch to the bounded canonical-inspection ceiling, not merely page-size + 1.
            // Otherwise invalid/stale rows at the head of one shard can hide a newer valid
            // row until the next refill, after an older row from another shard was emitted.
            const rows = await input.fetchPartition(month, shard, ceiling + 1, positions[partition]);
            return { partition, rows };
          }),
        ),
      );
      const candidates: TaggedCandidate[] = [];
      let anyFullPartition = false;
      for (const { partition, rows } of results) {
        if (rows.length === ceiling + 1) anyFullPartition = true;
        for (const candidate of rows) candidates.push({ candidate, partition });
      }
      if (candidates.length === 0) break;
      candidates.sort((left, right) => compareCandidates(left.candidate, right.candidate));

      const remainingBudget = Math.max(ceiling - inspected, 0);
      const boundedCandidates = candidates.slice(0, remainingBudget);
      if (boundedCandidates.length < candidates.length) hasMore = true;
      const uniqueIds = [...new Set(boundedCandidates.map(({ candidate }) => candidate.courseId))];
      const canonicalById = new Map<string, CanonicalCourse | undefined>();
      await Promise.all(
        uniqueIds.map(async (courseId) => {
          canonicalById.set(courseId, await this.store.getCanonicalCourse(courseId));
        }),
      );

      let brokeEarly = false;
      for (const { candidate, partition } of boundedCandidates) {
        if (items.length >= input.limit || inspected >= ceiling) {
          hasMore = true;
          brokeEarly = true;
          break;
        }
        inspected += 1;
        positions[partition] = {
          publishedAt: candidate.publishedAt.toISOString(),
          courseId: candidate.courseId,
        };
        const canonical = canonicalById.get(candidate.courseId);
        const verdict = this.#validateCandidate(candidate, canonical, input);
        if (!verdict.ok) {
          this.metrics.learningCandidateFiltered.inc({ operation: input.kind, reason: verdict.reason });
          continue;
        }
        if (included.has(candidate.courseId)) continue;
        included.add(candidate.courseId);
        items.push(summaryFrom(candidate, canonical as CanonicalCourse));
      }
      if (brokeEarly) break;
      if (inspected >= ceiling) {
        hasMore = true;
        break;
      }
      if (!anyFullPartition) break;
      hasMore = true;
    }

    const nextCursor = hasMore
      ? encodeCourseCursor(this.cursorSecret, {
          v: 1,
          kind: input.kind,
          ...(input.cursorIdentity.categoryId ? { categoryId: input.cursorIdentity.categoryId } : {}),
          ...(input.cursorIdentity.token ? { token: input.cursorIdentity.token } : {}),
          months: [input.months[0] ?? "", input.months[1] ?? ""],
          filtersHash: input.filtersHash,
          issuedAt: Math.floor(this.now().getTime() / 1_000),
          positions,
        })
      : null;
    return { items, nextCursor, hasMore };
  }

  #validateCandidate(
    candidate: CatalogCandidate,
    canonical: CanonicalCourse | undefined,
    input: {
      kind: CourseQueryKind;
      projectionLabel: string;
      validatePredicate: (c: CatalogCandidate, k: CanonicalCourse) => boolean;
    },
  ): { ok: true } | { ok: false; reason: string } {
    if (!canonical) return { ok: false, reason: "missing_canonical" };
    if (canonical.state !== COURSE_PUBLISHED_STATE) return { ok: false, reason: "not_published" };
    if (candidate.courseVersion < canonical.recordVersion) {
      this.metrics.learningProjectionStale.inc({ projection: input.projectionLabel });
      return { ok: false, reason: "stale_projection" };
    }
    if (candidate.courseVersion > canonical.recordVersion) {
      this.metrics.learningProjectionAhead.inc({ projection: input.projectionLabel });
      return { ok: false, reason: "ahead_projection" };
    }
    if (!input.validatePredicate(candidate, canonical)) return { ok: false, reason: "predicate_mismatch" };
    return { ok: true };
  }
}

function compareCandidates(left: CatalogCandidate, right: CatalogCandidate): number {
  const time = right.publishedAt.getTime() - left.publishedAt.getTime();
  return time === 0 ? left.courseId.localeCompare(right.courseId) : time;
}

function summaryFrom(candidate: CatalogCandidate, canonical: CanonicalCourse): CourseSummary {
  return {
    courseId: canonical.courseId,
    title: canonical.title,
    slug: canonical.slug,
    categoryId: canonical.categoryId,
    lecturerId: canonical.ownerLecturerId,
    priceType: canonical.priceType,
    price: canonical.price,
    currency: canonical.currency,
    publishedAt: candidate.publishedAt,
  };
}

function detailFromCanonical(canonical: CanonicalCourse): CourseDetail {
  return {
    courseId: canonical.courseId,
    title: canonical.title,
    slug: canonical.slug,
    categoryId: canonical.categoryId,
    lecturerId: canonical.ownerLecturerId,
    priceType: canonical.priceType,
    price: canonical.price,
    currency: canonical.currency,
    createdAt: canonical.createdAt,
    updatedAt: canonical.updatedAt,
  };
}

function unavailable(code: string, message: string): AppError {
  return new AppError(code, 503, message, true);
}
