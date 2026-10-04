import assert from "node:assert/strict";
import test from "node:test";
import { adminEnvelope, adminOperation } from "./admin.mjs";
const id = "00000000-0000-4000-8000-000000000001";
test("Admin operations only forwards bounded read-only ranges", () => {
  assert.equal(
    adminOperation("/web-session/admin/dashboard/operations", "GET", undefined, {}).path,
    "/admin/dashboard/operations?range=30d",
  );
  for (const range of ["7d", "30d", "90d", "365d"])
    assert.equal(
      adminOperation(`/web-session/admin/dashboard/operations?range=${range}`, "GET", undefined, {}).path,
      `/admin/dashboard/operations?range=${range}`,
    );
  for (const query of ["range=all", "range=30d&range=7d", "url=http://internal.test", "query=up"])
    assert.throws(() =>
      adminOperation(`/web-session/admin/dashboard/operations?${query}`, "GET", undefined, {}),
    );
  assert.throws(() => adminOperation("/web-session/admin/dashboard/operations", "POST", {}, {}));
});
test("Admin monitoring is read-only and rejects arbitrary queries", () => {
  assert.equal(
    adminOperation("/web-session/admin/monitoring", "GET", undefined, {}).path,
    "/admin/monitoring",
  );
  assert.throws(() =>
    adminOperation("/web-session/admin/monitoring?url=http://internal.test", "GET", undefined, {}),
  );
  assert.throws(() => adminOperation("/web-session/admin/monitoring", "POST", {}, {}));
});
test("Admin commission allowlist accepts a bounded rate and current policy version", () => {
  const effectiveAt = "2026-09-27T00:00:00.000Z";
  assert.equal(
    adminOperation("/web-session/admin/commission", "GET", undefined, {}).path,
    "/admin/commission",
  );
  assert.equal(
    adminOperation(
      "/web-session/admin/commission",
      "POST",
      { basisPoints: 2200, expectedEffectiveAt: effectiveAt },
      { "idempotency-key": "commission-change" },
    ).path,
    "/admin/commission",
  );
  assert.throws(() =>
    adminOperation(
      "/web-session/admin/commission",
      "POST",
      { basisPoints: 5001, expectedEffectiveAt: effectiveAt },
      { "idempotency-key": "bad" },
    ),
  );
});
test("Admin payout allowlist scopes one or all lecturers", () => {
  assert.equal(adminOperation("/web-session/admin/payouts", "GET", undefined, {}).path, "/admin/payouts");
  assert.equal(
    adminOperation(
      "/web-session/admin/payouts/prepare",
      "POST",
      { lecturerId: id },
      { "idempotency-key": "pay-one" },
    ).path,
    "/admin/payouts/prepare",
  );
  assert.equal(
    adminOperation("/web-session/admin/payouts/prepare", "POST", {}, { "idempotency-key": "pay-all" }).path,
    "/admin/payouts/prepare",
  );
  assert.throws(() =>
    adminOperation(
      "/web-session/admin/payouts/prepare",
      "POST",
      { accountNumber: "123" },
      { "idempotency-key": "bad" },
    ),
  );
  assert.deepEqual(
    adminOperation(
      `/web-session/admin/payouts/2026-08/${id}/approve`,
      "POST",
      {},
      { "idempotency-key": "approve-one" },
    ),
    { path: `/admin/payouts/2026-08/${id}/approve`, headers: {}, key: "approve-one" },
  );
  assert.throws(() =>
    adminOperation(
      `/web-session/admin/payouts/2026-08/${id}/approve`,
      "POST",
      { accountNumber: "123" },
      { "idempotency-key": "bad" },
    ),
  );
});
test("Admin moderation allowlist preserves cursor, optimistic version and password reauth body", () => {
  assert.equal(
    adminOperation("/web-session/admin/interaction-reports?limit=20&cursor=opaque", "GET", undefined, {})
      .path,
    "/admin/reports?limit=20&cursor=opaque",
  );
  const value = adminOperation(
    `/web-session/admin/interaction-reports/${id}/moderate`,
    "POST",
    { action: "HIDE", reason: "Policy", currentPassword: "secret" },
    { "idempotency-key": "logical-key", "if-match": '"v2"' },
  );
  assert.deepEqual(value, {
    path: `/admin/reports/${id}/moderate`,
    headers: { "If-Match": '"v2"' },
    key: "logical-key",
  });
});
test("Admin moderation allowlist rejects unsupported actions and malformed preconditions", () => {
  assert.throws(() =>
    adminOperation(
      `/web-session/admin/interaction-reports/${id}/moderate`,
      "POST",
      { action: "DELETE", reason: "x", currentPassword: "secret" },
      { "idempotency-key": "k", "if-match": '"v1"' },
    ),
  );
  assert.throws(() =>
    adminOperation(
      `/web-session/admin/interaction-reports/${id}/moderate`,
      "POST",
      { action: "WARN", reason: "x", currentPassword: "secret" },
      { "idempotency-key": "k", "if-match": "2" },
    ),
  );
});
test("Admin moderation envelope exposes only contract data and page metadata", () => {
  assert.deepEqual(
    adminEnvelope({
      data: [{ reportId: id }],
      meta: { page: { nextCursor: "opaque" }, requestId: "private" },
    }),
    { data: [{ reportId: id }], meta: { page: { nextCursor: "opaque" } } },
  );
});
test("Admin identity and course governance expose only exact contract operations", () => {
  assert.equal(
    adminOperation("/web-session/admin/users?role=STUDENT&status=ACTIVE&limit=25", "GET", undefined, {}).path,
    "/admin/users?role=STUDENT&status=ACTIVE&limit=25",
  );
  assert.equal(
    adminOperation(`/web-session/admin/users/${id}`, "GET", undefined, {}).path,
    `/admin/users/${id}`,
  );
  assert.deepEqual(
    adminOperation(
      `/web-session/admin/users/${id}/status`,
      "PATCH",
      { status: "SUSPENDED", currentPassword: "secret", reason: "review" },
      { "idempotency-key": "identity-change" },
    ),
    { path: `/admin/users/${id}/status`, headers: {}, key: "identity-change" },
  );
  assert.deepEqual(
    adminOperation(
      `/web-session/admin/courses/${id}/publish`,
      "POST",
      { currentPassword: "secret" },
      { "idempotency-key": "publish-course" },
    ),
    { path: `/admin/courses/${id}/publish`, headers: {}, key: "publish-course" },
  );
});
test("Admin identity allowlist rejects missing filters, unsupported status and extra body data", () => {
  assert.throws(() => adminOperation("/web-session/admin/users?role=STUDENT", "GET", undefined, {}));
  assert.throws(() =>
    adminOperation("/web-session/admin/users?role=STUDENT&status=DISABLED", "GET", undefined, {}),
  );
  assert.throws(() =>
    adminOperation(
      `/web-session/admin/courses/${id}/archive`,
      "POST",
      { currentPassword: "secret", reason: "extra" },
      { "idempotency-key": "archive" },
    ),
  );
});

