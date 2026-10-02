import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SessionProvider } from "../src/auth/session";
import { LearningRadar } from "../src/components/LearningRadar";
import { StudentLearningRadar } from "../src/student/LearningRadarPanel";
import { LecturerLearningRadar } from "../src/lecturer/LearningRadarPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) });
const courseA = "00000000-0000-4000-8000-000000000001",
  courseB = "00000000-0000-4000-8000-000000000002";
const profile = {
  userId: courseA,
  displayName: "Học viên",
  role: "STUDENT",
  status: "ACTIVE",
  profileVersion: 1,
};
const courses = [
  { courseId: courseA, title: "SQL căn bản" },
  { courseId: courseB, title: "Python căn bản" },
];
const axes = [
  { id: "a", label: "Truy vấn SQL", score: 80, evidenceCount: 2, confidence: 90 },
  { id: "b", label: "Mô hình dữ liệu", score: null, evidenceCount: 0, confidence: null },
  { id: "c", label: "Thiết kế bảng", score: 0, evidenceCount: 1, confidence: 30 },
];
describe("Learning radar interaction and authoritative data", () => {
  it("opens a course summary without choosing a student and clears values when switching courses", async () => {
    const fetcher = vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith("/bootstrap")
          ? ok({ ...profile, role: "LECTURER", lecturerVerified: true })
          : url.endsWith("/mastery-summary")
            ? ok({
                studentCount: 5,
                assessedStudentCount: url.includes(courseA) ? 2 : 0,
                records: url.includes(courseA)
                  ? [
                      {
                        conceptId: "lesson:a",
                        masteryScore: 75,
                        masteryState: "AGGREGATED",
                        evidenceCount: 4,
                        assessedStudentCount: 2,
                      },
                    ]
                  : [],
              })
            : url.endsWith("/lessons")
              ? ok(
                  ["a", "b", "c"].map((lessonId) => ({ lessonId, title: `Bài ${lessonId}`, state: "READY" })),
                )
              : ok([]),
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const view = (courseId: string) => (
      <SessionProvider>
        <MemoryRouter>
          <LecturerLearningRadar courseId={courseId} />
        </MemoryRouter>
      </SessionProvider>
    );
    const { rerender } = render(view(courseA));
    expect(await screen.findByText("75%")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Tổng quan năng lực khóa học" })).toBeTruthy();
    expect(screen.queryByLabelText("Học viên xem năng lực")).toBeNull();
    expect(fetcher.mock.calls.some(([url]) => url.includes("/roster") || url.includes("/students/"))).toBe(
      false,
    );
    fireEvent.click(screen.getByRole("button", { name: /Bài a/ }));
    expect(screen.getByRole("status").textContent).toContain("2/5 học viên đã đánh giá");
    rerender(view(courseB));
    expect(screen.queryByText("75%")).toBeNull();
    expect(await screen.findByText(/Chưa có kết quả đánh giá/)).toBeTruthy();
  });
  it("shows unknown separately from zero and exposes evidence when selected", () => {
    const { container } = render(<LearningRadar axes={axes} />);
    expect(screen.getByText("Chưa đánh giá")).toBeTruthy();
    expect(screen.getByText("0%")).toBeTruthy();
    expect(container.querySelector(".learning-radar-area")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Truy vấn SQL/ }));
    expect(screen.getByRole("status").textContent).toContain("2 bằng chứng học tập");
    expect(screen.getByRole("status").textContent).toContain("Độ tin cậy 90%");
  });
  it("switches courses without retaining another course's scores", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          url.endsWith("/bootstrap")
            ? ok(profile)
            : url.includes("/mastery/")
              ? ok(
                  url.endsWith(courseA)
                    ? [
                        {
                          conceptId: "lesson:a",
                          masteryScore: 80,
                          masteryState: "PROFICIENT",
                          evidenceCount: 2,
                        },
                      ]
                    : [],
                )
              : url.endsWith("/lessons")
                ? ok([
                    ...["a", "b", "c"].map((lessonId) => ({
                      lessonId,
                      title: `Bài ${lessonId}`,
                      state: "READY",
                    })),
                  ])
                : ok([]),
        ),
      ),
    );
    render(
      <SessionProvider>
        <MemoryRouter>
          <StudentLearningRadar courses={courses} />
        </MemoryRouter>
      </SessionProvider>,
    );
    expect(await screen.findByText("80%")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Khóa học xem năng lực"), { target: { value: courseB } });
    expect(screen.queryByText("80%")).toBeNull();
    expect(await screen.findByText(/Chưa có kết quả đánh giá/)).toBeTruthy();
    expect(screen.getAllByText("Chưa đánh giá")).toHaveLength(3);
  });
  it("keeps failed lecturer roster requests as errors with no invented students or chart", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          url.endsWith("/bootstrap")
            ? ok({ ...profile, role: "LECTURER", lecturerVerified: true })
            : { ok: false, status: 403, json: async () => ({ error: { code: "COURSE_ROSTER_FORBIDDEN" } }) },
        ),
      ),
    );
    render(
      <SessionProvider>
        <MemoryRouter>
          <LecturerLearningRadar courseId={courseA} />
        </MemoryRouter>
      </SessionProvider>,
    );
    expect(await screen.findByText("Bạn không có quyền thực hiện thao tác này.")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByLabelText("Học viên xem năng lực")).toBeNull();
  });
});
