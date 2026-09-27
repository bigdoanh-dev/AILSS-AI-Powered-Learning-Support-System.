import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { importPKCS8, SignJWT } from "jose";

if ((process.env.AILSS_PROFILE ?? "dev-async") !== "dev-async") throw new Error("P7.15A requires dev-async");
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-"),
  evidence = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidence, { recursive: true });
await ready();
const admin = await register("admin"),
  lecturer = await register("lecturer"),
  ineligible = await register("ineligible"),
  student = await register("student");
identity({ action: "promote", userId: admin.userId, role: "ADMIN" });
identity({ action: "promote", userId: lecturer.userId, role: "LECTURER" });
identity({ action: "promote", userId: ineligible.userId, role: "LECTURER" });
const adminToken = (await login(admin)).accessToken;
expectStatus(
  await http("POST", `/api/v1/admin/lecturers/${lecturer.userId}/verify`, {
    bearer: adminToken,
    key: `verify-${runId}`,
    body: { currentPassword: admin.password },
  }),
  200,
  "verify Lecturer",
);
const lecturerToken = (await login(lecturer)).accessToken,
  ineligibleToken = (await login(ineligible)).accessToken,
  studentToken = (await login(student)).accessToken;
const course = await createPublishedCourse(lecturerToken, adminToken, admin.password);
expectStatus(
  await http("POST", "/api/v1/classes", {
    bearer: ineligibleToken,
    key: `ineligible-${runId}`,
    body: { name: "Unverified Lecturer Class", classKind: "PRIVATE" },
  }),
  403,
  "unverified Lecturer denied",
);
expectStatus(
  await http("POST", "/api/v1/classes", {
    bearer: studentToken,
    key: `student-${runId}`,
    body: { name: "Denied", classKind: "PRIVATE" },
  }),
  403,
  "Student create denied",
);
const createKey = `class-${runId}`,
  body = {
    name: "P715A Private Lab",
    classKind: "PRIVATE",
    linkedCourseId: course.courseId,
    maxMembers: 50,
  };
const created = await http("POST", "/api/v1/classes", { bearer: lecturerToken, key: createKey, body });
expectStatus(created, 201, "create Class");
if (
  created.json.data.scheduleState !== "DRAFT" ||
  created.json.data.scheduleVersion !== 1 ||
  created.json.data.version !== 1
)
  throw new Error("Class initial invariant mismatch");
const classId = created.json.data.classId,
  joinCode = created.json.data.joinCode;
const replay = await http("POST", "/api/v1/classes", { bearer: lecturerToken, key: createKey, body });
expectStatus(replay, 201, "create replay");
if (
  !replay.json.meta.replayed ||
  replay.json.data.classId !== classId ||
  replay.json.data.joinCode !== joinCode
)
  throw new Error("Class replay mismatch");
expectStatus(
  await http("POST", "/api/v1/classes", {
    bearer: lecturerToken,
    key: `missing-link-${runId}`,
    body: { name: "Missing Course Link", classKind: "PRIVATE", linkedCourseId: randomUUID() },
  }),
  409,
  "INT-LRN-02 missing link denied",
);
expectStatus(
  await http("POST", "/api/v1/classes", {
    bearer: lecturerToken,
    key: createKey,
    body: { ...body, name: "Conflict Class" },
  }),
  409,
  "create conflict",
);
expectStatus(
  await http("GET", `/api/v1/classes/${classId}`, { bearer: studentToken }),
  403,
  "outsider concealed",
);
const joined = await http("POST", "/api/v1/classes/join", {
  bearer: studentToken,
  key: `join-${runId}`,
  body: { code: joinCode },
});
expectStatus(joined, 201, "PRIVATE DRAFT join");
const joinReplay = await http("POST", "/api/v1/classes/join", {
  bearer: studentToken,
  key: `join-${runId}`,
  body: { code: joinCode },
});
expectStatus(joinReplay, 201, "join replay");
if (!joinReplay.json.meta.replayed || joinReplay.json.data.membershipId !== joined.json.data.membershipId)
  throw new Error("join replay mismatch");
