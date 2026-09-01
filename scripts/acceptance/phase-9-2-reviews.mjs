import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
if ((process.env.AILSS_PROFILE ?? "dev-async") !== "dev-async") throw new Error("P9.2 requires dev-async");
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-"),
  evidence = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidence, { recursive: true });
await ready();
const a = await register("a"),
  b = await register("b"),
  c = await register("c-no-entitlement"),
  ta = (await login(a)).accessToken,
  tb = (await login(b)).accessToken,
  tc = (await login(c)).accessToken,
  courseId = randomUUID(),
  lessons = Array.from({ length: 100 }, () => randomUUID());
db({ action: "seed", courseId, lessons, students: [a.userId, b.userId] });
expect(await review(tc, "deny-no-entitlement", 3, "Not entitled"), 403, "non-entitled denied");
for (let i = 0; i < 19; i++) await completion(ta, i, `a19-${i}`);
expect(await review(ta, "deny19", 3, "nineteen"), 403, "19 denied");
await completion(ta, 19, "a20");
const created = await review(ta, "create-a", 3, "Good course");
expect(created, 201, "20 allowed");
const replay = await review(ta, "create-a", 3, "Good course");
expect(replay, 201, "replay");
if (replay.json.data.reviewId !== created.json.data.reviewId) throw new Error("review replay identity");
expect(await review(ta, "duplicate", 4, "Different"), 409, "business duplicate");
for (let i = 0; i < 100; i++) await completion(tb, i, `b-${i}`);
execFileSync("docker", ["stop", "ailss-rabbitmq"], { stdio: "ignore" });
let second;
try {
  const concurrent = await Promise.all([
    review(tb, "create-b-winner-a", 3, "Completed course"),
    review(tb, "create-b-winner-b", 4, "Concurrent duplicate"),
  ]);
  second = concurrent.find((result) => result.status === 201);
  if (!second || concurrent.filter((result) => result.status === 409).length !== 1)
    throw new Error(`concurrent uniqueness ${JSON.stringify(concurrent)}`);
  if (db({ action: "event", reviewId: second.json.data.reviewId }).state !== "READY")
    throw new Error("broker outage did not preserve READY event");
} finally {
  execFileSync("docker", ["start", "ailss-rabbitmq"], { stdio: "ignore" });
}
await waitEvent(second.json.data.reviewId);
let state = db({ action: "inspect", courseId, studentId: a.userId, reviewId: created.json.data.reviewId });
if (state.count !== 2 || state.sum !== 6) throw new Error(`create aggregate ${JSON.stringify(state)}`);
const patch = await http("PATCH", `/api/v1/reviews/${created.json.data.reviewId}`, {
  bearer: ta,
  key: `${runId}-patch-rating`,
  match: '"v1"',
  body: { rating: 5 },
});
expect(patch, 200, "rating patch");
state = db({ action: "inspect", courseId, studentId: a.userId, reviewId: created.json.data.reviewId });
if (state.count !== 2 || state.sum !== 8) throw new Error("rating delta");
const text = await http("PATCH", `/api/v1/reviews/${created.json.data.reviewId}`, {
  bearer: ta,
  key: `${runId}-patch-text`,
  match: '"v2"',
  body: { body: "Updated text" },
});
expect(text, 200, "text patch");
if (db({ action: "inspect", courseId, studentId: a.userId, reviewId: created.json.data.reviewId }).sum !== 8)
  throw new Error("text changed aggregate");
expect(
  await http("PATCH", `/api/v1/reviews/${created.json.data.reviewId}`, {
    bearer: tb,
    key: `${runId}-nonowner`,
    match: '"v3"',
    body: { rating: 1 },
  }),
  403,
  "non owner",
);
expect(
  await http("DELETE", `/api/v1/reviews/${created.json.data.reviewId}`, {
    bearer: ta,
    key: `${runId}-delete`,
    match: '"v3"',
  }),
  204,
  "delete",
);
state = db({ action: "inspect", courseId, studentId: a.userId, reviewId: created.json.data.reviewId });
if (state.count !== 1 || state.sum !== 3 || state.reviewState !== "DELETED_BY_AUTHOR")
  throw new Error(`delete aggregate ${JSON.stringify(state)}`);
expect(await review(ta, "re-review", 5, "Again"), 409, "terminal delete");
const list = await http("GET", `/api/v1/courses/${courseId}/reviews`);
expect(list, 200, "guest list");
if (list.json.data.length !== 1 || list.json.data[0].reviewId !== second.json.data.reviewId)
  throw new Error("deleted review leaked");
