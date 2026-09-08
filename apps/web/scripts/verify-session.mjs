import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const out = process.env.AILSS_SESSION_OUT || "../../docs/evidence/p12.2";
await fs.mkdir(out, { recursive: true });
let mode = "ok",
  refreshes = 0,
  generation = 0,
  registerAttempts = 0;
const keys = [];
const profile = {
  userId: "12345678-1234-4234-8234-123456789012",
  displayName: "Minh Anh",
  emailMasked: "m***@example.com",
  role: "STUDENT",
  status: "ACTIVE",
  lecturerVerified: false,
  profileVersion: 1,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
};
const gateway = http.createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  const body = raw ? JSON.parse(raw) : {};
  const send = (status, data) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(status < 400 ? { data } : { error: { code: data } }));
  };
  if (mode === "outage") return send(503, "IDENTITY_SERVICE_UNAVAILABLE");
  if (req.url.endsWith("/register")) {
    keys.push(req.headers["idempotency-key"]);
    return ++registerAttempts === 1
      ? send(503, "IDENTITY_SERVICE_UNAVAILABLE")
      : send(201, { userId: profile.userId });
  }
  if (req.url.endsWith("/login")) {
    if (body.email === "invalid@example.com") return send(401, "INVALID_CREDENTIALS");
    if (body.email === "disabled@example.com") return send(403, "LOGIN_NOT_ALLOWED");
    generation = 0;
    return send(200, {
      accessToken: "fixture-access-0",
      refreshToken: "fixture-refresh-0",
      sessionId: profile.userId,
      accessExpiresAt: new Date(Date.now() + 900000).toISOString(),
      refreshExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
  }
  if (req.url.endsWith("/refresh")) {
    refreshes++;
    if (mode === "revoked") return send(401, "INVALID_REFRESH_CREDENTIALS");
    generation++;
    return send(200, {
      accessToken: `fixture-access-${generation}`,
      refreshToken: `fixture-refresh-${generation}`,
      sessionId: profile.userId,
      accessExpiresAt: new Date(Date.now() + 900000).toISOString(),
      refreshExpiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
  }
  if (req.url.endsWith("/logout")) return send(200, { loggedOut: true });
  if ((mode === "expired" || mode === "revoked") && req.headers.authorization === "Bearer fixture-access-0")
    return send(401, "INVALID_ACCESS_TOKEN");
  if (req.url.endsWith("/password"))
    return body.currentPassword === "wrong"
      ? send(401, "INVALID_REAUTHENTICATION")
      : send(200, { changed: true });
  if (["/api/v1/me/courses", "/api/v1/me/classes"].includes(req.url)) return send(200, []);
  if (req.url.startsWith("/api/v1/notifications?"))
    return send(200, { items: [], page: { nextCursor: null } });
  if (req.method === "PATCH") profile.displayName = body.displayName;
  send(200, profile);
});
await new Promise((r) => gateway.listen(4185, "127.0.0.1", r));
const server = spawn(process.execPath, ["scripts/serve.mjs"], {
  env: {
    ...process.env,
    PORT: "4184",
    AILSS_WEB_ORIGIN: "http://127.0.0.1:4184",
    AILSS_GATEWAY_URL: "http://127.0.0.1:4185",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
await new Promise((resolve, reject) => {
  server.stdout.once("data", resolve);
  server.once("error", reject);
  server.once("exit", (code) => reject(new Error(`server exited ${code}`)));
});
const browser = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
const base = "http://127.0.0.1:4184";
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, pass: true });
    console.log("PASS", name);
  } catch (e) {
    results.push({ name, pass: false, error: e.message });
    console.log("FAIL", name, e.message.slice(0, 180));
  }
}
try {
  for (const width of [375, 768, 1440, 1920]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 375 ? 812 : 1000 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await check(`Login, account, shell and register visual ${width}`, async () => {
      await page.goto(base + "/auth/register/student");
      await page.screenshot({ path: `${out}/register-${width}.png`, fullPage: true });
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations,
      ).toEqual([]);
      await page.goto(base + "/app/account");
      await expect(page).toHaveURL(/auth\/login\?returnTo/);
      await page.screenshot({ path: `${out}/login-${width}.png`, fullPage: true });
      await page.getByLabel("Email", { exact: true }).fill("minh@example.com");
      await page.getByLabel("Mật khẩu", { exact: true }).fill("fixture-password");
      await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
      await expect(page).toHaveURL(base + "/app/account");
      await expect(page.getByRole("heading", { name: "Hồ sơ & bảo mật." })).toBeVisible();
      await page.screenshot({ path: `${out}/account-${width}.png`, fullPage: true });
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations,
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.goto(base + "/app");
      await expect(page.getByRole("heading", { name: "Xin chào, Minh Anh." })).toBeVisible();
      await page.screenshot({ path: `${out}/shell-${width}.png`, fullPage: true });
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations,
      ).toEqual([]);
      if (width === 375) {
        await page.getByRole("button", { name: "Mở điều hướng" }).click();
        await page.screenshot({ path: `${out}/drawer-${width}.png` });
        await page.keyboard.press("Shift+Tab");
        expect(await page.locator("dialog[open]").evaluate((d) => d.contains(document.activeElement))).toBe(
          true,
        );
        await page.keyboard.press("Escape");
        await expect(page.getByRole("button", { name: "Mở điều hướng" })).toBeFocused();
      }
      await page.getByRole("button", { name: "Tài khoản", exact: true }).click();
      await page.screenshot({ path: `${out}/account-menu-${width}.png` });
      await page.keyboard.press("Escape");
      const cookies = await context.cookies();
      expect(cookies.find((c) => c.name === "ailss")?.httpOnly).toBe(true);
      expect(
        await page.evaluate(async () => ({
          local: localStorage.length,
          session: sessionStorage.length,
          cookie: document.cookie,
          db: await indexedDB.databases(),
        })),
      ).toEqual({ local: 0, session: 0, cookie: "", db: [] });
      expect(await page.locator("body").innerText()).not.toMatch(/fixture-(access|refresh)|fixture-password/);
      expect(errors).toEqual([]);
    });
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const login = async (email = "minh@example.com") => {
    await page.goto(base + "/auth/login");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Mật khẩu", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  };
  await check("invalid and disabled login errors", async () => {
    await login("invalid@example.com");
    await expect(page.getByRole("status")).toContainText("Email hoặc mật khẩu");
    await login("disabled@example.com");
    await expect(page.getByRole("status")).toContainText("không được phép đăng nhập");
  });
  await check("register retry keeps canonical idempotency key", async () => {
    await page.goto(base + "/auth/register/student");
    await page.getByLabel("Họ và tên").fill("Minh Anh");
    await page.getByLabel("Email", { exact: true }).fill("MINH@example.com");
    await page.getByLabel("Mật khẩu", { exact: true }).fill("fixture-password");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("tạm thời");
    await page.getByLabel("Email", { exact: true }).fill("minh@example.com");
    await page.getByRole("button", { name: "Tạo tài khoản", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("đã được tạo");
    expect(keys.length).toBe(2);
    expect(keys[0]).toBe(keys[1]);
  });
  await check("refresh rotation and reload bootstrap", async () => {
    await login();
    await expect(page).toHaveURL(base + "/app");
    mode = "expired";
    await page.reload();
    await expect(page.getByRole("heading", { name: "Xin chào, Minh Anh." })).toBeVisible();
    expect(refreshes).toBe(1);
    mode = "ok";
  });
  await check("profile update and wrong-current-password preserve profile", async () => {
    await page.goto(base + "/app/account");
    await page.getByLabel("Họ và tên").fill("Minh Anh Updated");
    await page.getByRole("button", { name: "Lưu tên hiển thị" }).click();
    await expect(page.getByRole("status")).toContainText("Đã cập nhật");
    await page.getByLabel("Mật khẩu hiện tại").fill("wrong");
    await page.getByLabel("Mật khẩu mới").fill("new-fixture-password");
    await page.getByRole("button", { name: "Đổi mật khẩu", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("hiện tại không đúng");
  });
  await check("logout outage is truthful and retry works", async () => {
    await page.getByRole("button", { name: "Tài khoản", exact: true }).click();
    mode = "outage";
    await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Chưa thể xác minh phiên." })).toBeVisible();
    await page.screenshot({ path: `${out}/unavailable-1440.png` });
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations,
    ).toEqual([]);
    await expect(page.getByRole("status")).toContainText("Chưa xác nhận");
    mode = "ok";
    await page.getByRole("button", { name: "Thử đăng xuất" }).click();
    await expect(page).toHaveURL(/auth\/login/);
  });
  await check("revoked refresh redirects with explicit reason", async () => {
    await login();
    await expect(page).toHaveURL(base + "/app");
    mode = "revoked";
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page).toHaveURL(/auth\/login/);
    await expect(page.getByRole("status")).toContainText("hết hạn");
    await page.screenshot({ path: `${out}/session-expired-1440.png` });
    mode = "ok";
  });
  await check("safe external returnTo and successful password change", async () => {
    await page.goto(base + "/auth/login?returnTo=https://evil.example");
    await page.getByLabel("Email", { exact: true }).fill("minh@example.com");
    await page.getByLabel("Mật khẩu", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await expect(page).toHaveURL(base + "/app");
    await page.goto(base + "/app/account");
    await page.getByLabel("Mật khẩu hiện tại").fill("fixture-password");
    await page.getByLabel("Mật khẩu mới").fill("changed-fixture-password");
    await page.getByRole("button", { name: "Đổi mật khẩu", exact: true }).click();
    await expect(page).toHaveURL(/auth\/login/);
    await expect(page.getByRole("status")).toContainText("Đã đổi mật khẩu");
  });
  await check("route, tab and scroll animations plus reduced motion", async () => {
    await page.goto(base + "/how-it-works");
    await page.getByRole("button", { name: "Giảng viên", exact: true }).click();
    expect(await page.locator(".journey-timeline").evaluate((e) => e.getAnimations().length)).toBeGreaterThan(
      0,
    );
    await page.goto(base);
    await page.locator(".workflow").scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: /03 AI tạo bản nháp/ }).click();
    expect(
      await page.locator(".workflow-detail .panel-motion").evaluate((e) => e.getAnimations().length),
    ).toBeGreaterThan(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: /04 Giảng viên rà soát/ }).click();
    expect(
      await page.locator(".workflow-detail .panel-motion").evaluate((e) => e.getAnimations().length),
    ).toBe(0);
  });
  await context.close();
} finally {
  await browser.close();
  server.kill();
  await new Promise((r) => gateway.close(r));
  await fs.writeFile(`${out}/session-browser-results.json`, JSON.stringify(results, null, 2));
}
console.log(JSON.stringify(results, null, 2));
if (results.some((r) => !r.pass)) process.exitCode = 1;
