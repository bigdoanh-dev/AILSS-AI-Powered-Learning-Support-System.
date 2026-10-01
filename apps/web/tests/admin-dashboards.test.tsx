import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import RevenueDashboard from "../src/admin/RevenueDashboard";
import StatsDashboard from "../src/admin/StatsDashboard";
import LogsDashboard from "../src/admin/LogsDashboard";
import SettingsDashboard from "../src/admin/SettingsDashboard";
import { metadata } from "../src/metadata";
vi.mock("../src/auth/session", () => ({
  useSession: () => ({ profile: { userId: "admin-1", role: "ADMIN" } }),
}));
beforeEach(() =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: { code: "SERVICE_UNAVAILABLE" } }),
    })),
  ),
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});
const wrap = (node: React.ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>);
describe("Admin dashboards use authoritative data", () => {
  it("never fabricates finance when its service is unavailable", () => {
    wrap(<RevenueDashboard />);
    expect(screen.getByText("Chưa có báo cáo doanh thu có thẩm quyền")).toBeTruthy();
    expect(screen.queryByText("148.500.000 ₫")).toBeNull();
  });
  it("never fabricates role counts or learning metrics on failure", async () => {
    wrap(<StatsDashboard />);
    await screen.findByRole("button", { name: /Thử lại|Kiểm tra lại/ });
    expect(screen.queryByText("1.240")).toBeNull();
    expect(screen.queryByText(/86% Đạt chuẩn/)).toBeNull();
    expect(screen.queryByText(/94.2%|5.2%|10.2 giờ|3 hồ sơ chờ/)).toBeNull();
  });
  it("displays real system-wide accounts and marks unaggregated learning metrics unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            totalAccounts: 9,
            students: 5,
            lecturers: 2,
            admins: 1,
            suspended: 1,
            aiSessions: null,
            completionRate: null,
            avgScore: null,
            totalLearningHours: null,
            cognitiveLevels: [],
            weekdayEngagement: [],
          },
        }),
      })),
    );
    const { container } = wrap(<StatsDashboard />);
    await waitFor(() => expect(container.querySelectorAll(".kpi-card").length).toBeGreaterThan(0));
    expect(await screen.findByText("Học Viên (Students)")).toBeTruthy();
    expect(screen.getAllByText("Chưa có dữ liệu").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText(/86% Đạt chuẩn/)).toBeNull();
  });
  it("does not invent or export audit logs", () => {
    wrap(<LogsDashboard />);
    expect(screen.getByText("Không có bản ghi phù hợp.")).toBeTruthy();
    expect(screen.queryByText("req_sp_9921827")).toBeNull();
  });
  it("does not load another admin's local settings or claim a server update", () => {
    localStorage.setItem("ailss_admin_system_settings", JSON.stringify({ sessionTimeoutMinutes: 60 }));
    wrap(<SettingsDashboard />);
    expect(screen.getByText("Chưa có dữ liệu cấu hình từ máy chủ.")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Dọn dẹp Cache/ })).toBeNull();
  });
  it("preserves dedicated route metadata", () => {
    expect(metadata("/app/admin/stats")[0]).toBe("Thống kê học tập");
  });
});
