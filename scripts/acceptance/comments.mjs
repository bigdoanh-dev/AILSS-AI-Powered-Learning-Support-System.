import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
if ((process.env.AILSS_PROFILE ?? "dev-async") !== "dev-async") throw new Error("P9.1 requires dev-async");
const comments = (type, id) => `/api/v1/resources/${type}/${id}/comments`,
  comment = (id) => `/api/v1/comments/${id}`;
const base = `import{readFileSync}from"node:fs";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString,d=c.types.LocalDate.fromString;await x.connect();`;
await ready();
const tag = Date.now().toString(36),
  lecturer = await user("lecturer"),
  student = await user("student"),
  outsider = await user("outsider");
run("ailss-identity-service", identityProbe(), { userId: lecturer.userId });
const lecturerToken = await login(lecturer),
  studentToken = await login(student),
  outsiderToken = await login(outsider),
  courseId = randomUUID(),
  hiddenCourseId = randomUUID(),
  otherCourseId = randomUUID(),
  classId = randomUUID();
run("ailss-learning-service", learningProbe(), {
  courseId,
  hiddenCourseId,
  otherCourseId,
  lecturerId: lecturer.userId,
  studentId: student.userId,
});
run("ailss-classroom-service", classroomProbe(), {
  classId,
  lecturerId: lecturer.userId,
  studentId: student.userId,
});
expect(await http("GET", comments("COURSE", courseId)), 200, "guest course");
expect(await http("GET", comments("COURSE", hiddenCourseId)), 404, "hidden course");
expect(await http("GET", comments("CLASS", classId)), 404, "anonymous class");
expect(await http("GET", comments("CLASS", classId), { bearer: outsiderToken }), 404, "class outsider");
expect(await http("GET", comments("CLASS", classId), { bearer: studentToken }), 200, "class member");
const createKey = `create-${tag}`,
  createBody = { body: "Top level\r\ncomment" },
  created = await http("POST", comments("COURSE", courseId), {
    bearer: studentToken,
    key: createKey,
    body: createBody,
  });
expect(created, 201, "create");
const commentId = created.json.data.commentId,
  replay = await http("POST", comments("COURSE", courseId), {
    bearer: studentToken,
    key: createKey,
    body: createBody,
  });
expect(replay, 201, "create replay");
if (replay.json.data.commentId !== commentId) throw new Error("create replay changed id");
expect(
  await http("POST", comments("COURSE", courseId), {
    bearer: studentToken,
    key: createKey,
    body: { body: "different" },
  }),
  409,
  "create conflict",
);
expect(
  await http("POST", comments("COURSE", courseId), {
    bearer: outsiderToken,
    key: `deny-${tag}`,
    body: { body: "deny" },
  }),
  403,
  "entitlement",
);
expect(
  await http("POST", comments("COURSE", courseId), {
    bearer: lecturerToken,
    key: `owner-${tag}`,
    body: { body: "owner" },
  }),
  201,
  "owner create",
);
expect(
  await http("POST", comments("CLASS", classId), {
    bearer: studentToken,
    key: `member-${tag}`,
    body: { body: "member" },
  }),
  201,
  "member create",
);
const reply = await http("POST", comments("COURSE", courseId), {
  bearer: studentToken,
  key: `reply-${tag}`,
  body: { body: "reply", parentId: commentId },
});
expect(reply, 201, "reply");
expect(
  await http("POST", comments("COURSE", courseId), {
    bearer: studentToken,
    key: `deep-${tag}`,
    body: { body: "deep", parentId: reply.json.data.commentId },
  }),
  422,
  "reply depth",
);
expect(
  await http("POST", comments("COURSE", otherCourseId), {
    bearer: studentToken,
    key: `wrong-${tag}`,
    body: { body: "wrong", parentId: commentId },
  }),
  404,
  "wrong parent",
);
const patchKey = `patch-${tag}`,
  patched = await http("PATCH", comment(commentId), {
    bearer: studentToken,
    key: patchKey,
    match: '"v1"',
    body: { body: "Edited" },
  });
expect(patched, 200, "patch");
const noop = await http("PATCH", comment(commentId), {
  bearer: studentToken,
  key: `noop-${tag}`,
  match: '"v2"',
  body: { body: "Edited" },
});
expect(noop, 200, "noop");
if (noop.json.data.version !== 2 || !noop.json.meta.noOp) throw new Error("noop incremented");
const later = await http("PATCH", comment(commentId), {
  bearer: studentToken,
  key: `later-${tag}`,
  match: '"v2"',
  body: { body: "Edited again" },
});
expect(later, 200, "later patch");
const historical = await http("PATCH", comment(commentId), {
  bearer: studentToken,
  key: patchKey,
  match: '"v1"',
  body: { body: "Edited" },
});
expect(historical, 200, "historical replay");
if (historical.json.data.version !== 2 || historical.json.data.body !== "Edited")
  throw new Error("historical replay mismatch");
