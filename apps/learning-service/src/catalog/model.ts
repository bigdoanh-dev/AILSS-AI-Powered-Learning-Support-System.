import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const LEARNING_SHARD_COUNT = 4;
export const LEARNING_CURSOR_TTL_SECONDS = 900;
export const COURSE_PUBLISHED_STATE = "PUBLISHED";

export type CourseQueryKind = "catalog" | "search";

const catalogQuerySchema = z
  .object({
    categoryId: z.string().uuid(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(16).max(16_384).optional(),
  })
  .strict();

const searchQuerySchema = z
  .object({
    q: z.string().min(1).max(20),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().min(16).max(16_384).optional(),
  })
  .strict();

export interface CatalogQuery {
  readonly categoryId: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface SearchQuery {
  readonly token: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface CourseSummary {
  readonly courseId: string;
  readonly title: string;
  readonly slug: string;
  readonly categoryId: string;
  readonly lecturerId: string;
  readonly priceType: string;
  readonly price: string;
  readonly currency: string;
  readonly publishedAt: Date;
}

export interface CourseDetail {
  readonly courseId: string;
  readonly title: string;
  readonly slug: string;
  readonly categoryId: string;
  readonly lecturerId: string;
  readonly priceType: string;
  readonly price: string;
  readonly currency: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ShardPosition {
  readonly publishedAt: string;
  readonly courseId: string;
}

export interface CourseCursorPayload {
  readonly v: 1;
  readonly kind: CourseQueryKind;
  readonly categoryId?: string;
  readonly token?: string;
  readonly months: readonly [string, string];
  readonly filtersHash: string;
  readonly issuedAt: number;
  readonly positions: Readonly<Record<string, ShardPosition>>;
}

export function parseCatalogQuery(value: unknown): CatalogQuery {
  const parsed = catalogQuerySchema.parse(value);
  return {
    categoryId: parsed.categoryId,
    limit: parsed.limit,
    ...(parsed.cursor ? { cursor: parsed.cursor } : {}),
  };
}

export function parseSearchQueryInput(value: unknown): { q: string; limit: number; cursor?: string } {
  const parsed = searchQuerySchema.parse(value);
  return {
    q: parsed.q,
    limit: parsed.limit,
    ...(parsed.cursor ? { cursor: parsed.cursor } : {}),
  };
}

/** Canonical Learning shard function (ERRATA-P7-010-04). LRN-08 must reuse this. */
export function learningShard(courseId: string): number {
  return (createHash("sha256").update(courseId, "utf8").digest()[0] ?? 0) % LEARNING_SHARD_COUNT;
}

function normalizeBase(input: string): string {
  return input.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/** Canonical slug normalizer shared by LRN-04 lookup, fixtures and the future LRN-08 producer. */
export function normalizeSlug(input: string): string {
  return normalizeBase(input)
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

/**
 * Canonical limited-search token normalizer (ERRATA-P7-010-03). Returns the leading
 * normalized token, or undefined when its canonical length is outside 3..20.
 */
export function normalizeSearchToken(input: string): string | undefined {
  const base = normalizeBase(input);
  const first = base.split(/\s+/u)[0] ?? "";
  const token = first.replace(/[^a-z0-9]/gu, "");
  return token.length >= 3 && token.length <= 20 ? token : undefined;
}

/** Distinct normalized tokens of a title (for revalidating search predicates). */
function titleTokens(title: string): readonly string[] {
  return normalizeBase(title)
    .split(/\s+/u)
    .map((part) => part.replace(/[^a-z0-9]/gu, ""))
    .filter((part) => part.length > 0);
}

/** Exact bounded Q-LRN-004 producer set: every searchable 3..20 character word prefix. */
export function searchProjectionTokens(title: string): readonly string[] {
  const result = new Set<string>();
  for (const word of titleTokens(title)) {
    for (let length = 3; length <= Math.min(20, word.length); length += 1) {
      result.add(word.slice(0, length));
      if (result.size === 32) return [...result];
    }
  }
  return [...result];
}

/** Whether a normalized search token is still produced by the canonical title. */
export function searchTokenMatchesTitle(title: string, token: string): boolean {
  if (token.length < 3 || token.length > 20) return false;
  return titleTokens(title).some(
    (word) => word.length >= token.length && word.slice(0, token.length) === token,
  );
}

export function yearMonthKey(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function previousMonthKey(month: string): string {
  const [yearText, monthText] = month.split("-");
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 2, 1));
  return yearMonthKey(date);
}

export function monthWindow(now: Date): readonly [string, string] {
  const current = yearMonthKey(now);
  return [current, previousMonthKey(current)];
}

export function catalogFiltersHash(categoryId: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ kind: "catalog", categoryId }), "utf8")
    .digest("hex");
}

export function searchFiltersHash(token: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ kind: "search", token }), "utf8")
    .digest("hex");
}

export function encodeCourseCursor(secret: string, payload: CourseCursorPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(body, "utf8").digest("base64url");
  return `${body}.${signature}`;
}

export function decodeCourseCursor(
  secret: string,
  cursor: string,
  expected: { kind: CourseQueryKind; filtersHash: string },
  nowSeconds = Math.floor(Date.now() / 1_000),
): CourseCursorPayload {
  const [body, signature, extra] = cursor.split(".");
  if (!body || !signature || extra) throw new Error("INVALID_CURSOR");
  const expectedSignature = createHmac("sha256", secret).update(body, "utf8").digest();
  let actualSignature: Buffer;
  try {
    actualSignature = Buffer.from(signature, "base64url");
    if (actualSignature.toString("base64url") !== signature) throw new Error("NON_CANONICAL");
  } catch {
    throw new Error("INVALID_CURSOR");
  }
  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    throw new Error("INVALID_CURSOR");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new Error("INVALID_CURSOR");
  }
  const positionSchema = z
    .object({ publishedAt: z.string().datetime(), courseId: z.string().uuid() })
    .strict();
  const schema = z
    .object({
      v: z.literal(1),
      kind: z.enum(["catalog", "search"]),
      categoryId: z.string().uuid().optional(),
      token: z.string().min(3).max(20).optional(),
      months: z.tuple([z.string(), z.string()]),
      filtersHash: z.string().regex(/^[a-f0-9]{64}$/u),
      issuedAt: z.number().int().nonnegative(),
      positions: z.record(z.string(), positionSchema),
    })
    .strict();
  const payload = schema.parse(parsed);
  if (
    payload.kind !== expected.kind ||
    payload.filtersHash !== expected.filtersHash ||
    payload.issuedAt > nowSeconds ||
    nowSeconds - payload.issuedAt > LEARNING_CURSOR_TTL_SECONDS
  ) {
    throw new Error("INVALID_CURSOR");
  }
  return {
    v: 1,
    kind: payload.kind,
    ...(payload.categoryId !== undefined ? { categoryId: payload.categoryId } : {}),
    ...(payload.token !== undefined ? { token: payload.token } : {}),
    months: payload.months,
    filtersHash: payload.filtersHash,
    issuedAt: payload.issuedAt,
    positions: payload.positions,
  };
}
