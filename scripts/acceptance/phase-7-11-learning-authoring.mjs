import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";

if ((process.env.AILSS_PROFILE ?? "dev-async") !== "dev-async")
  throw new Error("P7.11 acceptance requires dev-async");
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
const evidence = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidence, { recursive: true });
const envText = await readFile(new URL("../../.env", import.meta.url), "utf8");
const hmacSecret = envText.match(/^PASSWORD_IDEMPOTENCY_HMAC_KEY=(.*)$/mu)?.[1]?.trim();
if (!hmacSecret) throw new Error("Missing idempotency HMAC key");
await ready();
const admin = await register("admin"),
  lecturer = await register("lecturer"),
  student = await register("student");
db("identity", { action: "promote", userId: admin.userId, role: "ADMIN" });
db("identity", { action: "promote", userId: lecturer.userId, role: "LECTURER" });
const adminSession = await login(admin);
expectStatus(
  await http("POST", `/api/v1/admin/lecturers/${lecturer.userId}/verify`, {
    bearer: adminSession.accessToken,
    key: `verify-${runId}`,
    body: { currentPassword: admin.password },
  }),
  200,
  "verify",
);
const lecturerSession = await login(lecturer),
  studentSession = await login(student);
const body = {
  title: "AILSS Advanced Databases",
  slug: "Cơ Sở Dữ Liệu Nâng Cao",
  categoryId: randomUUID(),
  priceType: "PAID",
  price: "125000.50",
  currency: "vnd",
};
const createKey = `create-${runId}`;
expectStatus(
  await http("POST", "/api/v1/courses", {
    bearer: studentSession.accessToken,
    key: `student-${runId}`,
    body,
  }),
  403,
  "student denied",
);
const created = await http("POST", "/api/v1/courses", {
  bearer: lecturerSession.accessToken,
  key: createKey,
  body,
});
expectStatus(created, 201, "create");
if (
  created.json.data.state !== "DRAFT" ||
  created.json.data.recordVersion !== 1 ||
  created.json.data.contentVersion !== 1
)
  throw new Error("initial state/version mismatch");
if (created.json.data.slug !== "co-so-du-lieu-nang-cao" || !/^125000\.50?$/u.test(created.json.data.price))
  throw new Error(`normalization mismatch ${JSON.stringify(created.json.data)}`);
const replay = await http("POST", "/api/v1/courses", {
  bearer: lecturerSession.accessToken,
  key: createKey,
  body,
});
expectStatus(replay, 201, "create replay");
if (replay.json.data.courseId !== created.json.data.courseId || replay.json.meta.replayed !== true)
  throw new Error("create replay mismatch");
expectStatus(
  await http("POST", "/api/v1/courses", {
    bearer: lecturerSession.accessToken,
    key: createKey,
    body: { ...body, title: "Conflict" },
  }),
  409,
  "idempotency conflict",
);
expectStatus(await http("GET", `/api/v1/courses/${created.json.data.courseId}`), 404, "draft detail private");
expectStatus(
  await http("GET", `/api/v1/courses/by-slug/${created.json.data.slug}`),
  404,
  "draft slug private",
);
const scope = `lecturer:${lecturer.userId}:LRN-05`,
  hashByte = createHmac("sha256", hmacSecret).update(createKey).digest()[0] ?? 0,
  keyHash = hashByte > 127 ? hashByte - 256 : hashByte;
const before = db("learning", {
  action: "course",
  courseId: created.json.data.courseId,
  lecturerId: lecturer.userId,
  scope,
  keyHash,
  key: createKey,
});
if (!before.canonical || before.projections.length !== 1) throw new Error("canonical/projection missing");
const updated = await http("PATCH", `/api/v1/courses/${created.json.data.courseId}`, {
  bearer: lecturerSession.accessToken,
  key: `update-${runId}`,
  body: { title: "AILSS Advanced Cassandra" },
});
expectStatus(updated, 200, "update");
if (updated.json.data.recordVersion !== 2 || updated.json.data.contentVersion !== 1)
  throw new Error("update versions mismatch");
