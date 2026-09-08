import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
const base = process.env.AILSS_QA_URL || "http://127.0.0.1:4174";
const out = process.env.AILSS_QA_OUT || "../../docs/evidence/p12.1";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1536, height: 1024 }, reducedMotion: "reduce" });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  window.__metrics = { lcp: 0, cls: 0 };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) window.__metrics.lcp = entry.startTime;
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__metrics.cls += entry.value;
  }).observe({ type: "layout-shift", buffered: true });
});
await page.goto(base);
await page.locator(".knowledge-scene img").evaluate((img) => img.decode());
await page.waitForTimeout(1000);
await page.screenshot({ path: `${out}/home-native-1536.png` });
const performance = await page.evaluate(() => ({
  fcp: window.performance.getEntriesByName("first-contentful-paint")[0]?.startTime,
  ...window.__metrics,
  resources: window.performance
    .getEntriesByType("resource")
    .map((r) => ({ name: new URL(r.name).pathname, encoded: r.encodedBodySize, transfer: r.transferSize })),
}));
const routes = [
  "/",
  "/about",
  "/features",
  "/how-it-works",
  "/courses",
  "/ai-learning",
  "/ai-quiz",
  "/students",
  "/lecturers",
  "/classroom",
  "/assessment",
  "/progress",
  "/notifications",
  "/security",
  "/architecture",
  "/research",
  "/roadmap",
  "/media",
  "/faq",
  "/help",
  "/contact",
  "/auth/login",
  "/auth/register",
  "/auth/forgot-password",
  "/legal/privacy",
  "/legal/terms",
  "/legal/cookies",
  "/accessibility",
];
const routeResults = [];
for (const route of routes) {
  const response = await page.goto(base + route);
  await page.locator("h1").waitFor();
  await expect(page.locator("h1")).toHaveCount(1);
  const title = await page.title();
  expect(title).not.toContain("Không tìm thấy");
  expect(await page.locator('meta[name="description"]').getAttribute("content")).toBeTruthy();
  routeResults.push({ route, status: response.status(), title });
}
const missing = await page.goto(base + "/does-not-exist");
expect(missing.status()).toBe(404);
await expect(page.getByRole("heading", { name: "Trang này chưa có ở đây." })).toBeVisible();
await page.goto(base + "/courses/00000000-0000-4000-8000-000000000000");
await expect(page.getByRole("alert")).toContainText("Không tìm thấy");
await page.goto(base + "/contact");
let posts = 0;
page.on("request", (r) => {
  if (r.method() === "POST") posts++;
});
await page.getByLabel("Họ và tên").fill("QA Example");
await page.getByLabel("Email", { exact: true }).fill("qa@example.com");
await page.getByLabel("Nội dung", { exact: true }).fill("Kiểm tra bản nháp liên hệ cục bộ.");
const downloadPromise = page.waitForEvent("download");
await page.getByRole("button", { name: "Tải bản nháp liên hệ" }).click();
await downloadPromise;
expect(posts).toBe(0);
await expect(page.getByRole("status")).toContainText("chưa được gửi");
const assets = [];
async function visit(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await visit(file);
    else {
      const b = await fs.readFile(file);
      const url = "/" + path.relative("public", file).split(path.sep).join("/");
      const r = await fetch(base + url);
      expect(r.ok).toBe(true);
      assets.push({ url, bytes: b.length, sha256: createHash("sha256").update(b).digest("hex") });
    }
  }
}
await visit("public/assets");
const bundles = [];
for (const file of await fs.readdir("dist/assets"))
  if (/\.(js|css)$/.test(file)) {
    const b = await fs.readFile("dist/assets/" + file);
    bundles.push({ file, bytes: b.length, gzip: gzipSync(b).length });
  }
const result = {
  date: new Date().toISOString(),
  environment:
    "Local production server, Chrome headless, 1536x1024, reduced motion, no network or CPU throttling. Single sample; not Lighthouse or field data.",
  performance,
  routes: routeResults,
  assets,
  bundles,
  errors,
  extraChecks: { notFound: true, courseNotFound: true, contactLocalDownloadWithoutPost: true },
};
await fs.writeFile(`${out}/audit-results.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ routes: routes.length, assets: assets.length, performance, errors }, null, 2));
await browser.close();
if (errors.length) process.exitCode = 1;
