import AxeBuilder from "@axe-core/playwright";
import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const base = process.env.AILSS_QA_URL || "http://127.0.0.1:5175",
  out = "../../docs/evidence/p12.4-browser",
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
await fs.mkdir(out, { recursive: true });
const profile = {
    userId: id(1),
    displayName: "Giảng viên Lan",
    emailMasked: "l***@example.test",
    role: "LECTURER",
    status: "ACTIVE",
    lecturerVerified: true,
    profileVersion: 1,
  },
  course = {
    courseId: id(2),
    title: "Cơ sở dữ liệu nâng cao",
    slug: "csdl-nang-cao",
    categoryId: id(9),
    state: "DRAFT",
    priceType: "FREE",
    price: "0",
    currency: "VND",
  },
  klass = {
    classId: id(3),
    name: "Lớp Cassandra",
    classKind: "LIVE_COHORT",
    state: "ACTIVE",
    scheduleState: "DRAFT",
    maxMembers: 80,
  },
  job = {
    jobId: id(5),
    documentId: id(6),
    targetType: "COURSE",
    targetId: id(2),
    state: "AI_DRAFT",
    draftId: id(7),
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
      calls = [],
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/web-session/**", async (route) => {
      const req = route.request(),
        u = new URL(req.url()),
        p = u.pathname.replace("/web-session/lecturer", "");
      calls.push({ path: p, method: req.method(), headers: req.headers() });
      let data = {};
      if (u.pathname === "/web-session/bootstrap") data = profile;
      else if (p === "/courses") data = [course];
      else if (p === "/me/owned-offerings") data = [];
      else if (p === "/me/owned-classes") data = [klass];
      else if (p === `/classes/${id(3)}`) data = klass;
      else if (p.startsWith(`/classes/${id(3)}/sessions`)) data = [];
      else if (p === "/ai/usage") data = { dailyQuota: 50, used: 10 };
      else if (p === "/ai/jobs") data = [job];
      else if (p === `/ai/jobs/${id(5)}`) data = job;
      else if (p.endsWith("/drafts"))
        data = [{ draftId: id(7), schemaVersion: 2, quiz: { title: "Bản nháp" } }];
      await route.fulfill({ status: 200, json: { data } });
    });
    await page.goto(base + "/app/teaching");
    await expect(page.getByRole("heading", { name: /Điều hành khóa học/ })).toBeVisible();
    await page.goto(base + `/app/teaching/classes/${id(3)}`);
    await expect(page.getByRole("heading", { name: "Lớp Cassandra" })).toBeVisible();
    await page.goto(base + "/app/teaching/ai");
    await expect(page.getByRole("heading", { name: /Tạo câu hỏi từ học liệu/ })).toBeVisible();
    await page.evaluate(() =>
      Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))),
    );
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `${out}/lecturer-${width}.png`, fullPage: true });
    results.push({ width, status: "PASS", requests: calls.length, reducedMotion: width === 375 });
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }),
    page = await context.newPage();
  await page.route("**/web-session/bootstrap", (r) =>
    r.fulfill({ status: 200, json: { data: { ...profile, lecturerVerified: false } } }),
  );
  await page.goto(base + "/app/teaching");
  await expect(page.getByRole("heading", { name: "Cần xác minh tài khoản." })).toBeVisible();
  await context.close();
  await fs.writeFile(
    `${out}/lecturer-browser-results.json`,
    JSON.stringify(
      { status: "PASS", scope: "deterministic browser fixture over production build", results },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
}