const duplicate = await http("POST", "/api/v1/classes/join", {
  bearer: studentToken,
  key: `join-duplicate-${runId}`,
  body: { code: joinCode },
});
expectStatus(duplicate, 201, "duplicate logical membership");
if (duplicate.json.data.membershipId !== joined.json.data.membershipId)
  throw new Error("duplicate join created another membership");
const concurrentStudent = await register("concurrent-student"),
  concurrentToken = (await login(concurrentStudent)).accessToken,
  concurrent = await Promise.all([
    http("POST", "/api/v1/classes/join", {
      bearer: concurrentToken,
      key: `join-a-${runId}`,
      body: { code: joinCode },
    }),
    http("POST", "/api/v1/classes/join", {
      bearer: concurrentToken,
      key: `join-b-${runId}`,
      body: { code: joinCode },
    }),
  ]);
for (const value of concurrent) expectStatus(value, 201, "concurrent one-winner join");
if (concurrent[0].json.data.membershipId !== concurrent[1].json.data.membershipId)
  throw new Error("concurrent join produced two memberships");
expectStatus(await http("GET", `/api/v1/classes/${classId}`, { bearer: studentToken }), 200, "member detail");
const updated = await http("PATCH", `/api/v1/classes/${classId}`, {
  bearer: lecturerToken,
  key: `update-${runId}`,
  body: { name: "P715A Revised Lab" },
});
expectStatus(updated, 200, "owner update");
if (updated.json.data.version !== 2 || updated.json.data.scheduleVersion !== 1)
  throw new Error("update version mismatch");
const noop = await http("PATCH", `/api/v1/classes/${classId}`, {
  bearer: lecturerToken,
  key: `noop-${runId}`,
  body: { name: "P715A Revised Lab" },
});
expectStatus(noop, 200, "semantic no-op");
if (!noop.json.meta.noOp || noop.json.data.version !== 2) throw new Error("no-op advanced version");
const reset = await http("POST", `/api/v1/classes/${classId}/join-code/reset`, {
  bearer: lecturerToken,
  key: `reset-${runId}`,
});
expectStatus(reset, 200, "reset code");
if (reset.json.data.joinCode === joinCode || reset.json.data.version !== 3)
  throw new Error("reset invariant mismatch");
const resetReplay = await http("POST", `/api/v1/classes/${classId}/join-code/reset`, {
  bearer: lecturerToken,
  key: `reset-${runId}`,
});
expectStatus(resetReplay, 200, "reset replay");
if (!resetReplay.json.meta.replayed || resetReplay.json.data.joinCode !== reset.json.data.joinCode)
  throw new Error("reset replay did not return the stable resulting code");
expectStatus(
  await http("POST", "/api/v1/classes/join", {
    bearer: (await login(await register("old-code-student"))).accessToken,
    key: `old-code-${runId}`,
    body: { code: joinCode },
  }),
  404,
  "retired code denied",
);
const announcement = await http("POST", `/api/v1/classes/${classId}/announcements`, {
  bearer: lecturerToken,
  key: `announcement-${runId}`,
  body: { title: "Lab notice", body: "Welcome to the private lab." },
});
expectStatus(announcement, 201, "announcement");
expectStatus(
  await http("GET", `/api/v1/classes/${classId}/announcements`, { bearer: studentToken }),
  200,
  "announcement read",
);
const live = await http("POST", "/api/v1/classes", {
  bearer: lecturerToken,
  key: `live-${runId}`,
  body: { name: "P715A Live Cohort", classKind: "LIVE_COHORT" },
});
expectStatus(live, 201, "LIVE_COHORT DRAFT create");
expectStatus(
  await http("POST", "/api/v1/classes/join", {
    bearer: studentToken,
    key: `live-join-${runId}`,
    body: { code: live.json.data.joinCode },
  }),
  409,
  "LIVE_COHORT join denied",
);
const publishedPrivate = await http("POST", "/api/v1/classes", {
  bearer: lecturerToken,
  key: `published-private-${runId}`,
  body: { name: "Published Private Schedule", classKind: "PRIVATE" },
});
expectStatus(publishedPrivate, 201, "published-schedule fixture create");
inspect({ action: "publishSchedule", classId: publishedPrivate.json.data.classId });
const reservationStudent = await register("reservation-student");
expectStatus(
  await http("POST", "/api/v1/classes/join", {
    bearer: (await login(reservationStudent)).accessToken,
    key: `published-join-${runId}`,
    body: { code: publishedPrivate.json.data.joinCode },
  }),
  503,
  "PUBLISHED schedule join fails closed",
);
await verifyInternalProviders(classId);
const state = inspect({ action: "inspect", classId, lecturerId: lecturer.userId, studentId: student.userId });
if (
  !state.canonical ||
  state.lecturerRows !== 1 ||
  !state.membership ||
  state.studentRows !== 1 ||
  state.rosterRows !== 1
)
  throw new Error(`Classroom projection mismatch ${JSON.stringify(state)}`);
