import { types } from "cassandra-driver";
import { z } from "zod";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import { learningShard } from "../catalog/model.js";
import type { ReconciliationWork } from "./repository.js";

const metadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    categoryId: z.string().uuid(),
    publishedAt: z.string().datetime(),
    searchTokens: z.array(z.string().regex(/^[a-z0-9]{3,20}$/u)).max(32),
  })
  .strict();

const LOCAL_QUORUM = "LOCAL_QUORUM" as const;
const uuid = (value: string) => types.Uuid.fromString(value);
const localDate = (value: string) => types.LocalDate.fromString(`${value}-01`);

/**
 * Exact, bounded archive cleanup for Q-LRN-003/Q-LRN-004. Q-LRN-002 is intentionally
 * untouched because ADR-P7-012A-01 permanently reserves an archived course slug.
 */
export class ArchivedCourseProjectionCleanup {
  public constructor(private readonly db: CassandraClient) {}

  public async execute(item: ReconciliationWork): Promise<number> {
    const rawMetadata: unknown = JSON.parse(item.checksum);
    const metadata = metadataSchema.parse(rawMetadata);
    const publishedAt = new Date(metadata.publishedAt);
    const yearMonth = metadata.publishedAt.slice(0, 7);
    const shard = learningShard(item.canonicalId);
    const canonical = await this.db.execute(
      `SELECT state,record_version,category_id,published_at FROM course_by_id WHERE course_id=?`,
      [uuid(item.canonicalId)],
      LOCAL_QUORUM,
    );
    const row = canonical[0];
    if (!row || row.get("state") !== "ARCHIVED") throw new Error("CANONICAL_COURSE_NOT_ARCHIVED");
    const version = numberValue(row, "record_version");
    const canonicalCategoryId = textValue(row, "category_id");
    const canonicalPublishedAt: unknown = row.get("published_at");
    if (
      version !== item.canonicalVersion ||
      canonicalCategoryId !== metadata.categoryId ||
      !(canonicalPublishedAt instanceof Date) ||
      canonicalPublishedAt.getTime() !== publishedAt.getTime()
    ) {
      throw new Error("ARCHIVE_CLEANUP_CANONICAL_MISMATCH");
    }

    await this.db.execute(
      `DELETE FROM published_courses_by_category_bucket
       WHERE category_id=? AND year_month=? AND shard=? AND published_at=? AND course_id=?`,
      [uuid(metadata.categoryId), localDate(yearMonth), shard, publishedAt, uuid(item.canonicalId)],
      LOCAL_QUORUM,
    );
    for (const token of [...new Set(metadata.searchTokens)]) {
      await this.db.execute(
        `DELETE FROM published_courses_by_search_token_bucket
         WHERE token_prefix=? AND year_month=? AND shard=? AND published_at=? AND course_id=?`,
        [token, localDate(yearMonth), shard, publishedAt, uuid(item.canonicalId)],
        LOCAL_QUORUM,
      );
    }

    const category = await this.db.execute(
      `SELECT course_id FROM published_courses_by_category_bucket
       WHERE category_id=? AND year_month=? AND shard=? AND published_at=? AND course_id=?`,
      [uuid(metadata.categoryId), localDate(yearMonth), shard, publishedAt, uuid(item.canonicalId)],
      LOCAL_QUORUM,
    );
    if (category.length !== 0) throw new Error("CATEGORY_PROJECTION_CLEANUP_NOT_CONVERGED");
    for (const token of [...new Set(metadata.searchTokens)]) {
      const search = await this.db.execute(
        `SELECT course_id FROM published_courses_by_search_token_bucket
         WHERE token_prefix=? AND year_month=? AND shard=? AND published_at=? AND course_id=?`,
        [token, localDate(yearMonth), shard, publishedAt, uuid(item.canonicalId)],
        LOCAL_QUORUM,
      );
      if (search.length !== 0) throw new Error("SEARCH_PROJECTION_CLEANUP_NOT_CONVERGED");
    }
    return version;
  }
}

function textValue(row: types.Row, name: string): string {
  const value: unknown = row.get(name);
  if (typeof value === "string") return value;
  if (value instanceof types.Uuid) return value.toString();
  throw new Error(`INVALID_${name.toUpperCase()}`);
}

function numberValue(row: types.Row, name: string): number {
  const value: unknown = row.get(name);
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber(): number }).toNumber();
  }
  throw new Error(`INVALID_${name.toUpperCase()}`);
}
