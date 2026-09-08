import AxeBuilder from "@axe-core/playwright";
import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const base = process.env.AILSS_QA_URL || "http://127.0.0.1:5175",
  out = "../../docs/evidence/p12.3-browser";
await fs.mkdir(out, { recursive: true });
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const student = {
  userId: id(1),
  displayName: "Minh An",
  emailMasked: "m***@example.test",
  role: "STUDENT",
  status: "ACTIVE",
  lecturerVerified: false,
  profileVersion: 1,
};
const course = { courseId: id(2), title: "Tư duy cơ sở dữ liệu", priceType: "FREE", state: "ACTIVE" },
  klass = {
    classId: id(3),
    name: "Lớp dữ liệu ứng dụng",
    state: "ACTIVE",
    scheduleState: "PUBLISHED",
    linkedCourseId: id(2),
  },
  lesson = {
    lessonId: id(4),
    courseId: id(2),
    title: "Thiết kế mô hình dữ liệu",
    preview: false,
    state: "READY",
  },
  quiz = {
    quizId: id(5),
    title: "Kiểm tra kiến thức nền tảng",
    state: "PUBLISHED",
    questionCount: 4,
    attemptLimit: 2,
  };
const questions = [
  {
    questionId: id(11),
    questionOrder: 1,
    prompt: "Chọn kiểu dữ liệu",
    questionType: "SINGLE_CHOICE",
    options: ["Số nguyên", "Bảng"],
    points: "1",
  },
  {
    questionId: id(12),
    questionOrder: 2,
    prompt: "Chọn thao tác đọc",
    questionType: "MULTIPLE_CHOICE",
    options: ["SELECT", "GET", "DELETE"],
    points: "1",
  },
  {
    questionId: id(13),
    questionOrder: 3,
    prompt: "Khóa chính là duy nhất",
    questionType: "TRUE_FALSE",
    points: "1",
  },
  {
    questionId: id(14),
    questionOrder: 4,
    prompt: "Tên ngôn ngữ truy vấn",
    questionType: "SHORT_ANSWER",
    points: "1",
  },
];
const browser = await chromium.launch({ channel: "chrome", headless: true }),
  results = [];
