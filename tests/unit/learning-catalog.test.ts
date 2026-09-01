import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../packages/logger/src/index.js";
import { createMetrics } from "../../packages/observability/src/index.js";
import {
  learningShard,
  LEARNING_SHARD_COUNT,
  monthWindow,
  normalizeSearchToken,
  normalizeSlug,
  searchTokenMatchesTitle,
  encodeCourseCursor,
  catalogFiltersHash,
  searchFiltersHash,
} from "../../apps/learning-service/src/catalog/model.js";
import type { CourseSummary } from "../../apps/learning-service/src/catalog/model.js";
import type {
  CanonicalCourse,
  CatalogCandidate,
  SlugLookup,
} from "../../apps/learning-service/src/catalog/repository.js";
import type { LearningCatalogStore } from "../../apps/learning-service/src/catalog/service.js";
import { LearningCatalogService } from "../../apps/learning-service/src/catalog/service.js";

const now = new Date("2026-08-15T12:00:00.000Z");
const secret = "p7.10-test-secret-that-is-at-least-thirty-two-bytes";
const [currentMonth, previousMonth] = monthWindow(now);

const uuid = (label: string) =>
  `00000000-0000-4000-8000-${createHash("sha256").update(label, "utf8").digest("hex").slice(0, 12)}`;

function canonicalCourse(overrides: Partial<CanonicalCourse> & { courseId: string }): CanonicalCourse {
  return {
    ownerLecturerId: uuid("1ecturer0001"),
    title: "Course Title",
    slug: "course-title",
    categoryId: uuid("ca7egory0001"),
    state: "PUBLISHED",
    recordVersion: 1,
    priceType: "PAID",
    price: "19.99",
    currency: "USD",
    createdAt: new Date(now.getTime() - 10_000),
    updatedAt: new Date(now.getTime() - 5_000),
    ...overrides,
  };
}

interface PartitionCandidate extends CatalogCandidate {
  readonly month: string;
  readonly shard: number;
  readonly token?: string;
}

class MemoryLearningStore implements LearningCatalogStore {
  readonly canonical = new Map<string, CanonicalCourse>();
  readonly slugs = new Map<string, SlugLookup>();
  readonly categoryCandidates: PartitionCandidate[] = [];
  readonly searchCandidates: PartitionCandidate[] = [];
  canonicalReadCount = 0;

  async getCanonicalCourse(courseId: string) {
    this.canonicalReadCount += 1;
    return this.canonical.get(courseId);
  }
  async getSlugLookup(normalizedSlug: string) {
    return this.slugs.get(normalizedSlug);
  }
  async listCategoryPartition(input: {
    categoryId: string;
    month: string;
    shard: number;
    limit: number;
    position?: { publishedAt: string; courseId: string };
  }) {
    return selectPartition(
      this.categoryCandidates.filter(
        (candidate) =>
          candidate.categoryId === input.categoryId &&
          candidate.month === input.month &&
          candidate.shard === input.shard,
      ),
      input.limit,
      input.position,
    );
  }
  async listSearchPartition(input: {
    token: string;
    month: string;
    shard: number;
    limit: number;
    position?: { publishedAt: string; courseId: string };
  }) {
    return selectPartition(
      this.searchCandidates.filter(
        (candidate) =>
          candidate.token === input.token &&
          candidate.month === input.month &&
          candidate.shard === input.shard,
      ),
      input.limit,
      input.position,
    );
  }
}

function selectPartition(
  rows: PartitionCandidate[],
  limit: number,
  position?: { publishedAt: string; courseId: string },
): CatalogCandidate[] {
  const sorted = [...rows].sort(
    (a, b) => b.publishedAt.getTime() - a.publishedAt.getTime() || a.courseId.localeCompare(b.courseId),
  );
  const after = position
    ? sorted.filter(
        (row) =>
          row.publishedAt.getTime() < new Date(position.publishedAt).getTime() ||
          (row.publishedAt.getTime() === new Date(position.publishedAt).getTime() &&
            row.courseId > position.courseId),
      )
    : sorted;
  return after.slice(0, limit);
}