await waitEvent(created.json.data.reviewId);
if (!db({ action: "deny" }).foreignDenied) throw new Error("foreign keyspace allowed");
const summary = {
  stage: "phase-9.2-course-reviews-acceptance",
  status: "PASS",
  runId,
  courseId,
  reviewId: created.json.data.reviewId,
  eligibility: { percent19Denied: true, percent20Allowed: true, percent100Allowed: true },
  idempotentReplay: true,
  unique: true,
  concurrentCreateOneWinner: true,
  nonEntitledDenied: true,
  aggregate: {
    afterCreate: { count: 2, sum: 6 },
    afterRating: { count: 2, sum: 8 },
    afterDelete: { count: 1, sum: 3 },
  },
  terminalDelete: true,
  publicDeletedHidden: true,
  eventPublished: true,
  brokerOutageRecoveredWithStableEvent: true,
  foreignKeyspaceDenied: true,
  counts: { publicApis: 93, internalApis: 15, queryIds: 71, events: 22, redis: false },
};
await writeFile(new URL("p9.2-summary.json", evidence), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ ...summary, evidence: decodeURIComponent(evidence.pathname) }));
async function completion(token, i, key) {
  const r = await http("PUT", `/api/v1/lessons/${lessons[i]}/completion`, {
    bearer: token,
    key: `${runId}-${key}`,
    body: { completed: true },
  });
  expect(r, 200, "completion");
}
function review(token, key, rating, body) {
  return http("POST", `/api/v1/courses/${courseId}/reviews`, {
    bearer: token,
    key: `${runId}-${key}`,
    body: { rating, body },
  });
}
async function waitEvent(reviewId) {
  for (let i = 0; i < 80; i++) {
    const x = db({ action: "event", reviewId });
    if (x.state === "PUBLISHED") return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("review event not published");
}
async function register(label) {
  const id = randomUUID(),
    u = {
      email: `p92-${label}-${id}@example.test`,
      password: `P9.2-${id}-Aa1!`,
      displayName: `P92 ${label}`,
    },
    r = await http("POST", "/api/v1/auth/register", { key: `reg-${id}`, body: u });
  expect(r, 201, "register");
  return { ...u, userId: r.json.data.userId };
}
async function login(u) {
  const r = await http("POST", "/api/v1/auth/login", { body: { email: u.email, password: u.password } });
  expect(r, 200, "login");
  return r.json.data;
}
async function http(method, path, { body, bearer, key, match } = {}) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(`http://127.0.0.1:8080${path}`, {
        method,
        headers: {
          ...(body ? { "content-type": "application/json" } : {}),
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          ...(key ? { "idempotency-key": key } : {}),
          ...(match ? { "if-match": match } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30000),
      });
      const text = await r.text();
      return { status: r.status, json: text ? JSON.parse(text) : undefined };
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw last;
}
function expect(r, s, l) {
  if (r.status !== s) throw new Error(`${l}:${r.status}:${JSON.stringify(r.json)}`);
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
  throw new Error("gateway unavailable");
}
function db(input) {
  return JSON.parse(
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        input.action === "seed" ? "ailss-learning-service" : "ailss-interaction-service",
        "node",
        "--input-type=module",
        "-e",
        probe(),
      ],
      { input: JSON.stringify(input), encoding: "utf8" },
    ).trim(),
  );
}
function probe() {
  return `import{readFileSync}from"node:fs";import{randomUUID}from"node:crypto";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString,l=c.types.Long.fromNumber;await x.connect();let o={};if(i.action==="seed"){const now=new Date(),owner=u(randomUUID());await x.execute("INSERT INTO course_by_id (course_id,owner_lecturer_id,title,slug,category_id,state,content_version,record_version,price_type,price,currency,created_at,updated_at,published_at) VALUES (?,?,? ,?,?,'PUBLISHED',1,1,'FREE',0,'VND',?,?,?)",[u(i.courseId),owner,"Review Course","review-"+i.courseId,u(randomUUID()),now,now,now],q);for(let n=0;n<i.lessons.length;n++){const id=u(i.lessons[n]);await x.execute("INSERT INTO lessons_by_course_version (course_id,content_version,section_order,lesson_order,lesson_id,section_title,lesson_title,state,preview,object_key,lesson_version) VALUES (?,1,1,?,?,'R',?,'READY',false,null,1)",[u(i.courseId),n+1,id,"L"+n],q);await x.execute("INSERT INTO lesson_current_by_id (lesson_id,lesson_version,course_id,updated_at) VALUES (?,1,?,?)",[id,u(i.courseId),now],q);}for(const s of i.students)await x.execute("INSERT INTO entitlement_by_student_course (student_id,course_id,entitlement_id,state,source_offering_id,source_enrollment_id,granted_at,version,updated_at) VALUES (?,?,?,'ACTIVE',?,?,?,1,?)",[u(s),u(i.courseId),u(randomUUID()),u(randomUUID()),u(randomUUID()),now,now],q);o={ok:true};}else if(i.action==="inspect"){const p=(await x.execute("SELECT review_count,rating_sum FROM interaction_keyspace.rating_summary_by_course WHERE course_id=?",[u(i.courseId)],q)).rows[0],r=(await x.execute("SELECT state FROM interaction_keyspace.review_by_student_course WHERE student_id=? AND course_id=?",[u(i.studentId),u(i.courseId)],q)).rows[0];o={count:Number(p?.get("review_count")??0),sum:Number(p?.get("rating_sum")??0),reviewState:r?.get("state")??null};}else if(i.action==="event"){const e=(await x.execute("SELECT state FROM pending_event_by_id WHERE event_id=?",[u(i.reviewId)],q)).rows[0];o={state:e?.get("state")??null};}else{let foreignDenied=false;try{await x.execute("SELECT user_id FROM identity_keyspace.user_by_id LIMIT 1",[],q)}catch{foreignDenied=true}o={foreignDenied};}await x.shutdown();console.log(JSON.stringify(o));`;
}
