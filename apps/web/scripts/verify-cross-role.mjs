import AxeBuilder from "@axe-core/playwright";
import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const base = process.env.AILSS_QA_URL || "http://127.0.0.1:5177",
  out = "../../docs/evidence/p12.5-cross-role",
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
await fs.mkdir(out, { recursive: true });
const course = {
    courseId: id(2),
    title: "Dữ liệu phân tán",
    slug: "du-lieu-phan-tan",
    categoryId: id(9),
    state: "PUBLISHED",
    priceType: "FREE",
    price: "0",
    currency: "VND",
  },
  offering = {
    offeringId: id(4),
    courseId: id(2),
    classId: id(3),
    title: "Đợt tháng 9",
    offeringType: "LIVE_COHORT",
    state: "PUBLISHED",
    price: "0",
    currency: "VND",
  },
  klass = {
    classId: id(3),
    name: "Lớp dữ liệu K23",
    classKind: "LIVE_COHORT",
    state: "ACTIVE",
    scheduleState: "PUBLISHED",
    linkedCourseId: id(2),
    maxMembers: 80,
  },
  session = {
    sessionId: id(5),
    classId: id(3),
    className: klass.name,
    title: "Nhất quán dữ liệu",
    startAt: "2026-09-10T02:00:00Z",
    endAt: "2026-09-10T03:00:00Z",
    timezone: "Asia/Ho_Chi_Minh",
    mode: "OFFLINE",
    location: "Phòng A",
    status: "SCHEDULED",
  },
  notice = {
    announcementId: id(6),
    title: "Chuẩn bị bài học",
    body: "Đọc bài trước giờ học.",
    createdAt: "2026-09-07T00:00:00Z",
  };
const lecturer = {
    userId: id(10),
    displayName: "Giảng viên Lan",
    emailMasked: "l***@test",
    role: "LECTURER",
    status: "ACTIVE",
    lecturerVerified: true,
    profileVersion: 1,
  },
  student = {
    userId: id(11),
    displayName: "Minh An",
    emailMasked: "m***@test",
    role: "STUDENT",
    status: "ACTIVE",
    lecturerVerified: false,
    profileVersion: 1,
  };
const browser = await chromium.launch({ channel: "chrome", headless: true }),
  results = [];
try {
  for (const width of [375, 768, 1440, 1920]) {
    const context = await browser.newContext({
        viewport: { width, height: 1000 },
        reducedMotion: width === 375 ? "reduce" : "no-preference",
      }),
      page = await context.newPage(),
      calls = [];
    let actor = lecturer;
    await page.route("**/web-session/**", async (route) => {
      const req = route.request(),
        u = new URL(req.url()),
        p = u.pathname.replace(/^\/web-session\/(lecturer|student)/, "");
      calls.push(`${actor.role}:${req.method()}:${p}`);
      let data = {};
      if (u.pathname === "/web-session/bootstrap") data = actor;
      else if (p === `/courses/${id(2)}`) data = course;
      else if (p === `/courses/${id(2)}/lessons`)
        data = [
          {
            lessonId: id(7),
            title: "Mô hình nhất quán",
            sectionTitle: "Nền tảng",
            state: "READY",
            preview: false,
            position: { sectionOrder: 1, lessonOrder: 1 },
          },
        ];
      else if (p.startsWith(`/courses/${id(2)}/offerings`)) data = [offering];
      else if (p === "/me/owned-classes") data = [klass];
      else if (p === "/me/owned-offerings") data = [offering];
      else if (p === `/offerings/${id(4)}`) data = offering;
      else if (p === `/classes/${id(3)}`) data = klass;
      else if (p.startsWith(`/classes/${id(3)}/sessions`)) data = [session];
      else if (p.startsWith(`/classes/${id(3)}/announcements`))
        data = req.method() === "POST" ? notice : [notice];
      else if (p === "/me/classes") data = [klass];
      else if (p === "/me/schedule") data = [session];
      else if (p === "/me/attendance") data = [];
      else if (p === "/notifications")
        data = {
          items: [
            {
              notificationId: id(8),
              title: notice.title,
              body: notice.body,
              createdAt: notice.createdAt,
              readAt: null,
              locator: "opaque-locator",
              source: { type: "CLASS_ANNOUNCEMENT", contextId: id(3) },
            },
          ],
          page: { month: "2026-09", nextCursor: null },
        };
      await route.fulfill({ status: 200, json: { data } });
    });
    await page.goto(`${base}/app/teaching/courses/${id(2)}`);
    await expect(page.getByRole("heading", { name: course.title })).toBeVisible();
    await expect(page.getByText("Đợt tháng 9")).toBeVisible();
    await page.goto(`${base}/app/teaching/offerings/${id(4)}`);
    await expect(page.getByRole("heading", { name: offering.title })).toBeVisible();
    await page.goto(`${base}/app/teaching/classes/${id(3)}/schedule`);
    await expect(page.getByText("Nhất quán dữ liệu")).toBeVisible();
    await page.goto(`${base}/app/teaching/classes/${id(3)}/announcements`);
    await page.getByLabel("Tiêu đề").fill("Nhắc lịch học");
    await page.getByLabel("Nội dung").fill("Hẹn gặp tại lớp.");
    await page.getByRole("button", { name: "Đăng thông báo" }).click();
    await expect(page.getByText(/Đã gửi thông báo trong ứng dụng/)).toBeVisible();
    actor = student;
    await page.goto(`${base}/app/classes/${id(3)}`);
    await expect(page.getByRole("heading", { name: klass.name })).toBeVisible();
    await expect(page.getByText(notice.title)).toBeVisible();
    await page.goto(`${base}/app/notifications`);
    await expect(page.getByRole("link", { name: /Xem lớp học/ })).toHaveAttribute(
      "href",
      `/app/classes/${id(3)}`,
    );
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations).toEqual([]);
    const storage = await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }));
    expect(storage).toEqual({ local: {}, session: {} });
    expect(await page.locator("body").innerText()).not.toMatch(
      /accessToken|refreshToken|serviceToken|actorContext/i,
    );
    expect(page.url()).not.toMatch(/joinCode|token|locator/i);
    await page.screenshot({ path: `${out}/cross-role-${width}.png`, fullPage: true });
    results.push({
      width,
      status: "PASS",
      shared: { courseId: course.courseId, offeringId: offering.offeringId, classId: klass.classId },
      requests: calls.length,
      storage,
    });
    await context.close();
  }
} finally {
  await browser.close();
}
await fs.writeFile(`${out}/cross-role-results.json`, JSON.stringify({ status: "PASS", results }, null, 2));
console.log(JSON.stringify(results));
