import AxeBuilder from "@axe-core/playwright";
import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const base = process.env.AILSS_QA_URL || "http://127.0.0.1:5177",
  out = "../../docs/evidence/p12.6-assessment",
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
await fs.mkdir(out, { recursive: true });
const graph = { courseId: id(1), quizId: id(2), lecturerId: id(3), studentId: id(4), attemptId: id(5) };
const questions = [
  {
    questionId: id(10),
    questionOrder: 1,
    prompt: "CAP chọn điều gì?",
    questionType: "SINGLE_CHOICE",
    options: ["Consistency", "Latency"],
    correctAnswer: "Consistency",
    points: "1",
  },
  {
    questionId: id(11),
    questionOrder: 2,
    prompt: "Chọn thuộc tính đúng",
    questionType: "MULTIPLE_CHOICE",
    options: ["Atomicity", "Isolation", "Weather"],
    correctAnswer: ["Atomicity", "Isolation"],
    points: "2",
  },
  {
    questionId: id(12),
    questionOrder: 3,
    prompt: "Snapshot là bất biến",
    questionType: "TRUE_FALSE",
    correctAnswer: true,
    points: "1",
  },
  {
    questionId: id(13),
    questionOrder: 4,
    prompt: "Viết ACID",
    questionType: "SHORT_ANSWER",
    correctAnswer: "ACID",
    points: "1",
  },
];
const quiz = {
  quizId: graph.quizId,
  targetType: "COURSE",
  targetId: graph.courseId,
  ownerId: graph.lecturerId,
  title: "Kiểm tra dữ liệu phân tán",
  state: "PUBLISHED",
  currentVersion: 2,
  recordVersion: 3,
  questionCount: 4,
  durationSeconds: 1800,
  attemptLimit: 2,
  questions,
};
const safeQuestions = questions.map((question) =>
    Object.fromEntries(Object.entries(question).filter(([key]) => key !== "correctAnswer")),
  ),
  attempt = {
    attemptId: graph.attemptId,
    quizId: graph.quizId,
    quizVersion: 2,
    attemptNo: 1,
    state: "IN_PROGRESS",
    startedAt: "2026-09-07T01:00:00Z",
    deadlineAt: "2027-09-07T01:30:00Z",
    version: 1,
    questions: safeQuestions,
  };
const browser = await chromium.launch({ channel: "chrome", headless: true }),
  report = [];
try {
  for (const width of [375, 768, 1440, 1920]) {
    for (const role of ["LECTURER", "STUDENT"]) {
      const context = await browser.newContext({
          viewport: { width, height: 1000 },
          reducedMotion: "reduce",
        }),
        page = await context.newPage(),
        requests = [];
      let published = false;
      await page.route("**/web-session/**", async (route) => {
        const req = route.request(),
          u = new URL(req.url()),
          p = u.pathname.replace(/^\/web-session\/(lecturer|student)/, "");
        requests.push({ method: req.method(), path: p, body: req.postDataJSON?.() });
        let data = {};
        if (u.pathname === "/web-session/bootstrap")
          data = {
            userId: role === "LECTURER" ? graph.lecturerId : graph.studentId,
            displayName: role,
            role,
            status: "ACTIVE",
            lecturerVerified: role === "LECTURER",
            profileVersion: 1,
          };
        else if (p === `/quizzes/${graph.quizId}`)
          data =
            role === "LECTURER"
              ? { ...quiz, state: published ? "PUBLISHED" : "DRAFT" }
              : { ...quiz, ownerId: undefined, questions: safeQuestions };
        else if (p === `/quizzes/${graph.quizId}/publish`) {
          published = true;
          data = { ...quiz, state: "PUBLISHED" };
        } else if (p.startsWith(`/quizzes/${graph.quizId}/results`)) data = { items: [] };
        else if (p === `/attempts/${graph.attemptId}`) data = { ...attempt, questions: undefined };
        else if (p === `/quizzes/${graph.quizId}/attempts`) data = attempt;
        else if (p === `/attempts/${graph.attemptId}/submit`)
          data = {
            attemptId: graph.attemptId,
            quizId: graph.quizId,
            score: "5",
            maxScore: "5",
            submittedAt: "2026-09-07T01:10:00Z",
            resultVersion: 1,
          };
        else if (p === `/attempts/${graph.attemptId}/result`)
          data = {
            attemptId: graph.attemptId,
            quizId: graph.quizId,
            score: "5",
            maxScore: "5",
            submittedAt: "2026-09-07T01:10:00Z",
            resultVersion: 1,
          };
        await route.fulfill({ status: 200, json: { data } });
      });
      if (role === "LECTURER") {
        await page.goto(`${base}/app/teaching/assessments/${graph.quizId}`);
        await expect(page.getByText("Phiên bản hiện tại: v2")).toBeVisible();
        await page.getByRole("button", { name: "Xem trước" }).click();
        await expect(page.getByText(/Đáp án đúng/).first()).toBeVisible();
        await page.getByRole("button", { name: "Đóng xem trước" }).click();
        page.once("dialog", (dialog) => dialog.accept());
        await page.getByRole("button", { name: "Xuất bản" }).click();
        await expect
          .poll(() => requests.some((x) => x.method === "POST" && x.path.endsWith("/publish")))
          .toBe(true);
        await page.getByRole("link", { name: /Xem kết quả/ }).click();
        await expect(page.getByText("Chưa có kết quả trong tháng này.")).toBeVisible();
      } else {
        await page.goto(`${base}/app/assessments/${graph.quizId}`);
        expect(requests.some((x) => x.method === "POST")).toBe(false);
        expect(await page.locator("body").innerText()).not.toContain("Đáp án đúng");
        await page.goto(`${base}/app/attempts/${graph.attemptId}`);
        await expect(page.getByText(/Tiếp tục lần làm bài/)).toBeVisible();
        await page.getByRole("button", { name: "Tải câu hỏi và tiếp tục" }).click();
        await expect(page.getByText("CAP chọn điều gì?")).toBeVisible();
        expect(await page.locator("body").innerText()).not.toContain("correctAnswer");
        await page.getByLabel("Consistency").check();
        await page.getByLabel("Atomicity").check();
        await page.getByLabel("Isolation").check();
        await page.getByLabel("Đúng").check();
        await page.getByLabel("Câu trả lời ngắn").fill("ACID");
        await page.getByRole("button", { name: "Nộp bài", exact: true }).click();
        await expect(page.getByText("Đã trả lời: 4. Chưa trả lời: 0.")).toBeVisible();
        await page.getByRole("button", { name: "Xác nhận nộp bài" }).click();
        await expect(page.getByText("5 / 5")).toBeVisible();
        const submitted = requests.find((x) => x.path.endsWith("/submit"));
        expect(Object.keys(submitted.body.answers[0]).sort()).toEqual(["questionId", "selectedOptionId"]);
        const storage = await page.evaluate(() => ({
          local: { ...localStorage },
          session: { ...sessionStorage },
        }));
        expect(storage).toEqual({ local: {}, session: {} });
      }
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(axe.violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      await page.screenshot({ path: `${out}/${role.toLowerCase()}-${width}.png`, fullPage: true });
      report.push({ width, role, status: "PASS", graph, requests: requests.length });
      await context.close();
    }
  }
} finally {
  await browser.close();
}
await fs.writeFile(
  `${out}/assessment-results.json`,
  JSON.stringify({ status: "PASS", graph, report }, null, 2),
);
console.log(JSON.stringify(report));
