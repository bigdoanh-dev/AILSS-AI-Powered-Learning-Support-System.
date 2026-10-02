import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LecturerReportsDashboard from "../src/lecturer/LecturerReportsDashboard";
import { lecturerRequest } from "../src/lecturer/api";

vi.mock("../src/lecturer/api", () => ({
  lecturerRequest: vi.fn(),
  lecturerError: () => "Lỗi API",
  useLecturer: () => ({ data: { items: [] } }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("lecturer report screen", () => {
  it("reads backend classes and updates totals when a class is selected", async () => {
    vi.mocked(lecturerRequest).mockImplementation(async (path) => {
      if (path === "/me/owned-classes")
        return {
          data: [
            { classId: "class-1", name: "Lớp A", state: "ACTIVE" },
            { classId: "class-2", name: "Lớp B", state: "ACTIVE" },
          ],
        } as never;
      if (path === "/classes/class-1/members")
        return { data: [{ studentId: "student-1", state: "ACTIVE" }] } as never;
      if (path === "/classes/class-2/members")
        return {
          data: [
            { studentId: "student-2", state: "ACTIVE" },
            { studentId: "student-3", state: "ACTIVE" },
          ],
        } as never;
      if (path.includes("/sessions?") || path.includes("/quizzes")) return { data: [] } as never;
      throw new Error(`Unexpected request: ${path}`);
    });
    render(
      <MemoryRouter>
        <LecturerReportsDashboard />
      </MemoryRouter>,
    );
    await screen.findByText("Đã tải từ máy chủ", { exact: false });
    const card = screen.getByText("Lượt ghi danh đang học").parentElement!;
    expect(card.textContent).toContain("3");
    fireEvent.change(screen.getByLabelText("Lớp học phần"), { target: { value: "class-1" } });
    expect(card.textContent).toContain("1");
    expect(card.textContent).not.toContain("3");
    expect(vi.mocked(lecturerRequest).mock.calls.some(([path]) => path === "/classes/class-1/members")).toBe(
      true,
    );
  });
});
