import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const base = process.env.AILSS_QA_URL || "http://127.0.0.1:4174";
const results = [];
try {
  await page.addInitScript(() => {
    window.__motionCalls = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      window.__motionCalls.push({ path: location.pathname, className: this.className });
      return animate.apply(this, args);
    };
  });
  await page.goto(base + "/about");
  await expect
    .poll(() => page.evaluate(() => window.__motionCalls.filter((x) => x.path === "/about").length))
    .toBeGreaterThan(0);
  await page.getByRole("link", { name: "Courses", exact: true }).click();
  await expect(page).toHaveURL(base + "/courses");
  await expect
    .poll(() => page.evaluate(() => window.__motionCalls.filter((x) => x.path === "/courses").length))
    .toBeGreaterThan(0);
  results.push({ name: "Client-side navigation starts incoming page animation", pass: true });
  await page.goto(base);
  await page.waitForTimeout(650);
  const before = await page.evaluate(() => window.__motionCalls.length);
  await page.locator(".workflow").scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => window.__motionCalls.length)).toBeGreaterThan(before);
  results.push({ name: "Native scroll reveals below-fold section", pass: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(base + "/about");
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__motionCalls.length)).toBe(0);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  results.push({ name: "Reduced motion skips page and scroll animations", pass: true });
} finally {
  await fs.writeFile(
    "../../docs/evidence/p12.2/motion-browser-results.json",
    JSON.stringify(results, null, 2),
  );
  await browser.close();
}
console.log(JSON.stringify(results, null, 2));
