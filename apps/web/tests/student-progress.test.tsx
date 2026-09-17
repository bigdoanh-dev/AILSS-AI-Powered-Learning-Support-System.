import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SessionProvider } from "../src/auth/session";
import ProgressDashboard from "../src/student/ProgressDashboard";

const profile = {
  userId: "00000000-0000-4000-8000-000000000001",
  displayName: "Student Demo",
  role: "STUDENT",
  status: "ACTIVE",
  profileVersion: 1,
};

describe("Student ProgressDashboard pagination and UI", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders 6 courses on page 1 and paginates to page 2", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.endsWith("/bootstrap")) {
          return Promise.resolve({ ok: true, json: async () => ({ data: profile }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
      }),
    );

    render(
      <SessionProvider>
        <MemoryRouter>
          <ProgressDashboard />
        </MemoryRouter>
      </SessionProvider>
    );

    // Wait for courses to be rendered
    await waitFor(() => {
      expect(screen.getByText("Cơ sở dữ liệu Nâng cao & Tối ưu hóa")).toBeDefined();
    });

    expect(screen.getByText("Lập trình Web & Trợ lý AI Fullstack")).toBeDefined();
    expect(screen.getByText("Kiểm thử Phần mềm & CI/CD DevOps")).toBeDefined();
    expect(screen.getByText("Cấu trúc Dữ liệu & Giải thuật Ứng dụng")).toBeDefined();
    expect(screen.getByText("Trí tuệ Nhân tạo & Xử lý Ngôn ngữ Tự nhiên")).toBeDefined();
    expect(screen.getByText("Kiến trúc Hệ thống Phân tán & Microservices")).toBeDefined();

    // 7th course should NOT be on page 1
    expect(screen.queryByText("Bảo mật Ứng dụng Web & An toàn Thông tin")).toBeNull();

    // Pagination info should show 1 - 6 of 12
    expect(screen.getByText(/Hiển thị/)).toBeDefined();
    expect(screen.getByText("Trang 1")).toBeDefined();
    const page2Btn = screen.getByText("Trang 2");
    expect(page2Btn).toBeDefined();

    // Click to Page 2
    fireEvent.click(page2Btn);

    // Now page 2 courses should be visible
    expect(screen.getByText("Bảo mật Ứng dụng Web & An toàn Thông tin")).toBeDefined();
    expect(screen.getByText("Phát triển Ứng dụng Di động Đa nền tảng")).toBeDefined();
    expect(screen.getByText("Python Chuyên Sâu & Phân Tích Dữ Liệu Lớn")).toBeDefined();
    expect(screen.getByText("Điện Toán Đám Mây & Kiến Trúc Serverless AWS")).toBeDefined();

    // Page 1 courses should no longer be visible
    expect(screen.queryByText("Cơ sở dữ liệu Nâng cao & Tối ưu hóa")).toBeNull();
  });

  it("filters courses and resets pagination to page 1", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.endsWith("/bootstrap")) {
          return Promise.resolve({ ok: true, json: async () => ({ data: profile }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
      }),
    );

    render(
      <SessionProvider>
        <MemoryRouter>
          <ProgressDashboard />
        </MemoryRouter>
      </SessionProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Cơ sở dữ liệu Nâng cao & Tối ưu hóa")).toBeDefined();
    });

    // Click "Đã xong" filter
    const doneFilterBtn = screen.getByText("Đã xong");
    fireEvent.click(doneFilterBtn);

    // Completed courses should appear
    expect(screen.getByText("Phát triển Ứng dụng Di động Đa nền tảng")).toBeDefined();
    expect(screen.getByText("Quản Trị Cơ Sở Dữ Liệu Doanh Nghiệp (PostgreSQL & Oracle)")).toBeDefined();
    expect(screen.queryByText("Cơ sở dữ liệu Nâng cao & Tối ưu hóa")).toBeNull();
  });

  it("renders animated progress bars with shimmer highlight effect for courses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.endsWith("/bootstrap")) {
          return Promise.resolve({ ok: true, json: async () => ({ data: profile }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
      }),
    );

    const { container } = render(
      <SessionProvider>
        <MemoryRouter>
          <ProgressDashboard />
        </MemoryRouter>
      </SessionProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Cơ sở dữ liệu Nâng cao & Tối ưu hóa")).toBeDefined();
    });

    const progressTracks = container.querySelectorAll(".animated-progress-track");
    expect(progressTracks.length).toBeGreaterThan(0);

    const progressFills = container.querySelectorAll(".animated-progress-fill");
    expect(progressFills.length).toBeGreaterThan(0);

    const shimmers = container.querySelectorAll(".progress-shimmer-highlight");
    expect(shimmers.length).toBeGreaterThan(0);
  });

  it("renders Adaptive Path action, Prerequisite Gaps, and opens Version Diff modal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.endsWith("/bootstrap")) {
          return Promise.resolve({ ok: true, json: async () => ({ data: profile }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
      }),
    );

    render(
      <SessionProvider>
        <MemoryRouter>
          <ProgressDashboard />
        </MemoryRouter>
      </SessionProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Kế Hoạch Thích Ứng Tiếp Theo")).toBeDefined();
    });

    // Verify Adaptive Path action and canonical policy thresholds
    expect(screen.getByText("REVIEW")).toBeDefined();
    expect(screen.getByText("Cảnh Báo Lỗ Hổng Kiến Thức Tiền Đề")).toBeDefined();
    expect(screen.getByText("BẮT BUỘC (42 / 70)")).toBeDefined();
    expect(screen.getByText("KHUYẾN NGHỊ (48 / 50)")).toBeDefined();

    // Verify explainable recommendations
    expect(screen.getByText("Gợi Ý Khóa Học Cá Nhân Hóa (Explainable Recommender)")).toBeDefined();
    expect(screen.getByText("✓ ĐỦ ĐIỀU KIỆN TIỀN ĐỀ")).toBeDefined();
    expect(screen.getByText("⚠ CẢNH BÁO TIỀN ĐỀ (-15 ĐIỂM)")).toBeDefined();

    // Open Diff Modal for first course
    const diffButtons = screen.getAllByText("So sánh (Diff)");
    expect(diffButtons.length).toBeGreaterThan(0);
    fireEvent.click(diffButtons[0]);

    // Check Diff Modal contents
    expect(screen.getByText("So Sánh Phiên Bản Khóa Học")).toBeDefined();
    expect(screen.getByText("Phiên bản v2.0.0 (Live)")).toBeDefined();

    // Close Diff Modal
    const closeBtn = screen.getByLabelText("Đóng");
    fireEvent.click(closeBtn);
    expect(screen.queryByText("So Sánh Phiên Bản Khóa Học")).toBeNull();
  });
});


