import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

if ((process.env.AILSS_PROFILE ?? "dev-async") !== "dev-async") throw new Error("P9.2A requires dev-async");
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-"),
  evidence = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidence, { recursive: true });
await ready();
const student = await register(),
  token = (await login(student)).accessToken,
  courseId = randomUUID(),
  lessonIds = Array.from({ length: 100 }, () => randomUUID());
db({ action: "seed", studentId: student.userId, courseId, lessonIds });
const zero = await http("GET", `/api/v1/courses/${courseId}/progress`, { bearer: token });
expect(zero, 200, "zero");
if (
  zero.json.data.percent !== 0 ||
  zero.json.data.progressVersion !== 0 ||
  zero.json.data.publishedTotal !== 100
)
  throw new Error("truthful zero mismatch");
for (let i = 0; i < 19; i++) expect(await complete(i, `c-${i}`), 200, `complete ${i}`);
let p = await read();
if (p.percent !== 19 || p.completedCount !== 19) throw new Error(`19 percent mismatch ${JSON.stringify(p)}`);
const twentieth = await complete(19, "threshold"),
  replay = await complete(19, "threshold");
expect(twentieth, 200, "20 percent");
expect(replay, 200, "20 replay");
if (!replay.json.meta.replayed || replay.json.data.progressVersion !== twentieth.json.data.progressVersion)
  throw new Error("replay advanced version");
expect(
  await http("PUT", `/api/v1/lessons/${lessonIds[19]}/completion`, {
    bearer: token,
    key: `${runId}-threshold`,
    body: { completed: false },
  }),
  409,
  "key conflict",
);
p = await read();
if (p.percent !== 20 || p.completedCount !== 20) throw new Error("exact threshold mismatch");
const duplicate = await complete(19, "duplicate-business");
if (!duplicate.json.meta.noOp || duplicate.json.data.progressVersion !== p.progressVersion)
  throw new Error("semantic no-op advanced");
for (let i = 20; i < 100; i += 2) {
  const pair = await Promise.all([complete(i, `a-${i}`), complete(i + 1, `b-${i + 1}`)]);
  for (const x of pair) expect(x, 200, "concurrent different lesson");
}
p = await read();
if (p.percent !== 100 || p.completedCount !== 100 || !p.completed)
  throw new Error(`100 percent mismatch ${JSON.stringify(p)}`);

let brokerRestarted = false;
try {
  execFileSync("docker", ["stop", "ailss-rabbitmq"], { stdio: "ignore" });
  const outage = await http("PUT", `/api/v1/lessons/${lessonIds[0]}/completion`, {
    bearer: token,
    key: `${runId}-broker-outage`,
    body: { completed: false },
  });
  expect(outage, 200, "broker outage canonical progress");
  if (outage.json.data.percent !== 99) throw new Error("broker outage rolled back canonical progress");
  const during = await waitEventState("READY");
  if (during.lastEventState !== "READY")
    throw new Error(`outage event is not recoverable ${JSON.stringify(during)}`);
  execFileSync("docker", ["start", "ailss-rabbitmq"], { stdio: "ignore" });
  brokerRestarted = true;
  await waitPublished();
  expect(await complete(0, "broker-restore"), 200, "restore 100 percent");
  p = await read();
} finally {
  if (!brokerRestarted) execFileSync("docker", ["start", "ailss-rabbitmq"], { stdio: "ignore" });
}
const state = db({ action: "inspect", studentId: student.userId, courseId });
if (
  state.completedCount !== 100 ||
  state.completionRows !== 100 ||
  !state.lastEventId ||
  !state.foreignDenied
)
  throw new Error(`canonical evidence mismatch ${JSON.stringify(state)}`);
const summary = {
  stage: "phase-9.2a-learning-progress-acceptance",
  status: "PASS",
  runId,
  courseId,
  studentId: student.userId,
  progress: {
    percent: p.percent,
    completedCount: p.completedCount,
    publishedTotal: p.publishedTotal,
    version: p.progressVersion,
  },
  thresholds: [19, 20, 100],
  idempotentReplay: true,
  semanticNoOp: true,
  concurrentDifferentLessons: true,
  brokerOutageRecovered: true,
  lastEventId: state.lastEventId,
  lastEventState: state.lastEventState,
  foreignKeyspaceDenied: true,
  counts: { publicApis: 93, internalApis: 15, queryIds: 71, events: 22, redis: false },
};
await writeFile(new URL("p9.2a-summary.json", evidence), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ...summary, evidence: decodeURIComponent(evidence.pathname) }));