const after = db("learning", {
  action: "course",
  courseId: created.json.data.courseId,
  lecturerId: lecturer.userId,
  scope,
  keyHash,
  key: createKey,
});
if (after.projections.length !== 1 || after.projections[0].courseVersion !== 2)
  throw new Error("projection move mismatch");
const event = await waitEvent(before.eventId);
if (event.state !== "PUBLISHED") throw new Error("created event not published");
execFileSync("docker", ["stop", "ailss-rabbitmq"], { stdio: "pipe" });
const outageKey = `broker-outage-${runId}`,
  outageBody = { ...body, title: "AILSS Broker Recovery", slug: "ailss-broker-recovery" };
const outageCreate = await http("POST", "/api/v1/courses", {
  bearer: lecturerSession.accessToken,
  key: outageKey,
  body: outageBody,
});
expectStatus(outageCreate, 201, "create while broker unavailable");
const outageScope = `lecturer:${lecturer.userId}:LRN-05`,
  outageByte = createHmac("sha256", hmacSecret).update(outageKey).digest()[0] ?? 0,
  outageHash = outageByte > 127 ? outageByte - 256 : outageByte;
const outageState = db("learning", {
  action: "course",
  courseId: outageCreate.json.data.courseId,
  lecturerId: lecturer.userId,
  scope: outageScope,
  keyHash: outageHash,
  key: outageKey,
});
const recoverable = await waitEventState(outageState.eventId, ["READY", "PUBLISHING"]);
if (!recoverable) throw new Error("broker outage did not retain recoverable event");
execFileSync("docker", ["start", "ailss-rabbitmq"], { stdio: "pipe" });
await rabbitReady();
const recoveredEvent = await waitEvent(outageState.eventId, 40000);
if (recoveredEvent.state !== "PUBLISHED") throw new Error("broker recovery did not publish stable eventId");
if (!foreignDenied()) throw new Error("svc_learning unexpectedly read identity_keyspace");
await writeFile(
  new URL("p7.11-summary.json", evidence),
  JSON.stringify(
    {
      stage: "phase-7.11-learning-authoring-acceptance",
      status: "PASS",
      courseId: created.json.data.courseId,
      eventId: before.eventId,
      eventState: event.state,
      createReplay: true,
      draftPrivate: true,
      recordVersion: 2,
      contentVersion: 1,
      projectionRows: after.projections.length,
      brokerOutage: {
        courseId: outageCreate.json.data.courseId,
        eventId: outageState.eventId,
        recoverableState: recoverable.state,
        recoveredState: recoveredEvent.state,
        stableEventId: true,
      },
      foreignIdentityAccessDenied: true,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    stage: "phase-7.11-learning-authoring-acceptance",
    status: "PASS",
    runId,
    evidence: decodeURIComponent(evidence.pathname),
  }),
);

