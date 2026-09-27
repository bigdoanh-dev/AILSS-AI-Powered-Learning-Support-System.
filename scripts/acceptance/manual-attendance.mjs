import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

if ((process.env.AILSS_PROFILE ?? "dev-async") !== "dev-async") throw new Error("P7.19 requires dev-async");
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-"),
  evidence = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidence, { recursive: true });
await ready();

const owner = await register("owner"),
  nonOwner = await register("non-owner"),
  inactive = await register("inactive"),
  unverified = await register("unverified"),
  student = await register("student"),
  secondStudent = await register("second-student"),
  nonMember = await register("non-member"),
  admin = await register("admin");
for (const user of [owner, nonOwner, inactive, unverified])
  identity({ action: "promote", userId: user.userId, role: "LECTURER" });
identity({ action: "promote", userId: admin.userId, role: "ADMIN" });
const adminToken = (await login(admin)).accessToken;
for (const lecturer of [owner, nonOwner, inactive])
  expectStatus(
    await http("POST", `/api/v1/admin/lecturers/${lecturer.userId}/verify`, {
      bearer: adminToken,
      key: `verify-${lecturer.userId}-${runId}`,
      body: { currentPassword: admin.password },
    }),
    200,
    "verify Lecturer",
  );
const tokens = {
  owner: (await login(owner)).accessToken,
  nonOwner: (await login(nonOwner)).accessToken,
  inactive: (await login(inactive)).accessToken,
  unverified: (await login(unverified)).accessToken,
  student: (await login(student)).accessToken,
  secondStudent: (await login(secondStudent)).accessToken,
};
identity({ action: "suspend", userId: inactive.userId });

const klass = await createClass(tokens.owner),
  offlineStart = new Date(Date.now() - 5 * 60_000),
  offlineEnd = new Date(Date.now() + 55 * 60_000),
  onlineStart = new Date(Date.now() + 2 * 60 * 60_000),
  onlineEnd = new Date(onlineStart.getTime() + 60 * 60_000);
const offline = await createSession(tokens.owner, klass.classId, `offline-${runId}`, {
    title: "P7.19 Offline Attendance",
    startAt: offlineStart.toISOString(),
    endAt: offlineEnd.toISOString(),
    timezone: "UTC",
    mode: "OFFLINE",
    location: "Room P719",
  }),
  online = await createSession(tokens.owner, klass.classId, `online-${runId}`, {
    title: "P7.19 Online Control",
    startAt: onlineStart.toISOString(),
    endAt: onlineEnd.toISOString(),
    timezone: "UTC",
    mode: "ONLINE",
    meetingProvider: "meet",
    meetingUrl: "https://meet.example.test/p719-private",
  });
expectStatus(
  await http("POST", `/api/v1/classes/${klass.classId}/schedule/publish`, {
    bearer: tokens.owner,
    key: `publish-${runId}`,
  }),
  200,
  "publish schedule",
);
for (const [label, token] of [
  ["student", tokens.student],
  ["second", tokens.secondStudent],
])
  expectStatus(
    await http("POST", "/api/v1/classes/join", {
      bearer: token,
      key: `join-${label}-${runId}`,
      body: { code: klass.joinCode },
    }),
    201,
    "join scheduled Class",
  );

const path = `/api/v1/class-sessions/${offline.sessionId}/attendance/${student.userId}`,
  firstKey = `manual-first-${runId}`,
  firstBody = { attendanceStatus: "PRESENT", note: "Checked at the room" };
const first = await http("PUT", path, { bearer: tokens.owner, key: firstKey, body: firstBody });
expectStatus(first, 200, "manual PRESENT");
assertManual(first.json.data, { status: "PRESENT", version: 1, note: firstBody.note });
const firstCommand = classroom({
  action: "command",
  scope: `CLS-19:${owner.userId}:${offline.sessionId}:${student.userId}`,
  key: firstKey,
});
if (!firstCommand.eventId) throw new Error("manual audit eventId missing");
const replay = await http("PUT", path, { bearer: tokens.owner, key: firstKey, body: firstBody });
expectStatus(replay, 200, "same-key replay");
if (!replay.json.meta.replayed || replay.json.data.attendanceVersion !== 1)
  throw new Error("same-key replay changed attendance version");
expectStatus(
  await http("PUT", path, {
    bearer: tokens.owner,
    key: firstKey,
    body: { attendanceStatus: "ABSENT", note: "different" },
  }),
  409,
  "same-key different-body conflict",
);

const correctionBody = { attendanceStatus: "ABSENT", note: "Corrected after roll call" },
  corrected = await http("PUT", path, {
    bearer: tokens.owner,
    key: `manual-correct-${runId}`,
    body: correctionBody,
  });
