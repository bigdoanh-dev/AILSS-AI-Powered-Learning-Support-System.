import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { Attendance } from "../src/lecturer/Classroom";

const mocks = vi.hoisted(() => ({ query: vi.fn(), retry: vi.fn() }));
vi.mock("../src/lecturer/api", () => ({
  useLecturer: mocks.query,
  lecturerRequest: vi.fn(),
  lecturerError: vi.fn(),
  month: vi.fn(),
  range: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Attendance session mode", () => {
  it.each(["ONLINE", "OFFLINE"])(
    "loads the session even with a class query parameter and explains %s attendance",
    (mode) => {
      mocks.query.mockImplementation((path: string) => ({
        data: path === "/class-sessions/session-1" ? { classId: "class-1", mode } : [],
        pending: false,
        retry: mocks.retry,
      }));
      render(
        <MemoryRouter initialEntries={["/sessions/session-1/attendance?class=class-1"]}>
          <Routes>
            <Route path="/sessions/:sessionId/attendance" element={<Attendance />} />
          </Routes>
        </MemoryRouter>,
      );
      expect(mocks.query).toHaveBeenCalledWith("/class-sessions/session-1");
      expect(screen.getByText(mode === "ONLINE" ? /Buổi học trực tuyến/ : /Buổi học trực tiếp/)).toBeTruthy();
      expect(
        screen.getByText(mode === "ONLINE" ? /Điểm danh tự động & thủ công/ : /Điểm danh trực tiếp tại lớp/),
      ).toBeTruthy();
    },
  );
});