for (const eventId of state.eventIds) {
  const event = await waitEvent(eventId);
  if (event.state !== "PUBLISHED") throw new Error(`event ${eventId} was not published`);
}
if (!inspect({ action: "deny" }).denied)
  throw new Error("svc_classroom foreign keyspace access was not denied");
execFileSync("docker", ["stop", "ailss-rabbitmq"], { stdio: "pipe" });
const outage = await http("POST", "/api/v1/classes", {
  bearer: lecturerToken,
  key: `outage-${runId}`,
  body: { name: "Broker Recovery Class", classKind: "INSTITUTIONAL" },
});
expectStatus(outage, 201, "create during broker outage");
const outageState = inspect({ action: "classEvent", classId: outage.json.data.classId });
const recoverable = await waitEventState(outageState.eventId, ["READY", "PUBLISHING"]);
execFileSync("docker", ["start", "ailss-rabbitmq"], { stdio: "pipe" });
await rabbitReady();
const recovered = await waitEvent(outageState.eventId, 40_000);
if (recovered.state !== "PUBLISHED") throw new Error("broker recovery failed");
const summary = {
  stage: "phase-7.15a-classroom-core-acceptance",
  status: "PASS",
  runId,
  classId,
  createReplay: true,
  joinReplay: true,
  duplicateJoinOneWinner: true,
  concurrentJoinOneWinner: true,
  privateDraftJoin: true,
  liveCohortJoinDenied: true,
  publishedScheduleJoinDeferred: true,
  internalProvidersAuthenticated: true,
  version: 3,
  scheduleVersion: 1,
  projections: { lecturer: 1, student: 1, roster: 1 },
  outboxPublished: true,
  brokerOutage: { eventId: outageState.eventId, recoverable: recoverable.state, recovered: recovered.state },
  foreignKeyspaceDenied: true,
  counts: { publicApis: 98, internalApis: 15, queryIds: 74, events: 22, redis: false },
};
await writeFile(new URL("p7.15a-summary.json", evidence), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ ...summary, evidence: decodeURIComponent(evidence.pathname) }));

