import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs/promises";
const base = "http://127.0.0.1:4174";
const out = "../../docs/evidence/p12.2a";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = { pages: [], interactions: [], performance: {} };
const routes = [
  "/",
  "/ai-learning",
  "/auth/login",
  "/auth/register",
  "/auth/register/student",
  "/auth/register/lecturer",
  "/auth/forgot-password",
  "/about",
  "/courses",
  "/contact",
];
try {
  for (const width of [375, 768, 1440, 1920]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 375 ? 812 : 1000 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    for (const route of routes) {
      const errors = [];
      const listener = (e) => errors.push(e.message);
      page.on("pageerror", listener);
      const response = await page.goto(base + route);
      await page.locator("main h1").waitFor();
      await page.evaluate(async () => {
        await Promise.all(
          [...document.images]
            .filter((i) => i.getClientRects().length && i.getBoundingClientRect().top < innerHeight)
            .map((i) => i.decode().catch(() => {})),
        );
      });
      const name = route === "/" ? "home" : route.slice(1).replaceAll("/", "-");
      await page.screenshot({ path: `${out}/${name}-${width}.png` });
      const violations = (
        await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()
      ).violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
      }));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      const authClean = !route.startsWith("/auth") || (await page.locator(".header,.footer").count()) === 0;
      results.pages.push({
        route,
        width,
        status: response.status(),
        title: await page.title(),
        violations,
        overflow,
        authClean,
        errors,
      });
      console.log("PAGE", route, width, violations.length, overflow, authClean);
      page.off("pageerror", listener);
    }
    await context.close();
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  async function check(name, fn) {
    try {
      await fn();
      results.interactions.push({ name, pass: true });
      console.log("PASS", name);
    } catch (e) {
      results.interactions.push({ name, pass: false, error: e.message });
      console.log("FAIL", name, e.message.slice(0, 200));
    }
  }
  await check("auth route snapshots, chooser and browser back", async () => {
    await page.addInitScript(() => {
      window.__transitions = 0;
      const fn = document.startViewTransition?.bind(document);
      if (fn)
        document.startViewTransition = (...args) => {
          window.__transitions++;
          return fn(...args);
        };
    });
    await page.goto(base + "/auth/login");
    await page.getByRole("button", { name: "Tạm dừng chuyển động" }).click();
    expect(
      await page.locator(".auth-art picture").evaluate((e) => getComputedStyle(e).animationPlayState),
    ).toBe("paused");
    await page.getByRole("button", { name: "Bật chuyển động" }).click();
    await page.getByRole("link", { name: "Đăng ký", exact: true }).click();
    await expect(page).toHaveURL(base + "/auth/register");
    await page.getByRole("link", { name: /Học viên/ }).click();
    await expect(page.getByLabel("Họ và tên")).toBeVisible();
    expect(await page.evaluate(() => window.__transitions)).toBe(2);
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Bạn muốn bắt đầu thế nào?" })).toBeVisible();
    await page.getByRole("link", { name: /Giảng viên/ }).click();
    await expect(page.getByText("Chưa mở đăng ký giảng viên trực tuyến")).toBeVisible();
    expect(await page.locator("form").count()).toBe(0);
  });
  await check("slow and fast native wheel settle with no cancelled wheel", async () => {
    await page.goto(base);
    await page.evaluate(() => {
      window.__cancelledWheel = 0;
      addEventListener("wheel", (e) =>
        queueMicrotask(() => {
          if (e.defaultPrevented) window.__cancelledWheel++;
        }),
      );
      window.__frames = [];
      let last = performance.now();
      const tick = (t) => {
        window.__frames.push(t - last);
        last = t;
        if (window.__frames.length < 180) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(200);
    await page.mouse.wheel(0, 180);
    await page.waitForTimeout(200);
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(700);
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(500);
    expect(await page.evaluate(() => window.__cancelledWheel)).toBe(0);
    await expect
      .poll(() =>
        page.locator("main").evaluate((e) => Math.abs(Number(e.style.getPropertyValue("--scroll-velocity")))),
      )
      .toBeLessThan(0.03);
    const frames = await page.evaluate(() => window.__frames);
    results.performance = {
      samples: frames.length,
      medianFrameMs: frames.sort((a, b) => a - b)[Math.floor(frames.length / 2)],
      framesOver50ms: frames.filter((x) => x > 50).length,
      environment: "Local headless Chrome, unthrottled, concurrent QA; not Lighthouse",
    };
    await page.locator(".scroll-story").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${out}/scroll-story-desktop.png` });
    await page.locator('[data-stage="4"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-stage="4"]')).toHaveClass(/is-current/);
  });
  await check("video loads on demand, controls playback, pauses offscreen", async () => {
    await page.goto(base);
    expect(await page.locator("video").count()).toBe(0);
    await page.getByRole("button", { name: "Tải video quy trình AI" }).click();
    const video = page.locator("video");
    await video.evaluate((v) => v.play());
    await expect.poll(() => video.evaluate((v) => v.currentTime)).toBeGreaterThan(0.05);
    await page.screenshot({ path: `${out}/video-desktop.png` });
    await page.evaluate(() => scrollTo(0, 0));
    await expect.poll(() => video.evaluate((v) => v.paused)).toBe(true);
    expect(await video.getAttribute("playsinline")).not.toBeNull();
    expect(await page.locator('track[kind="captions"]').count()).toBe(1);
  });
  await check("reduced motion removes decorative motion and WebGL", async () => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(base + "/auth/login");
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    await page.goto(base);
    expect(await page.locator("canvas").count()).toBe(0);
    await page.getByRole("button", { name: /03 AI tạo bản nháp/ }).click();
    expect(
      await page.locator(".workflow-detail .panel-motion").evaluate((e) => e.getAnimations().length),
    ).toBe(0);
  });
  await page.close();
} finally {
  await browser.close();
  await fs.writeFile(`${out}/premium-browser-results.json`, JSON.stringify(results, null, 2));
}
const failures = results.pages.filter(
  (p) => p.status !== 200 || p.violations.length || p.overflow || !p.authClean || p.errors.length,
);
console.log(
  JSON.stringify(
    {
      pages: results.pages.length,
      failures,
      interactions: results.interactions,
      performance: results.performance,
    },
    null,
    2,
  ),
);
if (failures.length || results.interactions.some((x) => !x.pass)) process.exitCode = 1;
