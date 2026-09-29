import { courses as decodeCourses, type Course } from "./learning";

// These are the product's configured category IDs (also used by the web catalog).
// They are query configuration, not a local list of courses or a global category API.
export const configuredCourseCategories = [
  { id: "10000000-0000-4000-8000-000000000001", name: "Lập trình" },
  { id: "10000000-0000-4000-8000-000000000002", name: "Cơ sở dữ liệu" },
  { id: "10000000-0000-4000-8000-000000000003", name: "Trí tuệ nhân tạo" },
  { id: "10000000-0000-4000-8000-000000000004", name: "Tiếng Anh & kỹ năng học" },
] as const;

const PAGE_SIZE_PER_CATEGORY = 6;
const MAX_PREVIEW_COURSES = 20;

type CatalogRequest = (path: string, options: { signal?: AbortSignal }) => Promise<unknown>;

export interface CatalogPreview {
  courses: Course[];
  failedCategories: string[];
}

export function configuredCategoryName(categoryId?: string): string {
  return configuredCourseCategories.find((category) => category.id === categoryId)?.name ?? "Chủ đề khác";
}

/** Match the Learning Service's single-token, 3–20-character search contract. */
export function isSupportedTitleSearchTerm(value: string): boolean {
  const raw = value.trim();
  if (!raw || raw.length > 20 || /\s/u.test(raw)) return false;
  const normalized = raw
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "");
  return normalized.length >= 3 && normalized.length <= 20;
}

/** A bounded, first-page preview; not a claim to cover every category or every course. */
export async function loadConfiguredCoursePreview(
  request: CatalogRequest,
  signal?: AbortSignal,
): Promise<CatalogPreview> {
  const results = await Promise.allSettled(
    configuredCourseCategories.map(async (category) => {
      const params = new URLSearchParams({ categoryId: category.id, limit: String(PAGE_SIZE_PER_CATEGORY) });
      return decodeCourses(await request(`/api/v1/courses?${params.toString()}`, { signal }));
    }),
  );
  const failedCategories: string[] = [];
  const unique = new Map<string, Course>();
  let successfulCategories = 0;
  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      failedCategories.push(configuredCourseCategories[index]!.name);
      continue;
    }
    successfulCategories += 1;
    for (const course of result.value) {
      if (!unique.has(course.courseId)) unique.set(course.courseId, course);
    }
  }
  if (successfulCategories === 0) {
    const firstFailure = results.find((result) => result.status === "rejected");
    throw firstFailure?.status === "rejected" ? firstFailure.reason : new Error("Catalog unavailable");
  }
  return { courses: [...unique.values()].slice(0, MAX_PREVIEW_COURSES), failedCategories };
}
