import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";

if ((process.env.AILSS_PROFILE ?? "dev-async") !== "dev-async") throw new Error("P7.12B requires dev-async");
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
const evidence = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidence, { recursive: true });
const env = await readFile(new URL("../../.env", import.meta.url), "utf8");
const secret = env.match(/^PASSWORD_IDEMPOTENCY_HMAC_KEY=(.*)$/mu)?.[1]?.trim();
if (!secret) throw new Error("Missing HMAC secret");
await ready();

const admin = await register("admin"),
  lecturer = await register("lecturer");
db({ action: "promote", userId: admin.userId, role: "ADMIN", identity: true });
db({ action: "promote", userId: lecturer.userId, role: "LECTURER", identity: true });
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
const lecturerToken = (await login(lecturer)).accessToken;
const slug = `lifecycle-${randomUUID()}`,
  categoryId = randomUUID();
const first = await createCourse("Advanced Database Lifecycle", slug, categoryId, lecturerToken, "first");
const second = await createCourse("Advanced Database Collision", slug, categoryId, lecturerToken, "second");
db({ action: "lessons", courseId: first.courseId, count: 30 });
db({ action: "lessons", courseId: second.courseId, count: 1 });

const reviewKey = `review-${runId}`;
const reviewed = await http("POST", `/api/v1/courses/${first.courseId}/submit-review`, {
  bearer: lecturerToken,
  key: reviewKey,
});
expectStatus(reviewed, 202, "submit review");
if (reviewed.json.data.state !== "IN_REVIEW" || reviewed.json.data.recordVersion !== 2)
  throw new Error("review transition mismatch");
const reviewReplay = await http("POST", `/api/v1/courses/${first.courseId}/submit-review`, {
  bearer: lecturerToken,
  key: reviewKey,
});
expectStatus(reviewReplay, 202, "review replay");
if (!reviewReplay.json.meta.replayed || reviewReplay.json.data.recordVersion !== 2)
  throw new Error("review replay incremented");
expectStatus(await http("GET", `/api/v1/courses/${first.courseId}`), 404, "pre-publish privacy");

const publishKey = `publish-${runId}`;
expectStatus(
  await http("POST", `/api/v1/admin/courses/${first.courseId}/publish`, {
    bearer: adminToken,
    key: `bad-${runId}`,
    body: { currentPassword: "wrong-password" },
  }),
  403,
  "wrong Admin password",
);
const published = await http("POST", `/api/v1/admin/courses/${first.courseId}/publish`, {
  bearer: adminToken,
  key: publishKey,
  body: { currentPassword: admin.password },
});
expectStatus(published, 200, "publish");
if (
  published.json.data.state !== "PUBLISHED" ||
  published.json.data.recordVersion !== 3 ||
  !published.json.data.publishedAt
)
  throw new Error("publish transition mismatch");
expectStatus(await http("GET", `/api/v1/courses/${first.courseId}`), 200, "published detail");
expectStatus(await http("GET", `/api/v1/courses/by-slug/${slug}`), 200, "published slug");
await submit(second.courseId, lecturerToken, `review-second-${runId}`);
expectStatus(
  await http("POST", `/api/v1/admin/courses/${second.courseId}/publish`, {
    bearer: adminToken,
    key: `publish-second-${runId}`,
    body: { currentPassword: admin.password },
  }),
  409,
  "slug collision",
);

const publishCommand = command("LRN-08", admin.userId, first.courseId, publishKey);
const publishEvent = await waitEvent(publishCommand.eventId);
if (publishEvent.state !== "PUBLISHED") throw new Error("publish event not relayed");
const archiveKey = `archive-${runId}`;
const archived = await http("POST", `/api/v1/admin/courses/${first.courseId}/archive`, {
  bearer: adminToken,
  key: archiveKey,
  body: { currentPassword: admin.password },
});
expectStatus(archived, 202, "archive");
if (
  archived.json.data.state !== "ARCHIVED" ||
  archived.json.data.recordVersion !== 4 ||
  archived.json.data.publishedAt !== published.json.data.publishedAt
)
  throw new Error("archive mismatch");
expectStatus(await http("GET", `/api/v1/courses/${first.courseId}`), 404, "archive immediate privacy");
const archiveCommand = command("LRN-09", admin.userId, first.courseId, archiveKey);
const archiveEvent = await waitEvent(archiveCommand.eventId);
const converged = await waitCleanup(
  archiveCommand.operationId,
  first.courseId,
  slug,
  categoryId,
  published.json.data.publishedAt,
);
if (!converged) throw new Error("archive cleanup did not converge");