function serviceFixture() {
  const store = new MemoryLearningStore();
  const metrics = createMetrics("learning-catalog-test");
  const logger = createLogger({ service: "learning-service", environment: "test", level: "silent" });
  void logger;
  const service = new LearningCatalogService(store, secret, metrics, () => new Date(now));
  return { store, service };
}

function seedPublishedCourse(
  store: MemoryLearningStore,
  index: number,
  opts: {
    categoryId?: string;
    month?: string;
    publishedAt?: Date;
    state?: string;
    recordVersion?: number;
    projectionVersion?: number;
    title?: string;
    token?: string;
  } = {},
): string {
  const courseId = uuid(`course-${String(index)}`);
  const categoryId = opts.categoryId ?? uuid("ca7egory0001");
  const recordVersion = opts.recordVersion ?? 1;
  const title = opts.title ?? `Course Number ${String(index)}`;
  store.canonical.set(
    courseId,
    canonicalCourse({
      courseId,
      categoryId,
      title,
      slug: normalizeSlug(title),
      state: opts.state ?? "PUBLISHED",
      recordVersion,
    }),
  );
  const candidate: PartitionCandidate = {
    courseId,
    title,
    slug: normalizeSlug(title),
    categoryId,
    lecturerId: uuid("1ecturer0001"),
    priceType: "PAID",
    price: "19.99",
    currency: "USD",
    courseVersion: opts.projectionVersion ?? recordVersion,
    publishedAt: opts.publishedAt ?? new Date(now.getTime() - index * 1_000),
    month: opts.month ?? currentMonth,
    shard: learningShard(courseId),
    ...(opts.token ? { token: opts.token } : {}),
  };
  store.categoryCandidates.push(candidate);
  if (opts.token) store.searchCandidates.push({ ...candidate });
  return courseId;
}

describe("P7.10 normalization and shard model", () => {
  it("normalizes slugs deterministically", () => {
    expect(normalizeSlug("  Hello World  ")).toBe("hello-world");
    expect(normalizeSlug("Café--Learning!!")).toBe("cafe-learning");
    expect(normalizeSlug("a_b_c")).toBe("a-b-c");
  });

  it("normalizes search tokens with case/whitespace policy and 3-20 bounds", () => {
    expect(normalizeSearchToken("  MacHine ")).toBe("machine");
    expect(normalizeSearchToken("machine learning")).toBe("machine");
    expect(normalizeSearchToken("ab")).toBeUndefined();
    expect(normalizeSearchToken("a".repeat(21))).toBeUndefined();
  });

  it("revalidates search tokens against the canonical title", () => {
    expect(searchTokenMatchesTitle("Machine Learning Basics", "mach")).toBe(true);
    expect(searchTokenMatchesTitle("Machine Learning Basics", "machine")).toBe(true);
    expect(searchTokenMatchesTitle("Machine Learning Basics", "learn")).toBe(true);
    expect(searchTokenMatchesTitle("Machine Learning Basics", "physics")).toBe(false);
    expect(searchTokenMatchesTitle("Machine Learning Basics", "machinery")).toBe(false);
  });

  it("uses a single bounded Learning shard function", () => {
    expect(LEARNING_SHARD_COUNT).toBe(4);
    const shard = learningShard(uuid("c0urse00000001"));
    expect(shard).toBeGreaterThanOrEqual(0);
    expect(shard).toBeLessThan(4);
    expect(learningShard(uuid("c0urse00000001"))).toBe(shard);
  });
});