expectStatus(corrected, 200, "PRESENT to ABSENT correction");
assertManual(corrected.json.data, { status: "ABSENT", version: 2, note: correctionBody.note });
const noOp = await http("PUT", path, {
  bearer: tokens.owner,
  key: `manual-noop-${runId}`,
  body: correctionBody,
});
expectStatus(noOp, 200, "semantic no-op");
if (!noOp.json.meta.noOp || noOp.json.data.attendanceVersion !== 2)
  throw new Error("semantic no-op changed version");

const concurrent = await Promise.all([
  http("PUT", path, {
    bearer: tokens.owner,
    key: `manual-concurrent-a-${runId}`,
    body: { attendanceStatus: "PRESENT", note: "Concurrent A" },
  }),
  http("PUT", path, {
    bearer: tokens.owner,
    key: `manual-concurrent-b-${runId}`,
    body: { attendanceStatus: "EXCUSED", note: "Concurrent B" },
  }),
]);
const winners = concurrent.filter((value) => value.status === 200),
  losers = concurrent.filter((value) => value.status === 409);
if (winners.length !== 1 || losers.length !== 1 || winners[0].json.data.attendanceVersion !== 3)
  throw new Error(`concurrent correction mismatch ${concurrent.map((value) => value.status).join(",")}`);
const winning = winners[0].json.data;

for (const [label, token, expected] of [
  ["non-owner", tokens.nonOwner, 403],
  ["unverified", tokens.unverified, 403],
  ["inactive", tokens.inactive, 403],
])
  expectStatus(
    await http("PUT", path, {
      bearer: token,
      key: `denied-${label}-${runId}`,
      body: { attendanceStatus: "PRESENT" },
    }),
    expected,
    `${label} Lecturer denied`,
  );
expectStatus(
  await http("PUT", `/api/v1/class-sessions/${offline.sessionId}/attendance/${nonMember.userId}`, {
    bearer: tokens.owner,
    key: `non-member-${runId}`,
    body: { attendanceStatus: "PRESENT" },
  }),
  404,
  "non-member concealed",
);
expectStatus(
  await http("PUT", `/api/v1/class-sessions/${online.sessionId}/attendance/${student.userId}`, {
    bearer: tokens.owner,
    key: `online-denied-${runId}`,
    body: { attendanceStatus: "PRESENT" },
  }),
  409,
  "ONLINE session manual attendance denied",
);

const canonical = classroom({
  action: "attendance",
  sessionId: offline.sessionId,
  studentId: student.userId,
  month: offlineStart.toISOString().slice(0, 7),
  startAt: offlineStart.toISOString(),
});
if (
  canonical.q14.version !== 3 ||
  canonical.q14.status !== winning.attendanceStatus ||
  canonical.q14.source !== "MANUAL_OFFLINE" ||
  canonical.q15.version !== 3 ||
  canonical.q15.status !== winning.attendanceStatus
)
  throw new Error(`Q14/Q15 convergence mismatch ${JSON.stringify(canonical)}`);
const roster = await http("GET", `/api/v1/class-sessions/${offline.sessionId}/attendance`, {
  bearer: tokens.owner,
});
expectStatus(roster, 200, "CLS-16 manual overlay");
const rosterStudent = roster.json.data.find((row) => row.studentId === student.userId),
  rosterUnmarked = roster.json.data.find((row) => row.studentId === secondStudent.userId);
if (
  rosterStudent?.attendanceStatus !== winning.attendanceStatus ||
  rosterStudent?.source !== "MANUAL_OFFLINE" ||
  rosterStudent?.presenceState !== "OFFLINE" ||
  rosterUnmarked?.attendanceStatus !== "NOT_RECORDED"
)
  throw new Error("CLS-16 manual/default overlay mismatch");
if (
  JSON.stringify(roster.json).includes("Corrected after") ||
  JSON.stringify(roster.json).includes("meet.example")
)
  throw new Error("CLS-16 leaked note or meeting URL");
const history = await http("GET", `/api/v1/me/attendance?month=${offlineStart.toISOString().slice(0, 7)}`, {
  bearer: tokens.student,
});
expectStatus(history, 200, "CLS-17 corrected history");
const own = history.json.data.find((row) => row.sessionId === offline.sessionId);
if (own?.attendanceStatus !== winning.attendanceStatus || own?.attendanceVersion !== 3)
  throw new Error("CLS-17 did not converge immediately");
if (
  JSON.stringify(history.json).includes("Concurrent") ||
  JSON.stringify(history.json).includes("meet.example")
)
  throw new Error("CLS-17 leaked note or meeting URL");

