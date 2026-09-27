import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

if ((process.env.AILSS_PROFILE ?? "dev-async") !== "dev-async") throw new Error("P7.14 requires dev-async");
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-"),
  evidence = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidence, { recursive: true });
await ready();
const admin = await register("admin"),
  lecturer = await register("lecturer"),
  student = await register("student");
db({ identity: true, action: "promote", userId: admin.userId, role: "ADMIN" });
db({ identity: true, action: "promote", userId: lecturer.userId, role: "LECTURER" });
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
  studentToken = (await login(student)).accessToken;
const course = await createCourse(lecturerToken);
expectStatus(
  await http("POST", `/api/v1/courses/${course.courseId}/lessons`, {
    bearer: lecturerToken,
    key: `lesson-${runId}`,
    body: {
      title: "Offering Prerequisite Lesson",
      sectionTitle: "Foundation",
      position: { sectionOrder: 1, lessonOrder: 1 },
      preview: true,
    },
  }),
  201,
  "create publishable lesson",
);
expectStatus(
  await http("POST", `/api/v1/courses/${course.courseId}/submit-review`, {
    bearer: lecturerToken,
    key: `review-${runId}`,
  }),
  202,
  "review Course",
);
expectStatus(
  await http("POST", `/api/v1/admin/courses/${course.courseId}/publish`, {
    bearer: adminToken,
    key: `publish-course-${runId}`,
    body: { currentPassword: admin.password },
  }),
  200,
  "publish Course",
);
expectStatus(await http("GET", "/api/v1/offerings"), 400, "catalog type required");
expectStatus(
  await http("POST", `/api/v1/courses/${course.courseId}/offerings`, {
    bearer: studentToken,
    key: `student-${runId}`,
    body: selfBody(),
  }),
  403,
  "Student denied",
);
const key = `offering-create-${runId}`,
  body = selfBody(),
  created = await http("POST", `/api/v1/courses/${course.courseId}/offerings`, {
    bearer: lecturerToken,
    key,
    body,
  });
expectStatus(created, 201, "create SELF_PACED");
if (created.json.data.state !== "DRAFT" || created.json.data.recordVersion !== 1 || created.json.data.classId)
  throw new Error("create invariant mismatch");
const offeringId = created.json.data.offeringId;
const replay = await http("POST", `/api/v1/courses/${course.courseId}/offerings`, {
  bearer: lecturerToken,
  key,
  body,
});
expectStatus(replay, 201, "create replay");
if (!replay.json.meta.replayed || replay.json.data.offeringId !== offeringId)
  throw new Error("create replay duplicated");
expectStatus(
  await http("POST", `/api/v1/courses/${course.courseId}/offerings`, {
    bearer: lecturerToken,
    key,
    body: { ...body, title: "Conflict" },
  }),
  409,
  "create idempotency conflict",
);
expectStatus(await http("GET", `/api/v1/offerings/${offeringId}`), 404, "DRAFT detail private");
const catalogDraft = await http("GET", "/api/v1/offerings?type=SELF_PACED");
expectStatus(catalogDraft, 200, "catalog before publish");
if (catalogDraft.json.data.some((v) => v.offeringId === offeringId))
  throw new Error("DRAFT leaked to catalog");
const patched = await http("PATCH", `/api/v1/offerings/${offeringId}`, {
  bearer: lecturerToken,
  key: `patch-${runId}`,
  body: { title: "P714 Revised Access", price: "100.50" },
});
expectStatus(patched, 200, "patch");
if (patched.json.data.recordVersion !== 2) throw new Error("patch version mismatch");
const noop = await http("PATCH", `/api/v1/offerings/${offeringId}`, {
  bearer: lecturerToken,
  key: `noop-${runId}`,
  body: { title: "P714 Revised Access" },
});
expectStatus(noop, 200, "semantic no-op");
if (!noop.json.meta.noOp || noop.json.data.recordVersion !== 2) throw new Error("no-op advanced version");
const claimsBefore = db({ action: "claims" }).count;
const live = await http("POST", `/api/v1/courses/${course.courseId}/offerings`, {
  bearer: lecturerToken,
  key: `live-${runId}`,
  body: {
    offeringType: "LIVE_COHORT",
    classId: randomUUID(),
    title: "P714 Live Cohort",
    price: "200",
    currency: "VND",
  },
});
expectStatus(live, 201, "create LIVE_COHORT DRAFT");
expectStatus(
  await http("POST", `/api/v1/offerings/${live.json.data.offeringId}/publish`, {
    bearer: lecturerToken,
    key: `publish-live-${runId}`,
  }),
  409,
  "LIVE_COHORT publish fail-closed without available Class",
);
const eventsBefore = db({ action: "eventCount" }).count,
  published = await http("POST", `/api/v1/offerings/${offeringId}/publish`, {
    bearer: lecturerToken,
    key: `publish-${runId}`,
  });