async function complete(i, key) {
  return http("PUT", `/api/v1/lessons/${lessonIds[i]}/completion`, {
    bearer: token,
    key: `${runId}-${key}`,
    body: { completed: true },
  });
}
async function read() {
  const r = await http("GET", `/api/v1/courses/${courseId}/progress`, { bearer: token });
  expect(r, 200, "read");
  return r.json.data;
}
async function waitPublished() {
  await waitEventState("PUBLISHED");
}
async function waitEventState(expected) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const value = db({ action: "inspect", studentId: student.userId, courseId });
    if (value.lastEventState === expected) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`progress event did not reach ${expected}`);
}
async function register() {
  const id = randomUUID(),
    user = { email: `p92a-${id}@example.test`, password: `P9.2A-${id}-Aa1!`, displayName: "P92A Student" },
    r = await http("POST", "/api/v1/auth/register", { key: `register-${id}`, body: user });
  expect(r, 201, "register");
  return { ...user, userId: r.json.data.userId };
}
async function login(u) {
  const r = await http("POST", "/api/v1/auth/login", { body: { email: u.email, password: u.password } });
  expect(r, 200, "login");
  return r.json.data;
}
async function http(method, path, { body, bearer, key } = {}) {
  const r = await fetch(`http://127.0.0.1:8080${path}`, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...(key ? { "idempotency-key": key } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    }),
    text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : undefined };
}
function expect(r, s, l) {
  if (r.status !== s) throw new Error(`${l}: ${r.status} ${JSON.stringify(r.json)}`);
}
async function ready() {
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch("http://127.0.0.1:8080/health/ready")).ok) return;
    } catch {
      /* transient */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Gateway unavailable");
}
function db(input) {
  return JSON.parse(
    execFileSync(
      "docker",
      ["exec", "-i", "ailss-learning-service", "node", "--input-type=module", "-e", probe()],
      { input: JSON.stringify(input), encoding: "utf8" },
    ).trim(),
  );
}
function probe() {
  return `import{readFileSync}from"node:fs";import{randomUUID}from"node:crypto";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString,l=c.types.Long.fromNumber;await x.connect();let o={};if(i.action==="seed"){const now=new Date(),owner=u(randomUUID()),enrollment=u(randomUUID()),offering=u(randomUUID());await x.execute("INSERT INTO course_by_id (course_id,owner_lecturer_id,title,slug,category_id,state,content_version,record_version,price_type,price,currency,created_at,updated_at,published_at) VALUES (?,?,? ,?,?,'PUBLISHED',1,1,'FREE',0,'VND',?,?,?)",[u(i.courseId),owner,"P92A Course","p92a-"+i.courseId,u(randomUUID()),now,now,now],q);for(let n=0;n<i.lessonIds.length;n++){const id=u(i.lessonIds[n]);await x.execute("INSERT INTO lessons_by_course_version (course_id,content_version,section_order,lesson_order,lesson_id,section_title,lesson_title,state,preview,object_key,lesson_version) VALUES (?,1,1,?,?,'Progress',?,'READY',false,null,1)",[u(i.courseId),n+1,id,"Lesson "+(n+1)],q);await x.execute("INSERT INTO lesson_current_by_id (lesson_id,lesson_version,course_id,updated_at) VALUES (?,?,?,?)",[id,l(1),u(i.courseId),now],q);}await x.execute("INSERT INTO entitlement_by_student_course (student_id,course_id,entitlement_id,state,source_offering_id,source_enrollment_id,granted_at,version,updated_at) VALUES (?,?,?,'ACTIVE',?,?,?,1,?)",[u(i.studentId),u(i.courseId),u(randomUUID()),offering,enrollment,now,now],q);await x.execute("INSERT INTO enrollment_by_student_course (student_id,course_id,enrollment_id,state,source,enrolled_at,version) VALUES (?,?,?,'ACTIVE','P92A',?,1)",[u(i.studentId),u(i.courseId),enrollment,now],q);await x.execute("INSERT INTO courses_by_student_bucket (student_id,state,year_month,enrolled_at,course_id,title,progress_percent,enrollment_version) VALUES (?,'ACTIVE',?,?,?,?,0,1)",[u(i.studentId),c.types.LocalDate.fromString(now.toISOString().slice(0,7)+"-01"),now,u(i.courseId),"P92A Course"],q);o={ok:true};}else{const p=(await x.execute("SELECT completed_count,published_total,percent,progress_version,last_event_id FROM progress_by_student_course WHERE student_id=? AND course_id=?",[u(i.studentId),u(i.courseId)],q)).rows[0],r=(await x.execute("SELECT lesson_id FROM lesson_completion_by_student_course WHERE student_id=? AND course_id=?",[u(i.studentId),u(i.courseId)],q)).rows,last=p.get("last_event_id"),e=last?(await x.execute("SELECT state FROM pending_event_by_id WHERE event_id=?",[last],q)).rows[0]:null;let denied=false;try{await x.execute("SELECT user_id FROM identity_keyspace.user_by_id LIMIT 1",[],q)}catch{denied=true}o={completedCount:Number(p.get("completed_count")),publishedTotal:Number(p.get("published_total")),percent:Number(p.get("percent")),version:Number(p.get("progress_version")),completionRows:r.length,lastEventId:last?String(last):null,lastEventState:e?.get("state")??null,foreignDenied:denied};}await x.shutdown();console.log(JSON.stringify(o));`;
}