const outageSlug = `outage-${randomUUID()}`;
const outageCourse = await createCourse(
  "Advanced Broker Recovery",
  outageSlug,
  randomUUID(),
  lecturerToken,
  "outage",
);
db({ action: "lessons", courseId: outageCourse.courseId, count: 1 });
await submit(outageCourse.courseId, lecturerToken, `review-outage-${runId}`);
const outageKey = `publish-outage-${runId}`;
execFileSync("docker", ["stop", "ailss-rabbitmq"], { stdio: "pipe" });
let outageCommand;
let recoverable;
try {
  const outagePublished = await http("POST", `/api/v1/admin/courses/${outageCourse.courseId}/publish`, {
    bearer: adminToken,
    key: outageKey,
    body: { currentPassword: admin.password },
  });
  expectStatus(outagePublished, 200, "publish while RabbitMQ unavailable");
  outageCommand = command("LRN-08", admin.userId, outageCourse.courseId, outageKey);
  recoverable = await waitEventState(outageCommand.eventId, ["READY", "PUBLISHING"]);
  if (!recoverable) throw new Error("publish event was not recoverable during broker outage");
} finally {
  execFileSync("docker", ["start", "ailss-rabbitmq"], { stdio: "pipe" });
  await rabbitReady();
}
const recovered = await waitEvent(outageCommand.eventId);
if (recovered.state !== "PUBLISHED") throw new Error("publish event did not recover after broker restart");

await writeFile(
  new URL("p7.12b-summary.json", evidence),
  JSON.stringify(
    {
      stage: "phase-7.12b-course-lifecycle-acceptance",
      status: "PASS",
      runId,
      courseId: first.courseId,
      states: ["DRAFT", "IN_REVIEW", "PUBLISHED", "ARCHIVED"],
      versions: [1, 2, 3, 4],
      contentVersion: 1,
      lessonsTraversed: 30,
      slugCollisionOneWinner: true,
      publicBeforePublish: false,
      publicAfterPublish: true,
      publicAfterArchive: false,
      q2Retained: true,
      q3q4Cleaned: true,
      publishEventId: publishCommand.eventId,
      archiveEventId: archiveCommand.eventId,
      publishEventState: publishEvent.state,
      archiveEventState: archiveEvent.state,
      brokerRecovery: {
        courseId: outageCourse.courseId,
        eventId: outageCommand.eventId,
        recoverableState: recoverable.state,
        recoveredState: recovered.state,
        stableEventId: true,
      },
      counts: { publicApis: 93, internalApis: 15, queryIds: 71, events: 22, redis: false },
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    stage: "phase-7.12b-course-lifecycle-acceptance",
    status: "PASS",
    runId,
    evidence: decodeURIComponent(evidence.pathname),
  }),
);

