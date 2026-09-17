import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { SessionProvider } from "../src/auth/session";
import { StudentGuard } from "../src/student/ui";
import { StudentHome } from "../src/student/Learning";

const id = "00000000-0000-4000-8000-000000000001";
const profile = {
  userId: id,
  displayName: "Học Viên Thử Nghiệm",
  role: "STUDENT",
  status: "ACTIVE",
  profileVersion: 1,
};
const ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) });

function setup() {
  const fetch = vi.fn((url: string) => {
    if (url.endsWith("/bootstrap")) return Promise.resolve(ok(profile));
    if (url.includes("/me/courses")) {
      return Promise.resolve(
        ok([
          {
            courseId: "10000000-0000-4000-8000-000000000001",
            title: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa truy vấn",
            priceType: "PAID",
          },
        ]),
      );
    }
    if (url.includes("/me/classes")) return Promise.resolve(ok([]));
    if (url.includes("/notifications")) return Promise.resolve(ok({ items: [] }));
    return Promise.resolve(ok({}));
  });

  vi.stubGlobal("fetch", fetch);

  render(
    <SessionProvider>
      <MemoryRouter initialEntries={["/app"]}>
        <Routes>
          <Route element={<StudentGuard />}>
            <Route path="/app" element={<StudentHome />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  );

  return fetch;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Student Marketplace Course Search on StudentHome", () => {
  it("renders search bar, quick action chip, and marketplace courses", async () => {
    setup();

    // Check quick action chip
    await waitFor(() => {
      expect(screen.getByText("🛒 Tìm khóa học để mua")).toBeDefined();
    });

    const marketplaceSection = document.getElementById("marketplace-search");
    expect(marketplaceSection).not.toBeNull();
    const m = within(marketplaceSection!);

    expect(m.getByText("Tìm Kiếm Khóa Học Để Mua & Kích Hoạt Ngay")).toBeDefined();

    // Check search input placeholder
    const searchInput = m.getByPlaceholderText(
      "Tìm kiếm khóa học để mua (ví dụ: Trí tuệ nhân tạo, Web AI, Cơ sở dữ liệu, DevOps, Python...)",
    );
    expect(searchInput).toBeDefined();

    // Check course cards inside marketplace section
    expect(m.getByText("Lập trình Web & Trợ lý AI Fullstack")).toBeDefined();
    expect(m.getByText("Cơ sở dữ liệu Nâng cao & Tối ưu hóa truy vấn")).toBeDefined();

    // Wait for async /me/courses to resolve so owned course has "✓ Đã sở hữu"
    await waitFor(() => {
      expect(m.getByText("✓ Đã sở hữu")).toBeDefined();
    });

    // Unowned paid course uses the shared card-button icon system and links to purchase.
    const buyLinks = m.getAllByRole("link", { name: /Mua ngay/i });
    expect(buyLinks.length).toBeGreaterThan(0);
    const firstBuyLink = buyLinks[0].closest("a");
    expect(firstBuyLink?.getAttribute("href")).toContain("/app/purchase/10000000-0000-4000-8000-000000000002");
  });

  it("filters courses when typing search term", async () => {
    setup();

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Tìm kiếm khóa học để mua/i)).toBeDefined();
    });

    const marketplaceSection = document.getElementById("marketplace-search")!;
    const m = within(marketplaceSection);

    const searchInput = m.getByPlaceholderText(/Tìm kiếm khóa học để mua/i);
    fireEvent.change(searchInput, { target: { value: "DevOps" } });

    // Should only show DevOps course inside marketplace
    expect(m.getByText("DevOps CI/CD Pipeline & Kubernetes Thực chiến")).toBeDefined();
    expect(m.queryByText("Python: Lập trình từ Nền tảng tới Hướng đối tượng")).toBeNull();

    // Clear search
    const clearBtn = m.getByLabelText("Xóa từ khóa tìm kiếm");
    fireEvent.click(clearBtn);

    expect(m.getByText("Python: Lập trình từ Nền tảng tới Hướng đối tượng")).toBeDefined();
  });

  it("filters courses by price category pills", async () => {
    setup();

    await waitFor(() => {
      expect(screen.getByText("💳 Khóa có phí (Mua ngay)")).toBeDefined();
    });

    const marketplaceSection = document.getElementById("marketplace-search")!;
    const m = within(marketplaceSection);

    const paidFilterBtn = m.getByText("💳 Khóa có phí (Mua ngay)");
    fireEvent.click(paidFilterBtn);

    // Paid courses should show in marketplace
    expect(m.getByText("Lập trình Web & Trợ lý AI Fullstack")).toBeDefined();
    // Free course should NOT show in marketplace
    expect(m.queryByText("Python: Lập trình từ Nền tảng tới Hướng đối tượng")).toBeNull();

    // Click free filter
    const freeFilterBtn = m.getByText("🚀 Miễn phí");
    fireEvent.click(freeFilterBtn);

    expect(m.getByText("Python: Lập trình từ Nền tảng tới Hướng đối tượng")).toBeDefined();
    expect(m.queryByText("Lập trình Web & Trợ lý AI Fullstack")).toBeNull();
  });
});
