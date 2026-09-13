import AxeBuilder from "@axe-core/playwright";
import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";
const base = process.env.AILSS_QA_URL || "http://127.0.0.1:5177",
  out = process.env.AILSS_QA_OUT || "../../docs/evidence/p12.8b-admin-commerce";
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
await fs.mkdir(out, { recursive: true });
const profiles = {
  ADMIN: {
    userId: id(1),
    displayName: "Admin An",
    emailMasked: "a***@test",
    role: "ADMIN",
    status: "ACTIVE",
    lecturerVerified: false,
    profileVersion: 1,
  },
  STUDENT: {
    userId: id(2),
    displayName: "Sinh viên Bình",
    emailMasked: "b***@test",
    role: "STUDENT",
    status: "ACTIVE",
    lecturerVerified: false,
    profileVersion: 1,
  },
};
const user = {
  userId: id(2),
  displayName: "Sinh viên Bình",
  emailMasked: "b***@test",
  role: "STUDENT",
  status: "ACTIVE",
  lecturerVerified: false,
  profileVersion: 1,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
};
const offering = {
  offeringId: id(4),
  courseId: id(3),
  title: "Tự học dữ liệu nâng cao",
  offeringType: "SELF_PACED",
  state: "PUBLISHED",
  price: "490000",
  currency: "VND",
};
const browser = await chromium.launch({ channel: "chrome", headless: true }),
  results = [];
try {
  for (const width of [375, 768, 1440, 1920])
    for (const role of ["ADMIN", "STUDENT"]) {
      const context = await browser.newContext({
          viewport: { width, height: 950 },
          reducedMotion: width === 375 ? "reduce" : "no-preference",
        }),
        page = await context.newPage();
      let orderState = "PENDING",
        alreadyEntitled = false,
        calls = [];
      await page.route("**/web-session/**", async (route) => {
        const req = route.request(),
          u = new URL(req.url()),
          p = u.pathname;
        calls.push(`${req.method()}:${p}`);
        let data = {};
        if (p === "/web-session/bootstrap") data = profiles[role];
        else if (p === "/web-session/student/me/courses")
          data = alreadyEntitled ? [{ courseId: id(3), title: "Tự học dữ liệu nâng cao" }] : [];
        else if (p === "/web-session/admin/users") data = [user];
        else if (p === `/web-session/admin/users/${id(2)}`) data = user;
        else if (p === `/web-session/admin/users/${id(2)}/status`)
          data = { userId: id(2), oldStatus: "ACTIVE", status: "SUSPENDED" };
        else if (p === `/web-session/student/courses/${id(3)}/offerings`) data = [offering];
        else if (p === "/web-session/student/orders")
          data = {
            orderId: id(5),
            courseId: id(3),
            offeringId: id(4),
            offeringType: "SELF_PACED",
            state: orderState,
            fulfillmentState: "NOT_STARTED",
            price: "490000",
            currency: "VND",
          };
        else if (p === `/web-session/student/orders/${id(5)}/simulate-payment`) {
          const outcome = req.postDataJSON().outcome;
          orderState = outcome === "FAILURE" ? "PAYMENT_FAILED" : "PAID_PENDING_ENTITLEMENT";
          data = {
            orderId: id(5),
            courseId: id(3),
            offeringId: id(4),
            offeringType: "SELF_PACED",
            state: orderState,
            fulfillmentState: outcome === "FAILURE" ? "NOT_STARTED" : "PENDING",
            price: "490000",
            currency: "VND",
          };
        } else if (p === `/web-session/student/orders/${id(5)}`) {
          orderState = "ENTITLED";
          data = {
            orderId: id(5),
            courseId: id(3),
            offeringId: id(4),
            offeringType: "SELF_PACED",
            state: orderState,
            fulfillmentState: "ACTIVE",
            price: "490000",
            currency: "VND",
          };
        }
        await route.fulfill({
          status: 200,
          json: { data, meta: { pagination: { nextCursor: null, hasMore: false } } },
        });
      });
      if (role === "ADMIN") {
        await page.goto(`${base}/app/admin/users`);
        await expect(page.getByRole("heading", { name: "Tra cứu người dùng." })).toBeVisible();
        await expect(page.getByText("Sinh viên Bình")).toBeVisible();
        await page.getByRole("link", { name: /Xem chi tiết/ }).click();
        await expect(page.getByRole("heading", { name: "Sinh viên Bình" })).toBeVisible();
      } else {
        await page.goto(`${base}/app/purchase/${id(3)}`);
        await expect(page.getByText("Tự học dữ liệu nâng cao")).toBeVisible();
        await page.getByRole("button", { name: "Tạo đơn thanh toán" }).click();
        await expect(page.getByRole("link", { name: /Bắt đầu học/ })).toBeVisible({ timeout: 6000 });
        alreadyEntitled = true;
        await page.reload();
        await expect(page.getByRole("heading", { name: "Thanh toán thành công" })).toBeVisible();
      }
      await page.evaluate(() =>
        Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
            .map((animation) => animation.finished.catch(() => undefined)),
        ),
      );
      const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        ),
        violations = (await new AxeBuilder({ page }).analyze()).violations
          .filter((v) => ["critical", "serious"].includes(v.impact))
          .map((v) => ({
            id: v.id,
            nodes: v.nodes.map((node) => ({ target: node.target, html: node.html })),
          })),
        storage = await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }));
      await page.screenshot({ path: `${out}/${role.toLowerCase()}-${width}.png`, fullPage: true });
      results.push({
        role,
        width,
        overflow,
        violations,
        calls: calls.length,
        storage,
        status:
          !overflow &&
          !violations.length &&
          !Object.keys(storage.local).length &&
          !Object.keys(storage.session).length
            ? "PASS"
            : "FAIL",
      });
      await context.close();
    }
} finally {
  await browser.close();
}
await fs.writeFile(
  `${out}/results.json`,
  JSON.stringify({ status: results.every((x) => x.status === "PASS") ? "PASS" : "FAIL", results }, null, 2),
);
console.log(JSON.stringify(results));
if (results.some((x) => x.status !== "PASS")) process.exitCode = 1;