await waitFor(
  () => classroom({ action: "event", eventId: firstCommand.eventId }).state === "PUBLISHED",
  30_000,
);
const audit = classroom({ action: "event", eventId: firstCommand.eventId });
if (
  audit.eventId !== firstCommand.eventId ||
  audit.payload.includes("Checked at the room") ||
  audit.payload.includes("meet.example")
)
  throw new Error("audit stability/privacy mismatch");

let brokerRestarted = false;
const outagePath = `/api/v1/class-sessions/${offline.sessionId}/attendance/${secondStudent.userId}`,
  outageKey = `manual-outage-${runId}`;
try {
  docker("stop", "ailss-rabbitmq");
  const outage = await http("PUT", outagePath, {
    bearer: tokens.owner,
    key: outageKey,
    body: { attendanceStatus: "EXCUSED", note: "Private outage note" },
  });
  expectStatus(outage, 200, "broker outage manual attendance");
  assertManual(outage.json.data, { status: "EXCUSED", version: 1, note: "Private outage note" });
  const outageCommand = classroom({
    action: "command",
    scope: `CLS-19:${owner.userId}:${offline.sessionId}:${secondStudent.userId}`,
    key: outageKey,
  });
  const beforeRestart = classroom({ action: "event", eventId: outageCommand.eventId });
  if (beforeRestart.state === "PUBLISHED") throw new Error("outage audit unexpectedly published");
  docker("start", "ailss-rabbitmq");
  brokerRestarted = true;
  await rabbitReady();
  await waitFor(
    () => classroom({ action: "event", eventId: outageCommand.eventId }).state === "PUBLISHED",
    90_000,
  );
  const afterRestart = classroom({ action: "event", eventId: outageCommand.eventId });
  if (afterRestart.eventId !== outageCommand.eventId || afterRestart.payload.includes("Private outage note"))
    throw new Error("broker recovery changed audit identity or leaked note");
} finally {
  if (!brokerRestarted) {
    docker("start", "ailss-rabbitmq");
    await rabbitReady();
  }
}
if (!classroom({ action: "deny" }).denied) throw new Error("svc_classroom foreign-keyspace access allowed");

const summary = {
  phase: "P7.19",
  status: "PASS",
  manualCreate: true,
  correctionVersion: 3,
  semanticNoOp: true,
  idempotencyReplayConflict: true,
  concurrentOneWinner: true,
  canonicalEligibilityAndOwner: true,
  offlineOnly: true,
  q14Q15Converged: true,
  cls16Cls17Converged: true,
  auditStableAndPrivate: true,
  brokerOutageRecovered: true,
  foreignKeyspaceDenied: true,
  counts: { publicApis: 98, internalApis: 15, queryIds: 74, events: 22, redis: false },
};
await writeFile(new URL("p7.19-summary.json", evidence), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ ...summary, evidence: decodeURIComponent(evidence.pathname) }));