test("Admin AI proxy accepts only admin support chat and own conversation routes", () => {
  assert.deepEqual(
    adminOperation(
      "/web-session/admin/assistant/chat",
      "POST",
      {
        mode: "ADMIN_SUPPORT",
        message: "Xem thống kê AI ở đâu?",
      },
      {},
    ),
    { path: "/assistant/chat", headers: {} },
  );
  assert.equal(
    adminOperation("/web-session/admin/assistant/conversations", "GET", undefined, {}).path,
    "/assistant/conversations",
  );
  assert.equal(
    adminOperation(`/web-session/admin/assistant/conversations/${id}`, "GET", undefined, {}).path,
    `/assistant/conversations/${id}`,
  );
  for (const body of [
    { mode: "STUDY_BUDDY", message: "Hỏi bài" },
    { mode: "ADMIN_SUPPORT", message: "Hỏi bài", courseId: id },
  ]) {
    assert.throws(() => adminOperation("/web-session/admin/assistant/chat", "POST", body, {}));
  }
});
test("Admin assistant mode is read-only and cannot accept an arbitrary upstream", () => {
  assert.equal(
    adminOperation("/web-session/admin/assistant/admin-status", "GET", undefined, {}).path,
    "/assistant/admin-status",
  );
  assert.throws(() =>
    adminOperation("/web-session/admin/assistant/admin-status?url=http://private", "GET", undefined, {}),
  );
  assert.throws(() =>
    adminOperation("/web-session/admin/assistant/admin-status", "POST", { mode: "local-guide" }, {}),
  );
});
test("Admin AI language is optional and limited to Vietnamese or English", () => {
  for (const responseLanguage of [undefined, "vi", "en"])
    assert.equal(
      adminOperation(
        "/web-session/admin/assistant/chat",
        "POST",
        {
          mode: "ADMIN_SUPPORT",
          message: "Where can I review system health?",
          ...(responseLanguage ? { responseLanguage } : {}),
        },
        {},
      ).path,
      "/assistant/chat",
    );
  for (const responseLanguage of ["ja", "ko", "zh", "", null])
    assert.throws(() =>
      adminOperation(
        "/web-session/admin/assistant/chat",
        "POST",
        {
          mode: "ADMIN_SUPPORT",
          message: "Question",
          responseLanguage,
        },
        {},
      ),
    );
});
