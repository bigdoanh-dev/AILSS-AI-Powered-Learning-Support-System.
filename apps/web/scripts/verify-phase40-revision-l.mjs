import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { captureDurable } from "../../../scripts/acceptance/capture-phase40-durable.mjs";

const base = "http://127.0.0.1:4174", out = "../../artifacts/release-evidence/revision-l/browser";
await mkdir(out, { recursive: true });
const server = spawn(process.execPath, ["scripts/serve.mjs"], { env: { ...process.env, PORT: "4174", AILSS_WEB_ORIGIN: base, AILSS_GATEWAY_URL: "http://127.0.0.1:8080" }, stdio: ["ignore", "pipe", "pipe"] });
await new Promise((resolve, reject) => { server.stdout.once("data", resolve); server.once("error", reject); server.once("exit", (code) => reject(new Error(`web exited ${code}`))); });
const browser = await chromium.launch({ channel: "chrome", headless: true }), context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
page.setDefaultTimeout(70_000);
const network = [], servicesStopped = new Set();
page.on("response", (response) => { const url = new URL(response.url()); if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/web-session/")) network.push({ method: response.request().method(), path: url.pathname + url.search, status: response.status(), requestId: response.headers()["x-request-id"] ?? null, correlationId: response.headers()["x-correlation-id"] ?? null }); });
const docker = (action, name) => { const result = spawnSync("docker", [action, name], { encoding: "utf8" }); if (result.status !== 0) throw new Error(`docker ${action} ${name}: ${result.stderr}`); action === "stop" ? servicesStopped.add(name) : servicesStopped.delete(name); };
try {
  await page.goto(`${base}/auth/login`);
  await page.getByLabel("Email", { exact: true }).fill("student.demo@ailss.local");
  await page.getByLabel("Mật khẩu", { exact: true }).fill(process.env.AILSS_DEMO_STUDENT_PASSWORD || "AilssDemo!2026");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click(); await expect(page).toHaveURL(/\/auth\/result$/); await page.goto(`${base}/app`); await expect(page).toHaveURL(`${base}/app`);
  await page.goto(`${base}/app/study-plan`); await expect(page.getByRole("heading", { name: /Kế hoạch học tập cá nhân/ })).toBeVisible();
  const planSelect = page.locator("select").first(), planOption = planSelect.locator("option", { hasText: "Cassandra" }).first(); await planSelect.selectOption(await planOption.getAttribute("value"));
  await expect(page.getByText(/Required lesson:|Exam Prep:/).first()).toBeVisible(); await page.getByRole("button", { name: /Khoảng trống kỹ năng/ }).click(); await expect(page.getByText(/mục tiêu là/).first()).toBeVisible(); await page.screenshot({ path: `${out}/study-plan-positive.png`, fullPage: true });
  await page.goto(`${base}/app/ai-tutor`); const tutorSelect = page.getByLabel("Khóa học cho AI Tutor"); await tutorSelect.selectOption(await tutorSelect.locator("option", { hasText: "Cassandra" }).first().getAttribute("value"));
  await page.getByLabel("Nhập câu hỏi cho AI Tutor").fill("Giải thích phần tài liệu về khóa phân vùng Cassandra, mastery và kế hoạch học gì tiếp"); await page.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(page.getByText(/Nguồn:/).first()).toBeVisible({ timeout: 70_000 }); await expect(page.getByText(/Course v\d+ · Lesson v\d+/).first()).toBeVisible(); await page.screenshot({ path: `${out}/ai-tutor-grounded.png`, fullPage: true });
  const seed = JSON.parse(await readFile("../../artifacts/release-evidence/revision-l/seed-journal.json", "utf8"));
  const lecturerLogin = await fetch("http://127.0.0.1:8080/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "lecturer.demo@ailss.local", password: process.env.AILSS_DEMO_LECTURER_PASSWORD || "AilssLecturer!2026" }) });
  if (!lecturerLogin.ok) throw new Error(`BROWSER_SEED_LECTURER_LOGIN:${lecturerLogin.status}`);
  const lecturerToken = (await lecturerLogin.json()).data.accessToken;
  const lecturerPost = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:8080/api/v1${path}`, { method: "POST", headers: { authorization: `Bearer ${lecturerToken}`, "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify(body) });
    const value = await response.json();
    if (!response.ok) throw new Error(`BROWSER_SEED:${path}:${response.status}:${value.error?.code}`);
    return value.data;
  };
  const quiz = await lecturerPost("/quizzes", { title: `Revision L browser feedback ${randomUUID().slice(0, 8)}`, targetType: "COURSE", targetId: seed.courseId, opensAt: new Date(Date.now() - 60_000).toISOString(), closesAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), durationSeconds: 600, attemptLimit: 2, questions: [{ prompt: "Cassandra partition key groups related rows.", questionType: "TRUE_FALSE", correctAnswer: true, points: "10" }] });
  await lecturerPost(`/quizzes/${quiz.quizId}/publish`, {});
  const planPath = `/web-session/student/study-plan/current?courseId=${encodeURIComponent(seed.courseId)}`;
  const beforeResponse = await page.request.get(`${base}${planPath}`);
  if (!beforeResponse.ok()) throw new Error(`BROWSER_PLAN_BEFORE:${beforeResponse.status()}`);
  const beforePlan = (await beforeResponse.json()).data;
  const beforeDurable = await captureDurable({ studentId: seed.studentId, courseId: seed.courseId, quizId: quiz.quizId });
  await page.goto(`${base}/app/assessments/${quiz.quizId}`);
  await page.getByRole("button", { name: /Bắt đầu \/ tiếp tục làm bài/ }).click();
  try { await expect(page).toHaveURL(/\/app\/attempts\//, { timeout: 20_000 }); }
  catch (error) { throw new Error(`BROWSER_ATTEMPT_START_FAILED: ${await page.locator("main").innerText()}\n${error.message}`); }
  const resume = page.getByRole("button", { name: "Tải câu hỏi và tiếp tục" });
  await expect(resume.or(page.getByRole("heading", { name: "Trả lời câu hỏi" })).first()).toBeVisible({ timeout: 20_000 });
  if (await resume.isVisible()) await resume.click();
  await expect(page.getByRole("heading", { name: "Trả lời câu hỏi" })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Sai", { exact: true }).check();
  await page.getByRole("button", { name: "Nộp bài", exact: true }).click();
  await page.getByRole("button", { name: "Xác nhận nộp bài" }).click();
  await expect(page).toHaveURL(/\/app\/attempts\/[^/]+\/result$/);
  const submittedAttemptId = new URL(page.url()).pathname.split("/")[3];
  let afterPlan, planChanged = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const response = await page.request.get(`${base}${planPath}`);
    if (response.ok()) {
      afterPlan = (await response.json()).data;
      planChanged = afterPlan?.planId !== beforePlan?.planId || afterPlan?.updatedAt !== beforePlan?.updatedAt || JSON.stringify(afterPlan?.items) !== JSON.stringify(beforePlan?.items);
      if (planChanged) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  if (!planChanged) throw new Error("BROWSER_FEEDBACK_LOOP_NOT_OBSERVED");
  const afterDurable = await captureDurable({ studentId: seed.studentId, courseId: seed.courseId, quizId: quiz.quizId });
  const event = afterDurable.evidence.find((row) => row.sourceId === submittedAttemptId);
  if (beforeDurable.evidence.length !== 0 || !event || afterDurable.ingestion.find((row) => row.eventId === event.eventId)?.state !== "PROCESSED" || !afterDurable.mastery || !afterDurable.history.length || !afterDurable.plans.find((row) => row.planId === afterPlan.planId) || !afterDurable.currentPlanItems.length)
    throw new Error("BROWSER_DURABLE_FEEDBACK_INCOMPLETE");
  await writeFile(`${out}/durable-before-after.json`, `${JSON.stringify({ capturedAt: new Date().toISOString(), before: beforeDurable, after: afterDurable }, null, 2)}\n`);
  await page.goto(`${base}/app/study-plan`);
  await expect(page.getByRole("heading", { name: /Kế hoạch học tập cá nhân/ })).toBeVisible();
  await writeFile(`${out}/feedback-loop.json`, `${JSON.stringify({ submittedAttemptId, quizId: quiz.quizId, courseId: seed.courseId, beforePlanId: beforePlan?.planId, afterPlanId: afterPlan?.planId, beforeUpdatedAt: beforePlan?.updatedAt, afterUpdatedAt: afterPlan?.updatedAt, beforeItems: beforePlan?.items?.length, afterItems: afterPlan?.items?.length, planChanged }, null, 2)}\n`);
  await page.screenshot({ path: `${out}/study-plan-after-submission.png`, fullPage: true });
  docker("stop", "ailss-learning-service"); await page.goto(`${base}/app/study-plan`); await expect(page.getByRole("alert")).toBeVisible(); await page.screenshot({ path: `${out}/learning-down.png`, fullPage: true }); docker("start", "ailss-learning-service"); await new Promise((resolve) => setTimeout(resolve, 5_000));
  docker("stop", "ailss-ai-service"); await page.goto(`${base}/app/ai-tutor`); await page.getByLabel("Nhập câu hỏi cho AI Tutor").fill("Giải thích tài liệu Cassandra"); await page.getByRole("button", { name: "Gửi", exact: true }).click(); await expect(page.getByRole("alert")).toBeVisible(); await page.screenshot({ path: `${out}/ai-down.png`, fullPage: true }); docker("start", "ailss-ai-service");
  const required = ["/web-session/login", "/web-session/student/me/courses", "/web-session/student/study-plan/current", "/web-session/student/assistant/chat"]; for (const path of required) if (!network.some((entry) => entry.path.startsWith(path) && entry.status < 500)) throw new Error(`NETWORK_PROOF_MISSING:${path}`);
  await writeFile(`${out}/network-proof.json`, `${JSON.stringify({ generatedAt: new Date().toISOString(), origin: base, gateway: "http://127.0.0.1:8080", mockedRoutes: [], bffForwarding: "/web-session/student/* -> Gateway /api/v1/*", requests: network }, null, 2)}\n`); process.stdout.write(`${JSON.stringify({ browserGoldenPath: "PASS", feedbackLoop: "PASS", durableBeforeAfter: "PASS", degradedLearning: "PASS", degradedAi: "PASS", networkRequests: network.length })}\n`);
} finally { for (const name of servicesStopped) spawnSync("docker", ["start", name]); await context.close().catch(() => undefined); await browser.close().catch(() => undefined); server.kill("SIGTERM"); }
