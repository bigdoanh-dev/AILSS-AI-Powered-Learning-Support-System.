import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { importPKCS8, SignJWT } from "jose";

if ((process.env.AILSS_PROFILE ?? "dev-async") !== "dev-async") throw new Error("P7.16 requires dev-async");
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-"),
  evidence = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidence, { recursive: true });
await ready();

const admin = await register("admin"),
  lecturer = await register("lecturer"),
  student = await register("student"),
  concurrentStudent = await register("concurrent");
identity({ action: "promote", userId: admin.userId, role: "ADMIN" });
identity({ action: "promote", userId: lecturer.userId, role: "LECTURER" });
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
  studentToken = (await login(student)).accessToken,
  concurrentToken = (await login(concurrentStudent)).accessToken;
const hour = 3_600_000,
  base = Math.ceil((Date.now() + 48 * hour) / hour) * hour,
  at = (days, hours) => new Date(base + days * 86_400_000 + hours * hour).toISOString(),
  day = (days) => new Date(base + days * 86_400_000).toISOString().slice(0, 10);

// Class A is confirmed. B strictly overlaps A and is rejected before ACTIVE membership. C touches another day.
const classA = await scheduledClass("Class A", at(0, 19), at(0, 21)),
  classB = await scheduledClass("Class B", at(0, 20), at(0, 22)),
  classC = await scheduledClass("Class C", at(1, 19), at(1, 21));
const joinKey = `join-a-${runId}`,
  joinedA = await join(studentToken, classA.joinCode, joinKey);
expectStatus(joinedA, 201, "join Class A");
if (joinedA.json.data.state !== "ACTIVE") throw new Error("Class A membership was not ACTIVE");
const replayA = await join(studentToken, classA.joinCode, joinKey);
expectStatus(replayA, 201, "join Class A replay");
if (!replayA.json.meta.replayed || replayA.json.data.membershipId !== joinedA.json.data.membershipId)
  throw new Error("join replay did not preserve membership");
expectStatus(await join(studentToken, classB.joinCode, `join-b-${runId}`), 409, "Class B overlap");
const joinedC = await join(studentToken, classC.joinCode, `join-c-${runId}`);
expectStatus(joinedC, 201, "join Class C");

const schedule = await http("GET", `/api/v1/me/schedule?from=${day(0)}&to=${day(2)}`, {
  bearer: studentToken,
});
expectStatus(schedule, 200, "CLS-15 own schedule");
const names = schedule.json.data.map((v) => v.className).sort();
if (names.join(",") !== "Class A,Class C" || JSON.stringify(schedule.json).includes("meetingUrl"))
  throw new Error(`CLS-15 privacy/content mismatch ${JSON.stringify(schedule.json)}`);
const overnightClass = await scheduledClass(
  "Cross Midnight",
  `${day(2)}T23:00:00.000Z`,
  `${day(3)}T01:00:00.000Z`,
);
expectStatus(
  await join(studentToken, overnightClass.joinCode, `join-overnight-${runId}`),
  201,
  "cross-midnight join",
);
const overnightSchedule = await http("GET", `/api/v1/me/schedule?from=${day(2)}&to=${day(3)}`, {
  bearer: studentToken,
});
expectStatus(overnightSchedule, 200, "CLS-15 cross-midnight range");
if (overnightSchedule.json.data.filter((v) => v.classId === overnightClass.classId).length !== 1)
  throw new Error("CLS-15 did not deduplicate cross-midnight schedule segments");
expectStatus(
  await http("GET", `/api/v1/me/schedule?from=${day(0)}&to=${day(40)}`, { bearer: studentToken }),
  400,
  "CLS-15 31-day bound",
);

// ERRATA-P7-016-01: an old DRAFT Class with ACTIVE members cannot newly publish.
const legacy = await createClass("Legacy Active Members");
expectStatus(await join(concurrentToken, legacy.joinCode, `legacy-join-${runId}`), 201, "legacy DRAFT join");
await createSession(legacy.classId, at(4, 9), at(4, 10));
expectStatus(await publish(legacy.classId), 409, "CLS-20 existing ACTIVE member guard");