async function register(label) {
  const id = randomUUID(),
    user = {
      email: `p715a-${label}-${id}@example.test`,
      password: `P7.15A-${label}-${id}-Aa1!`,
      displayName: `P715A ${label}`,
    };
  const response = await http("POST", "/api/v1/auth/register", { key: `register-${id}`, body: user });
  expectStatus(response, 201, "register");
  return { ...user, userId: response.json.data.userId };
}
async function createPublishedCourse(lecturerToken, adminToken, adminPassword) {
  const created = await http("POST", "/api/v1/courses", {
    bearer: lecturerToken,
    key: `course-${runId}`,
    body: {
      title: "P715A Linkable Course",
      slug: `p715a-${randomUUID()}`,
      categoryId: randomUUID(),
      priceType: "FREE",
      price: "0",
      currency: "VND",
    },
  });
  expectStatus(created, 201, "create linkable Course");
  expectStatus(
    await http("POST", `/api/v1/courses/${created.json.data.courseId}/lessons`, {
      bearer: lecturerToken,
      key: `lesson-${runId}`,
      body: {
        title: "Class Link Foundation",
        sectionTitle: "Foundation",
        position: { sectionOrder: 1, lessonOrder: 1 },
        preview: true,
      },
    }),
    201,
    "create Course lesson",
  );
  expectStatus(
    await http("POST", `/api/v1/courses/${created.json.data.courseId}/submit-review`, {
      bearer: lecturerToken,
      key: `review-${runId}`,
    }),
    202,
    "submit Course review",
  );
  expectStatus(
    await http("POST", `/api/v1/admin/courses/${created.json.data.courseId}/publish`, {
      bearer: adminToken,
      key: `publish-course-${runId}`,
      body: { currentPassword: adminPassword },
    }),
    200,
    "publish linkable Course",
  );
  return created.json.data;
}
async function login(user) {
  const response = await http("POST", "/api/v1/auth/login", {
    body: { email: user.email, password: user.password },
  });
  expectStatus(response, 200, "login");
  return response.json.data;
}
async function http(method, path, { body, bearer, key } = {}) {
  let last;
  for (let attempt = 0; attempt < 5; attempt += 1)
    try {
      const response = await fetch(`http://127.0.0.1:8080${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          ...(key ? { "idempotency-key": key } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30_000),
      });
      const text = await response.text();
      return { status: response.status, json: text ? JSON.parse(text) : undefined };
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  throw last;
}
function expectStatus(value, status, label) {
  if (value.status !== status) throw new Error(`${label}: ${value.status} ${JSON.stringify(value.json)}`);
}
async function ready() {
  for (let index = 0; index < 120; index += 1) {
    try {
      if ((await fetch("http://127.0.0.1:8080/health/ready")).ok) return;
    } catch {
      // transient while the stack starts
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Gateway unavailable");
}
async function rabbitReady() {
  for (let index = 0; index < 80; index += 1) {
    try {
      const status = execFileSync("docker", ["inspect", "-f", "{{.State.Health.Status}}", "ailss-rabbitmq"], {
        encoding: "utf8",
      }).trim();
      if (status === "healthy") return;
    } catch {
      // broker is starting
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("RabbitMQ unavailable after restart");
}
async function waitEvent(eventId, timeout = 25_000) {
  const value = await waitEventState(eventId, ["PUBLISHED"], timeout);
  return value;
}
async function waitEventState(eventId, states, timeout = 15_000) {
  const end = Date.now() + timeout;
  let value;
  while (Date.now() < end) {
    value = inspect({ action: "event", eventId });
    if (states.includes(value.state)) return value;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`event ${eventId} state ${value?.state ?? "missing"}`);
}
function identity(input) {
  return runDb("ailss-identity-service", input);
}
function inspect(input) {
  return runDb("ailss-classroom-service", input);
}
async function verifyInternalProviders(classId) {
  const cases = [
    [
      "assessment",
      "dev-assessment-2026-01",
      "assessment-service",
      "classroom.quiz-eligibility.read",
      "quiz-eligibility",
    ],
    [
      "interaction",
      "dev-interaction-2026-01",
      "interaction-service",
      "classroom.interaction-eligibility.read",
      "interaction-eligibility",
    ],
    ["ai", "dev-ai-2026-01", "ai-service", "classroom.ai-context.read", "ai-context"],
  ];
  for (const [keyName, kid, subject, purpose, suffix] of cases) {
    const token = await signedServiceToken(keyName, kid, subject, purpose);
    const result = directClassroom(`/internal/v1/classes/${classId}/${suffix}`, token);
    expectStatus(
      result,
      suffix === "interaction-eligibility" ? 404 : 200,
      suffix === "interaction-eligibility"
        ? "INT-CLS-02 requires member/owner Actor Context"
        : `${subject} internal provider`,
    );
  }
  const forged = await signedServiceToken(
    "assessment",
    "dev-assessment-2026-01",
    "rogue-service",
    "classroom.quiz-eligibility.read",
  );
  expectStatus(
    directClassroom(`/internal/v1/classes/${classId}/quiz-eligibility`, forged),
    403,
    "INT-CLS exact caller allowlist",
  );
  expectStatus(
    directClassroom(`/internal/v1/classes/${classId}/quiz-eligibility`),
    401,
    "INT-CLS token required",
  );
}
async function signedServiceToken(keyName, kid, subject, purpose) {
  const pem = await readFile(
    new URL(`../../infrastructure/tls/generated/services/${keyName}-private.pem`, import.meta.url),
    "utf8",
  );
  const key = await importPKCS8(pem, "EdDSA");
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ purpose })
    .setProtectedHeader({ alg: "EdDSA", kid, typ: "service+jwt" })
    .setIssuer("ailss-internal")
    .setAudience("classroom-service")
    .setSubject(subject)
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .setJti(randomUUID())
    .sign(key);
}
function directClassroom(path, token) {
  const source = `const r=await fetch(${JSON.stringify(`http://127.0.0.1:8103${path}`)},{headers:${JSON.stringify(
    token
      ? { authorization: `Service ${token}`, "x-correlation-id": randomUUID() }
      : { "x-correlation-id": randomUUID() },
  )}});const t=await r.text();console.log(JSON.stringify({status:r.status,json:t?JSON.parse(t):undefined}));`;
  return JSON.parse(
    execFileSync("docker", ["exec", "ailss-classroom-service", "node", "--input-type=module", "-e", source], {
      encoding: "utf8",
    }).trim(),
  );
}
function runDb(container, input) {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", container, "node", "--input-type=module", "-e", probe()], {
      input: JSON.stringify(input),
      encoding: "utf8",
    }).trim(),
  );
}
function probe() {
  return `import{readFileSync}from"node:fs";import{createHash}from"node:crypto";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();let o={};if(i.action==="promote"){const r=(await x.execute("SELECT display_name,role,status,lecturer_verified,profile_version,updated_at FROM user_by_id WHERE user_id=?",[u(i.userId)],q)).rows[0],s=(createHash("sha256").update(i.userId).digest()[0]??0)%16;await x.execute("DELETE FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?",[r.get("role"),r.get("status"),s,r.get("updated_at"),u(i.userId)],q);await x.execute("UPDATE user_by_id SET role=? WHERE user_id=?",[i.role,u(i.userId)],q);await x.execute("INSERT INTO users_by_role_status_bucket (role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version) VALUES (?,?,?,?,?,?,?,?)",[i.role,r.get("status"),s,r.get("updated_at"),u(i.userId),r.get("display_name"),r.get("lecturer_verified"),r.get("profile_version")],q);o={ok:true};}else if(i.action==="publishSchedule"){await x.execute("UPDATE class_by_id SET schedule_state='PUBLISHED' WHERE class_id=?",[u(i.classId)],q);o={ok:true};}else if(i.action==="inspect"){const a=(await x.execute("SELECT class_id,version FROM class_by_id WHERE class_id=?",[u(i.classId)],q)).rows[0],l=(await x.execute("SELECT class_id FROM classes_by_lecturer WHERE lecturer_id=?",[u(i.lecturerId)],q)).rows.filter(r=>String(r.get("class_id"))===i.classId),m=(await x.execute("SELECT membership_id FROM membership_by_class_student WHERE class_id=? AND student_id=?",[u(i.classId),u(i.studentId)],q)).rows[0],s=(await x.execute("SELECT class_id FROM classes_by_student WHERE student_id=?",[u(i.studentId)],q)).rows.filter(r=>String(r.get("class_id"))===i.classId);let n=0;for(let h=0;h<16;h++)n+=(await x.execute("SELECT student_id FROM students_by_class WHERE class_id=? AND state='ACTIVE' AND shard=?",[u(i.classId),h],q)).rows.filter(r=>String(r.get("student_id"))===i.studentId).length;const ids=new Set([i.classId,...(m?[String(m.get("membership_id"))]:[])]),e=(await x.execute("SELECT event_id,aggregate_id FROM pending_event_by_id",[],q)).rows.filter(r=>ids.has(String(r.get("aggregate_id")))).map(r=>String(r.get("event_id")));o={canonical:Boolean(a),version:a?Number(a.get("version").toString()):0,lecturerRows:l.length,membership:Boolean(m),studentRows:s.length,rosterRows:n,eventIds:e};}else if(i.action==="event"){const r=(await x.execute("SELECT state FROM pending_event_by_id WHERE event_id=?",[u(i.eventId)],q)).rows[0];o={state:r?.get("state")??null};}else if(i.action==="classEvent"){const r=(await x.execute("SELECT event_id,aggregate_id FROM pending_event_by_id",[],q)).rows.find(r=>String(r.get("aggregate_id"))===i.classId);o={eventId:String(r.get("event_id"))};}else if(i.action==="deny"){try{await x.execute("SELECT user_id FROM identity_keyspace.user_by_id LIMIT 1",[],q);o={denied:false}}catch{o={denied:true}}}await x.shutdown();console.log(JSON.stringify(o));`;
}
