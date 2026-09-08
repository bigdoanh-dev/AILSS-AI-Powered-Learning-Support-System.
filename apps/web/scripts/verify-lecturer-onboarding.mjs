import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const base = process.env.AILSS_QA_URL || "http://127.0.0.1:5175",
  out = "../../docs/evidence/p12.2b-browser";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true }),
  evidence = [];
try {
  for (const width of [375, 768, 1440, 1920]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce" }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let profile = null,
      application = null;
    const student = {
      userId: "00000000-0000-4000-8000-000000000001",
      displayName: "Test Applicant",
      emailMasked: "t***@example.test",
      role: "STUDENT",
      status: "ACTIVE",
      lecturerVerified: false,
      profileVersion: 1,
      createdAt: "2026-09-07T00:00:00Z",
      updatedAt: "2026-09-07T00:00:00Z",
    };
    await page.route("**/web-session/**", async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname;
      let data = {};
      if (path.endsWith("/bootstrap")) {
        if (!profile) return route.fulfill({ status: 401, json: { error: { code: "SESSION_EXPIRED" } } });
        data = profile;
      } else if (path.endsWith("/login")) {
        profile = student;
        data = profile;
      } else if (path === "/web-session/lecturer-application") {
        if (req.method() === "POST") {
          const body = req.postDataJSON();
          expect(Object.keys(body).sort()).toEqual([
            "institution",
            "motivation",
            "professionalTitle",
            "teachingArea",
          ]);
          application = {
            ...body,
            applicationId: "00000000-0000-4000-8000-000000000010",
            status: "SUBMITTED",
            result: "PENDING",
            displayNameSnapshot: student.displayName,
            submittedAt: "2026-09-07T00:00:00Z",
          };
          data = {
            applicationId: application.applicationId,
            status: "SUBMITTED",
            submittedAt: application.submittedAt,
          };
        } else data = application;
      } else if (path === "/web-session/admin/lecturer-applications")
        data = { items: [application], nextCursor: null };
      else if (path.endsWith("/decision")) {
        const body = req.postDataJSON();
        application.status = body.decision === "APPROVE" ? "APPROVED" : "REJECTED";
        application.result = body.decision === "APPROVE" ? "APPROVED_AWAITING_VERIFICATION" : "REJECTED";
        data = {
          applicationId: application.applicationId,
          status: application.status,
          decidedAt: "2026-09-07T00:01:00Z",
        };
      } else if (path.includes("/admin/lecturer-applications/"))
        data = { ...application, applicantId: student.userId };
      return route.fulfill({ status: 200, json: { data } });
    });
    await page.goto(base + "/auth/register");
    await page.getByRole("link", { name: /Giảng viên/ }).click();
    await page.getByRole("link", { name: "Đăng nhập", exact: true }).click();
    await page.locator('input[name="email"]').fill("test@example.test");
    await page.locator('input[name="password"]').fill("Fixture-Only-Password123!");
    await page.locator('form button[type="submit"]').click();
    for (const [label, value] of [
      ["Chức danh chuyên môn", "Giảng viên"],
      ["Đơn vị công tác", "Trường thử nghiệm"],
      ["Lĩnh vực giảng dạy", "Cơ sở dữ liệu"],
      ["Mong muốn giảng dạy", "Tôi muốn chia sẻ kiến thức cơ sở dữ liệu với sinh viên."],
    ])
      await page.getByLabel(label).fill(value);
    await page.getByRole("button", { name: "Xem lại yêu cầu" }).click();
    await expect(page.getByText(/vai trò Sinh viên chuyển sang Giảng viên/)).toBeVisible();
    await page.getByRole("button", { name: "Gửi yêu cầu", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Yêu cầu của bạn đang được xem xét." })).toBeVisible();
    expect(await page.locator("header.header,footer.footer").count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${out}/pending-${width}.png`, fullPage: true });
    await page.goBack();
    await page.goForward();
    await expect(page.getByRole("heading", { name: "Yêu cầu của bạn đang được xem xét." })).toBeVisible();
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
    profile = { ...student, role: "ADMIN" };
    await page.goto(base + "/app/admin/lecturer-applications");
    await page.getByRole("button", { name: "Tải danh sách chờ" }).click();
    await page.getByRole("button", { name: /Test Applicant/ }).click();
    await page.getByLabel("Mật khẩu hiện tại").fill("Fixture-Only-Admin123!");
    await page.getByRole("button", { name: "Xác nhận quyết định" }).click();
    await expect(page.getByRole("heading", { name: "Xác minh Giảng viên — bước riêng" })).toBeVisible();
    await expect(page.getByLabel("Mật khẩu hiện tại")).toHaveValue("");
    await page.screenshot({ path: `${out}/admin-${width}.png`, fullPage: true });
    application.status = "SUBMITTED";
    application.result = "PENDING";
    await page.getByRole("button", { name: "Tải danh sách chờ" }).click();
    await page.getByRole("button", { name: /Test Applicant/ }).click();
    await page.locator('select[name="decision"]').selectOption("REJECT");
    await page.getByLabel("Mật khẩu hiện tại").fill("Fixture-Only-Admin123!");
    await page.getByRole("button", { name: "Xác nhận quyết định" }).click();
    await expect(page.getByText("Đơn đã bị từ chối")).toBeVisible();
    profile = student;
    await page.goto(base + "/auth/register/lecturer/status");
    await expect(page.getByRole("heading", { name: "Yêu cầu chưa được chấp thuận." })).toBeVisible();
    await expect(page.getByText(/Hiện chưa hỗ trợ gửi lại yêu cầu/)).toBeVisible();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
    expect(await page.locator("vite-error-overlay").count()).toBe(0);
    expect(await page.title()).toContain("AILSS");
    expect(errors).toEqual([]);
    evidence.push({
      width,
      flow: "anonymous-login-form-review-submit-status-admin-approve-reject",
      reducedMotion: true,
      errors,
    });
    await context.close();
  }
  await fs.writeFile(
    `${out}/report.json`,
    JSON.stringify({ status: "PASS", type: "isolated mock Gateway browser E2E", evidence }, null, 2),
  );
  console.log(JSON.stringify({ status: "PASS", viewports: evidence.length }));
} finally {
  await browser.close();
}
