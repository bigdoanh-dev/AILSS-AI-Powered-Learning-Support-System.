import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SessionProvider } from "../src/auth/session";
import { StudentGuard } from "../src/student/ui";
import { AiTutorPage } from "../src/student/AiTutor";

const studentId = "00000000-0000-4000-8000-000000000001";
const courseId = "00000000-0000-4000-8000-000000000002";
const lessonId = "00000000-0000-4000-8000-000000000003";
const profile = {
  userId: studentId,
  displayName: "Học viên AILSS",
  emailMasked: "h***@example.test",
  role: "STUDENT" as const,
  status: "ACTIVE",
  lecturerVerified: false,
  profileVersion: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const course = { courseId, title: "Cơ sở dữ liệu phân tán", state: "PUBLISHED" };
const ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) });

function setup(initialEntry = "/app/ai-tutor") {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith("/bootstrap")) return Promise.resolve(ok(profile));
    if (url.endsWith("/student/me/courses")) return Promise.resolve(ok([course]));
    if (url.endsWith("/student/assistant/chat")) {
      const request = JSON.parse(String(init?.body ?? "{}")) as { mode?: string };
      return Promise.resolve(ok(request.mode === "STUDENT_ADVISOR"
        ? {
            conversationId: "00000000-0000-4000-8000-000000000011",
            messageId: "00000000-0000-4000-8000-000000000012",
            content: "Mình sẽ hỏi thêm một chút để hiểu mục tiêu học của bạn.",
            citations: [],
            catalogCourses: [{ courseId, title: course.title, priceAmount: 0, priceCurrency: "VND" }],
          }
        : {
            conversationId: "00000000-0000-4000-8000-000000000021",
            messageId: "00000000-0000-4000-8000-000000000022",
            content: "Phân vùng giúp Cassandra phân phối dữ liệu theo partition key.",
            citations: [{
              sourceId: "lesson-source",
              title: "Phân vùng dữ liệu",
              courseId,
              lessonId,
              courseVersion: 3,
              lessonVersion: 2,
              snippet: "Mỗi partition được xác định bởi partition key.",
            }],
          }));
    }
    return Promise.resolve(ok([]));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <SessionProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route element={<StudentGuard />}>
            <Route path="/app/ai-tutor" element={<AiTutorPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  );
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Web AI Tutor", () => {
  it("runs course advice through the real assistant endpoint and renders catalog matches", async () => {
    const fetchMock = setup();
    expect(await screen.findByRole("heading", { name: "Gia sư AILSS" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mình chưa biết nên chọn khóa học nào" }));

    expect(await screen.findByText("Mình sẽ hỏi thêm một chút để hiểu mục tiêu học của bạn.")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Cơ sở dữ liệu phân tán/ }).getAttribute("href"))
      .toBe(`/courses/${courseId}`);
    await waitFor(() => {
      const chatCall = fetchMock.mock.calls.find(([url]) => url.endsWith("/student/assistant/chat"));
      expect(chatCall).toBeTruthy();
      expect(JSON.parse(String(chatCall?.[1]?.body))).toMatchObject({
        mode: "STUDENT_ADVISOR",
        message: "Mình chưa biết nên chọn khóa học nào",
      });
    });
  });

  it("grounds Study Buddy replies in the selected course and links citations to the lesson", async () => {
    const fetchMock = setup("/app/ai-tutor?mode=STUDY_BUDDY&courseId=" + courseId);
    const selector = await screen.findByRole("combobox", { name: "Khóa học cho AI Tutor" });
    await waitFor(() => expect((selector as HTMLSelectElement).value).toBe(courseId));

    const question = screen.getByRole("textbox", { name: "Nhập câu hỏi cho AI Tutor" });
    fireEvent.change(question, { target: { value: "Giải thích partition key" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi câu hỏi" }));

    expect(await screen.findByText(/Phân vùng giúp Cassandra/)).toBeTruthy();
    expect(screen.getByText("Nguồn 1: Phân vùng dữ liệu")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Mở bài học" }).getAttribute("href"))
      .toBe(`/app/learn/${courseId}/lessons/${lessonId}`);
    await waitFor(() => {
      const chatCall = fetchMock.mock.calls.find(([url]) => url.endsWith("/student/assistant/chat"));
      expect(JSON.parse(String(chatCall?.[1]?.body))).toMatchObject({
        mode: "STUDY_BUDDY",
        courseId,
        message: "Giải thích partition key",
      });
    });
  });
});
