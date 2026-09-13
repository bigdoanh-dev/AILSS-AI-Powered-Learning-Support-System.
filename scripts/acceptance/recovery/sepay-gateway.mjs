import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// Dedicated dev fixtures only. Secrets remain in process memory; no provider account is used.
const runId = randomUUID();
const key = randomBytes(32).toString("hex");
const account = "999000111";
const cases = [];
async function http(method, path, { body, token, auth, idempotency = randomUUID() } = {}) {
  const response = await fetch(`http://127.0.0.1:8080${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotency,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(auth ? { authorization: auth } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, json: await response.json() };
}
function check(result, status, label) {
  assert.equal(result.status, status, `${label}: ${result.json?.error?.code ?? "unexpected status"}`);
  return result.json.data;
}
async function register(label, role = "STUDENT") {
  const user = {
    email: `sepay-${label}-${runId}@example.test`,
    password: `${randomUUID()}-Aa1!`,
    displayName: `SePay ${label}`,
    role,
  };
  const data = check(await http("POST", "/api/v1/auth/register", { body: user }), 201, "register");
  return { ...user, userId: data.userId };
}
async function login(user) {
  return check(
    await http("POST", "/api/v1/auth/login", { body: { email: user.email, password: user.password } }),
    200,
    "login",
  ).accessToken;
}
function learningMode(mode) {
  execFileSync(
    "docker",
    [
      "compose",
      "--env-file",
      ".env",
      "-f",
      "docker-compose.yml",
      "-f",
      "docker-compose.async.yml",
      "--profile",
      "dev-async",
      "up",
      "-d",
      "--no-deps",
      "learning-service",
    ],
    {
      env: {
        ...process.env,
        AILSS_PROFILE: "dev-async",
        PAYMENT_MODE: mode,
        SEPAY_WEBHOOK_API_KEY: mode === "sepay" ? key : "",
        SEPAY_ACCOUNT_NUMBER: mode === "sepay" ? account : "",
        SEPAY_ACCOUNT_NAME: "AILSS TEST",
        SEPAY_BANK: "MB",
      },
      stdio: "ignore",
    },
  );
}
async function ready() {
  for (let i = 0; i < 90; i++) {
    try {
      const result = execFileSync(
        "docker",
        [
          "exec",
          "ailss-learning-service",
          "node",
          "--input-type=module",
          "-e",
          "const r=await fetch('http://127.0.0.1:8102/health/ready');process.exit(r.ok?0:1)",
        ],
        { stdio: "ignore" },
      );
      void result;
      return;
    } catch {
      await delay(500);
    }
  }
  throw new Error("Learning readiness timed out");
}
// Same bounded dev-only Admin fixture convention as P7.17; no Order/payment DB mutation.
function promoteAdmin(userId) {
  const code = `import{readFileSync}from'node:fs';import{createHash}from'node:crypto';import c from'cassandra-driver';const id=JSON.parse(readFileSync(0,'utf8')).userId,x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(','),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();try{const r=(await x.execute('SELECT display_name,role,status,lecturer_verified,profile_version,updated_at FROM user_by_id WHERE user_id=?',[u(id)],q)).rows[0],s=createHash('sha256').update(id).digest()[0]%16;await x.execute('DELETE FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?',[r.role,r.status,s,r.updated_at,u(id)],q);await x.execute('UPDATE user_by_id SET role=? WHERE user_id=?',['ADMIN',u(id)],q);await x.execute('INSERT INTO users_by_role_status_bucket (role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version) VALUES (?,?,?,?,?,?,?,?)',['ADMIN',r.status,s,r.updated_at,u(id),r.display_name,r.lecturer_verified,r.profile_version],q);}finally{await x.shutdown();}`;
  execFileSync(
    "docker",
    ["exec", "-i", "ailss-identity-service", "node", "--input-type=module", "-e", code],
    { input: JSON.stringify({ userId }), stdio: ["pipe", "ignore", "pipe"] },
  );
}
async function settled(token, id) {
  for (let i = 0; i < 120; i++) {
    const order = check(await http("GET", `/api/v1/orders/${id}`, { token }), 200, "read Order");
    if (order.state === "ENTITLED") return order;
    await delay(500);
  }
  throw new Error("SePay Order did not converge to ENTITLED");
}
const admin = await register("admin");
promoteAdmin(admin.userId);
const lecturer = await register("lecturer", "LECTURER");
const student = await register("student");
const adminToken = await login(admin);
check(
  await http("POST", `/api/v1/admin/lecturers/${lecturer.userId}/verify`, {
    token: adminToken,
    body: { currentPassword: admin.password },
  }),
  200,
  "verify Lecturer",
);
const lecturerToken = await login(lecturer);
const token = await login(student);
const course = check(
  await http("POST", "/api/v1/courses", {
    token: lecturerToken,
    body: {
      title: "SePay recovery acceptance",
      slug: `sepay-${runId}`,
      categoryId: randomUUID(),
      priceType: "FREE",
      price: "0",
      currency: "VND",
    },
  }),
  201,
  "create Course",
);
check(
  await http("POST", `/api/v1/courses/${course.courseId}/lessons`, {
    token: lecturerToken,
    body: {
      title: "Recovery lesson",
      sectionTitle: "Payments",
      position: { sectionOrder: 1, lessonOrder: 1 },
      preview: false,
    },
  }),
  201,
  "create lesson",
);
check(
  await http("POST", `/api/v1/courses/${course.courseId}/submit-review`, { token: lecturerToken }),
  202,
  "submit review",
);
check(
  await http("POST", `/api/v1/admin/courses/${course.courseId}/publish`, {
    token: adminToken,
    body: { currentPassword: admin.password },
  }),
  200,
  "publish Course",
);
const offering = check(
  await http("POST", `/api/v1/courses/${course.courseId}/offerings`, {
    token: lecturerToken,
    body: { offeringType: "SELF_PACED", title: "SePay integer VND", price: "1000", currency: "VND" },
  }),
  201,
  "create Offering",
);
check(
  await http("POST", `/api/v1/offerings/${offering.offeringId}/publish`, { token: lecturerToken }),
  200,
  "publish Offering",
);
const failed = check(
  await http("POST", "/api/v1/orders", { token, body: { offeringId: offering.offeringId } }),
  201,
  "failed fixture Order",
);
check(
  await http("POST", `/api/v1/orders/${failed.orderId}/simulate-payment`, {
    token,
    body: { outcome: "FAILURE" },
  }),
  200,
  "failed fixture simulation",
);
let switched = false;
try {
  switched = true;
  learningMode("sepay");
  await ready();
  const order = check(
    await http("POST", "/api/v1/orders", { token, body: { offeringId: offering.offeringId } }),
    201,
    "SePay Order",
  );
  const transaction = {
    id: Date.now(),
    transferType: "in",
    accountNumber: account,
    transferAmount: 1000,
    content: `AILSS${order.orderId.replaceAll("-", "")}`,
  };
  const callback = (body, auth = `Apikey ${key}`) =>
    http("POST", "/api/v1/payments/sepay/webhook", { body, auth });
  for (const [label, body, status, auth] of [
    ["unauthenticated", transaction, 401, "Apikey invalid"],
    ["wrong recipient", { ...transaction, accountNumber: "other" }, 422],
    ["wrong amount", { ...transaction, transferAmount: 1001 }, 422],
    ["wrong direction", { ...transaction, transferType: "out" }, 422],
    ["unknown Order", { ...transaction, content: `AILSS${randomUUID().replaceAll("-", "")}` }, 422],
    ["failed Order", { ...transaction, content: `AILSS${failed.orderId.replaceAll("-", "")}` }, 409],
  ]) {
    check(await callback(body, auth), status, label);
    cases.push(label);
  }
  check(
    await http("POST", `/api/v1/orders/${order.orderId}/simulate-payment`, {
      token,
      body: { outcome: "SUCCESS" },
    }),
    403,
    "Student simulation forbidden",
  );
  check(await callback(transaction), 200, "valid callback");
  cases.push("valid callback");
  check(await callback(transaction), 200, "identical replay");
  cases.push("identical replay");
  check(await callback({ ...transaction, referenceCode: "changed" }), 409, "changed replay");
  cases.push("changed replay");
  await settled(token, order.orderId);
  check(await callback(transaction), 200, "already-entitled replay");
  cases.push("already-entitled replay");
  check(await callback({ ...transaction, id: transaction.id + 1 }), 409, "extra transaction");
  cases.push("extra transaction");
  const courses = check(await http("GET", "/api/v1/me/courses", { token }), 200, "My Courses");
  assert.equal(courses.filter((row) => row.courseId === course.courseId).length, 1);
  console.log(
    JSON.stringify({
      gate: "sepay-real-gateway-callback",
      status: "PASS",
      runId,
      orderId: order.orderId,
      cases,
      entitled: true,
      courseEffects: 1,
      canonicalPaymentsMutatedDirectly: false,
      liveBankAcceptance: false,
    }),
  );
} finally {
  if (switched) {
    learningMode("simulation");
    await ready();
  }
}
