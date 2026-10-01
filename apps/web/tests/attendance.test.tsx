import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Attendance } from "../src/lecturer/Classroom";
const mocks = vi.hoisted(() => ({
  query: { data: null as unknown, error: null as unknown, pending: false, retry: vi.fn() },
  request: vi.fn(),
}));
vi.mock("../src/lecturer/api", () => ({
  useLecturer: () => mocks.query,
  lecturerRequest: mocks.request,
  lecturerError: () => "Dịch vụ không khả dụng.",
}));
beforeEach(() => {
  mocks.query.data = [];
  mocks.query.error = null;
  mocks.request.mockReset();
});
afterEach(cleanup);
function setup() {
  render(
    <MemoryRouter initialEntries={["/sessions/session-1"]}>
      <Routes>
        <Route path="/sessions/:sessionId" element={<Attendance />} />
      </Routes>
    </MemoryRouter>,
  );
}
describe("Attendance data integrity", () => {
  it("shows an empty roster without sample students", () => {
    setup();
    expect(screen.getByText(/Chưa có học viên để điểm danh/)).toBeTruthy();
    expect(screen.queryByText(/Lê Văn Đức|10 SV/)).toBeNull();
  });
  it("shows service error instead of falling back to a sample roster", () => {
    mocks.query.error = new Error();
    setup();
    expect(screen.getByText("Dịch vụ không khả dụng.")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
  it("persists a real row with its version and never claims success on failure", async () => {
    mocks.query.data = [{ studentId: "student-1", attendanceStatus: "ABSENT", attendanceVersion: 4 }];
    mocks.request.mockRejectedValue(new Error());
    setup();
    fireEvent.change(screen.getByLabelText("Điểm danh student-1"), { target: { value: "PRESENT" } });
    expect(await screen.findByText("Dịch vụ không khả dụng.")).toBeTruthy();
    expect(mocks.request).toHaveBeenCalledWith(
      "/class-sessions/session-1/attendance/student-1",
      "PUT",
      { attendanceStatus: "PRESENT" },
      { "If-Match": '"v4"' },
    );
    expect(screen.queryByText("Đã lưu điểm danh.")).toBeNull();
  });
});
