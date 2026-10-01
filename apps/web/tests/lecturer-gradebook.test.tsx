import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import GradebookDashboard from "../src/lecturer/GradebookDashboard";
const mocks = vi.hoisted(() => ({ queries: new Map<string, unknown>(), useLecturer: vi.fn() }));
vi.mock("../src/lecturer/api", () => ({
  useLecturer: mocks.useLecturer,
  month: () => "2026-10",
  lecturerRequest: vi.fn(),
  lecturerError: () => "Không thể tải dữ liệu.",
}));
afterEach(cleanup);
beforeEach(() => {
  mocks.queries.clear();
  mocks.useLecturer.mockReset();
  mocks.useLecturer.mockImplementation((path: string | null) => ({
    data: path ? mocks.queries.get(path) : undefined,
    pending: false,
    error: null,
    retry: vi.fn(),
  }));
  mocks.queries.set("/me/owned-courses", [{ courseId: "draft-1", title: "Khóa học mới", state: "DRAFT" }]);
  mocks.queries.set("/me/owned-classes", [{ classId: "class-1", name: "Lớp A" }]);
});
const open = () =>
  render(
    <MemoryRouter>
      <GradebookDashboard />
    </MemoryRouter>,
  );
describe("Lecturer gradebook target selection", () => {
  it("labels a draft course and displays a verified empty quiz list without an error or invented grades", () => {
    mocks.queries.set("/targets/COURSE/draft-1/quizzes", []);
    open();
    expect(screen.getByRole("option", { name: "Khóa học mới — Bản nháp" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Khóa học hoặc lớp"), { target: { value: "COURSE/draft-1" } });
    expect(mocks.useLecturer).toHaveBeenCalledWith("/targets/COURSE/draft-1/quizzes");
    expect(screen.getByText("Chưa có bài kiểm tra cho mục đã chọn.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });
  it("loads draft course results and clears the previous quiz when changing to a class", () => {
    mocks.queries.set("/targets/COURSE/draft-1/quizzes", [{ quizId: "quiz-1", title: "Bài kiểm tra 1" }]);
    mocks.queries.set("/quizzes/quiz-1/results?month=2026-10&limit=50", { items: [] });
    mocks.queries.set("/targets/CLASS/class-1/quizzes", []);
    open();
    fireEvent.change(screen.getByLabelText("Khóa học hoặc lớp"), { target: { value: "COURSE/draft-1" } });
    fireEvent.change(screen.getByLabelText("Bài kiểm tra"), { target: { value: "quiz-1" } });
    expect(screen.getByText("Chưa có bài nộp trong tháng này.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Khóa học hoặc lớp"), { target: { value: "CLASS/class-1" } });
    expect(screen.getByText("Chưa có bài kiểm tra cho mục đã chọn.")).toBeTruthy();
    expect(screen.queryByLabelText("Tháng nộp bài")).toBeNull();
    expect(screen.queryByText("Chưa có bài nộp trong tháng này.")).toBeNull();
  });
});
