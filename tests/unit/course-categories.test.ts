import { describe, it, expect } from "vitest";
import { categoryIdForName } from "../../apps/learning-service/src/categories.js";
import { parseCreateCourse, parsePatchCourse } from "../../apps/learning-service/src/authoring/model.js";
const base = { title: "Thiết kế cơ bản", slug: "thiet-ke", priceType: "FREE", price: "0", currency: "VND" };
describe("lecturer-entered categories", () => {
  it("normalizes Vietnamese names into stable IDs while preserving display spelling", () => {
    const a = parseCreateCourse({ ...base, categoryName: "  Thiết kế   đồ họa  " });
    expect(a.categoryName).toBe("Thiết kế đồ họa");
    expect(a.categoryId).toBe(categoryIdForName("THIẾT KẾ ĐỒ HỌA"));
    expect(a.categoryId).toBe(categoryIdForName("Thiết kế đồ họa".normalize("NFD")));
    expect(parsePatchCourse({ categoryName: "Thiết kế đồ họa" }).categoryId).toBe(a.categoryId);
  });
  it("keeps existing categories and prevents supplied IDs from renaming another category", () => {
    const id = "10000000-0000-4000-8000-000000000001";
    expect(parseCreateCourse({ ...base, categoryName: "Lập trình" }).categoryId).toBe(id);
    expect(parseCreateCourse({ ...base, categoryId: id }).categoryId).toBe(id);
    expect(parseCreateCourse({ ...base, categoryId: id, categoryName: "Kế toán" }).categoryId).not.toBe(id);
  });
  it("rejects missing, empty and invalid category names", () => {
    for (const categoryName of ["", "x", "a".repeat(81), "Hello\nworld"]) {
      expect(() => parseCreateCourse({ ...base, categoryName })).toThrow();
    }
    expect(() => parseCreateCourse(base)).toThrow();
  });
});
