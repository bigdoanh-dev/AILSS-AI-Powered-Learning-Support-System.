import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import RevenueDashboard from "../src/admin/RevenueDashboard";
import StatsDashboard from "../src/admin/StatsDashboard";
import LogsDashboard from "../src/admin/LogsDashboard";
import SettingsDashboard from "../src/admin/SettingsDashboard";
import { metadata } from "../src/metadata";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Admin Dedicated Dashboards on Web", () => {
  describe("RevenueDashboard", () => {
    it("fails closed instead of presenting fabricated financial data", () => {
      render(
        <MemoryRouter>
          <RevenueDashboard />
        </MemoryRouter>,
      );

      expect(screen.getByText("Dashboard Doanh Thu & Đối Soát SePay")).toBeTruthy();
      expect(screen.getByText("Chưa có báo cáo doanh thu có thẩm quyền")).toBeTruthy();
      expect(screen.getByText(/không dùng KPI, giao dịch hoặc số liệu dự phòng giả/)).toBeTruthy();
      expect(screen.queryByText("148.500.000 ₫")).toBeNull();

      const todayBtn = screen.getByRole("button", { name: "Hôm nay" });
      fireEvent.click(todayBtn);
      expect(todayBtn.className).toContain("active");
      expect(screen.getByRole("button", { name: /Đang kiểm tra|Kiểm tra lại/ })).toBeTruthy();
    });
  });

  describe("StatsDashboard", () => {
    it("renders user role breakdown, Bloom cognitive taxonomy, and weekly engagement", () => {
      render(
        <MemoryRouter>
          <StatsDashboard />
        </MemoryRouter>,
      );

      // Verify header and user counts
      expect(screen.getByText("Dashboard Người Dùng & Năng Lực Học Tập AI")).toBeTruthy();
      expect(screen.getByText("1.240")).toBeTruthy();
      expect(screen.getByText("Học Viên (Students)")).toBeTruthy();
      expect(screen.getByText("48")).toBeTruthy();
      expect(screen.getByText("Giảng Viên (Lecturers)")).toBeTruthy();

      // Verify Bloom's Taxonomy presence
      expect(screen.getByText(/Nhận biết \(Remember \/ Recognition\)/)).toBeTruthy();
      expect(screen.getByText(/86% Đạt chuẩn/)).toBeTruthy();
      expect(screen.getByText(/Sáng tạo \(Create \/ Architecture\)/)).toBeTruthy();

      // Verify weekday engagement
      expect(screen.getByText("Thứ 2")).toBeTruthy();
      expect(screen.getByText("Chủ nhật")).toBeTruthy();
    });
  });

  describe("LogsDashboard", () => {
    it("does not present or export fabricated audit evidence", () => {
      render(
        <MemoryRouter>
          <LogsDashboard />
        </MemoryRouter>,
      );

      expect(screen.getByText(/Nhật Ký Hệ Thống & Kiểm Toán An Ninh/)).toBeTruthy();
      expect(screen.getByText("Không có bản ghi phù hợp.")).toBeTruthy();
      expect(screen.queryByText("req_sp_9921827")).toBeNull();
      expect(screen.queryByText("ISO 27001")).toBeNull();
      expect(screen.getByText("Chưa xác minh")).toBeTruthy();
    });
  });

  describe("SettingsDashboard", () => {
    it("manages session security policies and clears cache", () => {
      render(
        <MemoryRouter>
          <SettingsDashboard />
        </MemoryRouter>,
      );

      // Verify header
      expect(screen.getByText("Cài Đặt Hệ Thống & Quản Trị Bảo Mật")).toBeTruthy();

      // Check default toggle state
      const coldStartToggle = screen.getByLabelText(/Yêu cầu đăng nhập lại khi đóng trình duyệt/) as HTMLInputElement;
      expect(coldStartToggle.checked).toBe(true);

      // Toggle cold start
      fireEvent.click(coldStartToggle);
      expect(coldStartToggle.checked).toBe(false);
      expect(screen.getByText("Đã lưu các thay đổi cấu hình thành công!")).toBeTruthy();

      // Change timeout select
      const timeoutSelect = screen.getByLabelText("Thời gian nhàn rỗi tự động đăng xuất") as HTMLSelectElement;
      fireEvent.change(timeoutSelect, { target: { value: "60" } });
      expect(timeoutSelect.value).toBe("60");

      // Clear cache
      const clearCacheButtons = screen.getAllByRole("button", { name: /Dọn dẹp Cache|Xóa toàn bộ bộ nhớ đệm/ });
      fireEvent.click(clearCacheButtons[0]);
      expect(screen.getByText(/Đã dọn dẹp bộ nhớ đệm/)).toBeTruthy();
    });
  });

  describe("metadata routing verification", () => {
    it("returns correct page title and description for dedicated dashboards", () => {
      expect(metadata("/app/admin/revenue")[0]).toBe("Doanh thu & SePay");
      expect(metadata("/app/admin/stats")[0]).toBe("Thống kê học tập");
      expect(metadata("/app/admin/logs")[0]).toBe("Nhật ký & Kiểm toán");
      expect(metadata("/app/admin/settings")[0]).toBe("Cài đặt hệ thống");
    });
  });
});
