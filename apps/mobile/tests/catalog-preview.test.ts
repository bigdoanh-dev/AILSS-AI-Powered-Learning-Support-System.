import { describe, expect, it, vi } from "vitest";
import {
  configuredCategoryName,
  configuredCourseCategories,
  isSupportedTitleSearchTerm,
  loadConfiguredCoursePreview,
} from "../src/catalog-preview";

const sample = (courseId: string, categoryId: string) => ({
  courseId,
  title: `Khóa ${courseId}`,
  categoryId,
});

describe("configured mobile catalog preview", () => {
  it("requests only bounded, configured category pages and deduplicates courses", async () => {
    const request = vi.fn(async (path: string) => {
      const query = new URL(path, "https://example.invalid").searchParams;
      expect(query.get("limit")).toBe("6");
      const categoryId = query.get("categoryId")!;
      return [sample("shared", categoryId), sample(categoryId, categoryId)];
    });

    const result = await loadConfiguredCoursePreview(request);

    expect(request).toHaveBeenCalledTimes(4);
    expect(
      request.mock.calls.map(([path]) =>
        new URL(path, "https://example.invalid").searchParams.get("categoryId"),
      ),
    ).toEqual(configuredCourseCategories.map((category) => category.id));
    expect(result.courses.map((course) => course.courseId)).toEqual([
      "shared",
      ...configuredCourseCategories.map((category) => category.id),
    ]);
    expect(result.failedCategories).toEqual([]);
  });

  it("surfaces failed categories while preserving courses returned by successful ones", async () => {
    const failed = configuredCourseCategories[1]!;
    const request = vi.fn(async (path: string) => {
      const categoryId = new URL(path, "https://example.invalid").searchParams.get("categoryId")!;
      if (categoryId === failed.id) throw new Error("unavailable");
      return [sample(categoryId, categoryId)];
    });

    const result = await loadConfiguredCoursePreview(request);

    expect(result.courses).toHaveLength(3);
    expect(result.failedCategories).toEqual([failed.name]);
  });

  it("fails if none of the configured categories could be read", async () => {
    const request = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(loadConfiguredCoursePreview(request)).rejects.toThrow("offline");
  });

  it("caps the preview and keeps unknown category labels honest", async () => {
    const request = vi.fn(async (path: string) => {
      const categoryId = new URL(path, "https://example.invalid").searchParams.get("categoryId")!;
      return Array.from({ length: 6 }, (_, index) => sample(`${categoryId}-${index}`, categoryId));
    });
    const result = await loadConfiguredCoursePreview(request);

    expect(result.courses).toHaveLength(20);
    expect(configuredCategoryName(configuredCourseCategories[0]!.id)).toBe("Lập trình");
    expect(configuredCategoryName("unconfigured-category")).toBe("Chủ đề khác");
  });

  it("accepts only a single search token the server can normalize", () => {
    expect(isSupportedTitleSearchTerm("Python")).toBe(true);
    expect(isSupportedTitleSearchTerm("điện")).toBe(true);
    expect(isSupportedTitleSearchTerm("AI")).toBe(false);
    expect(isSupportedTitleSearchTerm("!!!")).toBe(false);
    expect(isSupportedTitleSearchTerm("khoa hoc")).toBe(false);
    expect(isSupportedTitleSearchTerm("a".repeat(21))).toBe(false);
  });
});
