import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const origin = process.env.AILSS_WEB_ORIGIN || "http://127.0.0.1:5173";
const fixture = Object.fromEntries(
  (await readFile(new URL("../../../.env.media-acceptance", import.meta.url), "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);
const evidence = process.env.PHASE42_BROWSER_EVIDENCE_DIR
  ? pathToFileURL(`${resolve(process.env.PHASE42_BROWSER_EVIDENCE_DIR)}/`)
  : new URL("../../../docs/evidence/phase42-b/", import.meta.url);
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
async function authenticated(email, password) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const login = await context.request.post(`${origin}/web-session/login`, {
    headers: { origin },
    data: { email, password },
  });
  assert.equal(login.status(), 200, `Browser session login: ${login.status()}`);
  return context;
}
try {
  const student = await authenticated(fixture.PHASE42_STUDENT_EMAIL, fixture.PHASE42_STUDENT_PASSWORD);
  const page = await student.newPage();
  const errors = [],
    mediaResponses = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.url().includes("/playback/") || response.url().includes("/media-session"))
      mediaResponses.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
  await page.goto(`${origin}/app/learn/${fixture.PHASE42_COURSE_ID}/lessons/${fixture.PHASE42_LESSON_ID}`);
  assert.ok(
    page.url().includes(`/app/learn/${fixture.PHASE42_COURSE_ID}/lessons/${fixture.PHASE42_LESSON_ID}`),
  );
  assert.match(await page.title(), /AILSS/i);
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  const skipIntro = page.getByRole("button", { name: "Bỏ qua" });
  if (await skipIntro.isVisible()) await skipIntro.click();
  await expect(page.locator(".cinematic-intro-overlay")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Video bài giảng" })).toBeVisible();
  await expect(page.getByLabel("Tốc độ phát")).toBeVisible();
  const video = page.getByRole("region", { name: "Video bài giảng" }).locator("video");
  await expect
    .poll(() => video.evaluate((element) => element.readyState), { timeout: 30000 })
    .toBeGreaterThan(0);
  await video.evaluate((element) => element.play());
  await expect
    .poll(() => video.evaluate((element) => element.currentTime), { timeout: 20000 })
    .toBeGreaterThan(0);
  assert.ok(mediaResponses.some((entry) => entry.path.endsWith("/media-session") && entry.status === 200));
  assert.ok(mediaResponses.some((entry) => entry.path.endsWith("master.m3u8") && entry.status === 200));
  assert.ok(mediaResponses.some((entry) => /variant-\d+\.m3u8$/.test(entry.path) && entry.status === 200));
  assert.ok(mediaResponses.some((entry) => entry.path.endsWith(".ts") && entry.status === 200));
  const captions = page.getByLabel("Chọn phụ đề");
  await expect(captions).toBeVisible();
  await captions.selectOption({ label: "Tiếng Việt" });
  await expect
    .poll(
      () =>
        video.evaluate((element) =>
          Array.from(element.textTracks).some(
            (track) => track.mode === "showing" && (track.activeCues?.length ?? 0) > 0,
          ),
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
  assert.ok(mediaResponses.some((entry) => entry.path.endsWith(".vtt") && entry.status === 200));
  await expect(video).toHaveAttribute("poster", /poster\.jpg\?token=/);
  assert.deepEqual(errors, []);
  await expect(page.getByText("Video đã sẵn sàng. Dùng nút phát để bắt đầu.")).toBeVisible();
  await video.scrollIntoViewIfNeeded();
  await page.evaluate(() => globalThis.scrollTo(0, 0));
  await page.screenshot({ path: fileURLToPath(new URL("student-playback.png", evidence)), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("region", { name: "Video bài giảng" })).toBeVisible();
  await expect(page.getByLabel("Tốc độ phát")).toBeVisible();
  await page.screenshot({
    path: fileURLToPath(new URL("student-playback-mobile.png", evidence)),
    fullPage: true,
  });
  results.push(
    "Entitled student plays real protected HLS and selected WebVTT captions in Chrome; playlist, segment and caption return 200",
  );
  await student.close();

  const other = await authenticated(fixture.PHASE42_OTHER_EMAIL, fixture.PHASE42_OTHER_PASSWORD);
  const denial = await other.request.post(
    `${origin}/web-session/student/lessons/${fixture.PHASE42_LESSON_ID}/media-session`,
    { headers: { origin }, data: {} },
  );
  assert.equal(denial.status(), 403);
  results.push("Non-entitled browser session is denied at media-session endpoint");
  await other.close();

  const lecturer = await authenticated(fixture.PHASE42_LECTURER_EMAIL, fixture.PHASE42_LECTURER_PASSWORD);
  const author = await lecturer.newPage();
  await author.goto(`${origin}/app/teaching/lessons/${fixture.PHASE42_LESSON_ID}`);
  const skipAuthorIntro = author.getByRole("button", { name: "Bỏ qua" });
  if (await skipAuthorIntro.isVisible()) await skipAuthorIntro.click();
  await expect(author.locator(".cinematic-intro-overlay")).toHaveCount(0);
  await expect(author.getByRole("region", { name: "Video bài giảng riêng tư" })).toBeVisible();
  await expect(author.getByText(/Sẵn sàng.*source\.mp4/)).toBeVisible({ timeout: 15000 });
  await expect(author.getByRole("button", { name: "Gắn video đã xử lý vào bài học" })).toBeVisible();
  await author.screenshot({ path: fileURLToPath(new URL("lecturer-media.png", evidence)), fullPage: true });
  results.push("Lecturer sees real READY asset and attach action in existing lesson UI");
  await lecturer.close();

  await writeFile(
    new URL("browser.md", evidence),
    `# Phase 42 browser acceptance\n\nGenerated: ${new Date().toISOString()}\nOrigin: ${origin}\nChrome headless, no network mocks.\n\n${results.map((result) => `- PASS: ${result}`).join("\n")}\n`,
  );
  console.log(`PHASE42_BROWSER_PASS ${results.length} checks`);
} finally {
  await browser.close();
}
