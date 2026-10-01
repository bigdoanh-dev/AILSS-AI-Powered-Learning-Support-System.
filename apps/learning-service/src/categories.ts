import { createHash } from "node:crypto";
import { types } from "cassandra-driver";
import type { CassandraClient } from "../../../packages/cassandra/src/index.js";

export const defaultCourseCategories = [
  { id: "10000000-0000-4000-8000-000000000001", name: "Lập trình" },
  { id: "10000000-0000-4000-8000-000000000002", name: "Cơ sở dữ liệu" },
  { id: "10000000-0000-4000-8000-000000000003", name: "Trí tuệ nhân tạo" },
  { id: "10000000-0000-4000-8000-000000000004", name: "Tiếng Anh & kỹ năng học" },
];
export function normalizeCategoryName(name: string): string {
  return name.normalize("NFC").trim().replace(/\s+/gu, " ");
}
export function categoryIdForName(name: string): string {
  const normalized = normalizeCategoryName(name).toLocaleLowerCase("vi");
  const existing = defaultCourseCategories.find((item) => item.name.toLocaleLowerCase("vi") === normalized);
  if (existing) return existing.id;
  const bytes = createHash("sha256").update(`ailss-category:${normalized}`).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 15) | 80;
  bytes[8] = ((bytes[8] ?? 0) & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export async function registerCategory(db: CassandraClient, name?: string) {
  if (!name) return;
  await db.execute(
    "INSERT INTO course_categories (catalog,category_id,name) VALUES ('public',?,?) IF NOT EXISTS",
    [types.Uuid.fromString(categoryIdForName(name)), normalizeCategoryName(name)],
    "LOCAL_QUORUM",
    "LOCAL_SERIAL",
  );
}
export async function listCourseCategories(db: CassandraClient) {
  const items = new Map(defaultCourseCategories.map((item) => [item.id, item]));
  let pageState: string | undefined;
  do {
    const page = await db.executePage(
      "SELECT category_id,name FROM course_categories WHERE catalog='public'",
      [],
      "LOCAL_QUORUM",
      500,
      pageState,
    );
    for (const row of page.rows) {
      const id = String(row.category_id);
      items.set(id, { id, name: String(row.name) });
    }
    pageState = page.pageState;
  } while (pageState);
  return [...items.values()].sort((a, b) => a.name.localeCompare(b.name, "vi"));
}
