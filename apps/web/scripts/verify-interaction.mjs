import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const base = process.env.BASE_URL || "http://127.0.0.1:4174",
  out = process.env.AILSS_QA_OUT || fileURLToPath(new URL("../../../docs/evidence/p12.8/", import.meta.url));
await fs.mkdir(out, { recursive: true });
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const roles = ["STUDENT", "LECTURER", "ADMIN"],
  widths = [375, 768, 1440, 1920],
  report = [];
for (const role of roles)
  for (const width of widths) {
    const browser = await chromium.launch({ channel: "chrome", headless: true }),
      context = await browser.newContext({ viewport: { width, height: 900 } }),
      page = await context.newPage();
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
    page.on("requestfailed", (request) =>
      errors.push(
        `request: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`,
      ),
    );
    await page.route("**/web-session/**", async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname;
      let data = {};
      if (path.endsWith("/bootstrap"))
        data = {
          userId: id(1),
          displayName: role,
          role,
          status: "ACTIVE",
          profileVersion: 1,
          lecturerVerified: role === "LECTURER",
        };
      else if (path.includes("interaction-reports"))
        data = path.endsWith("moderate")
          ? { reportId: id(3), state: "RESOLVED", version: 2 }
          : [
              {
                reportId: id(3),
                targetType: "COMMENT",
                targetId: id(2),
                state: "OPEN",
                decision: null,
                version: 1,
                createdAt: "2026-09-07T00:00:00Z",
                updatedAt: "2026-09-07T00:00:00Z",
              },
            ];
      else if (path.includes("/comments"))
        data = [
          {
            commentId: id(2),
            authorId: id(9),
            parentId: null,
            body: "Câu hỏi về nội dung khóa học",
            state: "ACTIVE",
            version: 1,
            createdAt: "2026-09-07T00:00:00Z",
          },
        ];
      else if (path.includes("/notifications"))
        data = {
          items: [
            {
              notificationId: id(4),
              title: "Thông báo lớp",
              body: "Buổi học bắt đầu lúc 19:00",
              createdAt: "2026-09-07T00:00:00Z",
              readAt: null,
              locator: "opaque_LOCATOR",
              source: { type: "CLASS_ANNOUNCEMENT", contextId: id(5) },
            },
          ],
          page: { month: "2026-09", nextCursor: null },
        };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data, meta: { page: { nextCursor: null } } }),
      });
    });
    const target =
      role === "ADMIN"
        ? "/app/admin/moderation"
        : role === "LECTURER"
          ? `/app/teaching/discussion/COURSE/${id(6)}`
          : "/app/notifications";
    await page.goto(base + target);
    await page.waitForLoadState("networkidle");
    await page.locator("main#main.workspace-content").waitFor();
    if (role === "STUDENT") await page.getByText("Thông báo lớp").waitFor();
    if (role === "LECTURER") await page.getByText("Câu hỏi về nội dung khóa học").waitFor();
    if (role === "ADMIN")
      await page.getByRole("heading", { name: "Hàng đợi nội dung được báo cáo." }).waitFor();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    if (role === "ADMIN") await page.getByText(id(2)).click();
    if (role === "STUDENT") {
      const link = page.getByRole("link", { name: /Xem lớp học/ });
      if (await link.count()) {
        const href = await link.getAttribute("href");
        if (href !== `/app/classes/${id(5)}`) throw Error("unsafe deep link");
      }
    }
    await page.waitForFunction(() =>
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .every((animation) => animation.playState === "finished"),
    );
    const violations = (await new AxeBuilder({ page }).analyze()).violations
      .filter((v) => v.impact === "critical" || v.impact === "serious")
      .map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.map((node) => ({ target: node.target, summary: node.failureSummary })),
      }));
    await page.screenshot({ path: path.join(out, `${role.toLowerCase()}-${width}.png`), fullPage: true });
    report.push({
      role,
      width,
      target,
      overflow,
      errors,
      violations,
      status: !overflow && !errors.length && !violations.length ? "PASS" : "FAIL",
    });
    await browser.close();
  }
await fs.writeFile(
  path.join(out, "interaction-results.json"),
  JSON.stringify({ status: report.every((x) => x.status === "PASS") ? "PASS" : "FAIL", report }, null, 2),
);
console.log(JSON.stringify(report));
if (report.some((x) => x.status !== "PASS")) process.exitCode = 1;
