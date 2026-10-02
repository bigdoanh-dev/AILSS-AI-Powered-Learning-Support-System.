import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createSessionAdapter } from "./session.mjs";
const profile = {
  userId: "test-user",
  displayName: "Test Student",
  emailMasked: "t***@example.com",
  role: "STUDENT",
  status: "ACTIVE",
  lecturerVerified: false,
};
function fixture(options = {}) {
  let refreshes = 0;
  let mode = "ok";
  let access = "access-secret";
  const calls = [];
  const tokens = () => ({
    accessToken: access,
    refreshToken: "refresh-secret",
    sessionId: "session-test",
    accessExpiresAt: new Date(Date.now() + (options.expired ? -1000 : 900000)).toISOString(),
    refreshExpiresAt: new Date(Date.now() + 10000000).toISOString(),
  });
  const fetcher = async (url, init) => {
    calls.push({ route: url.pathname, ...init });
    if (url.pathname.endsWith("/refresh")) {
      ++refreshes;
      await new Promise((r) => setTimeout(r, 10));
      if (mode === "revoked")
        return Response.json({ error: { code: "INVALID_REFRESH_CREDENTIALS" } }, { status: 401 });
      if (mode === "outage" || mode === "refresh-outage") throw new Error("untrusted token-secret error");
      access = "rotated-access";
      return Response.json({
        data: {
          ...tokens(),
          accessExpiresAt: new Date(Date.now() + 900000).toISOString(),
          refreshToken: "rotated-refresh",
        },
      });
    }
    if (mode === "reauth" && url.pathname.endsWith("/decision"))
      return Response.json({ error: { code: "ADMIN_STEP_UP_FAILED" } }, { status: 401 });
    if (mode === "outage")
      return Response.json({ error: { code: "IDENTITY_SERVICE_UNAVAILABLE" } }, { status: 503 });
    if (url.pathname.endsWith("/login")) return Response.json({ data: tokens() });
    if (url.pathname.endsWith("/logout")) return Response.json({ data: { loggedOut: true } });
    if (options.rosterError && url.pathname.endsWith("/roster"))
      return Response.json({ error: { code: "COURSE_ROSTER_FORBIDDEN" } }, { status: options.rosterError });
    if (
      (mode === "expired" || mode === "refresh-outage") &&
      init.headers.Authorization === "Bearer access-secret"
    )
      return Response.json({ error: { code: "INVALID_ACCESS_TOKEN" } }, { status: 401 });
    return Response.json({
      data:
        mode === "lecturer"
          ? { ...profile, role: "LECTURER", lecturerVerified: options.verified === true }
          : { ...profile, role: options.role || profile.role },
    });
  };
  const handle = createSessionAdapter({
    gateway: "http://gateway.test",
    origin: options.production ? "https://web.test" : "http://web.test",
    production: options.production,
    fetcher,
  });
  async function request(route, method = "GET", body, cookie, extra = {}) {
    const req = Readable.from(body ? [JSON.stringify(body)] : []);
    Object.assign(req, {
      url: `/web-session/${route}`,
      method,
      headers: {
        host: "web.test",
        origin: options.production ? "https://web.test" : "http://web.test",
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
        ...extra,
      },
    });
    const headers = {};
    let status, raw;
    await handle(req, {
      setHeader: (k, v) => (headers[k] = v),
      writeHead: (s) => (status = s),
      end: (value) => (raw = value),
    });
    return { status, headers, raw, data: JSON.parse(raw), cookie: headers["Set-Cookie"]?.split(";")[0] };
  }
  return { request, calls, count: () => refreshes, mode: (v) => (mode = v) };
}
test("roster failure is preserved rather than inventing students", async () => {
  for (const status of [403, 404, 503]) {
    const f = fixture({ verified: true, rosterError: status });
    f.mode("lecturer");
    const login = await f.request("login", "POST", {});
    const result = await f.request(
      "lecturer/courses/11111111-1111-4111-8111-111111111111/roster",
      "GET",
      undefined,
      login.cookie,
    );
    assert.equal(result.status, status);
    assert.equal(result.data.data, undefined);
    assert.doesNotMatch(result.raw, /sv-2026|student.edu.vn/);
  }
});
test("login profile is canonical, HttpOnly and no credentials in browser payload", async () => {
  const f = fixture();
  const r = await f.request("login", "POST", { email: "test@example.com", password: "test" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.data, profile);
  assert.match(r.headers["Set-Cookie"], /HttpOnly; SameSite=Lax/);
  assert.equal(r.headers["Cache-Control"], "no-store");
  assert.doesNotMatch(r.raw, /secret|Token|password/);
  assert.equal(f.calls[1].route, "/api/v1/me");
});

test("OTP delivery has a longer upstream deadline than verification", async (t) => {
  const deadlines = [];
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", (milliseconds) => {
    deadlines.push(milliseconds);
    return timeout(milliseconds);
  });
  const f = fixture();
  await f.request("auth/password-reset/request", "POST", { email: "test@example.invalid" });
  assert.deepEqual(deadlines, [50000]);
  await f.request("auth/password-reset/verify", "POST", {
    email: "test@example.invalid",
    code: "123456",
  });
  assert.deepEqual(deadlines, [50000, 15000]);
  assert.equal(f.calls[0].headers.Authorization, undefined);
});
test("production requires HTTPS and uses host-only Secure cookie", async () => {
  assert.throws(() =>
    createSessionAdapter({ gateway: "http://g", origin: "http://web.test", production: true }),
  );
  const r = await fixture({ production: true }).request("login", "POST", {});
  assert.match(r.cookie, /^__Host-ailss=/);
  assert.match(r.headers["Set-Cookie"], /; Secure$/);
  assert.doesNotMatch(r.headers["Set-Cookie"], /Domain=/);
});
test("CSRF rejects hostile or missing origin, Host and fetch-site", async () => {
  const f = fixture();
  for (const extra of [
    { origin: "https://evil.test" },
    { origin: undefined },
    { host: "evil.test" },
    { "sec-fetch-site": "cross-site" },
  ])
    assert.equal((await f.request("login", "POST", {}, null, extra)).status, 403);
  assert.equal(f.calls.length, 0);
});
test("Lecturer business adapter rechecks role and verification before forwarding", async () => {
  const unverified = fixture();
  unverified.mode("lecturer");
  const login = await unverified.request("login", "POST", {});
  const before = unverified.calls.length;
  const denied = await unverified.request("lecturer/me/owned-classes", "GET", undefined, login.cookie);
  assert.equal(denied.status, 403);
  assert.equal(denied.data.error.code, "LECTURER_VERIFICATION_REQUIRED");
  assert.equal(unverified.calls.length, before + 1);
  assert.equal(unverified.calls.at(-1).route, "/api/v1/me");

  const verified = fixture({ verified: true });
  verified.mode("lecturer");
  const active = await verified.request("login", "POST", {});
  assert.equal(
    (await verified.request("lecturer/me/owned-classes", "GET", undefined, active.cookie)).status,
    200,
  );
  assert.equal(verified.calls.at(-1).route, "/api/v1/me/owned-classes");
});

