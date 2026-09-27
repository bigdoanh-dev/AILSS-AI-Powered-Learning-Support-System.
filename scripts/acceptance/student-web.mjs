import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createSessionAdapter } from "../../apps/web/server/session.mjs";
const checks = [];
let handle, cookie;
const server = createServer(async (req, res) => {
  if (!(await handle(req, res))) {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
handle = createSessionAdapter({ gateway: "http://127.0.0.1:8080", origin });
async function gateway(path, method = "GET", body, token, key = randomUUID()) {
  const r = await boundedFetch("http://127.0.0.1:8080/api/v1" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      "Idempotency-Key": key,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const v = await r.json();
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${v.error?.code}`);
  return v.data;
}
async function web(path, method = "GET", body, key = randomUUID(), headers = {}) {
  const r = await boundedFetch(origin + "/web-session/" + path, {
    method,
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      "Idempotency-Key": key,
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(25000),
  });
  if (r.headers.get("set-cookie")) cookie = r.headers.get("set-cookie").split(";")[0];
  const v = await r.json();
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(
    JSON.stringify(v),
    /accessToken|refreshToken|correctAnswer|gradingChecksum|currentPassword/,
  );
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${v.error?.code}`);
  return v.data;
}
async function account(label) {
  const v = {
    email: `p123-${label}-${randomUUID()}@example.test`,
    password: "P123!" + randomUUID() + "Aa1",
    displayName: "P123 " + label,
  };
  return { ...v, ...(await gateway("/auth/register", "POST", v)) };
}
try {
  const admin = await account("admin"),
    lecturer = await account("lecturer");
  bootstrapRole(admin.userId, "ADMIN");
  bootstrapRole(lecturer.userId, "LECTURER");
  checks.push("dedicated Admin/Lecturer role fixtures bootstrapped separately");
  const at = (await gateway("/auth/login", "POST", { email: admin.email, password: admin.password }))
    .accessToken;
  await gateway(
    "/admin/lecturers/" + lecturer.userId + "/verify",
    "POST",
    { currentPassword: admin.password },
    at,
  );
  const lt = (await gateway("/auth/login", "POST", { email: lecturer.email, password: lecturer.password }))
    .accessToken;
  const course = await gateway(
    "/courses",
    "POST",
    {
      title: "P123 Student Learning",
      slug: "p123-" + randomUUID(),
      categoryId: randomUUID(),
      priceType: "FREE",
      price: "0",
      currency: "VND",
    },
    lt,
  );
  const lesson = await gateway(
    "/courses/" + course.courseId + "/lessons",
    "POST",
    {
      title: "A real Student lesson",
      sectionTitle: "Foundation",
      position: { sectionOrder: 1, lessonOrder: 1 },
      preview: false,
    },
    lt,
  );
  await gateway("/courses/" + course.courseId + "/submit-review", "POST", {}, lt);
  await gateway(
    "/admin/courses/" + course.courseId + "/publish",
    "POST",
    { currentPassword: admin.password },
    at,
  );
  const student = {
    email: "p123-web-" + randomUUID() + "@example.test",
    password: "Web-P123!" + randomUUID() + "Aa1",
    displayName: "P123 Student",
  };
  await web("register", "POST", student);
  const me = await web("login", "POST", { email: student.email, password: student.password });
  assert.equal(me.role, "STUDENT");
  checks.push("Student Web registration/login HttpOnly session");
  // LRN-14 needs a legacy deterministic default Offering not created by LRN-24.
  // Use registered local commerce APIs to obtain entitlement; never seed Student state.
  await assert.rejects(
    () => web("student/courses/" + course.courseId + "/enrollments", "POST", {}),
    /OFFERING_NOT_AVAILABLE/,
  );
  const offering = await gateway(
    "/courses/" + course.courseId + "/offerings",
    "POST",
    { offeringType: "SELF_PACED", title: "P123 Access Offering", price: "0", currency: "VND" },
    lt,
  );
  await gateway("/offerings/" + offering.offeringId + "/publish", "POST", {}, lt);
  const st = (await gateway("/auth/login", "POST", { email: student.email, password: student.password }))
    .accessToken;
  const order = await gateway("/orders", "POST", { offeringId: offering.offeringId }, st);
  await gateway("/orders/" + order.orderId + "/simulate-payment", "POST", { outcome: "SUCCESS" }, st);
  let entitled = false;
  for (let i = 0; i < 40; i++) {
    if ((await gateway("/orders/" + order.orderId, "GET", undefined, st)).state === "ENTITLED") {
      entitled = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  assert(entitled, "API commerce fulfillment");
  checks.push(
    "LRN-14 missing legacy default Offering reported; entitlement obtained via LRN-24/26/19/21 local simulated commerce APIs, outside Web UI",
  );
  assert((await web("student/me/courses")).some((c) => c.courseId === course.courseId));
  const l = await web("student/lessons/" + lesson.lessonId);
  assert.equal(l.courseId, course.courseId);
  assert.equal((await web("student/courses/" + course.courseId + "/progress")).percent, 0);
  const key = randomUUID(),
    p = await web("student/lessons/" + lesson.lessonId + "/completion", "PUT", { completed: true }, key),
    replay = await web("student/lessons/" + lesson.lessonId + "/completion", "PUT", { completed: true }, key);
  assert.deepEqual(replay, p);
  assert.equal((await web("student/courses/" + course.courseId + "/progress")).percent, 100);
  checks.push("API-acquired entitlement, private lesson access, canonical progress, completion exact replay");
  const comment = await web("student/resources/COURSE/" + course.courseId + "/comments", "POST", {
    body: "Student Web question",
  });
  await web("student/comments/" + comment.commentId, "PATCH", { body: "Student Web updated" }, randomUUID(), {
    "If-Match": '"v1"',
  });
  const review = await web("student/courses/" + course.courseId + "/reviews", "POST", {
    rating: 5,
    body: "Useful learning material",
  });
  assert.equal(review.rating, 5);
  checks.push("comment create/versioned edit and eligible review");
  const quiz = await gateway(
    "/quizzes",
    "POST",
    {
      title: "P123 Objective Quiz",
      targetType: "COURSE",
      targetId: course.courseId,
      attemptLimit: 2,
      durationSeconds: 1800,
      questions: [{ prompt: "SQL reads data", questionType: "TRUE_FALSE", correctAnswer: true, points: "1" }],
    },
    lt,
  );
  await gateway("/quizzes/" + quiz.quizId + "/publish", "POST", {}, lt);
  await web("student/quizzes/" + quiz.quizId);
  const a = await web("student/quizzes/" + quiz.quizId + "/attempts", "POST", {}),
    resume = await web("student/quizzes/" + quiz.quizId + "/attempts", "POST", {});
  assert.equal(resume.attemptId, a.attemptId);
  assert.equal((await web("student/attempts/" + a.attemptId)).state, "IN_PROGRESS");
  await web("student/attempts/" + a.attemptId + "/submit", "POST", {
    answers: [{ questionId: a.questions[0].questionId, value: true }],
    clientSubmittedAt: new Date().toISOString(),
  });
  const result = await web("student/attempts/" + a.attemptId + "/result");
  assert.equal(result.score, "1");
  assert.equal(result.maxScore, "1");
  checks.push("quiz explicit start/resume same attempt, submit, owner-safe score");
  const klass = await gateway(
    "/classes",
    "POST",
    { name: "P123 Student Class", classKind: "PRIVATE", maxMembers: 10 },
    lt,
  );
  await web("student/classes/join", "POST", { code: klass.joinCode });
  assert.equal((await web("student/classes/" + klass.classId)).classId, klass.classId);
  const notice = await gateway(
    "/classes/" + klass.classId + "/announcements",
    "POST",
    { title: "P123 Class notice", body: "Prepare the lesson." },
    lt,
  );
  let item;
  const month = new Date().toISOString().slice(0, 7);
  for (let i = 0; i < 25 && !item; i++) {
    const list = await web("student/notifications?month=" + month + "&limit=20");
    item = list.items.find((n) => n.source.id === notice.announcementId);
    if (!item) await new Promise((r) => setTimeout(r, 800));
  }
  assert(item, "notification delivery");
  await web("student/notifications/" + item.notificationId + "/read", "PATCH", {}, randomUUID(), {
    "x-notification-locator": item.locator,
  });
  checks.push("class join/member detail and real asynchronous notification exact locator READ");
  await web("logout", "POST", {});
  await mkdir("docs/evidence/p12.3-web-real", { recursive: true });
  await writeFile(
    "docs/evidence/p12.3-web-real/report.json",
    JSON.stringify(
      {
        status: "PASS",
        scope: "local real Web adapter → Gateway → existing services",
        checks,
        studentCanonicalSeed: false,
        resourceIds: {
          courseId: course.courseId,
          lessonId: lesson.lessonId,
          quizId: quiz.quizId,
          attemptId: a.attemptId,
          classId: klass.classId,
        },
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: "PASS", checks }));
} finally {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}

function bootstrapRole(userId, role) {
  if (!["ADMIN", "LECTURER"].includes(role)) throw new Error("Fixture role denied");
  execFileSync(
    "docker",
    ["exec", "-i", "ailss-identity-service", "node", "--input-type=module", "-e", identityProbe()],
    { input: JSON.stringify({ userId, role }), stdio: ["pipe", "pipe", "pipe"] },
  );
}
function identityProbe() {
  return `import{readFileSync}from"node:fs";import{createHash}from"node:crypto";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();const r=(await x.execute("SELECT display_name,role,status,lecturer_verified,profile_version,updated_at FROM user_by_id WHERE user_id=?",[u(i.userId)],q)).rows[0],s=(createHash("sha256").update(i.userId).digest()[0]??0)%16;await x.execute("DELETE FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?",[r.get("role"),r.get("status"),s,r.get("updated_at"),u(i.userId)],q);await x.execute("UPDATE user_by_id SET role=? WHERE user_id=?",[i.role,u(i.userId)],q);await x.execute("INSERT INTO users_by_role_status_bucket (role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version) VALUES (?,?,?,?,?,?,?,?)",[i.role,r.get("status"),s,r.get("updated_at"),u(i.userId),r.get("display_name"),r.get("lecturer_verified"),r.get("profile_version")],q);await x.shutdown();console.log(JSON.stringify({ok:true}));`;
}

async function boundedFetch(url, init) {
  for (let i = 0; i < 3; i++) {
    try {
      return await fetch(url, init);
    } catch {
      if (i === 2) throw new Error("Local transport unavailable: " + new URL(url).pathname);
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
}
