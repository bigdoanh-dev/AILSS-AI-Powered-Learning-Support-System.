import assert from "node:assert/strict";
import test from "node:test";
import { adminEnvelope, adminOperation } from "./admin.mjs";
const id = "00000000-0000-4000-8000-000000000001";
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