test("Admin AI chat is forwarded only for an active admin session", async () => {
  const student = fixture();
  const studentLogin = await student.request("login", "POST", {});
  const denied = await student.request(
    "admin/assistant/chat",
    "POST",
    {
      mode: "ADMIN_SUPPORT",
      message: "Xem thống kê",
    },
    studentLogin.cookie,
  );
  assert.equal(denied.status, 403);
  assert.equal(student.calls.at(-1).route, "/api/v1/me");

  const admin = fixture({ role: "ADMIN" });
  const adminLogin = await admin.request("login", "POST", {});
  const accepted = await admin.request(
    "admin/assistant/chat",
    "POST",
    {
      mode: "ADMIN_SUPPORT",
      message: "Xem thống kê",
    },
    adminLogin.cookie,
  );
  assert.equal(accepted.status, 200);
  assert.equal(admin.calls.at(-1).route, "/api/v1/assistant/chat");
});
test("five expired requests share one refresh, use rotated credential", async () => {
  const f = fixture();
  const r = await f.request("login", "POST", {});
  f.mode("expired");
  const all = await Promise.all(
    Array.from({ length: 5 }, () => f.request("bootstrap", "GET", null, r.cookie)),
  );
  assert.ok(all.every((r) => r.status === 200));
  assert.equal(f.count(), 1);
  assert.equal(f.calls.filter((c) => c.route.endsWith("/refresh")).length, 1);
});
test("bootstrap restores session; logout revokes and clears cookie", async () => {
  const f = fixture();
  const r = await f.request("login", "POST", {});
  assert.equal((await f.request("bootstrap", "GET", null, r.cookie)).status, 200);
  const out = await f.request("logout", "POST", null, r.cookie);
  assert.equal(out.status, 200);
  assert.match(out.headers["Set-Cookie"], /Max-Age=0/);
  assert.equal((await f.request("bootstrap", "GET", null, r.cookie)).status, 401);
  assert.equal(f.calls.at(-1).route, "/api/v1/auth/logout");
  assert.equal(f.calls.at(-1).body, undefined);
});
test("invalid refresh clears authentication", async () => {
  const f = fixture({ expired: true });
  f.mode("revoked");
  const r = await f.request("login", "POST", {});
  assert.equal(r.status, 401);
  assert.match(r.headers["Set-Cookie"], /Max-Age=0/);
});
test("outage is unavailable, no raw error details, logout retry remains possible", async () => {
  const f = fixture();
  const r = await f.request("login", "POST", {});
  f.mode("outage");
  const out = await f.request("logout", "POST", null, r.cookie);
  assert.equal(out.status, 503);
  assert.doesNotMatch(out.raw, /token-secret/);
  f.mode("ok");
  assert.equal((await f.request("logout", "POST", null, r.cookie)).status, 200);
});
test("ambiguous refresh never replays old credential", async () => {
  const f = fixture();
  const r = await f.request("login", "POST", {});
  f.mode("refresh-outage");
  assert.equal((await f.request("bootstrap", "GET", null, r.cookie)).status, 503);
  assert.equal(
    (await f.request("bootstrap", "GET", null, r.cookie)).data.error.code,
    "REFRESH_OUTCOME_UNKNOWN",
  );
  assert.equal(f.count(), 1);
});
test("register forwards exact body/key; profile and password are narrow routes", async () => {
  const f = fixture();
  const body = { email: "t@example.com", password: "test-pass", displayName: "Test" };
  await f.request("register", "POST", body, null, { "idempotency-key": "stable" });
  assert.equal(f.calls[0].body, JSON.stringify(body));
  assert.equal(f.calls[0].headers["Idempotency-Key"], "stable");
  assert.equal((await f.request("admin", "POST", {})).status, 405);
  const login = await f.request("login", "POST", {});
  await f.request("profile", "PATCH", { displayName: "New" }, login.cookie, {
    "idempotency-key": "profile-key",
  });
  assert.equal(f.calls.at(-2).route, "/api/v1/me");
  await f.request("password", "POST", { currentPassword: "old", newPassword: "new" }, login.cookie);
  assert.equal((await f.request("bootstrap", "GET", null, login.cookie)).status, 401);
});

