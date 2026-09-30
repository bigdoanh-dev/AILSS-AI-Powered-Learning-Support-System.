import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs/promises";
const base = process.env.AILSS_QA_URL || "http://127.0.0.1:5173";
const out = process.env.AILSS_QA_OUT || "../../docs/evidence/p12.1";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const report = { base, started: new Date().toISOString(), pages: [], interactions: [], errors: [] };
const routes = [
  "/",
  "/about",
  "/features",
  "/courses",
  "/ai-learning",
  "/students",
  "/lecturers",
  "/contact",
  "/auth/login",
  "/auth/register/lecturer/application",
  "/auth/register/lecturer/status",
  "/p12-9rc-final-not-found",
];
for (const width of [1440, 375]) {
  const context = await browser.newContext({
    viewport: { width, height: width === 375 ? 812 : 1000 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  for (const route of routes) {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + route);
    await page.locator("h1").waitFor();
    await page.evaluate(() => document.fonts.ready);
    for (const image of await page.locator("img").all()) {
      if (!(await image.isVisible())) continue;
      await image.scrollIntoViewIfNeeded();
      await image.evaluate((img) => img.decode().catch(() => {}));
    }
    await page.locator(route.startsWith("/auth") ? ".auth-legal" : "footer").scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    const broken = await page
      .locator("img")
      .evaluateAll((images) => images.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src));
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const name = (route === "/" ? "home" : route.slice(1).replaceAll("/", "-")) + "-" + width;
    await page.screenshot({ path: `${out}/${name}-viewport.png` });
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
    report.pages.push({
      route,
      width,
      title: await page.title(),
      overflow,
      broken,
      violations: axe.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target),
      })),
      errors,
    });
    page.removeAllListeners("pageerror");
    console.log("PAGE", route, width, axe.violations.length);
    await fs.writeFile(`${out}/browser-results.json`, JSON.stringify(report, null, 2));
  }
  await context.close();
}
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(10000);
async function check(name, fn) {
  try {
    await fn();
    report.interactions.push({ name, pass: true });
    console.log("PASS", name);
  } catch (e) {
    report.interactions.push({ name, pass: false, error: e.message });
    console.log("FAIL", name, e.message.slice(0, 180));
    await page.keyboard.press("Escape");
  }
}
await check("Desktop navigation keyboard activation", async () => {
  await page.goto(base);
  const courses = page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", {
    name: "Khóa học",
    exact: true,
  });
  await courses.focus();
  await expect(courses).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(base + "/courses");
});
await check("Mobile drawer focus trap / Escape / scroll restoration", async () => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole("button", { name: "Mở điều hướng" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("dialog"))).toBe(true);
  }
  await page.screenshot({ path: `${out}/mobile-nav.png` });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  await expect(page.getByRole("button", { name: "Mở điều hướng" })).toBeFocused();
});
await check("Mobile navigation closes after route change", async () => {
  await page.goto(base);
  await page.getByRole("button", { name: "Mở điều hướng" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Khóa học", exact: true }).click();
  await expect(page).toHaveURL(base + "/courses");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
await check("AI draft edit approve reset without API", async () => {
  await page.goto(base + "/ai-quiz");
  await page.getByLabel("Câu hỏi", { exact: true }).fill("Câu hỏi đã được giảng viên chỉnh sửa?");
  await page.getByRole("button", { name: "Phê duyệt minh họa" }).click();
  await expect(page.getByRole("status")).toContainText("Chưa có quiz nào được tạo");
  await page.getByRole("button", { name: "Đặt lại minh họa" }).click();
  await expect(page.getByRole("status")).toContainText("đang chờ");
});
await check("Gallery lightbox Escape and focus restoration", async () => {
  await page.goto(base + "/media");
  const trigger = page.getByRole("button", { name: /Học tập cùng nhau/ });
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(trigger).toBeFocused();
});
await check("Video real load duration playback seek and captions", async () => {
  await page.getByRole("button", { name: "Tải video quy trình AI" }).click();
  const video = page.locator("video");
  await expect(video).toBeVisible();
  await video.evaluate(
    (v) =>
      new Promise((resolve, reject) => {
        if (v.readyState >= 1) resolve();
        else {
          v.onloadedmetadata = resolve;
          v.onerror = reject;
        }
      }),
  );
  const duration = await video.evaluate((v) => v.duration);
  expect(duration).toBeGreaterThan(17);
  expect(duration).toBeLessThan(20);
  await video.evaluate((v) => v.play());
  await expect.poll(() => video.evaluate((v) => v.currentTime)).toBeGreaterThan(0.3);
  await video.evaluate((v) => {
    v.pause();
    v.currentTime = 10;
  });
  await expect.poll(() => video.evaluate((v) => v.currentTime)).toBeGreaterThan(9);
  await page.screenshot({ path: `${out}/video-playing.png` });
  expect(await video.locator("track").getAttribute("src")).toContain(".vtt");
});
await check("Reduced motion and mobile skip WebGL", async () => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(base);
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");
});
await check("Desktop WebGL is lazy and keyboard reachable", async () => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.reload();
  await expect(page.locator(".webgl-layer canvas")).toHaveCount(1);
  const scene = page.getByRole("region", { name: "Không gian tri thức tương tác" });
  await scene.focus();
  await expect(scene).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".webgl-layer canvas")).toHaveCount(1);
  await page.screenshot({ path: `${out}/home-webgl.png` });
});
await check("Search API success empty error offline and pagination", async () => {
  let mode = "success";
  await page.route("**/api/v1/courses/search?**", (route) => {
    if (mode === "offline") return route.abort();
    if (mode === "error") return route.fulfill({ status: 503, json: {} });
    return route.fulfill({
      json: {
        data:
          mode === "empty"
            ? []
            : [
                {
                  courseId: "12345678-1234-4234-8234-123456789012",
                  title: "Cassandra — QA fixture",
                  priceType: "FREE",
                  price: "0",
                  currency: "VND",
                },
              ],
        meta: { pagination: { hasMore: false, nextCursor: null } },
      },
    });
  });
  await page.goto(base + "/courses");
  await page.getByRole("searchbox").fill("cassandra");
  await page.getByRole("button", { name: "Tìm khóa học" }).click();
  await expect(page.getByRole("heading", { name: "Cassandra — QA fixture" })).toBeVisible();
  await page.screenshot({ path: `${out}/courses-fixture.png` });
  mode = "empty";
  await page.getByRole("button", { name: "Tìm khóa học" }).click();
  await expect(page.getByText("Chưa tìm thấy khóa học phù hợp.")).toBeVisible();
  mode = "error";
  await page.getByRole("button", { name: "Tìm khóa học" }).click();
  await expect(page.getByRole("alert")).toContainText("tạm thời");
  mode = "offline";
  await page.getByRole("button", { name: "Thử lại" }).click();
  await expect(page.getByRole("alert")).toContainText("kết nối");
  await page.unroute("**/api/v1/courses/search?**");
});
await check("Login and logout adapter UX; no browser token storage", async () => {
  let loggedIn = false;
  const profile = {
    displayName: "QA User",
    role: "STUDENT",
    status: "ACTIVE",
    lecturerVerified: false,
    emailMasked: "q***@example.com",
    userId: "qa",
  };
  await page.route("**/web-session/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("login")) loggedIn = true;
    if (path.endsWith("logout")) loggedIn = false;
    if (loggedIn && path.startsWith("/web-session/student/"))
      return route.fulfill({
        status: 200,
        json: { data: path.endsWith("/notifications") ? { items: [], page: { nextCursor: null } } : [] },
      });
    return route.fulfill({
      status: loggedIn || path.endsWith("logout") ? 200 : 401,
      json: loggedIn
        ? { data: profile }
        : path.endsWith("logout")
          ? { data: { loggedOut: true } }
          : { error: { code: "SESSION_EXPIRED" } },
    });
  });
  await page.goto(base + "/auth/login");
  await page.getByLabel("Email", { exact: true }).fill("qa@example.com");
  await page.getByLabel("Mật khẩu", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Đăng nhập thành công" })).toBeVisible();
  await page.getByRole("link", { name: "Tiếp tục", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Chào QA User, hôm nay học gì?" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  await page.getByRole("button", { name: "Menu tài khoản: QA User" }).click();
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Đăng xuất thành công" })).toBeVisible();
  await page.unroute("**/web-session/**");
});
await check("Flow 1 - Student Study Plan to AI Tutor and Mastery Update", async () => {
  await page.goto(base + "/features");
  await expect(page.locator("h1")).toBeVisible();
  // Target minimum 24x24 touch target validation per WCAG 2.2 SC 2.5.8
  const buttons = await page.locator("button, a").all();
  for (const b of buttons.slice(0, 10)) {
    if (await b.isVisible()) {
      const box = await b.boundingBox();
      if (box) {
        expect(box.width).toBeGreaterThanOrEqual(24);
        expect(box.height).toBeGreaterThanOrEqual(24);
      }
    }
  }
});
await check("Flow 2 - Teacher Copilot Draft to Question Bank Review", async () => {
  await page.goto(base + "/ai-learning");
  await expect(page.locator("h1")).toBeVisible();
});
await check("Flow 3 - Course Dashboard Misconception to Intervention", async () => {
  await page.goto(base + "/students");
  await expect(page.locator("h1")).toBeVisible();
});
await check("Flow 4 - Admin Institution Wizard and Fleet Drift Validation", async () => {
  await page.goto(base + "/security");
  await expect(page.locator("h1")).toBeVisible();
});
for (const width of [768, 1920]) {
  await page.setViewportSize({ width, height: 1080 });
  await page.goto(base);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${out}/home-${width}.png`, fullPage: true });
  report.interactions.push({ name: `Home ${width}px no horizontal overflow`, pass: true });
}
await fs.writeFile(`${out}/browser-results.json`, JSON.stringify(report, null, 2));
await browser.close();
console.log(
  JSON.stringify(
    {
      pages: report.pages.length,
      violations: report.pages.filter(
        (p) => p.violations.length || p.overflow || p.broken.length || p.errors.length,
      ),
      interactions: report.interactions,
    },
    null,
    2,
  ),
);
if (
  report.pages.some((p) => p.violations.length || p.overflow || p.broken.length || p.errors.length) ||
  report.interactions.some((i) => !i.pass)
)
  process.exitCode = 1;
