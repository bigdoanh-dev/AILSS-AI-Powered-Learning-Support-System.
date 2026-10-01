import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QuizResults } from "../src/lecturer/GradebookDashboard";
import RevenueDashboard from "../src/lecturer/RevenueDashboard";
import Comments from "../src/lecturer/Comments";
const mocks = vi.hoisted(() => ({
  query: { data: null as unknown, error: null as unknown, pending: false, retry: vi.fn() },
  request: vi.fn(),
}));
vi.mock("../src/lecturer/api", () => ({
  useLecturer: () => mocks.query,
  month: () => "2026-10",
  lecturerRequest: mocks.request,
  lecturerError: () => "Không thể lưu trên máy chủ.",
}));
vi.mock("../src/auth/session", () => ({
  useSession: () => ({ profile: { userId: "lecturer-1", role: "LECTURER" } }),
}));
beforeEach(() => {
  mocks.query.data = null;
  mocks.query.error = null;
  mocks.request.mockReset();
});
afterEach(cleanup);
const wrap = (node: React.ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>);
describe("Lecturer grades and revenue reflect backend state", () => {
  it("renders an authoritative empty revenue report without inventing bank details or payout promises", () => {
    mocks.query.data = {
      lecturer: {
        lecturerId: "lecturer-1",
        grossMinor: "0",
        refundMinor: "0",
        netMinor: "0",
        estimatedPlatformMinor: "0",
        estimatedEarningsMinor: "0",
        orders: 0,
        dailyRevenue: [{ day: "2026-10-01", grossMinor: "0", refundMinor: "0", netMinor: "0" }],
        courses: [],
      },
      completeness: { backfillThrough: "2026-10-01T12:00:00Z" },
    };
    wrap(<RevenueDashboard />);
    expect(screen.getByRole("img", { name: "Biểu đồ doanh thu 1 ngày" })).toBeTruthy();
    expect(screen.getAllByText("0 ₫").length).toBeGreaterThan(0);
    expect(screen.queryByText("NGUYEN VAN A")).toBeNull();
    expect(screen.queryByText("Sẵn sàng chi trả")).toBeNull();
    expect(screen.queryByText("Cố định 15%")).toBeNull();
    expect(screen.queryByText("Đã xác minh")).toBeNull();
  });
  it("does not give an unrated course a five-star score or full rating bar", () => {
    mocks.query.data = { items: [], ratingSummary: { reviewCount: 0, ratingSum: 0, average: 0 } };
    const { container } = render(
      <MemoryRouter initialEntries={["/comments/COURSE/course-1"]}>
        <Routes>
          <Route path="/comments/:resourceType/:resourceId" element={<Comments />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getAllByText("Chưa có đánh giá").length).toBeGreaterThan(0);
    expect(screen.queryByText("5.0")).toBeNull();
    expect(screen.queryByText("★★★★★")).toBeNull();
    expect(container.querySelector('[style*="width: 100%"]')).toBeNull();
  });
  it("does not render sample earnings on a failed revenue request", () => {
    mocks.query.error = new Error();
    wrap(<RevenueDashboard />);
    expect(screen.queryByText(/47.600.000|58.200.000/)).toBeNull();
    expect(screen.getByText("Không thể lưu trên máy chủ.")).toBeTruthy();
  });
  it("starts manual scoring blank and persists only the chosen result with its version", async () => {
    mocks.query.data = {
      items: [
        {
          attemptId: "attempt-1",
          studentId: "student-1",
          score: "0",
          maxScore: "10",
          submittedAt: "2026-10-01T00:00:00Z",
          gradingStatus: "PENDING_MANUAL_GRADING",
          resultVersion: 3,
        },
      ],
    };
    mocks.request.mockResolvedValue({ data: {} });
    wrap(<QuizResults quizId="quiz-1" />);
    expect(screen.getByText("Chờ chấm")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Chấm điểm" }));
    expect((screen.getByLabelText("Điểm") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Điểm"), { target: { value: "7.25" } });
    fireEvent.change(screen.getByLabelText("Nhận xét"), { target: { value: "Nhận xét thật" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu điểm" }));
    await screen.findByText("Đã lưu điểm và nhận xét trên hệ thống.");
    expect(mocks.request).toHaveBeenCalledWith("/quizzes/quiz-1/grades/attempt-1", "POST", {
      score: "7.25",
      feedback: "Nhận xét thật",
      expectedResultVersion: 3,
    });
  });
  it("keeps edits and does not claim a saved grade after API failure", async () => {
    mocks.query.data = {
      items: [
        {
          attemptId: "attempt-1",
          studentId: "student-1",
          score: "0",
          maxScore: "10",
          submittedAt: "2026-10-01T00:00:00Z",
          gradingStatus: "PENDING_MANUAL_GRADING",
        },
      ],
    };
    mocks.request.mockRejectedValue(new Error());
    wrap(<QuizResults quizId="quiz-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Chấm điểm" }));
    fireEvent.change(screen.getByLabelText("Điểm"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu điểm" }));
    await screen.findByText("Không thể lưu trên máy chủ.");
    expect((screen.getByLabelText("Điểm") as HTMLInputElement).value).toBe("8");
    expect(screen.queryByText("Đã lưu điểm và nhận xét trên hệ thống.")).toBeNull();
  });
});
