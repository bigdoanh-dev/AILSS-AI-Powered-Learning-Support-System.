import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../../packages/cassandra/src/index.js";
import type { ShardPosition } from "./model.js";

const LOCAL_QUORUM = "LOCAL_QUORUM" as const;
const LOCAL_ONE = "LOCAL_ONE" as const;
const uuid = (value: string) => types.Uuid.fromString(value);
const localDate = (month: string) => types.LocalDate.fromString(`${month}-01`);

function text(row: types.Row, name: string): string {
  const value: unknown = row.get(name);
  if (typeof value === "string") return value;
  if (value instanceof types.Uuid) return value.toString();
  throw new Error(`INVALID_${name.toUpperCase()}`);
}

function date(row: types.Row, name: string): Date {
  const value: unknown = row.get(name);
  if (!(value instanceof Date)) throw new Error(`INVALID_${name.toUpperCase()}`);
  return value;
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

/** Decimal-safe price: the driver returns a BigDecimal; serialize to string. */
function decimalText(row: types.Row, name: string): string {
  const value: unknown = row.get(name);
  if (value === null || value === undefined) return "0";
  if (value instanceof types.BigDecimal) return value.toString();
  if (typeof value === "number") return String(value);
  if (typeof value === "bigint") return value.toString();
  throw new Error(`INVALID_${name.toUpperCase()}`);
}

export interface CanonicalCourse {
  readonly courseId: string;
  readonly ownerLecturerId: string;
  readonly title: string;
  readonly slug: string;
  readonly categoryId: string;
  readonly state: string;
  readonly recordVersion: number;
  readonly priceType: string;
  readonly price: string;
  readonly currency: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SlugLookup {
  readonly courseId: string;
  readonly state: string;
  readonly title: string;
  readonly categoryId: string;
  readonly courseVersion: number;
  readonly updatedAt: Date;
}

export interface CatalogCandidate {
  readonly courseId: string;
  readonly title: string;
  readonly slug: string;
  readonly categoryId: string;
  readonly lecturerId: string | null;
  readonly priceType: string | null;
  readonly price: string | null;
  readonly currency: string | null;
  readonly courseVersion: number;
  readonly publishedAt: Date;
}

export class LearningCatalogRepository {
  public constructor(private readonly client: CassandraClient) {}

  public async getCanonicalCourse(courseId: string): Promise<CanonicalCourse | undefined> {
    // Q-LRN-001: exact canonical read, strong consistency for visibility correctness.
    const rows = await this.client.execute(
      `SELECT course_id,owner_lecturer_id,title,slug,category_id,state,record_version,price_type,price,currency,created_at,updated_at
       FROM course_by_id WHERE course_id=?`,
      [uuid(courseId)],
      LOCAL_QUORUM,
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      courseId: text(row, "course_id"),
      ownerLecturerId: text(row, "owner_lecturer_id"),
      title: text(row, "title"),
      slug: text(row, "slug"),
      categoryId: text(row, "category_id"),
      state: text(row, "state"),
      recordVersion: numberValue(row, "record_version"),
      priceType: text(row, "price_type"),
      price: decimalText(row, "price"),
      currency: text(row, "currency"),
      createdAt: date(row, "created_at"),
      updatedAt: date(row, "updated_at"),
    };
  }

  public async getSlugLookup(normalizedSlug: string): Promise<SlugLookup | undefined> {
    // Q-LRN-002: public slug lookup projection, LOCAL_ONE per registry.
    const rows = await this.client.execute(
      `SELECT course_id,state,title,category_id,course_version,updated_at
       FROM course_by_slug WHERE normalized_slug=?`,
      [normalizedSlug],
      LOCAL_ONE,
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      courseId: text(row, "course_id"),
      state: text(row, "state"),
      title: text(row, "title"),
      categoryId: text(row, "category_id"),
      courseVersion: numberValue(row, "course_version"),
      updatedAt: date(row, "updated_at"),
    };
  }

  public async listCategoryPartition(input: {
    categoryId: string;
    month: string;
    shard: number;
    limit: number;
    position?: ShardPosition;
  }): Promise<readonly CatalogCandidate[]> {
    // Q-LRN-003: bounded single-partition read, LOCAL_ONE per registry.
    const select = `SELECT course_id,slug,title,lecturer_id,price_type,price,currency,course_version,published_at
                    FROM published_courses_by_category_bucket
                    WHERE category_id=? AND year_month=? AND shard=?`;
    const rows = input.position
      ? await this.client.execute(
          `${select} AND (published_at,course_id) < (?,?) LIMIT ?`,
          [
            uuid(input.categoryId),
            localDate(input.month),
            input.shard,
            new Date(input.position.publishedAt),
            uuid(input.position.courseId),
            input.limit,
          ],
          LOCAL_ONE,
        )
      : await this.client.execute(
          `${select} LIMIT ?`,
          [uuid(input.categoryId), localDate(input.month), input.shard, input.limit],
          LOCAL_ONE,
        );
    return rows.map((row) => ({
      courseId: text(row, "course_id"),
      title: text(row, "title"),
      slug: text(row, "slug"),
      categoryId: input.categoryId,
      lecturerId: text(row, "lecturer_id"),
      priceType: text(row, "price_type"),
      price: decimalText(row, "price"),
      currency: text(row, "currency"),
      courseVersion: numberValue(row, "course_version"),
      publishedAt: date(row, "published_at"),
    }));
  }

  public async listSearchPartition(input: {
    token: string;
    month: string;
    shard: number;
    limit: number;
    position?: ShardPosition;
  }): Promise<readonly CatalogCandidate[]> {
    // Q-LRN-004: bounded single-partition read, LOCAL_ONE per registry.
    const select = `SELECT course_id,slug,title,category_id,course_version,published_at
                    FROM published_courses_by_search_token_bucket
                    WHERE token_prefix=? AND year_month=? AND shard=?`;
    const rows = input.position
      ? await this.client.execute(
          `${select} AND (published_at,course_id) < (?,?) LIMIT ?`,
          [
            input.token,
            localDate(input.month),
            input.shard,
            new Date(input.position.publishedAt),
            uuid(input.position.courseId),
            input.limit,
          ],
          LOCAL_ONE,
        )
      : await this.client.execute(
          `${select} LIMIT ?`,
          [input.token, localDate(input.month), input.shard, input.limit],
          LOCAL_ONE,
        );
    return rows.map((row) => ({
      courseId: text(row, "course_id"),
      title: text(row, "title"),
      slug: text(row, "slug"),
      categoryId: text(row, "category_id"),
      lecturerId: null,
      priceType: null,
      price: null,
      currency: null,
      courseVersion: numberValue(row, "course_version"),
      publishedAt: date(row, "published_at"),
    }));
  }
}