expect(
  await http("PATCH", comment(commentId), {
    bearer: studentToken,
    key: `stale-${tag}`,
    match: '"v1"',
    body: { body: "stale" },
  }),
  409,
  "stale",
);
expect(
  await http("PATCH", comment(commentId), {
    bearer: lecturerToken,
    key: `nonowner-${tag}`,
    match: '"v3"',
    body: { body: "bad" },
  }),
  403,
  "nonowner",
);
const deleted = await http("DELETE", comment(commentId), {
  bearer: studentToken,
  key: `delete-${tag}`,
  match: '"v3"',
});
expect(deleted, 200, "delete");
if (deleted.json.data.body !== null || deleted.json.data.state !== "DELETED_BY_AUTHOR")
  throw new Error("tombstone leak");
const seeded = run("ailss-interaction-service", interactionProbe(), {
    action: "history",
    courseId,
    authorId: student.userId,
  }),
  seen = [],
  first = await http("GET", `${comments("COURSE", courseId)}?limit=4`);
expect(first, 200, "cursor page1");
seen.push(...first.json.data.map((x) => x.commentId));
const initialCursor = first.json.meta.page.nextCursor,
  newer = run("ailss-interaction-service", interactionProbe(), {
    action: "newer",
    courseId,
    authorId: student.userId,
  });
let cursor = initialCursor;
for (let pageNo = 0; cursor && pageNo < 20; pageNo++) {
  const page = await http(
    "GET",
    `${comments("COURSE", courseId)}?limit=4&cursor=${encodeURIComponent(cursor)}`,
  );
  expect(page, 200, "cursor page");
  seen.push(...page.json.data.map((x) => x.commentId));
  cursor = page.json.meta.page.nextCursor;
}
if (new Set(seen).size !== seen.length || !seeded.ids.every((x) => seen.includes(x)))
  throw new Error("cursor duplicate/missing");
if (seen.includes(newer.id)) throw new Error("snapshot admitted newer row");
expect(
  await http(
    "GET",
    `${comments("COURSE", courseId)}?limit=4&cursor=${encodeURIComponent(`${initialCursor.slice(0, -1)}x`)}`,
  ),
  400,
  "tamper",
);
expect(
  await http(
    "GET",
    `${comments("COURSE", otherCourseId)}?limit=4&cursor=${encodeURIComponent(initialCursor)}`,
    { bearer: studentToken },
  ),
  400,
  "target cursor",
);
const evidence = run("ailss-interaction-service", interactionProbe(), { action: "inspect", courseId });
if (
  evidence.bounds.earliestDay !== seeded.earliest ||
  evidence.bounds.latestDay !== seeded.latest ||
  !evidence.receiptComplete ||
  evidence.pendingEvents !== 0 ||
  !evidence.foreignDenied ||
  !evidence.ddlDenied
)
  throw new Error(`evidence ${JSON.stringify(evidence)}`);
