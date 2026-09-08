import AxeBuilder from "@axe-core/playwright";
import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const base = process.env.AILSS_QA_URL || "http://127.0.0.1:5177",
  out = "../../docs/evidence/p12.7-ai",
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
await fs.mkdir(out, { recursive: true });
const graph = {
  lecturerId: id(1),
  courseId: id(2),
  documentId: id(3),
  extractionJobId: id(4),
  generationJobId: id(5),
  draftId: id(6),
  quizId: id(7),
};
const questions = [
  {
    id: "q1",
    order: 1,
    text: "CAP ưu tiên điều gì?",
    points: "1",
    type: "SINGLE_CHOICE",
    options: [
      { id: "a", text: "Consistency" },
      { id: "b", text: "Latency" },
    ],
    correctAnswer: { optionId: "a" },
  },
  {
    id: "q2",
    order: 2,
    text: "Chọn thuộc tính ACID",
    points: "2",
    type: "MULTIPLE_CHOICE",
    options: [
      { id: "a", text: "Atomicity" },
      { id: "b", text: "Isolation" },
      { id: "c", text: "Weather" },
    ],
    correctAnswer: { optionIds: ["a", "b"] },
  },
  {
    id: "q3",
    order: 3,
    text: "Snapshot là bất biến",
    points: "1",
    type: "TRUE_FALSE",
    correctAnswer: { value: true },
  },
  {
    id: "q4",
    order: 4,
    text: "Viết ACID",
    points: "1",
    type: "SHORT_ANSWER",
    correctAnswer: { acceptedAnswer: "ACID" },
  },
];
const draft = {
  draftId: graph.draftId,
  draftVersion: 1,
  validationStatus: "VALID",
  questionCount: 4,
  state: "AI_DRAFT",
  checksum: "a".repeat(64),
  content: { schemaVersion: "objective-v1", title: "Câu hỏi dữ liệu phân tán", questions },
  createdAt: "2026-09-07T01:00:00Z",
};
const browser = await chromium.launch({ channel: "chrome", headless: true }),
  report = [];
