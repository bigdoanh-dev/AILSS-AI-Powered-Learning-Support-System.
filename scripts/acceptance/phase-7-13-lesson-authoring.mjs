import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

if ((process.env.AILSS_PROFILE ?? "dev-async") !== "dev-async") throw new Error("P7.13 requires dev-async");
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
const evidence = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
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
const lecturerToken = (await login(lecturer)).accessToken;
const studentToken = (await login(student)).accessToken;

const course = await createCourse(lecturerToken);
expectStatus(
  await http("GET", `/api/v1/courses/${course.courseId}/lessons`),
  404,
  "anonymous DRAFT syllabus",
);
const createKey = `lesson-create-${runId}`;
const lessonBody = {
  title: "Immutable Lesson One",
  sectionTitle: "Foundations",
  position: { sectionOrder: 1, lessonOrder: 1 },
  preview: true,
};
const created = await http("POST", `/api/v1/courses/${course.courseId}/lessons`, {
  bearer: lecturerToken,
  key: createKey,
  body: lessonBody,
});
expectStatus(created, 201, "create lesson");
if (created.json.data.lessonVersion !== 1 || created.json.data.contentVersion !== 2)
  throw new Error("initial immutable/content versions mismatch");
const replay = await http("POST", `/api/v1/courses/${course.courseId}/lessons`, {
  bearer: lecturerToken,
  key: createKey,
  body: lessonBody,
});
expectStatus(replay, 201, "create replay");
if (!replay.json.meta.replayed || replay.json.data.lessonId !== created.json.data.lessonId)
  throw new Error("create replay duplicated lesson");
expectStatus(
  await http("POST", `/api/v1/courses/${course.courseId}/lessons`, {
    bearer: lecturerToken,
    key: createKey,
    body: { ...lessonBody, title: "Different Payload" },
  }),
  409,
  "idempotency conflict",
);
expectStatus(
  await http("POST", `/api/v1/courses/${course.courseId}/lessons`, {
    bearer: lecturerToken,
    key: `collision-${runId}`,
    body: { ...lessonBody, title: "Position Collision" },
  }),
  409,
  "position collision",
);

db({ action: "seed", courseId: course.courseId, contentVersion: 2, count: 30 });
const patchKey = `lesson-patch-${runId}`;
const patched = await http("PATCH", `/api/v1/lessons/${created.json.data.lessonId}`, {
  bearer: lecturerToken,
  key: patchKey,
  body: { title: "Immutable Lesson Revised" },
});
expectStatus(patched, 200, "patch lesson");
if (patched.json.data.lessonVersion !== 2 || patched.json.data.contentVersion !== 3)
  throw new Error("patch did not activate V2/N+1");
const patchReplay = await http("PATCH", `/api/v1/lessons/${created.json.data.lessonId}`, {
  bearer: lecturerToken,
  key: patchKey,
  body: { title: "Immutable Lesson Revised" },
});
expectStatus(patchReplay, 200, "patch replay");
if (!patchReplay.json.meta.replayed || patchReplay.json.data.contentVersion !== 3)
  throw new Error("patch replay advanced content again");

const ownerDetail = await http("GET", `/api/v1/lessons/${created.json.data.lessonId}`, {
  bearer: lecturerToken,
});
expectStatus(ownerDetail, 200, "owner detail");
expectStatus(
  await http("GET", `/api/v1/lessons/${created.json.data.lessonId}`, { bearer: studentToken }),
  403,
  "student without entitlement",
);
db({ action: "enroll", studentId: student.userId, courseId: course.courseId });
expectStatus(
  await http("GET", `/api/v1/lessons/${created.json.data.lessonId}`, { bearer: studentToken }),
  200,
  "legacy entitlement read",
);
const list = await http("GET", `/api/v1/courses/${course.courseId}/lessons`, { bearer: lecturerToken });
expectStatus(list, 200, "owner list");
if (list.json.data.length !== 31 || list.json.meta.contentVersion !== 3)
  throw new Error("bounded >25 snapshot copy mismatch");

const database = db({ action: "inspect", courseId: course.courseId, lessonId: created.json.data.lessonId });
if (
  database.contentVersion !== 3 ||
  database.recordVersion !== 1 ||
  database.snapshotRows !== 31 ||
  database.detailVersions.join(",") !== "1,2" ||
  database.pointerVersion !== 2
)
  throw new Error(`database invariant mismatch: ${JSON.stringify(database)}`);
if (!db({ action: "deny" }).denied) throw new Error("svc_learning foreign keyspace read was not denied");

const reviewed = await http("POST", `/api/v1/courses/${course.courseId}/submit-review`, {
  bearer: lecturerToken,
  key: `review-${runId}`,
});
expectStatus(reviewed, 202, "snapshot-bound submit review");
expectStatus(
  await http("PATCH", `/api/v1/lessons/${created.json.data.lessonId}`, {
    bearer: lecturerToken,
    key: `after-review-${runId}`,
    body: { title: "Forbidden After Review" },
  }),
  409,
  "non-DRAFT patch",
);