// Two simultaneous overlapping joins for a clean Student: one may win, never both.
const raceA = await scheduledClass("Race A", at(5, 9), at(5, 11)),
  raceB = await scheduledClass("Race B", at(5, 10), at(5, 12));
const race = await Promise.all([
  join(concurrentToken, raceA.joinCode, `race-a-${runId}`),
  join(concurrentToken, raceB.joinCode, `race-b-${runId}`),
]);
if (race.filter((v) => v.status === 201).length !== 1 || race.filter((v) => v.status === 409).length !== 1)
  throw new Error(`schedule guard did not produce one winner: ${race.map((v) => v.status).join(",")}`);

// Direct registered INT-CLS-04/05/06 security and replay.
const directStudent = await register("direct"),
  directClass = await scheduledClass("Direct Reserve", at(7, 9), at(7, 10)),
  reserveOperation = randomUUID(),
  offeringId = randomUUID(),
  correlationId = randomUUID(),
  reserveToken = await serviceToken("classroom.schedule.reserve"),
  actorToken = await actorContext(directStudent.userId, correlationId);
const held = await direct(
  "POST",
  "/internal/v1/schedule-reservations",
  reserveToken,
  actorToken,
  correlationId,
  {
    operationId: reserveOperation,
    studentId: directStudent.userId,
    offeringId,
    classId: directClass.classId,
  },
);
expectStatus(held, 201, "INT-CLS-04 reserve");
const heldReplay = await direct(
  "POST",
  "/internal/v1/schedule-reservations",
  reserveToken,
  actorToken,
  correlationId,
  {
    operationId: reserveOperation,
    studentId: directStudent.userId,
    offeringId,
    classId: directClass.classId,
  },
);
expectStatus(heldReplay, 201, "INT-CLS-04 replay");
if (heldReplay.json.data.reservationId !== held.json.data.reservationId)
  throw new Error("reserve replay changed ID");
const confirmRequest = { operationId: randomUUID(), orderId: randomUUID(), membershipId: randomUUID() };
const confirmed = await direct(
  "POST",
  `/internal/v1/schedule-reservations/${held.json.data.reservationId}/confirm`,
  await serviceToken("classroom.schedule.confirm"),
  undefined,
  randomUUID(),
  confirmRequest,
);
expectStatus(confirmed, 200, "INT-CLS-05 confirm");
if (confirmed.json.data.state !== "CONFIRMED") throw new Error("reservation not CONFIRMED");
expectStatus(
  await direct(
    "POST",
    `/internal/v1/schedule-reservations/${held.json.data.reservationId}/confirm`,
    await serviceToken("classroom.schedule.confirm"),
    undefined,
    randomUUID(),
    confirmRequest,
  ),
  200,
  "INT-CLS-05 replay",
);

const releaseClass = await scheduledClass("Direct Release", at(8, 9), at(8, 10)),
  releaseOperation = randomUUID(),
  releaseCorrelation = randomUUID(),
  releaseActor = await actorContext(directStudent.userId, releaseCorrelation),
  releasable = await direct(
    "POST",
    "/internal/v1/schedule-reservations",
    reserveToken,
    releaseActor,
    releaseCorrelation,
    {
      operationId: releaseOperation,
      studentId: directStudent.userId,
      offeringId: randomUUID(),
      classId: releaseClass.classId,
    },
  );
expectStatus(releasable, 201, "reserve for release");
const released = await direct(
  "POST",
  `/internal/v1/schedule-reservations/${releasable.json.data.reservationId}/release`,
  await serviceToken("classroom.schedule.release"),
  undefined,
  randomUUID(),
  { operationId: randomUUID(), reason: "CANCELLED" },
);
expectStatus(released, 200, "INT-CLS-06 release");
if (released.json.data.state !== "RELEASED") throw new Error("reservation not RELEASED");
expectStatus(
  await direct(
    "POST",
    `/internal/v1/schedule-reservations/${releasable.json.data.reservationId}/release`,
    await serviceToken("classroom.schedule.release"),
    undefined,
    randomUUID(),
    { operationId: randomUUID(), reason: "CANCELLED" },
  ),
  200,
  "INT-CLS-06 replay",
);