try {
  for (const width of [375, 768, 1440, 1920]) {
    const context = await browser.newContext({
        viewport: { width, height: 1000 },
        reducedMotion: width === 375 ? "reduce" : "no-preference",
      }),
      page = await context.newPage(),
      errors = [],
      calls = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let profile = { ...student },
      completed = false,
      read = false,
      state = "IN_PROGRESS",
      comments = [],
      reviews = [],
      mode = 200,
      failPath = "",
      delay = false;
    await page.route("**/web-session/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        p = url.pathname.replace("/web-session/student", ""),
        method = req.method();
      calls.push({ path: p, method, body: req.postDataJSON(), query: url.search });
      let data = {},
        meta = {};
      if (url.pathname === "/web-session/bootstrap") data = profile;
      else if (url.pathname.startsWith("/web-session/student/")) {
        if (p === failPath) {
          if (delay) await new Promise((r) => setTimeout(r, 1000));
          if (mode !== 200)
            return route.fulfill({
              status: mode,
              json: { error: { code: mode === 401 ? "SESSION_EXPIRED" : "RESOURCE_UNAVAILABLE" } },
            });
        }
        if (p === "/me/courses") data = [course];
        else if (p === "/me/classes") data = [klass];
        else if (p === "/courses/search") {
          data = [course];
          meta = {
            pagination: { nextCursor: url.searchParams.has("cursor") ? null : "opaque.cursor_page2" },
          };
        } else if (p === `/courses/${id(2)}`) data = course;
        else if (p.endsWith("/lessons")) data = [lesson];
        else if (p === `/lessons/${id(4)}`) data = lesson;
        else if (p.endsWith("/completion") || p.endsWith("/progress")) {
          if (method === "PUT") {
            expect(req.postDataJSON()).toEqual({ completed: true });
            completed = true;
          }
          data = {
            courseId: id(2),
            percent: completed ? 100 : 0,
            completedCount: completed ? 1 : 0,
            publishedTotal: 1,
            progressVersion: completed ? 1 : 0,
            courseContentVersion: 1,
          };
        } else if (p.endsWith("/enrollments")) data = { courseId: id(2), state: "ACTIVE" };
        else if (p === `/classes/${id(3)}`) data = klass;
        else if (p === "/classes/join") data = { classId: id(3) };
        else if (p === "/me/schedule" || p.endsWith("/sessions"))
          data = [
            {
              sessionId: id(7),
              classId: id(3),
              title: "Buổi thực hành mô hình",
              startAt: "2026-09-10T02:00:00Z",
              endAt: "2026-09-10T03:00:00Z",
              timezone: "Asia/Ho_Chi_Minh",
              mode: "OFFLINE",
              location: "Phòng A",
              status: "SCHEDULED",
            },
          ];
        else if (p.startsWith("/class-sessions/"))
          data = { sessionId: id(7), mode: "OFFLINE", location: "Phòng A" };
        else if (p === "/me/attendance")
          data = [{ sessionId: id(7), classId: id(3), title: "Buổi thực hành", attendanceStatus: "PRESENT" }];
        else if (p.endsWith("/announcements"))
          data = [
            {
              announcementId: id(8),
              title: "Chuẩn bị cho buổi học",
              body: "Đọc tài liệu trước giờ học.",
              createdAt: "2026-09-07T00:00:00Z",
            },
          ];
        else if (p.startsWith("/targets/")) data = [quiz];
        else if (p === `/quizzes/${id(5)}`) data = quiz;
        else if (p === `/quizzes/${id(5)}/attempts`)
          data = { attemptId: id(6), quizId: id(5), state, attemptNo: 1, questions };
        else if (p === `/attempts/${id(6)}`) data = { attemptId: id(6), quizId: id(5), state, attemptNo: 1 };
        else if (p.endsWith("/submit")) {
          expect(req.postDataJSON().answers).toHaveLength(4);
          state = "SUBMITTED";
          data = { attemptId: id(6), score: "4", maxScore: "4" };
        } else if (p.endsWith("/result"))
          data = { attemptId: id(6), score: "4", maxScore: "4", submittedAt: "2026-09-07T00:00:00Z" };
        else if (p === "/notifications")
          data = {
            items:
              mode === 204
                ? []
                : [
                    {
                      notificationId: id(9),
                      title: "Lịch học của bạn đã sẵn sàng",
                      body: "Xem thông tin lớp trước buổi học.",
                      createdAt: "2026-09-07T00:00:00Z",
                      readAt: read ? "2026-09-07T00:01:00Z" : null,
                      locator: "OPAQUE_LOCATOR-unchanged",
                      source: { type: "CLASS_ANNOUNCEMENT", contextId: id(3) },
                    },
                  ],
            page: { month: url.searchParams.get("month"), nextCursor: null },
          };
        else if (p.endsWith("/read")) {
          expect(req.headers()["x-notification-locator"]).toBe("OPAQUE_LOCATOR-unchanged");
          read = true;
          data = { state: "READ" };
        } else if (p.startsWith("/resources/")) {
          if (method === "POST") {
            const b = req.postDataJSON();
            data = {
              commentId: id(20 + comments.length),
              authorId: id(1),
              state: "ACTIVE",
              version: 1,
              parentId: b.parentId || null,
              body: b.body,
              createdAt: "2026-09-07T00:00:00Z",
            };
            comments.push(data);
          } else {
            data = comments;
            meta = { page: { nextCursor: null } };
          }
        } else if (p.startsWith("/comments/")) {
          const c = comments.find((c) => p.endsWith(c.commentId));
          expect(req.headers()["if-match"]).toBe(`"v${c.version}"`);
          c.version++;
          c.body = method === "DELETE" ? null : req.postDataJSON().body;
          c.state = method === "DELETE" ? "DELETED_BY_AUTHOR" : "ACTIVE";
          data = c;
        } else if (p.endsWith("/reviews")) {
          if (method === "POST") {
            data = { reviewId: id(30), authorId: id(1), state: "ACTIVE", version: 1, ...req.postDataJSON() };
            reviews.push(data);
          } else {
            data = reviews;
            meta = { page: { nextCursor: null } };
          }
        } else throw new Error("Unhandled fixture " + method + " " + p);
      }
      return route.fulfill({ status: 200, json: { data, meta } });
    });
    const visit = async (path) => {
      await page.goto(base + path);
      await expect(page.locator("main h1")).toBeVisible();
    };
    const shot = async (name) => {
      await page.evaluate(async () => {
        window.scrollTo({ top: 0, behavior: "instant" });
        await Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect?.getTiming().iterations !== Infinity)
            .map((a) => a.finished.catch(() => {})),
        );
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations,
      ).toEqual([]);
      await page.screenshot({ path: `${out}/${name}-${width}.png`, fullPage: true });
    };
    await visit("/app");
    await expect(page.getByRole("heading", { name: course.title })).toBeVisible();
    await shot("home");
    if (width === 375) {
      await page.getByRole("button", { name: "Mở điều hướng" }).click();
      await page.getByRole("dialog").getByRole("link", { name: "Học tập", exact: true }).click();
    } else await visit("/app/learn");
    await page.getByLabel("Từ khóa").fill("database");
    await page.getByRole("button", { name: "Tìm kiếm", exact: true }).click();
    await page.getByRole("button", { name: "Trang tiếp theo →" }).click();
    await expect.poll(() => calls.some((c) => c.query.includes("opaque.cursor_page2"))).toBe(true);
    await visit("/app/learn/" + id(2));
    await expect(page.getByText("0 / 1 bài hoàn thành")).toBeVisible();
    await expect(page.getByText(/Học ít nhất 20%/)).toBeVisible();
    await page.getByRole("link", { name: lesson.title, exact: true }).click();
    await page.getByRole("button", { name: "Đánh dấu đã hoàn thành", exact: true }).click();
    await expect(page.getByText("1 / 1 bài hoàn thành")).toBeVisible();
    await shot("lesson");
    await page.getByLabel("Viết bình luận").fill("Tôi muốn hỏi về khóa chính.");
    await page.getByRole("button", { name: "Gửi bình luận", exact: true }).click();
    await expect(page.getByText("Tôi muốn hỏi về khóa chính.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Trả lời", exact: true }).click();
    await page.getByLabel("Viết bình luận").fill("Tôi đã hiểu ví dụ.");
    await page.getByRole("button", { name: "Gửi trả lời", exact: true }).click();
    await expect(page.getByText("Tôi đã hiểu ví dụ.", { exact: true })).toBeVisible();
    expect(await page.getByRole("button", { name: "Trả lời", exact: true }).count()).toBe(1);
    await page.getByRole("button", { name: "Sửa bình luận" }).first().click();
    await page.getByLabel("Sửa nội dung bình luận").fill("Câu hỏi đã cập nhật.");
    await page.getByRole("button", { name: "Lưu bình luận" }).click();
    await expect(page.getByText("Câu hỏi đã cập nhật.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Gỡ bình luận" }).first().click();
    await expect(page.getByText("Bình luận đã được gỡ.")).toBeVisible();
    await page.getByLabel("Nội dung đánh giá").fill("Bài học dễ hiểu và hữu ích.");
    await page.getByRole("button", { name: "Gửi đánh giá" }).click();
    await expect(page.getByText("Bài học dễ hiểu và hữu ích.", { exact: true })).toBeVisible();
    await visit("/app/progress");
    await page.getByLabel("Chọn khóa học").selectOption(id(2));
    await expect(page.getByRole("progressbar")).toHaveAttribute("value", "100");
    await visit("/app/classes");
    await page.getByLabel("Mã tham gia").fill("ABCDEF");
    await page.getByRole("button", { name: "Tham gia", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/app/classes/${id(3)}$`));
    await expect(page.getByRole("heading", { name: klass.name })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Buổi thực hành mô hình" })).toBeVisible();
    await shot("class");
    await visit("/app/assessments");
    await page.getByLabel("Khóa học hoặc lớp").selectOption("COURSE/" + id(2));
    await page.getByRole("link", { name: "Xem bài kiểm tra →" }).click();
    expect(calls.filter((c) => c.path.endsWith("/attempts") && c.method === "POST")).toHaveLength(0);
    await page.getByRole("button", { name: "Bắt đầu / tiếp tục làm bài" }).click();
    await page.getByRole("button", { name: "Tải câu hỏi và tiếp tục" }).click();
    await page.getByLabel("Số nguyên", { exact: true }).check();
    await page.getByLabel("SELECT", { exact: true }).check();
    await page.getByLabel("GET", { exact: true }).check();
    await page.getByLabel("Đúng", { exact: true }).check();
    await page.getByLabel("Câu trả lời ngắn").fill("SQL");
    await shot("attempt");
    await page.getByRole("button", { name: "Nộp bài", exact: true }).click();
    expect(calls.some((c) => c.path.endsWith("/submit"))).toBe(false);
    await page.getByRole("button", { name: "Xác nhận nộp bài", exact: true }).click();
    await expect(page.getByRole("heading", { name: "4 / 4" })).toBeVisible();
    await shot("result");
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Bài đã nộp" })).toBeVisible();
    await page.goForward();
    await visit("/app/notifications");
    await page.getByRole("button", { name: "Đánh dấu đã đọc" }).click();
    await expect(page.getByText("Đã đọc", { exact: true })).toBeVisible();
    await shot("notifications");
    await page.getByRole("link", { name: "Xem lớp học →" }).click();
    await expect(page.getByRole("heading", { name: klass.name })).toBeVisible();
    for (const status of [403, 404, 503]) {
      mode = status;
      failPath = "/classes/" + id(3);
      await visit("/app/classes/" + id(3));
      await expect(page.getByRole("alert")).toBeVisible();
      expect(await page.getByRole("heading", { name: "Các buổi học" }).count()).toBe(0);
    }
    mode = 403;
    failPath = "/lessons/" + id(4);
    await visit("/app/learn/" + id(2) + "/lessons/" + id(4));
    await expect(page.getByRole("alert")).toBeVisible();
    expect(await page.getByRole("button", { name: "Đánh dấu đã hoàn thành", exact: true }).count()).toBe(0);
    mode = 200;
    failPath = "";
    state = "EXPIRED";
    await visit("/app/attempts/" + id(6));
    await expect(page.getByText(/Bài kiểm tra đã hết thời gian/)).toBeVisible();
    expect(await page.getByRole("button", { name: "Tải câu hỏi và tiếp tục" }).count()).toBe(0);
    mode = 200;
    delay = true;
    failPath = "/me/courses";
    await visit("/app/learn");
    await expect(page.getByText("Đang tải nội dung…").first()).toBeVisible();
    await expect(page.getByText(course.title, { exact: true })).toBeVisible();
    delay = false;
    mode = 204;
    await visit("/app/notifications");
    await expect(page.getByText(/Không có thông báo trong tháng này/)).toBeVisible();
    mode = 401;
    failPath = "/me/courses";
    await page.goto(base + "/app/learn");
    await expect(page).toHaveURL(/\/auth\/login/);
    expect(await page.getByText(course.title, { exact: true }).count()).toBe(0);
    mode = 200;
    failPath = "";
    profile = { ...student, role: "LECTURER" };
    await visit("/app");
    expect(await page.getByRole("link", { name: "Học tập", exact: true }).count()).toBe(0);
    const storage = await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    }));
    expect(storage).toEqual({ local: 0, session: 0 });
    expect(await page.locator("body").innerText()).not.toMatch(
      /accessToken|refreshToken|correctAnswer|Actor Context|Service JWS/,
    );
    expect(errors).toEqual([]);
    results.push({ width, status: "PASS", requests: calls.length, storage, reducedMotion: width === 375 });
    await context.close();
  }
  await fs.writeFile(
    out + "/report.json",
    JSON.stringify(
      { status: "PASS", scope: "deterministic Web fixtures; not live backend", results },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
