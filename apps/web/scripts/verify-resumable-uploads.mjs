import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const origin = process.env.AILSS_WEB_ORIGIN || "http://127.0.0.1:5173";
const gateway = "http://127.0.0.1:8080";
const fixture = Object.fromEntries(
  (await readFile(new URL("../../../.env.media-acceptance", import.meta.url), "utf8"))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);
const sourceFile = process.env.AILSS_MEDIA_SOURCE_FILE || fixture.PHASE42_SOURCE_FILE;
const profile = await mkdtemp(path.join(tmpdir(), "ailss-media-resume-browser-"));
async function api(token, route, method, body) {
  const response = await fetch(`${gateway}/api/v1${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const value = await response.json();
  assert.ok(response.ok, `${route}: HTTP ${response.status} ${value.error?.code ?? ""}`);
  return value.data;
}
async function browser() {
  const context = await chromium.launchPersistentContext(profile, { channel: "chrome", headless: true });
  const login = await context.request.post(`${origin}/web-session/login`, {
    headers: { origin },
    data: { email: fixture.PHASE42_LECTURER_EMAIL, password: fixture.PHASE42_LECTURER_PASSWORD },
  });
  assert.equal(login.status(), 200, "Lecturer browser login");
  return context;
}
let context;
try {
  const auth = await fetch(`${gateway}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: fixture.PHASE42_LECTURER_EMAIL,
      password: fixture.PHASE42_LECTURER_PASSWORD,
    }),
  });
  assert.equal(auth.status, 200, "Lecturer API login");
  const token = (await auth.json()).data.accessToken;
  const course = await api(token, "/courses", "POST", {
    title: "Phase42 Browser Restart Resume",
    slug: `phase42-resume-${randomUUID()}`,
    categoryId: randomUUID(),
    priceType: "FREE",
    price: "0",
    currency: "VND",
  });
  const lesson = await api(token, `/courses/${course.courseId}/lessons`, "POST", {
    title: "Restartable media upload",
    sectionTitle: "Media",
    preview: false,
    position: { sectionOrder: 1, lessonOrder: 1 },
  });
  const url = `${origin}/app/teaching/lessons/${lesson.lessonId}`;
  context = await browser();
  let page = await context.newPage();
  let interrupted = false;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const target = new URL(request.url());
    if (!interrupted && request.method() === "PUT" && target.searchParams.get("partNumber") === "2") {
      interrupted = true;
      await route.abort("failed");
    } else await route.continue();
  });
  await page.goto(url);
  const intro = page.getByRole("button", { name: "Bỏ qua" });
  if (await intro.isVisible()) await intro.click();
  await expect(page.getByRole("region", { name: "Video bài giảng riêng tư" })).toBeVisible();
  await page.getByLabel("Chọn video MP4 hoặc WebM").setInputFiles(sourceFile);
  await page.getByRole("button", { name: "Tải video / thử lại phần còn thiếu" }).click();
  await expect.poll(() => interrupted, { timeout: 60_000 }).toBe(true);
  const progress = await page.getByRole("status").allTextContents();
  console.log(`Upload interruption UI: ${progress.join(" | ")}`);
  const record = await page.evaluate(
    ({ courseId, lessonId }) => {
      const key = Object.keys(localStorage).find(
        (candidate) =>
          candidate.endsWith(`:${courseId}:${lessonId}`) && candidate.startsWith("ailss:media-upload:"),
      );
      return key ? JSON.parse(localStorage.getItem(key) ?? "null") : null;
    },
    { courseId: course.courseId, lessonId: lesson.lessonId },
  );
  assert.ok(record?.id, "Upload asset ID persisted without storing credentials");
  const prior = await api(token, `/media-assets/${record.id}/upload`, "GET");
  assert.deepEqual(
    prior.parts.map((part) => part.part),
    [1],
    "S3 confirms first part before browser restart",
  );
  await context.close();
  context = await browser();
  page = await context.newPage();
  let repeatedFirst = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && new URL(request.url()).searchParams.get("partNumber") === "1")
      repeatedFirst++;
  });
  await page.goto(url);
  const reopenedIntro = page.getByRole("button", { name: "Bỏ qua" });
  if (await reopenedIntro.isVisible()) await reopenedIntro.click();
  await expect(page.getByText(/Có phiên tải lên chưa hoàn tất/)).toBeVisible();
  await page.getByLabel("Chọn video MP4 hoặc WebM").setInputFiles(sourceFile);
  await page.getByRole("button", { name: "Tải video / thử lại phần còn thiếu" }).click();
  await expect(page.getByText(/Đã tải lên. Đang kiểm tra/)).toBeVisible({ timeout: 120_000 });
  assert.equal(repeatedFirst, 0, "Already uploaded part is not re-uploaded");
  const completed = await api(token, `/media-assets/${record.id}`, "GET");
  assert.ok(["VERIFYING", "QUEUED", "PROCESSING", "READY"].includes(completed.status));
  console.log("PHASE42_BROWSER_RESTART_RESUME_PASS 5 checks");
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