describe("P7.10 LRN-01 catalog", () => {
  it("returns an empty page as 200 [] for a category with no published courses", async () => {
    const { service } = serviceFixture();
    const page = await service.catalog({ categoryId: uuid("emptycateg01"), limit: 10 });
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it("merges shards and month buckets in global published_at DESC, courseId ASC order", async () => {
    const { store, service } = serviceFixture();
    const categoryId = uuid("ca7egory0001");
    const ids: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      ids.push(
        seedPublishedCourse(store, index, {
          categoryId,
          month: index % 2 === 0 ? currentMonth : previousMonth,
          publishedAt: new Date(now.getTime() - index * 60_000),
        }),
      );
    }
    const page = await service.catalog({ categoryId, limit: 20 });
    expect(page.items.map((item) => item.courseId)).toEqual(ids);
    expect(page.hasMore).toBe(false);
  });

  it("paginates with a signed cursor and no duplicates or skipped rows", async () => {
    const { store, service } = serviceFixture();
    const categoryId = uuid("ca7egory0001");
    const ids: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      ids.push(
        seedPublishedCourse(store, index, {
          categoryId,
          publishedAt: new Date(now.getTime() - index * 60_000),
        }),
      );
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await service.catalog({ categoryId, limit: 3, ...(cursor ? { cursor } : {}) });
      seen.push(...page.items.map((item) => item.courseId));
      cursor = page.nextCursor ?? undefined;
      pages += 1;
      if (!page.hasMore) break;
    } while (cursor && pages < 10);
    expect(seen).toEqual(ids);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("keeps global page order when invalid head rows hide a valid row in one shard", async () => {
    const { store, service } = serviceFixture();
    const categoryId = uuid("ca7egory0001");
    const valid: Array<{ id: string; at: Date }> = [];
    for (let index = 0; index < 24; index += 1) {
      const publishedAt = new Date(now.getTime() - index * 60_000);
      const id = seedPublishedCourse(store, 1_000 + index, {
        categoryId,
        publishedAt,
        ...(index < 8 ? { state: "ARCHIVED" } : {}),
      });
      if (index >= 8) valid.push({ id, at: publishedAt });
    }
    const seen: CourseSummary[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < 10; pages += 1) {
      const page = await service.catalog({ categoryId, limit: 2, ...(cursor ? { cursor } : {}) });
      seen.push(...page.items);
      cursor = page.nextCursor ?? undefined;
      if (!page.hasMore) break;
    }
    expect(seen.map((item) => item.courseId)).toEqual(valid.map((item) => item.id));
    expect(seen.map((item) => item.publishedAt.getTime())).toEqual(
      [...seen].map((item) => item.publishedAt.getTime()).sort((left, right) => right - left),
    );
  });

  it("filters archived canonical candidates and wrong-category candidates", async () => {
    const { store, service } = serviceFixture();
    const categoryId = uuid("ca7egory0001");
    const visible = seedPublishedCourse(store, 1, { categoryId });
    seedPublishedCourse(store, 2, { categoryId, state: "ARCHIVED" });
    seedPublishedCourse(store, 3, { categoryId: uuid("othercateg01") });
    const page = await service.catalog({ categoryId, limit: 20 });
    expect(page.items.map((item) => item.courseId)).toEqual([visible]);
  });

  it("skips stale-lower and ahead-of-canonical projections", async () => {
    const { store, service } = serviceFixture();
    const categoryId = uuid("ca7egory0001");
    const current = seedPublishedCourse(store, 1, { categoryId, recordVersion: 2, projectionVersion: 2 });
    seedPublishedCourse(store, 2, { categoryId, recordVersion: 3, projectionVersion: 2 });
    seedPublishedCourse(store, 3, { categoryId, recordVersion: 1, projectionVersion: 5 });
    const page = await service.catalog({ categoryId, limit: 20 });
    expect(page.items.map((item) => item.courseId)).toEqual([current]);
  });

  it("caps canonical candidate reads at the bounded refill ceiling", async () => {
    const { store, service } = serviceFixture();
    const categoryId = uuid("ca7egory0001");
    for (let index = 0; index < 80; index += 1) {
      seedPublishedCourse(store, index, { categoryId, state: "ARCHIVED" });
    }
    const page = await service.catalog({ categoryId, limit: 1 });
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(true);
    expect(store.canonicalReadCount).toBeLessThanOrEqual(40);
  });

  it("rejects tampered, filter-mismatched and expired cursors", async () => {
    const { store, service } = serviceFixture();
    const categoryId = uuid("ca7egory0001");
    for (let index = 0; index < 4; index += 1) seedPublishedCourse(store, index, { categoryId });
    const page = await service.catalog({ categoryId, limit: 2 });
    const cursor = page.nextCursor ?? "";
    expect(cursor).not.toBe("");
    await expect(
      service.catalog({ categoryId, limit: 2, cursor: `${cursor.slice(0, -1)}x` }),
    ).rejects.toMatchObject({
      code: "INVALID_CURSOR",
    });
    await expect(
      service.catalog({ categoryId: uuid("othercateg01"), limit: 2, cursor }),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    const expired = encodeCourseCursor(secret, {
      v: 1,
      kind: "catalog",
      categoryId,
      months: [currentMonth, previousMonth],
      filtersHash: catalogFiltersHash(categoryId),
      issuedAt: Math.floor(now.getTime() / 1_000) - 10_000,
      positions: {},
    });
    await expect(service.catalog({ categoryId, limit: 2, cursor: expired })).rejects.toMatchObject({
      code: "INVALID_CURSOR",
    });
  });
});

describe("P7.10 LRN-02 search", () => {
  it("returns published courses matching the normalized token", async () => {
    const { store, service } = serviceFixture();
    const categoryId = uuid("ca7egory0001");
    const match = seedPublishedCourse(store, 1, { categoryId, title: "Machine Learning", token: "mach" });
    seedPublishedCourse(store, 2, { categoryId, title: "Cooking Basics", token: "cook" });
    const page = await service.search({ token: "mach", limit: 20 });
    expect(page.items.map((item) => item.courseId)).toEqual([match]);
  });

  it("filters a candidate whose canonical title no longer matches the token", async () => {
    const { store, service } = serviceFixture();
    const categoryId = uuid("ca7egory0001");
    const id = seedPublishedCourse(store, 1, { categoryId, title: "Machine Learning", token: "mach" });
    const canonical = store.canonical.get(id);
    if (canonical) store.canonical.set(id, { ...canonical, title: "Cooking Basics", slug: "cooking-basics" });
    const page = await service.search({ token: "mach", limit: 20 });
    expect(page.items).toEqual([]);
  });

  it("filters archived and missing-canonical search candidates", async () => {
    const { store, service } = serviceFixture();
    const categoryId = uuid("ca7egory0001");
    seedPublishedCourse(store, 1, {
      categoryId,
      title: "Machine Learning",
      token: "mach",
      state: "ARCHIVED",
    });
    const orphanId = uuid("orphancourse01");
    store.searchCandidates.push({
      courseId: orphanId,
      title: "Machine Ghost",
      slug: "machine-ghost",
      categoryId,
      lecturerId: null,
      priceType: null,
      price: null,
      currency: null,
      courseVersion: 1,
      publishedAt: new Date(now.getTime() - 500),
      month: currentMonth,
      shard: learningShard(orphanId),
      token: "mach",
    });
    const page = await service.search({ token: "mach", limit: 20 });
    expect(page.items).toEqual([]);
  });

  it("rejects a search cursor bound to a different token", async () => {
    const { store, service } = serviceFixture();
    const categoryId = uuid("ca7egory0001");
    for (let index = 0; index < 4; index += 1)
      seedPublishedCourse(store, index, { categoryId, title: "Machine Learning", token: "mach" });
    const page = await service.search({ token: "mach", limit: 2 });
    const cursor = page.nextCursor ?? "";
    expect(cursor).not.toBe("");
    await expect(service.search({ token: "cook", limit: 2, cursor })).rejects.toMatchObject({
      code: "INVALID_CURSOR",
    });
    void searchFiltersHash;
  });
});

describe("P7.10 LRN-03 detail", () => {
  it("returns a published course detail with an allowlisted DTO", async () => {
    const { store, service } = serviceFixture();
    const courseId = seedPublishedCourse(store, 1, {});
    const detail = await service.detail(courseId);
    expect(detail.courseId).toBe(courseId);
    expect(detail.price).toBe("19.99");
    expect(detail).not.toHaveProperty("recordVersion");
    expect(detail).not.toHaveProperty("state");
  });

  it("returns COURSE_NOT_FOUND for draft, in-review, archived and missing courses", async () => {
    const { store, service } = serviceFixture();
    const draft = seedPublishedCourse(store, 1, { state: "DRAFT" });
    const review = seedPublishedCourse(store, 2, { state: "IN_REVIEW" });
    const archived = seedPublishedCourse(store, 3, { state: "ARCHIVED" });
    for (const id of [draft, review, archived, uuid("missingcourse1")]) {
      await expect(service.detail(id)).rejects.toMatchObject({ code: "COURSE_NOT_FOUND", status: 404 });
    }
  });
});

describe("P7.10 LRN-04 by-slug", () => {
  function seedSlugCourse(
    store: MemoryLearningStore,
    opts: { state?: string; recordVersion?: number; slugVersion?: number } = {},
  ): { courseId: string; slug: string } {
    const courseId = uuid("c0urse00slug1");
    const recordVersion = opts.recordVersion ?? 1;
    const canonical = canonicalCourse({
      courseId,
      title: "Deep Learning",
      slug: "deep-learning",
      state: opts.state ?? "PUBLISHED",
      recordVersion,
    });
    store.canonical.set(courseId, canonical);
    store.slugs.set("deep-learning", {
      courseId,
      state: opts.state ?? "PUBLISHED",
      title: "Deep Learning",
      categoryId: canonical.categoryId,
      courseVersion: opts.slugVersion ?? recordVersion,
      updatedAt: canonical.updatedAt,
    });
    return { courseId, slug: "deep-learning" };
  }

  it("resolves a published course by normalized slug", async () => {
    const { store, service } = serviceFixture();
    const { courseId } = seedSlugCourse(store);
    const detail = await service.bySlug("  Deep  Learning ");
    expect(detail.courseId).toBe(courseId);
  });

  it("returns COURSE_NOT_FOUND for a missing slug", async () => {
    const { service } = serviceFixture();
    await expect(service.bySlug("not-there")).rejects.toMatchObject({
      code: "COURSE_NOT_FOUND",
      status: 404,
    });
  });

  it("returns COURSE_NOT_FOUND when the slug projection is published but canonical is archived", async () => {
    const { store, service } = serviceFixture();
    seedSlugCourse(store, { state: "ARCHIVED" });
    await expect(service.bySlug("deep-learning")).rejects.toMatchObject({
      code: "COURSE_NOT_FOUND",
      status: 404,
    });
  });

  it("returns COURSE_NOT_FOUND when the canonical slug no longer matches the lookup key", async () => {
    const { store, service } = serviceFixture();
    const { courseId } = seedSlugCourse(store);
    const canonical = store.canonical.get(courseId);
    if (canonical) store.canonical.set(courseId, { ...canonical, slug: "renamed-course" });
    await expect(service.bySlug("deep-learning")).rejects.toMatchObject({
      code: "COURSE_NOT_FOUND",
      status: 404,
    });
  });

  it("fails closed when the slug projection version diverges from canonical", async () => {
    const { store, service } = serviceFixture();
    seedSlugCourse(store, { recordVersion: 2, slugVersion: 1 });
    await expect(service.bySlug("deep-learning")).rejects.toMatchObject({
      code: "LEARNING_PROJECTION_INCONSISTENT",
      status: 503,
    });
    const store2 = new MemoryLearningStore();
    seedSlugCourse(store2, { recordVersion: 1, slugVersion: 3 });
    const metrics = createMetrics("learning-catalog-test-2");
    const logger = createLogger({ service: "learning-service", environment: "test", level: "silent" });
    void logger;
    const service2 = new LearningCatalogService(store2, secret, metrics, () => new Date(now));
    await expect(service2.bySlug("deep-learning")).rejects.toMatchObject({
      code: "LEARNING_PROJECTION_INCONSISTENT",
      status: 503,
    });
  });
});