try {
  for (const width of [375, 768, 1440, 1920]) {
    const context = await browser.newContext({
        viewport: { width, height: 1000 },
        reducedMotion: width === 375 ? "reduce" : "no-preference",
      }),
      page = await context.newPage(),
      requests = [];
    let documentReads = 0,
      jobReads = 0;
    await page.route("**/*", async (route) => {
      const req = route.request(),
        u = new URL(req.url());
      if (u.hostname === "upload.ailss.test") return route.fulfill({ status: 200, body: "" });
      if (!u.pathname.startsWith("/web-session/")) return route.continue();
      const p = u.pathname.replace(/^\/web-session\/lecturer/, "");
      requests.push({ method: req.method(), path: p, body: req.postDataJSON?.(), headers: req.headers() });
      let data = {},
        meta = {};
      if (u.pathname === "/web-session/bootstrap")
        data = {
          userId: graph.lecturerId,
          displayName: "Giảng viên Lan",
          role: "LECTURER",
          status: "ACTIVE",
          lecturerVerified: true,
          profileVersion: 1,
        };
      else if (p === "/ai/usage")
        data = { day: "2026-09-07", limit: 50, reserved: 4, consumed: 10, remaining: 36 };
      else if (p === "/courses") data = [{ courseId: graph.courseId, title: "Dữ liệu phân tán" }];
      else if (p === "/me/owned-classes") data = [];
      else if (p === "/ai/jobs") data = [];
      else if (p === "/ai/documents/upload-intents")
        data = {
          documentId: graph.documentId,
          objectKey: "EPHEMERAL-PRIVATE-OBJECT",
          uploadUrl: "https://upload.ailss.test/ephemeral",
          status: "UPLOAD_PENDING",
          version: 1,
        };
      else if (p === `/ai/documents/${graph.documentId}/complete`)
        data = { documentId: graph.documentId, status: "EXTRACTION_QUEUED", version: 2 };
      else if (p === `/ai/documents/${graph.documentId}`) {
        documentReads += 1;
        data = {
          documentId: graph.documentId,
          fileName: "hoc-lieu.txt",
          contentType: "text/plain",
          sizeBytes: 20,
          sha256: "b".repeat(64),
          status: documentReads < 2 ? "EXTRACTION_QUEUED" : "EXTRACTED",
          version: documentReads < 2 ? 2 : 4,
          createdAt: "2026-09-07T00:00:00Z",
          updatedAt: "2026-09-07T00:01:00Z",
        };
      } else if (p === "/ai/quiz-jobs")
        data = {
          jobId: graph.generationJobId,
          jobKind: "QUIZ_GENERATION",
          state: "QUEUED",
          version: 1,
          targetType: "COURSE",
          targetId: graph.courseId,
          documentId: graph.documentId,
          createdAt: "2026-09-07T01:00:00Z",
          updatedAt: "2026-09-07T01:00:00Z",
        };
      else if (p === `/ai/jobs/${graph.generationJobId}`) {
        const states = ["QUEUED", "PROCESSING", "VALIDATING", "AI_DRAFT"],
          state = states[Math.min(jobReads++, 3)];
        data = {
          jobId: graph.generationJobId,
          jobKind: "QUIZ_GENERATION",
          state,
          version: Math.min(jobReads, 4),
          targetType: "COURSE",
          targetId: graph.courseId,
          documentId: graph.documentId,
          draftId: state === "AI_DRAFT" ? graph.draftId : undefined,
          createdAt: "2026-09-07T01:00:00Z",
          updatedAt: "2026-09-07T01:01:00Z",
        };
      } else if (p === `/ai/jobs/${graph.generationJobId}/drafts`) data = [draft];
      else if (p === `/ai/drafts/${graph.draftId}/approve`)
        data = {
          jobId: graph.generationJobId,
          draftId: graph.draftId,
          state: "APPROVED",
          approvedDraftVersion: 2,
          assessment: { quizId: graph.quizId, quizVersion: 1, status: "DRAFT" },
        };
      await route.fulfill({ status: 200, json: { data, meta } });
    });
    await page.goto(`${base}/app/teaching/ai`);
    await expect(page.getByRole("heading", { name: "Tạo câu hỏi từ học liệu." })).toBeVisible();
    await page.getByLabel("Tệp PDF, DOCX hoặc TXT").setInputFiles({
      name: "hoc-lieu.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Nội dung dữ liệu phân tán"),
    });
    await page.getByRole("button", { name: "Tải tài liệu" }).click();
    await expect(page.getByText("Sẵn sàng sử dụng").first()).toBeVisible({ timeout: 10000 });
    await page.getByLabel("Khóa học hoặc lớp").selectOption(graph.courseId);
    await page.getByRole("button", { name: "Tạo câu hỏi từ học liệu" }).click();
    await expect(page.getByText("Bản nháp đã sẵn sàng").first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("textbox", { name: "Nội dung" })).toHaveValue("CAP ưu tiên điều gì?");
    await page.getByLabel("Nội dung").fill("CAP yêu cầu đánh đổi điều gì?");
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Phê duyệt và tạo bài kiểm tra nháp" }).click();
    await expect(page.getByRole("heading", { name: "Đã tạo bài kiểm tra nháp." })).toBeVisible();
    await expect(page.getByRole("link", { name: "Mở bài kiểm tra trong Assessment" })).toHaveAttribute(
      "href",
      `/app/teaching/assessments/${graph.quizId}`,
    );
    const approval = requests.find((x) => x.path.endsWith("/approve"));
    expect(approval.headers["if-match"]).toBe('"v1"');
    expect(approval.body.reviewedDraft.title).toBe(draft.content.title);
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(
      /EPHEMERAL-PRIVATE-OBJECT|upload\.ailss|Service JWS|Actor Context|provider raw/i,
    );
    const storage = await page.evaluate(async () => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
      databases: await indexedDB.databases(),
    }));
    expect(storage.local).toEqual({});
    expect(storage.session).toEqual({});
    expect(storage.databases).toEqual([]);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(axe.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `${out}/ai-${width}.png`, fullPage: true });
    report.push({
      width,
      status: "PASS",
      graph,
      documentReads,
      jobStates: ["QUEUED", "PROCESSING", "VALIDATING", "AI_DRAFT"],
      requests: requests.length,
      storage,
    });
    await context.close();
  }
} finally {
  await browser.close();
}
await fs.writeFile(`${out}/ai-results.json`, JSON.stringify({ status: "PASS", graph, report }, null, 2));
console.log(JSON.stringify(report));
