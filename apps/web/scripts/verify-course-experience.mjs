import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
const timer = setTimeout(() => {
  console.error("Browser verification timed out");
  process.exit(1);
}, 90000);
const browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 15000 });
const base = "http://127.0.0.1:5173";
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const directory = new URL("../../../tmp/web-review/", import.meta.url);
  await mkdir(directory, { recursive: true });
  await page.goto(base + "/courses");
  await page.getByRole("heading", { name: "Python: lập trình từ nền tảng", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Học cùng giảng viên được đánh giá tốt" }).waitFor();
  await page.screenshot({ path: fileURLToPath(new URL("catalog-current.png", directory)), fullPage: true });
  console.log("Catalog, prices, reviews and instructors rendered");
  await page.goto(base + "/courses?mode=LIVE_COHORT");
  await page
    .getByRole("heading", { name: "JavaScript: làm chủ dữ liệu và tương tác", exact: true })
    .waitFor();
  if (await page.getByRole("heading", { name: "Python: lập trình từ nền tảng", exact: true }).count())
    throw Error("Live filter included self-paced course");
  console.log("Live cohort filter passed");
  await page.goto(base + "/");
  await page.getByRole("heading", { name: "Ba cách học. Chọn cách phù hợp với bạn." }).waitFor();
  await page.screenshot({ path: fileURLToPath(new URL("home-current.png", directory)), fullPage: true });
  const login = await context.request.post(base + "/web-session/login", {
    headers: { origin: base },
    data: { email: "student.demo@ailss.local", password: "AilssDemo!2026" },
  });
  if (!login.ok()) throw Error("Login " + login.status());
  const map = JSON.parse(await readFile(new URL("../../../tmp/course-media.json", import.meta.url), "utf8"));
  const [lessonId, item] = Object.entries(map).find(([, x]) => x.contentType === "video/mp4");
  const r = await context.request.get(base + "/web-session/student/lessons/" + lessonId);
  const j = await r.json();
  if (!r.ok() || !j.data.contentUrl) throw Error("Lesson enrichment " + r.status());
  const video = await context.request.get(base + j.data.contentUrl, { headers: { range: "bytes=0-1023" } });
  if (video.status() !== 206) throw Error("Video range " + video.status());
  await page.goto(base + "/app/learn/" + item.courseId + "/lessons/" + lessonId);
  await page.locator("video").waitFor();
  await page.screenshot({
    path: fileURLToPath(new URL("ielts-course-current.png", directory)),
    fullPage: true,
  });
  console.log("IELTS course lesson and authorized video streaming passed");
  await page.goto(base + "/courses");
  if (await page.getByRole("link", { name: "Đăng nhập", exact: true }).count())
    throw Error("Public header lost account");
  console.log("Public navigation preserves account");
  if (errors.length) throw Error(errors.join("\n"));
  await context.close();
  console.log("Browser verification passed");
} finally {
  await browser.close();
  clearTimeout(timer);
}