const expiryClass = await scheduledClass("Expiry Runner", at(9, 9), at(9, 10)),
  expiryOperation = randomUUID(),
  expiryCorrelation = randomUUID(),
  expiryHeld = await direct(
    "POST",
    "/internal/v1/schedule-reservations",
    reserveToken,
    await actorContext(directStudent.userId, expiryCorrelation),
    expiryCorrelation,
    {
      operationId: expiryOperation,
      studentId: directStudent.userId,
      offeringId: randomUUID(),
      classId: expiryClass.classId,
    },
  );
expectStatus(expiryHeld, 201, "reserve for expiry runner");
expiryDb({ action: "due", reservationId: expiryHeld.json.data.reservationId });
let expiryState;
for (let attempt = 0; attempt < 50; attempt += 1) {
  expiryState = expiryDb({ action: "state", reservationId: expiryHeld.json.data.reservationId }).state;
  if (expiryState === "EXPIRED") break;
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
if (expiryState !== "EXPIRED") throw new Error(`expiry runner did not converge: ${expiryState}`);
const afterExpiryCorrelation = randomUUID();
expectStatus(
  await direct(
    "POST",
    "/internal/v1/schedule-reservations",
    await serviceToken("classroom.schedule.reserve"),
    await actorContext(directStudent.userId, afterExpiryCorrelation),
    afterExpiryCorrelation,
    {
      operationId: randomUUID(),
      studentId: directStudent.userId,
      offeringId: randomUUID(),
      classId: expiryClass.classId,
    },
  ),
  201,
  "expired HELD ignored after recovery",
);

const wrongCorrelation = randomUUID();
expectStatus(
  await direct(
    "POST",
    "/internal/v1/schedule-reservations",
    reserveToken,
    await actorContext(student.userId, wrongCorrelation),
    wrongCorrelation,
    {
      operationId: randomUUID(),
      studentId: directStudent.userId,
      offeringId: randomUUID(),
      classId: directClass.classId,
    },
  ),
  403,
  "INT-CLS-04 actor/student binding",
);
expectStatus(
  await direct(
    "POST",
    "/internal/v1/schedule-reservations",
    await serviceToken("classroom.schedule.confirm"),
    actorToken,
    correlationId,
    {
      operationId: randomUUID(),
      studentId: directStudent.userId,
      offeringId: randomUUID(),
      classId: directClass.classId,
    },
  ),
  401,
  "INT-CLS-04 exact service purpose",
);

const db = classroom({ action: "schedule", studentId: student.userId, from: day(0), to: day(2) });
if (db.confirmed !== 3 || db.held !== 0 || db.pendingMemberships !== 0)
  throw new Error(`canonical schedule mismatch ${JSON.stringify(db)}`);
if (!classroom({ action: "deny" }).denied)
  throw new Error("svc_classroom foreign-keyspace access was not denied");

const summary = {
  stage: "phase-7.16-student-schedule-acceptance",
  status: "PASS",
  runId,
  classABC: { confirmed: [classA.classId, classC.classId], conflictRejected: classB.classId },
  concurrency: { winners: 1, conflicts: 1 },
  internal: {
    reserveReplay: true,
    confirmReplay: true,
    releaseReplay: true,
    expiryRunner: true,
    actorBinding: true,
  },
  cls15: {
    confirmedOnly: true,
    crossPartitionRange: true,
    crossMidnightDeduplicated: true,
    meetingUrlLeak: false,
    maxDays: 31,
  },
  publicationExistingMembersDenied: true,
  foreignKeyspaceDenied: true,
  counts: { publicApis: 93, internalApis: 15, queryIds: 71, events: 22, redis: false },
};
await writeFile(new URL("p7.16-summary.json", evidence), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ ...summary, evidence: decodeURIComponent(evidence.pathname) }));