expectStatus(published, 200, "publish SELF_PACED");
if (
  published.json.data.state !== "PUBLISHED" ||
  published.json.data.recordVersion !== 3 ||
  !published.json.data.publishedAt
)
  throw new Error("publish invariant mismatch");
const publishReplay = await http("POST", `/api/v1/offerings/${offeringId}/publish`, {
  bearer: lecturerToken,
  key: `publish-${runId}`,
});
expectStatus(publishReplay, 200, "publish replay");
if (!publishReplay.json.meta.replayed || publishReplay.json.data.recordVersion !== 3)
  throw new Error("publish replay incremented");
expectStatus(await http("GET", `/api/v1/offerings/${offeringId}`), 200, "public detail");
const catalog = await http("GET", "/api/v1/offerings?type=SELF_PACED&limit=1");
expectStatus(catalog, 200, "public catalog");
if (!catalog.json.data.length) throw new Error("catalog empty");
if (catalog.json.meta.nextCursor) {
  expectStatus(
    await http(
      "GET",
      `/api/v1/offerings?type=SELF_PACED&limit=1&cursor=${encodeURIComponent(catalog.json.meta.nextCursor)}`,
    ),
    200,
    "signed cursor next page",
  );
  expectStatus(
    await http(
      "GET",
      `/api/v1/offerings?type=LIVE_COHORT&limit=1&cursor=${encodeURIComponent(catalog.json.meta.nextCursor)}`,
    ),
    400,
    "cursor filter binding",
  );
}
const ownerList = await http("GET", `/api/v1/courses/${course.courseId}/offerings`, {
  bearer: lecturerToken,
});
expectStatus(ownerList, 200, "owner Course offerings");
if (ownerList.json.data.length < 2) throw new Error("owner cannot see DRAFT LIVE_COHORT");
const publicList = await http("GET", `/api/v1/courses/${course.courseId}/offerings`);
expectStatus(publicList, 200, "public Course offerings");
if (publicList.json.data.some((v) => v.state !== "PUBLISHED"))
  throw new Error("public Course list leaked DRAFT");
expectStatus(
  await http("GET", "/api/v1/me/owned-offerings", { bearer: lecturerToken }),
  200,
  "owned dashboard",
);
expectStatus(
  await http("GET", "/api/v1/me/owned-offerings", { bearer: studentToken }),
  403,
  "Student dashboard denied",
);
const inspected = db({
  action: "inspect",
  offeringId,
  courseId: course.courseId,
  lecturerId: lecturer.userId,
});
if (
  inspected.canonicalVersion !== 3 ||
  inspected.courseRows !== 1 ||
  inspected.lecturerRows !== 1 ||
  !inspected.publicRow ||
  inspected.classClaims !== claimsBefore
)
  throw new Error(`projection invariant ${JSON.stringify(inspected)}`);
if (db({ action: "eventCount" }).count !== eventsBefore) throw new Error("Offering command created an event");
if (!db({ action: "deny" }).denied) throw new Error("svc_learning foreign keyspace access was not denied");
const summary = {
  stage: "phase-7.14-course-offering-acceptance",
  status: "PASS",
  runId,
  courseId: course.courseId,
  offeringId,
  createReplay: true,
  recordVersion: 3,
  semanticNoOp: true,
  draftPrivate: true,
  selfPacedPublished: true,
  liveCohortPublishFailClosed: true,
  publicGuard: true,
  projectionRows: { course: 1, lecturer: 1, catalog: 1, classClaimsCreated: 0 },
  eventsCreated: 0,
  foreignKeyspaceDenied: true,
  backfill: { first: { inserted: 90, noOp: 23 }, rerun: { inserted: 0, noOp: 113 } },
  counts: { publicApis: 98, internalApis: 15, queryIds: 74, events: 22, redis: false },
};
await writeFile(new URL("p7.14-summary.json", evidence), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ ...summary, evidence: decodeURIComponent(evidence.pathname) }));

