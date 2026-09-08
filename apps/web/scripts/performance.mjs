import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const samples = [];
const evidence = process.env.AILSS_PERFORMANCE_DIR || "../../docs/evidence/p12.1";
for (let i = 0; i < 3; i++) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__p = { lcp: 0, cls: 0 };
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__p.lcp = e.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) window.__p.cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto("http://127.0.0.1:4174");
  await page.locator(".knowledge-scene img").evaluate((img) => img.decode());
  await page.waitForTimeout(1000);
  samples.push(
    await page.evaluate(() => ({
      ...window.__p,
      fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime,
      domContentLoaded: performance.getEntriesByType("navigation")[0].domContentLoadedEventEnd,
    })),
  );
  if (i === 0) {
    await page.locator(".workflow").scrollIntoViewIfNeeded();
    await page.locator(".workflow").screenshot({ path: `${evidence}/workflow-section.png` });
    await page
      .locator(".section")
      .filter({ has: page.getByRole("heading", { name: "Học theo nhịp của bạn." }) })
      .screenshot({ path: `${evidence}/student-section.png` });
    await page.locator("footer").screenshot({ path: `${evidence}/footer.png` });
  }
  await context.close();
}
await browser.close();
await fs.writeFile(
  process.env.AILSS_PERFORMANCE_OUT || "../../docs/evidence/p12.1/performance-samples.json",
  JSON.stringify(
    {
      environment:
        "Local production, Chrome, fresh contexts, 1440x1000, reduced motion, no CPU/network throttle; three sequential samples, not Lighthouse/field data.",
      samples,
    },
    null,
    2,
  ),
);
console.log(samples);