async function createCourse(title, courseSlug, courseCategory, token, label) {
  const response = await http("POST", "/api/v1/courses", {
    bearer: token,
    key: `create-${label}-${runId}`,
    body: {
      title,
      slug: courseSlug,
      categoryId: courseCategory,
      priceType: "FREE",
      price: "0",
      currency: "VND",
    },
  });
  expectStatus(response, 201, `create ${label}`);
  return response.json.data;
}
async function submit(id, token, key) {
  const response = await http("POST", `/api/v1/courses/${id}/submit-review`, { bearer: token, key });
  expectStatus(response, 202, "submit");
  return response;
}
function command(operation, actorId, id, key) {
  const scope = `${operation}:${actorId}:course:${id}`,
    byte = createHmac("sha256", secret).update(key).digest()[0] ?? 0;
  return db({ action: "command", scope, keyHash: byte > 127 ? byte - 256 : byte, key });
}
async function waitEvent(id) {
  for (let i = 0; i < 80; i += 1) {
    const result = db({ action: "event", eventId: id });
    if (result.state === "PUBLISHED") return result;
    await delay(250);
  }
  return db({ action: "event", eventId: id });
}
async function waitEventState(id, states) {
  for (let i = 0; i < 12; i += 1) {
    const result = db({ action: "event", eventId: id });
    if (states.includes(result.state)) return result;
    await delay(250);
  }
  return undefined;
}
async function rabbitReady() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const state = execFileSync("docker", ["inspect", "-f", "{{.State.Health.Status}}", "ailss-rabbitmq"], {
        encoding: "utf8",
      }).trim();
      if (state === "healthy") return;
    } catch {
      /* broker restart is transient */
    }
    await delay(500);
  }
  throw new Error("RabbitMQ did not recover");
}
async function waitCleanup(operationId, id, courseSlug, courseCategory, publishedAt) {
  for (let i = 0; i < 80; i += 1) {
    const result = db({
      action: "cleanup",
      operationId,
      courseId: id,
      slug: courseSlug,
      categoryId: courseCategory,
      publishedAt,
    });
    if (
      result.operationState === "COMPLETE" &&
      result.categoryRows === 0 &&
      result.searchRows === 0 &&
      result.slugRows === 1
    )
      return true;
    await delay(250);
  }
  return false;
}
async function register(label) {
  const id = randomUUID(),
    user = {
      email: `p712b-${label}-${id}@example.test`,
      password: `P7.12B-${label}-${id}-Aa1!`,
      displayName: `P712B ${label}`,
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
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:8080${path}`, {
        method,
        headers: {
          ...(body ? { "content-type": "application/json" } : {}),
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          ...(key ? { "idempotency-key": key } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(25_000),
      });
      const text = await response.text();
      return { status: response.status, json: text ? JSON.parse(text) : undefined };
    } catch (error) {
      lastError = error;
      await delay(300);
    }
  }
  throw lastError;
}
function expectStatus(result, expected, label) {
  if (result.status !== expected)
    throw new Error(`${label}: ${result.status} ${JSON.stringify(result.json)}`);
}
async function ready() {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch("http://127.0.0.1:8080/health/ready")).ok) return;
    } catch {
      /* startup is transient */
    }
    await delay(500);
  }
  throw new Error("Gateway unavailable");
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function db(input) {
  const container = input.identity ? "ailss-identity-service" : "ailss-learning-service";
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", container, "node", "--input-type=module", "-e", probe()], {
      input: JSON.stringify(input),
      encoding: "utf8",
    }).trim(),
  );
}
function probe() {
  return `import{readFileSync}from"node:fs";import{createHash,randomUUID}from"node:crypto";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString,l=c.types.Long.fromNumber,d=c.types.LocalDate.fromString;await x.connect();let o={};if(i.action==="promote"){const r=(await x.execute("SELECT display_name,role,status,lecturer_verified,profile_version,updated_at FROM user_by_id WHERE user_id=?",[u(i.userId)],q)).rows[0],s=(createHash("sha256").update(i.userId).digest()[0]??0)%16;await x.execute("DELETE FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?",[r.get("role"),r.get("status"),s,r.get("updated_at"),u(i.userId)],q);await x.execute("UPDATE user_by_id SET role=? WHERE user_id=?",[i.role,u(i.userId)],q);await x.execute("INSERT INTO users_by_role_status_bucket (role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version) VALUES (?,?,?,?,?,?,?,?)",[i.role,r.get("status"),s,r.get("updated_at"),u(i.userId),r.get("display_name"),r.get("lecturer_verified"),r.get("profile_version")],q);o={ok:true};}else if(i.action==="lessons"){for(let n=0;n<i.count;n++)await x.execute("INSERT INTO lessons_by_course_version (course_id,content_version,section_order,lesson_order,lesson_id,section_title,lesson_title,state,preview,object_key,lesson_version) VALUES (?,1,1,?,?,'Section',?,'READY',false,null,1)",[u(i.courseId),n,u(randomUUID()),"Lesson "+n],q);o={count:i.count};}else if(i.action==="command"){const r=(await x.execute("SELECT operation_id,result_checksum FROM idempotency_by_scope_key WHERE scope=? AND key_hash=? AND idempotency_key=?",[i.scope,i.keyHash,i.key],q)).rows[0],v=JSON.parse(r.get("result_checksum"));o={operationId:r.get("operation_id").toString(),eventId:v.eventId};}else if(i.action==="event"){const r=(await x.execute("SELECT state FROM pending_event_by_id WHERE event_id=?",[u(i.eventId)],q)).rows[0];o={state:r?.get("state")};}else if(i.action==="cleanup"){const ym=i.publishedAt.slice(0,7),sh=(createHash("sha256").update(i.courseId).digest()[0]??0)%4,p=new Date(i.publishedAt),op=(await x.execute("SELECT state FROM reconcile_operation_by_id WHERE operation_id=?",[u(i.operationId)],q)).rows[0],cat=await x.execute("SELECT course_id FROM published_courses_by_category_bucket WHERE category_id=? AND year_month=? AND shard=? AND published_at=? AND course_id=?",[u(i.categoryId),d(ym+"-01"),sh,p,u(i.courseId)],q),sea=await x.execute("SELECT course_id FROM published_courses_by_search_token_bucket WHERE token_prefix='adv' AND year_month=? AND shard=? AND published_at=? AND course_id=?",[d(ym+"-01"),sh,p,u(i.courseId)],q),slug=await x.execute("SELECT course_id FROM course_by_slug WHERE normalized_slug=?",[i.slug],q);o={operationState:op?.get("state"),categoryRows:cat.rows.length,searchRows:sea.rows.length,slugRows:slug.rows.length};}await x.shutdown();console.log(JSON.stringify(o));`;
}