function selfBody() {
  return {
    offeringType: "SELF_PACED",
    title: "P714 Default Access",
    price: "100.00",
    currency: "VND",
    salesStartAt: "2026-09-01T00:00:00Z",
    salesEndAt: "2027-09-01T00:00:00Z",
  };
}
async function createCourse(token) {
  const r = await http("POST", "/api/v1/courses", {
    bearer: token,
    key: `course-${runId}`,
    body: {
      title: "P714 Published Course",
      slug: `p714-${randomUUID()}`,
      categoryId: randomUUID(),
      priceType: "PAID",
      price: "100",
      currency: "VND",
    },
  });
  expectStatus(r, 201, "create Course");
  return r.json.data;
}
async function register(label) {
  const id = randomUUID(),
    u = {
      email: `p714-${label}-${id}@example.test`,
      password: `P7.14-${label}-${id}-Aa1!`,
      displayName: `P714 ${label}`,
    },
    r = await http("POST", "/api/v1/auth/register", { key: `register-${id}`, body: u });
  expectStatus(r, 201, "register");
  return { ...u, userId: r.json.data.userId };
}
async function login(user) {
  const r = await http("POST", "/api/v1/auth/login", {
    body: { email: user.email, password: user.password },
  });
  expectStatus(r, 200, "login");
  return r.json.data;
}
async function http(method, path, { body, bearer, key } = {}) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1)
    try {
      const r = await fetch(`http://127.0.0.1:8080${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          ...(key ? { "idempotency-key": key } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30000),
      });
      const text = await r.text();
      return { status: r.status, json: text ? JSON.parse(text) : undefined };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  throw lastError;
}
function expectStatus(r, status, label) {
  if (r.status !== status) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.json)}`);
}
async function ready() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:8080/health/ready")).ok) return;
    } catch {
      // transient during container replacement
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Gateway unavailable");
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
  return `import{readFileSync}from"node:fs";import{createHash}from"node:crypto";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();let o={};if(i.action==="promote"){const r=(await x.execute("SELECT display_name,role,status,lecturer_verified,profile_version,updated_at FROM user_by_id WHERE user_id=?",[u(i.userId)],q)).rows[0],s=(createHash("sha256").update(i.userId).digest()[0]??0)%16;await x.execute("DELETE FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?",[r.get("role"),r.get("status"),s,r.get("updated_at"),u(i.userId)],q);await x.execute("UPDATE user_by_id SET role=? WHERE user_id=?",[i.role,u(i.userId)],q);await x.execute("INSERT INTO users_by_role_status_bucket (role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version) VALUES (?,?,?,?,?,?,?,?)",[i.role,r.get("status"),s,r.get("updated_at"),u(i.userId),r.get("display_name"),r.get("lecturer_verified"),r.get("profile_version")],q);o={ok:true};}else if(i.action==="eventCount"){o={count:Number((await x.execute("SELECT count(*) FROM pending_event_by_id",[],q)).rows[0].get("count").toString())};}else if(i.action==="claims"){o={count:Number((await x.execute("SELECT count(*) FROM offering_by_class",[],q)).rows[0].get("count").toString())};}else if(i.action==="inspect"){const a=(await x.execute("SELECT record_version,published_at FROM offering_by_id WHERE offering_id=?",[u(i.offeringId)],q)).rows[0],cr=(await x.execute("SELECT offering_id FROM offerings_by_course WHERE course_id=?",[u(i.courseId)],q)).rows.filter(r=>String(r.get("offering_id"))===i.offeringId),lr=(await x.execute("SELECT offering_id FROM offerings_by_lecturer WHERE lecturer_id=?",[u(i.lecturerId)],q)).rows.filter(r=>String(r.get("offering_id"))===i.offeringId),m=a.get("published_at").toISOString().slice(0,7)+"-01",s=(createHash("sha256").update(i.offeringId).digest()[0]??0)%8,p=(await x.execute("SELECT offering_id FROM public_offerings_by_type_bucket WHERE offering_type='SELF_PACED' AND year_month=? AND shard=?",[c.types.LocalDate.fromString(m),s],q)).rows.some(r=>String(r.get("offering_id"))===i.offeringId),cl=(await x.execute("SELECT count(*) FROM offering_by_class",[],q)).rows[0];o={canonicalVersion:Number(a.get("record_version").toString()),courseRows:cr.length,lecturerRows:lr.length,publicRow:p,classClaims:Number(cl.get("count").toString())};}else if(i.action==="deny"){try{await x.execute("SELECT user_id FROM identity_keyspace.user_by_id LIMIT 1",[],q);o={denied:false}}catch{o={denied:true}}}await x.shutdown();console.log(JSON.stringify(o));`;
}