async function register(label) {
  const id = randomUUID(),
    item = {
      email: `p711-${label}-${id}@example.test`,
      password: `P7.11-${label}-${id}-Aa1!`,
      displayName: `P711 ${label} ${id.slice(0, 8)}`,
    };
  const r = await http("POST", "/api/v1/auth/register", { key: `register-${id}`, body: item });
  expectStatus(r, 201, "register");
  return { ...item, userId: r.json.data.userId };
}
async function login(user) {
  const r = await http("POST", "/api/v1/auth/login", {
    body: { email: user.email, password: user.password },
  });
  expectStatus(r, 200, "login");
  return r.json.data;
}
async function http(method, path, { body, bearer, key } = {}) {
  let last;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const r = await fetch(`http://127.0.0.1:8080${path}`, {
        method,
        headers: {
          ...(body ? { "content-type": "application/json" } : {}),
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          ...(key ? { "idempotency-key": key } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(25000),
      });
      const text = await r.text();
      return { status: r.status, json: text ? JSON.parse(text) : undefined };
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw last;
}
function expectStatus(r, status, label) {
  if (r.status !== status)
    throw new Error(`${label}: expected ${status}, got ${r.status} ${JSON.stringify(r.json)}`);
}
async function ready() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch("http://127.0.0.1:8080/health/ready")).ok) return;
    } catch {
      /* container replacement is transient */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("gateway unavailable");
}
async function waitEvent(eventId, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const e = db("learning", { action: "event", eventId });
    if (e.state === "PUBLISHED") return e;
    await new Promise((r) => setTimeout(r, 300));
  }
  return db("learning", { action: "event", eventId });
}
async function waitEventState(eventId, states) {
  for (let i = 0; i < 30; i++) {
    const e = db("learning", { action: "event", eventId });
    if (states.includes(e.state)) return e;
    await new Promise((r) => setTimeout(r, 200));
  }
  return undefined;
}
async function rabbitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      const status = execFileSync("docker", ["inspect", "-f", "{{.State.Health.Status}}", "ailss-rabbitmq"], {
        encoding: "utf8",
      }).trim();
      if (status === "healthy") return;
    } catch {
      /* broker is starting */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("RabbitMQ did not recover");
}
function db(service, input) {
  const container = service === "identity" ? "ailss-identity-service" : "ailss-learning-service";
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", container, "node", "--input-type=module", "-e", probe(service)], {
      input: JSON.stringify(input),
      encoding: "utf8",
    }).trim(),
  );
}
function probe(service) {
  return `import{readFileSync}from"node:fs";import{createHash}from"node:crypto";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)});await x.connect();const q={prepare:true,consistency:c.types.consistencies.localQuorum},u=v=>c.types.Uuid.fromString(v);let o;if(${JSON.stringify(service)}==="identity"&&i.action==="promote"){const r=(await x.execute("SELECT display_name,role,status,lecturer_verified,profile_version,updated_at FROM user_by_id WHERE user_id=?",[u(i.userId)],q)).rows[0],s=(createHash("sha256").update(i.userId).digest()[0]??0)%16;await x.execute("DELETE FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?",[r.get("role"),r.get("status"),s,r.get("updated_at"),u(i.userId)],q);await x.execute("UPDATE user_by_id SET role=? WHERE user_id=?",[i.role,u(i.userId)],q);await x.execute("INSERT INTO users_by_role_status_bucket (role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version) VALUES (?,?,?,?,?,?,?,?)",[i.role,r.get("status"),s,r.get("updated_at"),u(i.userId),r.get("display_name"),r.get("lecturer_verified"),r.get("profile_version")],q);o={ok:true};}else if(i.action==="course"){const a=(await x.execute("SELECT state,record_version,content_version,updated_at FROM course_by_id WHERE course_id=?",[u(i.courseId)],q)).rows[0],p=(await x.execute("SELECT updated_at,course_id,title,state,course_version FROM courses_by_lecturer WHERE lecturer_id=?",[u(i.lecturerId)],q)).rows.filter(r=>r.get("course_id").toString()===i.courseId);const command=(await x.execute("SELECT result_checksum FROM idempotency_by_scope_key WHERE scope=? AND key_hash=? AND idempotency_key=?",[i.scope,i.keyHash,i.key],q)).rows[0],eventId=JSON.parse(command.get("result_checksum")).eventId;o={canonical:a?{state:a.get("state"),recordVersion:Number(a.get("record_version").toString()),contentVersion:Number(a.get("content_version").toString())}:null,projections:p.map(r=>({courseVersion:Number(r.get("course_version").toString()),updatedAt:r.get("updated_at").toISOString()})),eventId};}else if(i.action==="event"){const r=(await x.execute("SELECT state,retry_count,published_at FROM pending_event_by_id WHERE event_id=?",[u(i.eventId)],q)).rows[0];o=r?{state:r.get("state"),retryCount:r.get("retry_count"),publishedAt:r.get("published_at")?.toISOString()}:{};}await x.shutdown();console.log(JSON.stringify(o));`;
}
function foreignDenied() {
  try {
    execFileSync(
      "docker",
      [
        "exec",
        "ailss-learning-service",
        "node",
        "--input-type=module",
        "-e",
        `import c from"cassandra-driver";const x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:"identity_keyspace",authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)});await x.connect();await x.execute("SELECT user_id FROM user_by_id LIMIT 1");`,
      ],
      { stdio: "pipe" },
    );
    return false;
  } catch {
    return true;
  }
}