console.log(
  JSON.stringify({
    phase: "P9.1",
    status: "PASS",
    courseId,
    classId,
    traversed: seen.length,
    bounds: evidence.bounds,
    event: "NONE",
    rbac: true,
  }),
);
async function user(label) {
  const id = randomUUID(),
    value = {
      email: `p91-${label}-${id}@example.test`,
      password: `P9.1-${label}-${id}-Aa1!`,
      displayName: `P91 ${label}`,
    },
    response = await http("POST", "/api/v1/auth/register", { key: `register-${id}`, body: value });
  expect(response, 201, "register");
  return { ...value, userId: response.json.data.userId };
}
async function login(value) {
  const response = await http("POST", "/api/v1/auth/login", {
    body: { email: value.email, password: value.password },
  });
  expect(response, 200, "login");
  return response.json.data.accessToken;
}
async function http(method, path, { body, bearer, key, match } = {}) {
  let last;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:8080${path}`, {
          method,
          headers: {
            ...(body !== undefined ? { "content-type": "application/json" } : {}),
            ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
            ...(key ? { "idempotency-key": key } : {}),
            ...(match ? { "if-match": match } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(30000),
        }),
        text = await response.text();
      return { status: response.status, json: text ? JSON.parse(text) : undefined };
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw last;
}
function expect(value, status, label) {
  if (value.status !== status) throw new Error(`${label}: ${value.status} ${JSON.stringify(value.json)}`);
}
async function ready() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch("http://127.0.0.1:8080/health/ready")).ok) return;
    } catch {
      // Stack may still be restarting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Gateway unavailable");
}
function run(container, source, input) {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", container, "node", "--input-type=module", "-e", source], {
      input: JSON.stringify(input),
      encoding: "utf8",
    }).trim(),
  );
}
function identityProbe() {
  return (
    base +
    `await x.execute("UPDATE user_by_id SET role='LECTURER',lecturer_verified=true WHERE user_id=?",[u(i.userId)],q);await x.shutdown();console.log('{"ok":true}');`
  );
}
function learningProbe() {
  return (
    base +
    `const n=new Date();for(const pair of [[i.courseId,"PUBLISHED"],[i.hiddenCourseId,"DRAFT"],[i.otherCourseId,"PUBLISHED"]])await x.execute("INSERT INTO course_by_id (course_id,owner_lecturer_id,title,slug,category_id,state,content_version,record_version,price_type,price,currency,created_at,updated_at,published_at) VALUES (?,?,?,?,?,?,1,1,'FREE',0,'VND',?,?,?)",[u(pair[0]),u(i.lecturerId),"P91",pair[0],u(crypto.randomUUID()),pair[1],n,n,pair[1]==="PUBLISHED"?n:null],q);for(const course of [i.courseId,i.otherCourseId])await x.execute("INSERT INTO entitlement_by_student_course (student_id,course_id,entitlement_id,state,granted_at,version,updated_at) VALUES (?,?,?,'ACTIVE',?,1,?)",[u(i.studentId),u(course),u(crypto.randomUUID()),n,n],q);await x.shutdown();console.log('{"ok":true}');`
  );
}
function classroomProbe() {
  return (
    base +
    `const n=new Date();await x.execute("INSERT INTO class_by_id (class_id,owner_lecturer_id,name,class_kind,schedule_state,schedule_version,max_members,state,version,created_at,updated_at) VALUES (?,?,?,'PRIVATE','PUBLISHED',1,50,'ACTIVE',1,?,?)",[u(i.classId),u(i.lecturerId),"P91 Class",n,n],q);await x.execute("INSERT INTO membership_by_class_student (class_id,student_id,membership_id,state,source,joined_at,version) VALUES (?,?,?,'ACTIVE','JOIN_CODE',?,1)",[u(i.classId),u(i.studentId),u(crypto.randomUUID()),n],q);await x.shutdown();console.log('{"ok":true}');`
  );
}
function interactionProbe() {
  return (
    base +
    `const h=await import("node:crypto"),sh=id=>(h.createHash("sha256").update(id.toLowerCase()).digest()[0]??0)%8,put=async(id,at,text)=>{const bucket=at.toISOString().slice(0,10);await x.execute("INSERT INTO comment_by_id (comment_id,target_type,target_id,author_id,parent_id,body_sanitized,state,version,created_at,updated_at) VALUES (?,'COURSE',?,?,null,?,'ACTIVE',1,?,?)",[u(id),u(i.courseId),u(i.authorId),text,at,at],q);await x.execute("INSERT INTO comments_by_target_bucket (target_type,target_id,day_bucket,shard,created_at,comment_id,author_id,parent_id,body_sanitized,state,comment_version) VALUES ('COURSE',?,?,?,?,?,?,null,?,'ACTIVE',1)",[u(i.courseId),d(bucket),sh(id),at,u(id),u(i.authorId),text],q)};let o={};if(i.action==="history"){const ids=[],now=Date.now();for(let k=1;k<=3;k++)for(let j=0;j<5;j++){const id=crypto.randomUUID();ids.push(id);await put(id,new Date(now-k*86400000-j*1000),"history-"+k+"-"+j)}const earliest=new Date(now-3*86400000).toISOString().slice(0,10),latest=new Date(now).toISOString().slice(0,10);await x.execute("UPDATE comment_timeline_bounds_by_target SET earliest_day=?,latest_day=?,version=99,updated_at=? WHERE target_type='COURSE' AND target_id=?",[d(earliest),d(latest),new Date(),u(i.courseId)],q);o={ids,earliest,latest}}else if(i.action==="newer"){const id=crypto.randomUUID();await put(id,new Date(),"newer");o={id}}else{const b=(await x.execute("SELECT earliest_day,latest_day FROM comment_timeline_bounds_by_target WHERE target_type='COURSE' AND target_id=?",[u(i.courseId)],q)).rows[0],r=await x.execute("SELECT status FROM idempotency_by_scope_key",[],q),e=await x.execute("SELECT event_type FROM pending_event_by_id",[],q);let foreignDenied=false,ddlDenied=false;try{await x.execute("SELECT user_id FROM identity_keyspace.user_by_id LIMIT 1",[],q)}catch{foreignDenied=true}try{await x.execute("CREATE TABLE interaction_keyspace.runtime_forbidden (id uuid PRIMARY KEY)",[],q)}catch{ddlDenied=true}o={bounds:{earliestDay:String(b.get("earliest_day")),latestDay:String(b.get("latest_day"))},receiptComplete:r.rows.some(v=>v.get("status")==="COMPLETE"),pendingEvents:e.rows.filter(v=>String(v.get("event_type")).startsWith("interaction.comment.")).length,foreignDenied,ddlDenied}}await x.shutdown();console.log(JSON.stringify(o));`
  );
}