async function scheduledClass(name, startAt, endAt) {
  const klass = await createClass(name);
  await createSession(klass.classId, startAt, endAt);
  expectStatus(await publish(klass.classId), 200, `publish ${name}`);
  return klass;
}
async function createClass(name) {
  const response = await http("POST", "/api/v1/classes", {
    bearer: lecturerToken,
    key: `class-${randomUUID()}`,
    body: { name, classKind: "PRIVATE", maxMembers: 50 },
  });
  expectStatus(response, 201, `create ${name}`);
  return response.json.data;
}
async function createSession(classId, startAt, endAt) {
  const response = await http("POST", `/api/v1/classes/${classId}/sessions`, {
    bearer: lecturerToken,
    key: `session-${randomUUID()}`,
    body: {
      title: `Session ${randomUUID().slice(0, 8)}`,
      startAt,
      endAt,
      timezone: "UTC",
      mode: "OFFLINE",
      location: "Hall P716",
    },
  });
  expectStatus(response, 201, "create session");
}
function publish(classId) {
  return http("POST", `/api/v1/classes/${classId}/schedule/publish`, {
    bearer: lecturerToken,
    key: `publish-${randomUUID()}`,
  });
}
function join(token, code, key) {
  return http("POST", "/api/v1/classes/join", { bearer: token, key, body: { code } });
}
async function register(label) {
  const id = randomUUID(),
    user = {
      email: `p716-${label}-${id}@example.test`,
      password: `P7.16-${label}-${id}-Aa1!`,
      displayName: `P716 ${label}`,
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
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  throw last;
}
function expectStatus(value, status, label) {
  if (value.status !== status) throw new Error(`${label}: ${value.status} ${JSON.stringify(value.json)}`);
}
async function ready() {
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch("http://127.0.0.1:8080/health/ready")).ok) return;
    } catch {
      // Transient while the local stack starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Gateway unavailable");
}
async function serviceToken(purpose) {
  const pem = await readFile(
      new URL("../../infrastructure/tls/generated/services/learning-private.pem", import.meta.url),
      "utf8",
    ),
    key = await importPKCS8(pem, "EdDSA"),
    now = Math.floor(Date.now() / 1000);
  return new SignJWT({ purpose })
    .setProtectedHeader({ alg: "EdDSA", kid: "dev-learning-2026-01", typ: "service+jwt" })
    .setIssuer("ailss-internal")
    .setAudience("classroom-service")
    .setSubject("learning-service")
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .setJti(randomUUID())
    .sign(key);
}
async function actorContext(userId, correlationId) {
  const pem = await readFile(
      new URL("../../infrastructure/tls/generated/services/gateway-private.pem", import.meta.url),
      "utf8",
    ),
    key = await importPKCS8(pem, "EdDSA"),
    now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    roles: ["STUDENT"],
    sessionId: randomUUID(),
    tokenVersion: 1,
    correlationId,
    purpose: "classroom.schedule.reserve",
  })
    .setProtectedHeader({ alg: "EdDSA", kid: "dev-gateway-2026-01", typ: "actor-context+jwt" })
    .setIssuer("api-gateway")
    .setAudience("classroom-service")
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(now + 30)
    .setJti(randomUUID())
    .sign(key);
}
function direct(method, path, token, actor, correlationId, body) {
  const source = `const r=await fetch(${JSON.stringify(`http://127.0.0.1:8103${path}`)},{method:${JSON.stringify(method)},headers:${JSON.stringify(
    {
      authorization: `Service ${token}`,
      "x-correlation-id": correlationId,
      ...(actor ? { "x-actor-context": actor } : {}),
      "content-type": "application/json",
    },
  )},body:${JSON.stringify(JSON.stringify(body))}});const t=await r.text();console.log(JSON.stringify({status:r.status,json:t?JSON.parse(t):undefined}));`;
  return JSON.parse(
    execFileSync("docker", ["exec", "ailss-classroom-service", "node", "--input-type=module", "-e", source], {
      encoding: "utf8",
    }).trim(),
  );
}
function identity(input) {
  return runDb("ailss-identity-service", identityProbe(), input);
}
function classroom(input) {
  return runDb("ailss-classroom-service", classroomProbe(), input);
}
function expiryDb(input) {
  return runDb("ailss-classroom-service", expiryProbe(), input);
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
  return `import{readFileSync}from"node:fs";import{createHash}from"node:crypto";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();const r=(await x.execute("SELECT display_name,role,status,lecturer_verified,profile_version,updated_at FROM user_by_id WHERE user_id=?",[u(i.userId)],q)).rows[0],s=(createHash("sha256").update(i.userId).digest()[0]??0)%16;await x.execute("DELETE FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?",[r.get("role"),r.get("status"),s,r.get("updated_at"),u(i.userId)],q);await x.execute("UPDATE user_by_id SET role=? WHERE user_id=?",[i.role,u(i.userId)],q);await x.execute("INSERT INTO users_by_role_status_bucket (role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version) VALUES (?,?,?,?,?,?,?,?)",[i.role,r.get("status"),s,r.get("updated_at"),u(i.userId),r.get("display_name"),r.get("lecturer_verified"),r.get("profile_version")],q);await x.shutdown();console.log('{"ok":true}');`;
}
function classroomProbe() {
  return `import{readFileSync}from"node:fs";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();let o={};if(i.action==="schedule"){let confirmed=0,held=0;for(let t=Date.parse(i.from+"T00:00:00Z");t<=Date.parse(i.to+"T00:00:00Z");t+=86400000){const d=c.types.LocalDate.fromString(new Date(t).toISOString().slice(0,10)),rows=(await x.execute("SELECT entry_state FROM student_schedule_by_day WHERE student_id=? AND schedule_day=? LIMIT 200",[u(i.studentId),d],q)).rows;confirmed+=rows.filter(r=>r.get("entry_state")==="CONFIRMED").length;held+=rows.filter(r=>r.get("entry_state")==="HELD").length;}const m=await x.execute("SELECT state FROM membership_by_class_student",[],{...q,prepare:false,fetchSize:5000});o={confirmed,held,pendingMemberships:m.rows.filter(r=>r.get("state")==="PENDING").length};}else if(i.action==="deny"){try{await x.execute("SELECT offering_id FROM learning_keyspace.offering_by_class LIMIT 1",[],q);o={denied:false}}catch{o={denied:true}}}await x.shutdown();console.log(JSON.stringify(o));`;
}
function expiryProbe() {
  return `import{readFileSync}from"node:fs";import{createHash}from"node:crypto";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();let o={};if(i.action==="due"){const now=new Date(Date.now()-1000),r=(await x.execute("SELECT student_id,version FROM schedule_reservation_by_id WHERE reservation_id=?",[u(i.reservationId)],q)).rows[0],shard=(createHash("sha256").update(i.reservationId).digest()[0]??0)%16;await x.execute("UPDATE schedule_reservation_by_id SET expires_at=?,updated_at=? WHERE reservation_id=?",[now,now,u(i.reservationId)],q);await x.execute("INSERT INTO schedule_reservations_by_expiry_bucket (expiry_day,shard,expires_at,reservation_id,student_id,state,reservation_version) VALUES (?,?,?,?,?,'HELD',?) USING TTL 604800",[c.types.LocalDate.fromString(now.toISOString().slice(0,10)),shard,now,u(i.reservationId),r.get("student_id"),r.get("version")],q);o={ok:true};}else{const r=(await x.execute("SELECT state FROM schedule_reservation_by_id WHERE reservation_id=?",[u(i.reservationId)],q)).rows[0];o={state:r?.get("state")};}await x.shutdown();console.log(JSON.stringify(o));`;
}