test("Lecturer adapter is narrowly routed, preserves reauth failures and keeps secrets server-side", async () => {
  const f = fixture();
  const login = await f.request("login", "POST", {});
  const cookie = login.cookie;
  const body = {
    professionalTitle: "Lecturer",
    institution: "School",
    teachingArea: "Databases",
    motivation: "Teach database systems to students",
  };
  const submitted = await f.request("lecturer-application", "POST", body, cookie, {
    "idempotency-key": "application-key",
  });
  assert.equal(submitted.status, 201);
  assert.equal(f.calls.at(-1).route, "/api/v1/lecturer-applications");
  assert.deepEqual(JSON.parse(f.calls.at(-1).body), body);
  assert.equal(f.calls.at(-1).headers["Idempotency-Key"], "application-key");
  assert.doesNotMatch(submitted.raw, /access-secret|refresh-secret/);
  await f.request("lecturer-application", "GET", undefined, cookie);
  assert.equal(f.calls.at(-1).route, "/api/v1/me/lecturer-application");
  assert.equal((await f.request("admin/users/arbitrary", "POST", {}, cookie)).status, 400);
  f.mode("reauth");
  const denied = await f.request(
    "admin/lecturer-applications/00000000-0000-4000-8000-000000000001/decision",
    "POST",
    { decision: "APPROVE", currentPassword: "wrong" },
    cookie,
    { "idempotency-key": "decision-key" },
  );
  assert.equal(denied.status, 401);
  assert.equal(denied.headers["Set-Cookie"], undefined);
  assert.equal(f.count(), 0);
  assert.equal((await f.request("bootstrap", "GET", undefined, cookie)).status, 200);
});

