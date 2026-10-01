import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SessionProvider } from "../src/auth/session";
import ProgressDashboard from "../src/student/ProgressDashboard";
const profile = {
  userId: "00000000-0000-4000-8000-000000000001",
  displayName: "New student",
  role: "STUDENT",
  status: "ACTIVE",
  profileVersion: 1,
};
const ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) });
function setup(courses: unknown[] = [], fail = false) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith("/bootstrap")
          ? ok(profile)
          : url.includes("/progress")
            ? fail
              ? { ok: false, status: 503, json: async () => ({ error: { code: "SERVICE_UNAVAILABLE" } }) }
              : ok({ percent: 37.5, completedCount: 3, publishedTotal: 8, completed: false })
            : url.endsWith("/me/courses")
              ? ok(courses)
              : ok([]),
      ),
    ),
  );
  return render(
    <SessionProvider>
      <MemoryRouter>
        <ProgressDashboard />
      </MemoryRouter>
    </SessionProvider>,
  );
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("Personal progress from authoritative data", () => {
  it("shows zero and no sample courses for a new student", async () => {
    const { container } = setup();
    await screen.findByText("Bạn chưa đăng ký khóa học nào.");
    await waitFor(() =>
      expect([...container.querySelectorAll(".kpi-value")].map((e) => e.textContent)).toEqual([
        "0",
        "0",
        "0",
      ]),
    );
    expect(screen.queryByText(/Cơ sở dữ liệu Nâng cao/)).toBeNull();
    expect(screen.queryByText(/68%|8.6|REVIEW/)).toBeNull();
  });
  it("keeps backend percent and supports search on actual owned courses", async () => {
    setup([{ courseId: profile.userId, title: "Owned course", state: "PUBLISHED" }]);
    expect(await screen.findByRole("progressbar")).toHaveProperty("value", 37.5);
    expect(screen.getByText("3 / 8 bài hoàn thành")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Tìm khóa học"), { target: { value: "not owned" } });
    expect(screen.getByText("Không có khóa học phù hợp.")).toBeTruthy();
    expect(screen.queryByText("Owned course")).toBeNull();
  });
  it("does not replace a progress failure with invented scores", async () => {
    setup([{ courseId: profile.userId, title: "Owned course" }], true);
    await screen.findAllByText(/Dịch vụ tạm thời không khả dụng/);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText(/68%/)).toBeNull();
  });
});
