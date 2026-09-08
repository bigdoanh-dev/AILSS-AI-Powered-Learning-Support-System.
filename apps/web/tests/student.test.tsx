import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { SessionProvider, useSession, safeReturnTo } from "../src/auth/session";
import { ProgressView, StudentGuard } from "../src/student/ui";
import { logicalCommand, useStudent, type Progress } from "../src/student/api";
import { QuizDetail, ResultPage } from "../src/student/Assessment";
import Notifications from "../src/student/Notifications";
import Discussion from "../src/student/Discussion";
const id = "00000000-0000-4000-8000-000000000001";
const profile = { userId: id, displayName: "Student", role: "STUDENT", status: "ACTIVE", profileVersion: 1 };
const ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) });
function setup(
  component: React.ReactNode,
  path = "/app/assessments/" + id,
  role = "STUDENT",
  handler: (path: string, init: RequestInit) => unknown = () => ok({}),
) {
  const fetch = vi.fn((url: string, init: RequestInit) =>
    Promise.resolve(url.endsWith("/bootstrap") ? ok({ ...profile, role }) : handler(url, init)),
  );
  vi.stubGlobal("fetch", fetch);
  render(
    <SessionProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app" element={<p>Other role home</p>} />
          <Route element={<StudentGuard />}>
            <Route path="/app/assessments/:quizId" element={component} />
            <Route path="/app/notifications" element={component} />
            <Route path="/app/attempts/:attemptId/result" element={component} />
          </Route>
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  );
  return fetch;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("Student contracts and privacy", () => {
  it("uses canonical percent without recomputing it", () => {
    render(<ProgressView value={{ percent: 37.5, completedCount: 1, publishedTotal: 3 } as Progress} />);
    expect(screen.getByRole("progressbar").getAttribute("value")).toBe("37.5");
    expect(screen.getByText("1 / 3 bài hoàn thành")).toBeTruthy();
  });
  it("preserves a key on retry and rotates it for changes and success", () => {
    const command = logicalCommand(),
      first = command.key({ completed: true });
    expect(command.key({ completed: true })).toBe(first);
    expect(command.key({ completed: false })).not.toBe(first);
    command.success();
    expect(command.key({ completed: true })).not.toBe(first);
  });
  it("accepts only implemented exact return destinations", () => {
    expect(safeReturnTo("/app/learn/" + id + "/lessons/" + id)).toContain("/lessons/");
    for (const path of [
      "/app/results/" + id,
      "/app/learn/" + id + "/admin",
      "/app/learn/%2f",
      "//evil",
      "/app/notifications?redirect=evil",
    ])
      expect(safeReturnTo(path)).toBe("/app");
  });
  it.each(["LECTURER", "ADMIN"])("guards Student pages for %s", async (role) => {
    const fetch = setup(<QuizDetail />, undefined, role);
    await screen.findByText("Other role home");
    expect(fetch.mock.calls.filter((c) => c[0].includes("/student/"))).toHaveLength(0);
  });
  it("never starts an attempt when opening quiz detail", async () => {
    const f = setup(<QuizDetail />, undefined, "STUDENT", () =>
      ok({ quizId: id, title: "A real quiz", questionCount: 4, state: "PUBLISHED" }),
    );
    await screen.findByText("A real quiz");
    expect(f.mock.calls.some((c) => c[1].method === "POST")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Bắt đầu / tiếp tục làm bài" }));
    await waitFor(() =>
      expect(f.mock.calls.some((c) => c[0].endsWith("/attempts") && c[1].body === "{}")).toBe(true),
    );
  });
  it("result renders only score summary even if unexpected private fields arrive", async () => {
    setup(<ResultPage />, "/app/attempts/" + id + "/result", "STUDENT", () =>
      ok({
        attemptId: id,
        score: "7",
        maxScore: "10",
        submittedAt: "2026-09-07T00:00:00Z",
        correctAnswer: "SECRET-ANSWER",
        items: [{ correctAnswer: "SECRET-KEY" }],
      }),
    );
    await screen.findByText("7 / 10");
    expect(document.body.textContent).not.toContain("SECRET");
  });
  it("sends exact opaque notification locator and clears read action after refetch", async () => {
    let read = false;
    const f = setup(<Notifications />, "/app/notifications", "STUDENT", (path, init) => {
      if (init.method === "PATCH") {
        read = true;
        return ok({ state: "READ" });
      }
      return ok({
        items: [
          {
            notificationId: id,
            title: "Class notice",
            body: "Hello",
            createdAt: "2026-09-07T00:00:00Z",
            readAt: read ? "2026-09-07T00:01:00Z" : null,
            locator: "opaque_LOCATOR-unchanged",
            source: { type: "CLASS_ANNOUNCEMENT", contextId: id },
          },
        ],
        page: { nextCursor: null },
      });
    });
    await screen.findByText("Class notice");
    fireEvent.click(screen.getByRole("button", { name: "Đánh dấu đã đọc" }));
    await screen.findByText("Đã đọc");
    const call = f.mock.calls.find((c) => c[1].method === "PATCH")!;
    expect(call[1].headers).toMatchObject({ "x-notification-locator": "opaque_LOCATOR-unchanged" });
    expect(call[0]).not.toContain("LOCATOR");
  });
  it("disables review creation until eligibility is established", async () => {
    setup(<Discussion type="COURSE" id={id} canWrite={false} canReview={false} />, undefined, "STUDENT", () =>
      ok([]),
    );
    await screen.findByText(/Học ít nhất 20%/);
    expect(screen.queryByRole("button", { name: "Gửi đánh giá" })).toBeNull();
  });
});
function Probe() {
  const [path, setPath] = React.useState("/me/courses"),
    q = useStudent<{ title: string }>(path),
    auth = useSession();
  return (
    <>
      <p>{q.data?.title}</p>
      <p>{auth.state}</p>
      <button onClick={() => setPath("/me/classes")}>route</button>
      <button onClick={() => void auth.logout()}>logout</button>
    </>
  );
}
import React from "react";
it("cancels stale protected reads on route switch and logout even when fetch ignores abort", async () => {
  let resolve: (v: unknown) => void = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.endsWith("/bootstrap")) return Promise.resolve(ok(profile));
      if (url.endsWith("/me/courses"))
        return new Promise((r) => {
          resolve = r;
        });
      if (url.endsWith("/me/classes")) return Promise.resolve(ok({ title: "Current class" }));
      return Promise.resolve(ok({ loggedOut: true }));
    }),
  );
  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
  await screen.findByText("AUTHENTICATED");
  fireEvent.click(screen.getByText("route"));
  await screen.findByText("Current class");
  await act(async () => resolve(ok({ title: "STALE COURSE" })));
  expect(screen.queryByText("STALE COURSE")).toBeNull();
  fireEvent.click(screen.getByText("logout"));
  await screen.findByText("UNAUTHENTICATED");
  expect(screen.queryByText("Current class")).toBeNull();
});

it("a cancelled old 401 cannot invalidate a newer session", async () => {
  const { studentRequest } = await import("../src/student/api");
  const controller = new AbortController();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      controller.abort();
      return { ok: false, status: 401, json: async () => ({ error: { code: "SESSION_EXPIRED" } }) };
    }),
  );
  const dispatch = vi.spyOn(window, "dispatchEvent");
  await expect(studentRequest("/me/courses", controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(dispatch).not.toHaveBeenCalled();
});