async function createClass(token) {
  const response = await http("POST", "/api/v1/classes", {
    bearer: token,
    key: `class-${runId}`,
    body: { name: `P7.19 Class ${runId}`, classKind: "PRIVATE", maxMembers: 50 },
  });
  expectStatus(response, 201, "create Class");
  return response.json.data;
}
async function createSession(token, classId, key, body) {
  const response = await http("POST", `/api/v1/classes/${classId}/sessions`, {
    bearer: token,
    key,
    body,
  });
  expectStatus(response, 201, "create Session");
  return response.json.data.sessions[0];
}
async function register(label) {
  const id = randomUUID(),
    user = {
      email: `p719-${label}-${id}@example.test`,
      password: `P7.19-${label}-${id}-Aa1!`,
      displayName: `P719 ${label}`,
    };
  const response = await http("POST", "/api/v1/auth/register", { key: `register-${id}`, body: user });
  expectStatus(response, 201, "register");
  return { ...user, userId: response.json.data.userId };
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
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  throw last;
}
function expectStatus(value, status, label) {
  if (value.status !== status) throw new Error(`${label}: ${value.status} ${JSON.stringify(value.json)}`);
}
function assertManual(value, expected) {
  if (
    value.attendanceStatus !== expected.status ||
    value.attendanceVersion !== expected.version ||
    value.note !== expected.note ||
    value.source !== "MANUAL_OFFLINE" ||
    value.presenceState !== "OFFLINE"
  )
    throw new Error(`manual result mismatch ${JSON.stringify(value)}`);
}
async function ready() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch("http://127.0.0.1:8080/health/ready")).ok) return;
    } catch {
      // Transient while local containers start.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Gateway unavailable");
}
async function rabbitReady() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const status = execFileSync("docker", ["inspect", "-f", "{{.State.Health.Status}}", "ailss-rabbitmq"], {
      encoding: "utf8",
    }).trim();
    if (status === "healthy") return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("RabbitMQ did not become healthy");
}
async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("condition did not converge");
}
function docker(action, container) {
  execFileSync("docker", [action, container], { stdio: "ignore" });
}
function identity(input) {
  return runDb("ailss-identity-service", identityProbe(), input);
}
function classroom(input) {
  return runDb("ailss-classroom-service", classroomProbe(), input);
}
function runDb(container, program, input) {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", container, "node", "--input-type=module", "-e", program], {
      input: JSON.stringify(input),
      encoding: "utf8",
    }).trim(),
  );
}
function identityProbe() {
  return `import{readFileSync}from"node:fs";import{createHash}from"node:crypto";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();let o={};const r=(await x.execute("SELECT display_name,role,status,lecturer_verified,profile_version,updated_at FROM user_by_id WHERE user_id=?",[u(i.userId)],q)).rows[0],s=(createHash("sha256").update(i.userId).digest()[0]??0)%16;if(i.action==="promote"){await x.execute("DELETE FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?",[r.get("role"),r.get("status"),s,r.get("updated_at"),u(i.userId)],q);await x.execute("UPDATE user_by_id SET role=? WHERE user_id=?",[i.role,u(i.userId)],q);await x.execute("INSERT INTO users_by_role_status_bucket (role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version) VALUES (?,?,?,?,?,?,?,?)",[i.role,r.get("status"),s,r.get("updated_at"),u(i.userId),r.get("display_name"),r.get("lecturer_verified"),r.get("profile_version")],q);o={ok:true};}else if(i.action==="suspend"){await x.execute("UPDATE user_by_id SET status='SUSPENDED' WHERE user_id=?",[u(i.userId)],q);o={ok:true};}await x.shutdown();console.log(JSON.stringify(o));`;
}
function classroomProbe() {
  return `import{readFileSync}from"node:fs";import{createHash,createHmac}from"node:crypto";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();let o={};if(i.action==="command"){const b=createHmac("sha256",process.env.PASSWORD_IDEMPOTENCY_HMAC_KEY).update(i.key).digest()[0]??0,h=b>127?b-256:b,r=(await x.execute("SELECT operation_id,resource_id,status,result_checksum FROM idempotency_by_scope_key WHERE scope=? AND key_hash=? AND idempotency_key=?",[i.scope,h,i.key],q)).rows[0],m=r?JSON.parse(r.get("result_checksum")):{};o={operationId:r?String(r.get("operation_id")):null,resourceId:r?String(r.get("resource_id")):null,status:r?.get("status")??null,eventId:m.eventId??null,occurredAt:m.occurredAt??null};}else if(i.action==="attendance"){const a=(await x.execute("SELECT attendance_status,source,manual_note,presence_state,connected_duration_seconds,attendance_version FROM attendance_by_session WHERE session_id=? AND student_id=?",[u(i.sessionId),u(i.studentId)],q)).rows[0],m=c.types.LocalDate.fromString(i.month+"-01"),h=(await x.execute("SELECT attendance_status,manual_note,attendance_version FROM attendance_by_student_bucket WHERE student_id=? AND year_month=? AND start_at=? AND session_id=?",[u(i.studentId),m,new Date(i.startAt),u(i.sessionId)],q)).rows[0];o={q14:{status:a?.get("attendance_status")??null,source:a?.get("source")??null,note:a?.get("manual_note")??null,presence:a?.get("presence_state")??null,duration:a?Number(a.get("connected_duration_seconds").toString()):null,version:a?Number(a.get("attendance_version").toString()):null},q15:{status:h?.get("attendance_status")??null,note:h?.get("manual_note")??null,version:h?Number(h.get("attendance_version").toString()):null}};}else if(i.action==="event"){const r=(await x.execute("SELECT state,created_at FROM pending_event_by_id WHERE event_id=?",[u(i.eventId)],q)).rows[0];let payload="";if(r){const day=c.types.LocalDate.fromString(r.get("created_at").toISOString().slice(0,10)),shard=(createHash("sha256").update(i.eventId).digest()[0]??0)%16,rows=(await x.execute("SELECT event_id,payload_json FROM pending_events_by_due_bucket WHERE due_day=? AND shard=?",[day,shard],q)).rows,p=rows.find(v=>String(v.get("event_id"))===i.eventId);payload=p?.get("payload_json")??"";}o={eventId:i.eventId,state:r?.get("state")??null,payload};}else if(i.action==="deny"){try{await x.execute("SELECT user_id FROM identity_keyspace.user_by_id LIMIT 1",[],q);o={denied:false}}catch{o={denied:true}}}await x.shutdown();console.log(JSON.stringify(o));`;
}
