import AxeBuilder from "@axe-core/playwright";
import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";

const base = process.env.AILSS_QA_URL || "http://127.0.0.1:4174";
const out = process.env.AILSS_QA_OUT || "../../docs/evidence/p12.9r-direct-lecturer";
const lecturerId = "00000000-0000-4000-8000-000000000021";
const common = {
  userId: lecturerId,
  displayName: "Giảng viên Trực tiếp",
  emailMasked: "g***@example.test",
  role: "LECTURER",
  status: "ACTIVE",
  profileVersion: 1,
  createdAt: "2026-09-13T00:00:00Z",
  updatedAt: "2026-09-13T00:00:00Z",
};
const admin = {
  ...common,
  userId: "00000000-0000-4000-8000-000000000001",
  displayName: "Admin An",
  emailMasked: "a***@example.test",
  role: "ADMIN",
  lecturerVerified: false,
};

await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
try {
  for (const width of [375, 768, 1440, 1920]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: width === 375 ? "reduce" : "no-preference",
    });
    const page = await context.newPage();
    const pageErrors = [];
    const failedRequests = [];
    const calls = [];
    let profile = null;
    let verified = false;
    let loginActor = "LECTURER";
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => failedRequests.push(request.url()));
    await page.route("**/web-session/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      calls.push(`${request.method()}:${url.pathname}`);
      if (url.pathname === "/web-session/bootstrap") {
        if (!profile) return route.fulfill({ status: 401, json: { error: { code: "SESSION_EXPIRED" } } });
        return route.fulfill({ status: 200, json: { data: profile } });
      }
      if (url.pathname === "/web-session/register") {
        const body = request.postDataJSON();
        expect(body.role).toBe("LECTURER");
        expect(body).not.toHaveProperty("lecturerVerified");
        expect(request.headers()["idempotency-key"]).toBeTruthy();
        return route.fulfill({ status: 200, json: { data: { userId: lecturerId } } });
      }
      if (url.pathname === "/web-session/login") {
        profile =
          loginActor === "ADMIN"
            ? admin
            : { ...common, lecturerVerified: verified, profileVersion: verified ? 2 : 1 };
        return route.fulfill({ status: 200, json: { data: profile } });
      }
      if (url.pathname === `/web-session/admin/users/${lecturerId}`) {
        return route.fulfill({
          status: 200,
          json: { data: { ...common, lecturerVerified: verified, profileVersion: verified ? 2 : 1 } },
        });
      }
      if (url.pathname === `/web-session/admin/lecturers/${lecturerId}/verify`) {
        expect(request.method()).toBe("POST");
        expect(request.postDataJSON()).toEqual({ currentPassword: "Fixture-Only-Admin123!" });
        expect(request.headers()["idempotency-key"]).toBeTruthy();
        verified = true;
        return route.fulfill({ status: 200, json: { data: { userId: lecturerId, lecturerVerified: true } } });
      }
      return route.fulfill({ status: 200, json: { data: [] } });
    });

    await page.goto(base + "/auth/register/lecturer");
    await page.getByLabel("Email", { exact: true }).fill("lecturer@example.test");
    await page.getByLabel("Họ và tên", { exact: true }).fill(common.displayName);
    await page.getByLabel("Mật khẩu", { exact: true }).fill("Fixture-Only-Lecturer123!");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Tạo tài khoản" }).click();
    await expect(page.getByRole("heading", { name: "Đăng ký thành công" })).toBeVisible();

    profile = null;
    loginActor = "LECTURER";
    await page.goto(base + "/auth/login");
    await page.getByLabel("Email", { exact: true }).fill("lecturer@example.test");
    await page.getByLabel("Mật khẩu", { exact: true }).fill("Fixture-Only-Lecturer123!");
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Đăng nhập thành công" })).toBeVisible();
    await page.getByRole("link", { name: "Tiếp tục", exact: true }).click();
    await expect(page.getByRole("heading", { name: `Chào mừng, ${common.displayName}.` })).toBeVisible();
    await page.goto(base + "/app/teaching");
    await expect(page.getByRole("heading", { name: "Cần xác minh tài khoản." })).toBeVisible();

    profile = admin;
    loginActor = "ADMIN";
    await page.goto(base + `/app/admin/users/${lecturerId}`);
    await expect(page.getByRole("heading", { name: common.displayName })).toBeVisible();
    await expect(page.getByText("Chưa xác minh", { exact: true })).toBeVisible();
    await page.getByLabel("Mật khẩu quản trị viên", { exact: true }).fill("Fixture-Only-Admin123!");
    await page.getByRole("button", { name: "Xác minh giảng viên", exact: true }).click();
    await expect(page.getByText("Đã xác minh", { exact: true })).toBeVisible();

    profile = null;
    loginActor = "LECTURER";
    await page.goto(base + "/auth/login");
    await page.getByLabel("Email", { exact: true }).fill("lecturer@example.test");
    await page.getByLabel("Mật khẩu", { exact: true }).fill("Fixture-Only-Lecturer123!");
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await page.getByRole("link", { name: "Tiếp tục", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Không gian giảng dạy của bạn/ })).toBeVisible();

    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => undefined)),
      ),
    );
    const violations = (await new AxeBuilder({ page }).analyze()).violations;
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    const storage = await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    }));
    expect(violations).toEqual([]);
    expect(overflow).toBe(false);
    expect(storage).toEqual({ local: 0, session: 0 });
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
    await page.screenshot({ path: `${out}/verified-lecturer-${width}.png`, fullPage: true });
    results.push({ width, status: "PASS", calls: calls.length, storage, pageErrors });
    await context.close();
  }
} finally {
  await browser.close();
}

await fs.writeFile(
  `${out}/report.json`,
  JSON.stringify(
    { status: "PASS", scope: "separate deterministic direct Lecturer onboarding", results },
    null,
    2,
  ),
);
console.log(JSON.stringify({ status: "PASS", viewports: results.length }));