test("Student allowlist validates bodies, queries and exact forwarding without changing session refresh", async () => {
  const f = fixture();
  const login = await f.request("login", "POST", {});
  const cookie = login.cookie;
  const id = "00000000-0000-4000-8000-000000000001";
  const invalid = [
    ["student/me/courses?admin=true", "GET"],
    ["student/courses/../admin/users", "GET"],
    ["student/lessons/" + id + "/completion", "PUT", { completed: true, studentId: id }],
    ["student/notifications?month=2026-09&month=2026-08", "GET"],
    ["student/me/schedule?from=2026-01-01&to=2026-03-01", "GET"],
    ["student/quizzes/" + id + "/results", "GET"],
  ];
  for (const [path, method, body] of invalid) {
    const count = f.calls.length;
    assert.equal((await f.request(path, method, body, cookie, { "idempotency-key": "stable" })).status, 400);
    assert.equal(f.calls.length, count);
  }
  assert.equal(
    (
      await f.request("student/lessons/" + id + "/completion", "PUT", { completed: true }, cookie, {
        "idempotency-key": "stable",
      })
    ).status,
    200,
  );
  assert.equal(f.calls.at(-1).body, JSON.stringify({ completed: true }));
  assert.equal(f.calls.at(-1).headers["Idempotency-Key"], "stable");
  assert.equal(
    (
      await f.request("student/comments/" + id, "PATCH", { body: "Edited" }, cookie, {
        "idempotency-key": "edit",
        "if-match": '"v2"',
      })
    ).status,
    200,
  );
  assert.equal(f.calls.at(-1).headers["If-Match"], '"v2"');
  assert.equal(
    (
      await f.request("student/notifications/" + id + "/read", "PATCH", {}, cookie, {
        "x-notification-locator": "opaque_unchanged-123",
      })
    ).status,
    200,
  );
  assert.equal(f.calls.at(-1).headers["x-notification-locator"], "opaque_unchanged-123");
  f.mode("expired");
  const responses = await Promise.all([
    f.request("student/me/courses", "GET", undefined, cookie),
    f.request("student/me/classes", "GET", undefined, cookie),
  ]);
  assert(responses.every((r) => r.status === 200));
  assert.equal(f.count(), 1);
});

test("Student adapter rechecks role before every operation", async () => {
  const f = fixture(),
    login = await f.request("login", "POST", {});
  f.mode("lecturer");
  const response = await f.request("student/me/courses", "GET", undefined, login.cookie);
  assert.equal(response.status, 403);
  assert.equal(f.calls.at(-1).route, "/api/v1/me");
});
test("Student response mapping preserves opaque pagination and rejects private answer/token fields", async () => {
  const { studentEnvelope } = await import("./student.mjs");
  assert.deepEqual(
    studentEnvelope({ data: [], meta: { page: { nextCursor: "opaque.cursor" }, requestId: "private-meta" } }),
    { data: [], meta: { page: { nextCursor: "opaque.cursor" } } },
  );
  for (const field of ["correctAnswer", "accessToken", "refreshToken", "gradingChecksum", "resultItems"])
    assert.throws(
      () => studentEnvelope({ data: { questions: [{ [field]: "private" }] } }),
      /UNSAFE_STUDENT_RESPONSE/,
    );
});

for (const role of ["STUDENT", "LECTURER", "ADMIN"])
  test(`Shared notifications authenticate ${role} and validate requests`, async () => {
    const f = fixture({ role });
    const login = await f.request("login", "POST", { email: "test@example.com", password: "test" });
    const read = await f.request("notifications?month=2026-09&limit=20", "GET", undefined, login.cookie);
    assert.equal(read.status, 200);
    assert.equal(f.calls.at(-1).route, "/api/v1/notifications");
    const bad = await f.request("notifications?month=2026-09&userId=other", "GET", undefined, login.cookie);
    assert.equal(bad.status, 400);
    const unauth = await f.request("notifications?month=2026-09", "GET");
    assert.equal(unauth.status, 401);
  });
test("Notification mark-read forwards locator only after validation", async () => {
  const f = fixture({ role: "ADMIN" });
  const login = await f.request("login", "POST", { email: "test@example.com", password: "test" });
  const path = "notifications/00000000-0000-4000-8000-000000000001/read";
  const good = await f.request(path, "PATCH", { locator: "opaque_locator" }, login.cookie);
  assert.equal(good.status, 200);
  assert.equal(f.calls.at(-1).headers["x-notification-locator"], "opaque_locator");
  assert.equal(f.calls.at(-1).body, "{}");
  const bad = await f.request(path, "PATCH", { locator: "opaque", userId: "other" }, login.cookie);
  assert.equal(bad.status, 400);
});