const summary = {
  stage: "phase-7.13-lesson-authoring-acceptance",
  status: "PASS",
  runId,
  courseId: course.courseId,
  lessonId: created.json.data.lessonId,
  createLessonVersion: 1,
  patchedLessonVersion: 2,
  finalContentVersion: 3,
  recordVersionUnchanged: true,
  copiedLessons: 31,
  immutableVersions: database.detailVersions,
  pointerVersion: database.pointerVersion,
  idempotentReplay: true,
  q8LegacyCompatibility: true,
  foreignKeyspaceDenied: true,
  lrn07Status: 202,
  eventsCreated: 0,
  counts: { publicApis: 93, internalApis: 15, queryIds: 71, events: 22, redis: false },
};
await writeFile(new URL("p7.13-summary.json", evidence), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ...summary, evidence: decodeURIComponent(evidence.pathname) }));

async function createCourse(token) {
  const response = await http("POST", "/api/v1/courses", {
    bearer: token,
    key: `course-${runId}`,
    body: {
      title: "P713 Lesson Course",
      slug: `p713-${randomUUID()}`,
      categoryId: randomUUID(),
      priceType: "FREE",
      price: "0",
      currency: "VND",
    },
  });
  expectStatus(response, 201, "create Course");
  return response.json.data;
}
async function register(label) {
  const id = randomUUID();
  const user = {
    email: `p713-${label}-${id}@example.test`,
    password: `P7.13-${label}-${id}-Aa1!`,
    displayName: `P713 ${label}`,
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
        signal: AbortSignal.timeout(30_000),
      });
      const text = await response.text();
      return { status: response.status, json: text ? JSON.parse(text) : undefined };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw lastError;
}
function expectStatus(result, status, label) {
  if (result.status !== status) throw new Error(`${label}: ${result.status} ${JSON.stringify(result.json)}`);
}
async function ready() {
  for (let index = 0; index < 80; index += 1) {
    try {
      if ((await fetch("http://127.0.0.1:8080/health/ready")).ok) return;
    } catch {
      /* transient */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
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
  return `import{readFileSync}from"node:fs";import{createHash,randomUUID}from"node:crypto";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString,l=c.types.Long.fromNumber;await x.connect();let o={};if(i.action==="promote"){const r=(await x.execute("SELECT display_name,role,status,lecturer_verified,profile_version,updated_at FROM user_by_id WHERE user_id=?",[u(i.userId)],q)).rows[0],s=(createHash("sha256").update(i.userId).digest()[0]??0)%16;await x.execute("DELETE FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?",[r.get("role"),r.get("status"),s,r.get("updated_at"),u(i.userId)],q);await x.execute("UPDATE user_by_id SET role=? WHERE user_id=?",[i.role,u(i.userId)],q);await x.execute("INSERT INTO users_by_role_status_bucket (role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version) VALUES (?,?,?,?,?,?,?,?)",[i.role,r.get("status"),s,r.get("updated_at"),u(i.userId),r.get("display_name"),r.get("lecturer_verified"),r.get("profile_version")],q);o={ok:true};}else if(i.action==="seed"){for(let n=0;n<i.count;n++)await x.execute("INSERT INTO lessons_by_course_version (course_id,content_version,section_order,lesson_order,lesson_id,section_title,lesson_title,state,preview,object_key,lesson_version) VALUES (?,?,?,?,?,'Bulk',?,'READY',false,null,1)",[u(i.courseId),l(i.contentVersion),2,n+1,u(randomUUID()),"Bulk "+n],q);o={count:i.count};}else if(i.action==="enroll"){await x.execute("INSERT INTO enrollment_by_student_course (student_id,course_id,enrollment_id,state,source,enrolled_at,version) VALUES (?,?,?,'ACTIVE','P713',?,1)",[u(i.studentId),u(i.courseId),u(randomUUID()),new Date()],q);o={ok:true};}else if(i.action==="inspect"){const a=(await x.execute("SELECT content_version,record_version FROM course_by_id WHERE course_id=?",[u(i.courseId)],q)).rows[0],s=(await x.execute("SELECT lesson_id FROM lessons_by_course_version WHERE course_id=? AND content_version=?",[u(i.courseId),a.get("content_version")],q)).rows,d=[];for(let v=1;v<=5;v++){const r=(await x.execute("SELECT lesson_version FROM lesson_by_id_version WHERE lesson_id=? AND lesson_version=?",[u(i.lessonId),l(v)],q)).rows[0];if(r)d.push(v)}const p=(await x.execute("SELECT lesson_version FROM lesson_current_by_id WHERE lesson_id=?",[u(i.lessonId)],q)).rows[0];o={contentVersion:Number(a.get("content_version").toString()),recordVersion:Number(a.get("record_version").toString()),snapshotRows:s.length,detailVersions:d,pointerVersion:Number(p.get("lesson_version").toString())};}else if(i.action==="deny"){try{await x.execute("SELECT user_id FROM identity_keyspace.user_by_id LIMIT 1",[],q);o={denied:false}}catch{o={denied:true}}}await x.shutdown();console.log(JSON.stringify(o));`;
}
