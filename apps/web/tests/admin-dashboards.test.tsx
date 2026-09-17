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
    it("renders financial KPIs, SePay status, and handles actions", () => {
      render(
        <MemoryRouter>
          <RevenueDashboard />
        </MemoryRouter>,
      );

      // Verify title & KPIs
      expect(screen.getByText("Dashboard Doanh Thu & Đối Soát SePay")).toBeTruthy();
      expect(screen.getByText("148.500.000 ₫")).toBeTruthy();
      expect(screen.getByText("426 đơn")).toBeTruthy();
      expect(screen.getByText("99.4%")).toBeTruthy();

      // Test time range switcher
      const todayBtn = screen.getByRole("button", { name: "Hôm nay" });
      fireEvent.click(todayBtn);
      expect(todayBtn.className).toContain("active");

      // Test export CSV
      const exportBtn = screen.getByRole("button", { name: /Xuất báo cáo CSV/ });
      fireEvent.click(exportBtn);
      expect(screen.getByText(/Đã xuất báo cáo đối soát doanh thu/)).toBeTruthy();

      // Test webhook test button
      const testWebhookBtn = screen.getByRole("button", { name: /Kiểm tra kết nối Webhook/ });
      fireEvent.click(testWebhookBtn);
      expect(screen.getByText(/Phản hồi 200 OK/)).toBeTruthy();

      // Test transaction search
      const searchInput = screen.getByLabelText("Tìm kiếm giao dịch");
      fireEvent.change(searchInput, { target: { value: "Trần Thị Mai" } });
      expect(screen.getByText("Trần Thị Mai")).toBeTruthy();
      expect(screen.queryByText("Nguyễn Văn Hùng")).toBeNull();

      // Test Payout Reconciliation Queue & Action
      expect(screen.getByText("Hàng Đợi Quyết Toán & Đối Soát Giảng Viên (Payout Reconciliation)")).toBeTruthy();
      expect(screen.getByText("po-101")).toBeTruthy();
      const reconcileBtn = screen.getByRole("button", { name: "Khớp lệnh đối soát" });
      fireEvent.click(reconcileBtn);
      expect(screen.getByText(/Đã hoàn tất đối soát lệnh quyết toán po-101/)).toBeTruthy();

      // Test Finance Policy Panel (Vietnamese 7-day / <20% completion rule)
      expect(screen.getByText("Chính Sách Hoàn Tiền & An Toàn Tài Chính (Finance Policy)")).toBeTruthy();
      expect(screen.getByText("7 ngày kể từ ngày mua")).toBeTruthy();
      expect(screen.getByText("Dưới 20% khóa học")).toBeTruthy();
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
    it("renders audit logs, filters by category, and expands JSON payload", () => {
      render(
        <MemoryRouter>
          <LogsDashboard />
        </MemoryRouter>,
      );

      // Verify header
      expect(screen.getByText(/Nhật Ký Hệ Thống & Kiểm Toán An Ninh/)).toBeTruthy();

      // Verify initial log entries
      expect(screen.getByText("req_sp_9921827")).toBeTruthy();
      expect(screen.getByText("req_auth_104821")).toBeTruthy();

      // Filter by category: "Thương mại & SePay"
      const commerceBtn = screen.getByRole("button", { name: "Thương mại & SePay" });
      fireEvent.click(commerceBtn);
      expect(screen.getByText("req_sp_9921827")).toBeTruthy();
      expect(screen.queryByText("req_auth_104821")).toBeNull();

      // Search by keyword
      const searchInput = screen.getByLabelText("Tìm kiếm nhật ký");
      fireEvent.change(searchInput, { target: { value: "ORD-2026-0902" } });
      expect(screen.getByText("req_rec_440192")).toBeTruthy();

      // Expand details
      const detailBtn = screen.getByLabelText("Xem chi tiết req_rec_440192");
      fireEvent.click(detailBtn);
      expect(screen.getByText(/Cấu Trúc Dữ Liệu Payload/)).toBeTruthy();
      expect(screen.getByText(/INVALID_TRANSFER_SYNTAX/)).toBeTruthy();

      // Close details
      const closeBtn = screen.getByRole("button", { name: "✕ Đóng" });
      fireEvent.click(closeBtn);
      expect(screen.queryByText(/Cấu Trúc Dữ Liệu Payload/)).toBeNull();
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
