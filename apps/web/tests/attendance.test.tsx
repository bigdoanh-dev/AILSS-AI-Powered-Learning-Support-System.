import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Attendance } from "../src/lecturer/Classroom";

// Mock lecturer api to simulate server error or empty state
vi.mock("../src/lecturer/api", () => ({
  useLecturer: () => ({
    data: null,
    error: new Error("HTTP 409 Conflict: Session not initialized"),
    pending: false,
    retry: vi.fn(),
  }),
  lecturerRequest: vi.fn().mockResolvedValue({ ok: true }),
}));

afterEach(() => {
  cleanup();
});

describe("Attendance Component with Demo Data Fallback", () => {
  function renderAttendance() {
    return render(
      <MemoryRouter initialEntries={["/app/teaching/sessions/ses-123/attendance?classId=cls-101"]}>
        <Routes>
          <Route path="/app/teaching/sessions/:sessionId/attendance" element={<Attendance />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("renders demo fallback banner, KPI cards, and default 10 students", () => {
    renderAttendance();

    // Verify demo banner
    expect(screen.getByText(/Đang hiển thị dữ liệu điểm danh mẫu/)).toBeTruthy();

    // Verify KPI cards
    expect(screen.getByText("Tổng sĩ số lớp")).toBeTruthy();
    expect(screen.getByText(/10 SV/)).toBeTruthy();
    expect(screen.getByText("Có mặt tham gia")).toBeTruthy();
    expect(screen.getByText(/8 SV \(80%\)/)).toBeTruthy();

    // Verify students are listed
    expect(screen.getByText("Lê Văn Đức")).toBeTruthy();
    expect(screen.getByText(/SV-202601/)).toBeTruthy();
    expect(screen.getByText("Đặng Thùy Linh")).toBeTruthy();
    expect(screen.getByText(/SV-202610/)).toBeTruthy();
  });

  it("filters students by search query", () => {
    renderAttendance();

    const searchInput = screen.getByPlaceholderText("Tìm theo tên học viên hoặc mã SV...");
    fireEvent.change(searchInput, { target: { value: "Bùi Quốc Hưng" } });

    expect(screen.getByText("Bùi Quốc Hưng")).toBeTruthy();
    expect(screen.queryByText("Lê Văn Đức")).toBeNull();
  });

  it("filters students by status buttons", () => {
    renderAttendance();

    const excusedFilterBtn = screen.getByRole("button", { name: /Có phép \(1\)/ });
    fireEvent.click(excusedFilterBtn);

    // Đỗ Thị Bảo Ngọc is excused in demo data
    expect(screen.getByText("Đỗ Thị Bảo Ngọc")).toBeTruthy();
    expect(screen.queryByText("Lê Văn Đức")).toBeNull();
  });

  it("marks all students as present when clicking batch action", () => {
    renderAttendance();

    const markAllBtn = screen.getByRole("button", { name: /Điểm danh tất cả Có mặt/ });
    fireEvent.click(markAllBtn);

    // After batch mark, rate should become 100%
    expect(screen.getByText(/10 SV \(100%\)/)).toBeTruthy();
    expect(screen.getByText(/Đã đánh dấu TẤT CẢ học viên CÓ MẶT/)).toBeTruthy();
  });

  it("allows toggling a single student's attendance status", () => {
    renderAttendance();

    // Find student Lê Văn Đức's row and mark as Absent
    const absentButtons = screen.getAllByRole("button", { name: /Vắng/i });
    // Pick the button in the table row
    const rowAbsentBtn = absentButtons.find(btn => btn.classList.contains("btn-attendance-absent"));
    expect(rowAbsentBtn).toBeTruthy();
    if (rowAbsentBtn) {
      fireEvent.click(rowAbsentBtn);
      expect(screen.getByText(/Đã ghi nhận Lê Văn Đức: Vắng/)).toBeTruthy();
    }
  });

  it("handles CSV export and data reset", () => {
    renderAttendance();

    // Test CSV Export
    const exportBtn = screen.getByRole("button", { name: /Xuất CSV/ });
    fireEvent.click(exportBtn);
    expect(screen.getByText(/Đã xuất file CSV danh sách điểm danh thành công/)).toBeTruthy();

    // Test Reset Data
    const resetBtn = screen.getByRole("button", { name: /Đặt lại/ });
    fireEvent.click(resetBtn);
    expect(screen.getByText(/Đã khôi phục danh sách điểm danh mẫu ban đầu/)).toBeTruthy();
  });
});
