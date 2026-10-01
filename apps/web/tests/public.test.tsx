import { SessionProvider } from "../src/auth/session";
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Logo } from "../src/components/Logo";
import { Faq } from "../src/components/Faq";
import { Workflow } from "../src/components/Workflow";
import { Architecture } from "../src/components/Architecture";
import { CourseSearch, CourseCard } from "../src/pages/Courses";
import { Auth } from "../src/pages/Support";
import { AiQuiz } from "../src/pages/Platform";
import { normalizeQuery, priceLabel } from "../src/lib/api";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const wrap = (element: React.ReactNode, path = "/") =>
  render(<MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>);
const course = {
  courseId: "12345678-1234-4234-8234-123456789012",
  title: "Cassandra cơ bản",
  slug: "cassandra",
  categoryId: "c",
  lecturerId: "l",
  priceType: "FREE",
  price: "0",
  currency: "VND",
};
describe("public foundation", () => {
  it("exposes canonical home logo with accessible name", () => {
    wrap(<Logo />);
    expect(screen.getByRole("link", { name: "AILSS — Trang chủ" }).getAttribute("href")).toBe("/");
  });
  it("filters FAQs by topic and local search", async () => {
    render(<Faq />);
    await userEvent.selectOptions(screen.getByLabelText("Chủ đề"), "AI");
    expect(screen.getByText("AI có tự xuất bản quiz không?")).toBeTruthy();
    expect(screen.queryByText("AILSS là gì?")).toBeNull();
    await userEvent.type(screen.getByLabelText("Tìm câu hỏi"), "không có kết quả");
    expect(screen.getByRole("status").textContent).toContain("Chưa tìm thấy");
  });
  it("keeps human review and DRAFT in interactive workflow", async () => {
    render(<Workflow />);
    await userEvent.click(screen.getByRole("button", { name: /06 Bài đánh giá nháp/ }));
    expect(screen.getByRole("heading", { name: "Bài đánh giá nháp" })).toBeTruthy();
    expect(screen.getByText(/AI không tự xuất bản quiz/)).toBeTruthy();
  });
  it("shows six business services and support separately", async () => {
    render(<Architecture />);
    expect(screen.getAllByRole("button")).toHaveLength(6);
    await userEvent.click(screen.getByRole("button", { name: /06 AI/ }));
    expect(screen.getByText(/Xử lý tài liệu, tạo quiz/)).toBeTruthy();
    expect(screen.getByText("Notification Worker")).toBeTruthy();
  });
  it("links course records to exact IDs and labels illustration", () => {
    wrap(<CourseCard course={course} />);
    expect(screen.getByRole("link", { name: "Xem khóa học" }).getAttribute("href")).toBe(
      "/courses/" + course.courseId,
    );
    expect(screen.getByRole("img", { name: /Minh họa chủ đề/ })).toBeTruthy();
    expect(priceLabel(course)).toBe("Miễn phí");
  });
  it("normalizes the same leading token supported by backend", () => {
    expect(normalizeQuery(" Cơ sở dữ liệu ")).toBe("co");
    expect(normalizeQuery("Cassandra nâng cao")).toBe("cassandra");
  });
  it("never calls API for an invalid normalized token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], meta: { pagination: { hasMore: false, nextCursor: null } } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    wrap(<CourseSearch />);
    await userEvent.type(screen.getByRole("searchbox"), "ab");
    await userEvent.click(screen.getByRole("button", { name: "Tìm khóa học" }));
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("/courses/search"))).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("3–20");
  });
  it("renders backend course search and next cursor correctly", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/reviews"))
        return {
          ok: true,
          json: async () => ({ data: [], ratingSummary: { reviewCount: 0, averageRating: null } }),
        };
      if (url.includes("/lecturers/"))
        return { ok: true, json: async () => ({ data: { displayName: "Giảng viên" } }) };
      return {
        ok: true,
        json: async () => ({
          data: url.includes("/courses/search") && !url.includes("cursor=") ? [course] : [],
          meta: {
            pagination: {
              hasMore: url.includes("/courses/search") && !url.includes("cursor="),
              nextCursor:
                url.includes("/courses/search") && !url.includes("cursor=") ? "opaque-cursor-12345" : null,
            },
          },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    wrap(<CourseSearch />);
    await userEvent.type(screen.getByRole("searchbox"), "Cassandra");
    await userEvent.click(screen.getByRole("button", { name: "Tìm khóa học" }));
    await screen.findByText(course.title);
    await userEvent.click(screen.getByRole("button", { name: "Xem thêm khóa học" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("cursor=opaque-cursor-12345"))).toBe(
        true,
      ),
    );
  });
  it("shows empty results without seeding fake courses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [], meta: { pagination: { hasMore: false, nextCursor: null } } }),
      }),
    );
    wrap(<CourseSearch />);
    await userEvent.type(screen.getByRole("searchbox"), "test");
    await userEvent.click(screen.getByRole("button", { name: "Tìm khóa học" }));
    expect(await screen.findByText("Chưa tìm thấy khóa học phù hợp.")).toBeTruthy();
  });
  it("renders a degraded API state and retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    wrap(<CourseSearch />);
    await userEvent.type(screen.getByRole("searchbox"), "test");
    await userEvent.click(screen.getByRole("button", { name: "Tìm khóa học" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeTruthy();
  });
  it("auth uses exact registration fields and idempotency header", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async (path) =>
        path.endsWith("bootstrap")
          ? { ok: false, status: 401, json: async () => ({ error: { code: "SESSION_EXPIRED" } }) }
          : { ok: true, json: async () => ({ data: {} }) },
      );
    vi.stubGlobal("fetch", fetchMock);
    wrap(
      <SessionProvider>
        <Auth />
      </SessionProvider>,
      "/auth/register/student",
    );
    fireEvent.change(screen.getByLabelText("Họ và tên"), { target: { value: "Test Student" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "test@example.com" } });
    fireEvent.change(screen.getByLabelText("Mật khẩu"), { target: { value: "Test-password-123" } });
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: "Tạo tài khoản" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [path, init] = fetchMock.mock.calls[1];
    expect(path).toBe("/web-session/register");
    expect(init.headers["Idempotency-Key"]).toBeTruthy();
    expect(Object.keys(JSON.parse(init.body)).sort()).toEqual(["displayName", "email", "password"]);
  });
  it("forgot-password does not invent submission", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    wrap(
      <SessionProvider>
        <Auth />
      </SessionProvider>,
      "/auth/forgot-password",
    );
    expect(screen.getByLabelText("Email đăng ký")).toBeTruthy();
    expect(fetchMock.mock.calls.every(([path]) => path.endsWith("bootstrap"))).toBe(true);
    expect(screen.getByRole("button", { name: "Gửi mã OTP" })).toBeTruthy();
  });
  it("approval demo is reversible and makes no network requests", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    wrap(<AiQuiz />);
    await userEvent.click(screen.getByRole("button", { name: "Phê duyệt minh họa" }));
    expect(screen.getByRole("status").textContent).toContain("Chưa có quiz nào được tạo");
    await userEvent.click(screen.getByRole("button", { name: "Đặt lại minh họa" }));
    expect(screen.getByRole("status").textContent).toContain("đang chờ");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
