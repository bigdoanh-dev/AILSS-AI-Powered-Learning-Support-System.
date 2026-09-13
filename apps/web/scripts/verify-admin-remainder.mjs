import AxeBuilder from "@axe-core/playwright";
import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const base = process.env.BASE_URL || "http://127.0.0.1:4174";
const out = process.env.AILSS_QA_OUT || "../../docs/evidence/p12.9rc-admin-remainder";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
await fs.mkdir(out, { recursive: true });

const results = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const width of [375, 768, 1440, 1920]) {
    for (const role of ["ADMIN", "STUDENT"]) {
      const context = await browser.newContext({ viewport: { width, height: 950 } });
      const page = await context.newPage();
      const requests = [];
      const runtimeErrors = [];
      page.on("console", (message) => {
        if (message.type() === "error") runtimeErrors.push(`console: ${message.text()}`);
      });
      page.on("pageerror", (error) => runtimeErrors.push(`page: ${error.message}`));
      page.on("requestfailed", (request) =>
        runtimeErrors.push(
          `request: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`,
        ),
      );
      await page.route("**/api/v1/**", (route) =>
        route.fulfill({ status: 200, json: { data: [], meta: { pagination: { nextCursor: null } } } }),
      );
      await page.route("**/web-session/**", async (route) => {
        const request = route.request();
        const pathname = new URL(request.url()).pathname;
        if (pathname === "/web-session/bootstrap") {
          await route.fulfill({
            status: 200,
            json: {
              data: {
                userId: id(role === "ADMIN" ? 1 : 2),
                displayName: role === "ADMIN" ? "Admin An" : "Sinh viên Bình",
                role,
                status: "ACTIVE",
                lecturerVerified: false,
                profileVersion: 1,
              },
            },
          });
          return;
        }
        if (pathname === "/web-session/avatar") {
          requests.push({ method: request.method(), pathname, body: null });
          await route.fulfill({ status: 200, json: { data: null } });
          return;
        }
        if (role === "STUDENT" && request.method() === "GET") {
          const data = pathname.endsWith("/notifications") ? { items: [], page: { nextCursor: null } } : [];
          requests.push({ method: request.method(), pathname, body: null });
          await route.fulfill({ status: 200, json: { data } });
          return;
        }
        const body = request.postDataJSON();
        requests.push({
          method: request.method(),
          pathname,
          body,
          idempotencyKey: request.headers()["idempotency-key"],
        });
        const state = pathname.endsWith("/publish") ? "PUBLISHED" : "ARCHIVED";
        await route.fulfill({ status: 200, json: { data: { courseId: id(3), state } } });
      });

      await page.goto(`${base}/app/admin/courses`);
      if (role === "STUDENT") {
        await expect(page).toHaveURL(`${base}/app`);
        await expect(page.locator("main#main.workspace-content")).toBeVisible();
        await expect(page.getByRole("heading", { name: "Quản lý xuất bản khóa học." })).toHaveCount(0);
      } else {
        await expect(page.getByRole("heading", { name: "Quản lý xuất bản khóa học." })).toBeVisible();
        const form = page.locator("form.admin-action");
        await form.getByLabel("Mã khóa học").fill(id(3));
        await form.getByLabel("Mật khẩu quản trị viên hiện tại").fill("Admin-passphrase-42!");
        await form.getByRole("button", { name: "Xác nhận thao tác" }).click();
        await expect(form.getByRole("status")).toContainText("Đã xuất bản khóa học · PUBLISHED");
        await expect(form.getByLabel("Mật khẩu quản trị viên hiện tại")).toHaveValue("");

        await form.getByLabel("Thao tác").selectOption("archive");
        await form.getByLabel("Mật khẩu quản trị viên hiện tại").fill("Admin-passphrase-42!");
        await form.getByRole("button", { name: "Xác nhận thao tác" }).click();
        await expect(form.getByRole("status")).toContainText("Đã gửi yêu cầu lưu trữ khóa học · ARCHIVED");
        await expect(form.getByLabel("Mật khẩu quản trị viên hiện tại")).toHaveValue("");
        const actionRequests = requests.filter(
          (request) => request.method === "POST" && request.pathname.includes("/admin/courses/"),
        );
        expect(actionRequests).toHaveLength(2);
        expect(actionRequests.map((request) => request.pathname)).toEqual([
          `/web-session/admin/courses/${id(3)}/publish`,
          `/web-session/admin/courses/${id(3)}/archive`,
        ]);
        for (const request of actionRequests) {
          expect(request.body).toEqual({ currentPassword: "Admin-passphrase-42!" });
          expect(request.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
        }
      }

      await page.evaluate(() =>
        Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
            .map((animation) => animation.finished.catch(() => undefined)),
        ),
      );
      const storage = await page.evaluate(async () => ({
        local: { ...localStorage },
        session: { ...sessionStorage },
        indexedDb: "databases" in indexedDB ? (await indexedDB.databases()).map((item) => item.name) : [],
        historyState: history.state,
      }));
      const bodyText = await page.locator("body").innerText();
      const violations = (await new AxeBuilder({ page }).analyze()).violations.filter((violation) =>
        ["critical", "serious"].includes(violation.impact),
      );
      const secretExposed =
        page.url().includes("Admin-passphrase-42!") ||
        bodyText.includes("Admin-passphrase-42!") ||
        JSON.stringify(storage).includes("Admin-passphrase-42!");
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      await page.screenshot({ path: path.join(out, `${role.toLowerCase()}-${width}.png`), fullPage: true });
      const status =
        !runtimeErrors.length &&
        !violations.length &&
        !secretExposed &&
        !overflow &&
        !Object.keys(storage.local).length &&
        !Object.keys(storage.session).length &&
        !storage.indexedDb.length
          ? "PASS"
          : "FAIL";
      results.push({
        role,
        width,
        requests: requests.length,
        runtimeErrors,
        violations: violations.map((v) => v.id),
        secretExposed,
        overflow,
        storage,
        status,
      });
      await context.close();
    }
  }
} finally {
  await browser.close();
}

const status = results.every((result) => result.status === "PASS") ? "PASS" : "FAIL";
await fs.writeFile(
  path.join(out, "admin-remainder-results.json"),
  JSON.stringify({ status, results }, null, 2),
);
console.log(JSON.stringify(results));
if (status === "FAIL") process.exitCode = 1;
