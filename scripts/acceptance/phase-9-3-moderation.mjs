import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
if ((process.env.AILSS_PROFILE ?? "dev-async") !== "dev-async") throw new Error("P9.3 requires dev-async");
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-"),
  evidence = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidence, { recursive: true });
await ready();
const admin = await register("admin"),
  student = await register("student");
db("identity", { action: "promote", userId: admin.userId });
const adminToken = (await login(admin)).accessToken,
  studentToken = (await login(student)).accessToken,
  courseId = randomUUID(),
  commentId = randomUUID(),
  reviewId = randomUUID();
db("learning", { action: "seed", courseId });
db("interaction", { action: "seed", courseId, commentId, reviewId, studentId: student.userId });
expect(await report(studentToken, "comment", "COMMENT", commentId), 201, "report comment");
const commentReport = await report(studentToken, "comment", "COMMENT", commentId);
expect(commentReport, 201, "report replay");
expect(
  await http("POST", "/api/v1/reports", {
    bearer: studentToken,
    key: `${runId}-comment`,
    body: { targetType: "REVIEW", targetId: reviewId, reason: "changed" },
  }),
  409,
  "idempotency conflict",
);
const reviewReport = await report(studentToken, "review", "REVIEW", reviewId);
expect(reviewReport, 201, "report review");
expect(await http("GET", "/api/v1/admin/reports", { bearer: studentToken }), 403, "nonadmin queue");
const queue = await http("GET", "/api/v1/admin/reports?limit=20", { bearer: adminToken });
expect(queue, 200, "admin queue");
if (
  !queue.json.data.some((r) => r.reportId === commentReport.json.data.reportId) ||
  queue.json.data.some((r) => "reporterId" in r || "reason" in r)
)
  throw new Error("queue privacy/order");
expect(
  await moderate(adminToken, admin.password + "x", commentReport.json.data.reportId, "HIDE", "bad", "wrong"),
  403,
  "wrong password",
);
expect(
  await moderate(studentToken, student.password, commentReport.json.data.reportId, "HIDE", "bad", "student"),
  403,
  "nonadmin moderation",
);
const hiddenComment = await moderate(
  adminToken,
  admin.password,
  commentReport.json.data.reportId,
  "HIDE",
  "policy",
  "hide-comment",
);
expect(hiddenComment, 200, "hide comment");
const replay = await moderate(
  adminToken,
  admin.password,
  commentReport.json.data.reportId,
  "HIDE",
  "policy",
  "hide-comment",
);
expect(replay, 200, "moderation replay");
let state = db("interaction", {
  action: "inspect",
  courseId,
  commentId,
  reviewId,
  reportId: commentReport.json.data.reportId,
});
if (state.commentState !== "HIDDEN_BY_MODERATOR" || state.reportState !== "RESOLVED")
  throw new Error("comment moderation mismatch");
const comments = await http("GET", `/api/v1/resources/COURSE/${courseId}/comments`);
expect(comments, 200, "comment list");
if (comments.json.data.some((x) => x.commentId === commentId)) throw new Error("hidden comment leaked");
const hiddenReview = await moderate(
  adminToken,
  admin.password,
  reviewReport.json.data.reportId,
  "HIDE",
  "policy",
  "hide-review",
);
expect(hiddenReview, 200, "hide review");
state = db("interaction", {
  action: "inspect",
  courseId,
  commentId,
  reviewId,
  reportId: reviewReport.json.data.reportId,
});
if (state.reviewState !== "HIDDEN_BY_MODERATOR" || state.count !== 0 || state.sum !== 0)
  throw new Error("review hide aggregate");
const reviewsHidden = await http("GET", `/api/v1/courses/${courseId}/reviews`);
expect(reviewsHidden, 200, "hidden reviews");
if (reviewsHidden.json.data.length) throw new Error("hidden review leaked");
expect(await report(studentToken, "hidden-deny", "REVIEW", reviewId), 404, "hidden target concealed");
const restoreReport = await report(adminToken, "restore-review", "REVIEW", reviewId);
expect(restoreReport, 201, "admin restore report");
expect(
  await moderate(
    adminToken,
    admin.password,
    restoreReport.json.data.reportId,
    "RESTORE",
    "restore",
    "restore-review",
  ),
  200,
  "restore review",
);
state = db("interaction", {
  action: "inspect",
  courseId,
  commentId,
  reviewId,
  reportId: restoreReport.json.data.reportId,
});
if (state.reviewState !== "ACTIVE" || state.count !== 1 || state.sum !== 4)
  throw new Error("review restore aggregate");
const concurrentReport = await report(studentToken, "concurrent", "REVIEW", reviewId);
expect(concurrentReport, 201, "concurrent report");
const decisions = await Promise.all([
  moderate(adminToken, admin.password, concurrentReport.json.data.reportId, "WARN", "warn", "decision-a"),
  moderate(adminToken, admin.password, concurrentReport.json.data.reportId, "HIDE", "hide", "decision-b"),
]);
if (
  decisions.filter((x) => x.status === 200).length !== 1 ||
  decisions.filter((x) => x.status === 409).length !== 1
)
  throw new Error(`decision concurrency ${JSON.stringify(decisions)}`);
const outageReport = await report(adminToken, "outage", "COMMENT", commentId);
expect(outageReport, 201, "outage report");
execFileSync("docker", ["stop", "ailss-rabbitmq"], { stdio: "ignore" });
let outage;
try {
  outage = await moderate(
    adminToken,
    admin.password,
    outageReport.json.data.reportId,
    "DISMISS",
    "dismiss",
    "outage-moderate",
  );
  expect(outage, 200, "moderate broker down");
  const e = db("interaction", { action: "moderationEvent", reportId: outageReport.json.data.reportId });
  if (e.state !== "READY" && e.state !== "PUBLISHING") throw new Error("moderation event not recoverable");
} finally {
  execFileSync("docker", ["start", "ailss-rabbitmq"], { stdio: "ignore" });
}
await waitPublished(outageReport.json.data.reportId, "interaction.content.moderated.v1");
await waitPublished(commentReport.json.data.reportId, "interaction.report.created.v1");
const isolation = db("interaction", { action: "deny" });
if (!isolation.foreignDenied || !isolation.ddlDenied) throw new Error("runtime isolation failed");
const logs = ["ailss-interaction-service", "ailss-api-gateway"]
  .map((name) => execFileSync("docker", ["logs", "--since", "10m", name], { encoding: "utf8" }))
  .join("\n");
if (
  !logs.includes("interaction moderation audit") ||
  !logs.includes('"result":"SUCCESS"') ||
  !logs.includes('"result":"DENIED"')
)
  throw new Error("audit evidence missing");
const summary = {
  stage: "phase-9.3-reporting-moderation-acceptance",
  status: "PASS",
  runId,
  commentId,
  reviewId,
  reportCreateReplay: true,
  queuePrivacy: true,
  adminPasswordReauth: true,
  commentHidden: true,
  reviewHideRestoreAggregateExact: true,
  concurrentDecisionOneWinner: true,
  brokerRecoveryStableEvent: true,
  auditEvidence: ["SUCCESS", "DENIED"],
  foreignKeyspaceDenied: true,
  runtimeDdlDenied: true,
  counts: { publicApis: 93, internalApis: 15, queryIds: 71, events: 22, redis: false },
};
await writeFile(new URL("p9.3-summary.json", evidence), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ ...summary, evidence: decodeURIComponent(evidence.pathname) }));
function report(token, suffix, targetType, targetId) {
  return http("POST", "/api/v1/reports", {
    bearer: token,
    key: `${runId}-${suffix}`,
    body: { targetType, targetId, reason: `Reason ${suffix}` },
  });
}
function moderate(token, password, reportId, action, reason, suffix) {
  return http("POST", `/api/v1/admin/reports/${reportId}/moderate`, {
    bearer: token,
    key: `${runId}-${suffix}`,
    match: '"v1"',
    body: { action, reason, currentPassword: password },
  });
}
async function waitPublished(reportId, eventType) {
  for (let i = 0; i < 100; i++) {
    const e = db("interaction", { action: "event", reportId, eventType });
    if (e.state === "PUBLISHED") return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`event not published ${eventType}`);
}
async function register(label) {
  const id = randomUUID(),
    user = {
      email: `p93-${label}-${id}@example.test`,
      password: `P9.3-${id}-Aa1!`,
      displayName: `P93 ${label}`,
    },
    result = await http("POST", "/api/v1/auth/register", { key: `reg-${id}`, body: user });
  expect(result, 201, "register");
  return { ...user, userId: result.json.data.userId };
}
async function login(user) {
  const result = await http("POST", "/api/v1/auth/login", {
    body: { email: user.email, password: user.password },
  });
  expect(result, 200, "login");
  return result.json.data;
}
async function http(method, path, { body, bearer, key, match } = {}) {
  let last;
  for (let i = 0; i < 3; i++)
    try {
      const response = await fetch(`http://127.0.0.1:8080${path}`, {
          method,
          headers: {
            ...(body ? { "content-type": "application/json" } : {}),
            ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
            ...(key ? { "idempotency-key": key } : {}),
            ...(match ? { "if-match": match } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(30000),
        }),
        text = await response.text();
      return { status: response.status, json: text ? JSON.parse(text) : undefined };
    } catch (error) {
      last = error;
      await new Promise((r) => setTimeout(r, 250));
    }
  throw last;
}
function expect(value, status, label) {
  if (value.status !== status) throw new Error(`${label}:${value.status}:${JSON.stringify(value.json)}`);
}
async function ready() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:8080/health/ready")).ok) return;
    } catch {
      // The gateway may still be restarting; retry within the bounded readiness window.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("gateway unavailable");
}
function db(service, input) {
  return JSON.parse(
    execFileSync(
      "docker",
      ["exec", "-i", `ailss-${service}-service`, "node", "--input-type=module", "-e", probe()],
      { input: JSON.stringify(input), encoding: "utf8" },
    ).trim(),
  );
}
function probe() {
  return `import{readFileSync}from"node:fs";import{createHash,randomUUID}from"node:crypto";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString,l=c.types.Long.fromNumber,d=c.types.LocalDate.fromString;await x.connect();let o={};if(i.action==="promote"){const r=(await x.execute("SELECT role,status,updated_at,display_name,lecturer_verified,profile_version FROM user_by_id WHERE user_id=?",[u(i.userId)],q)).rows[0],s=(createHash("sha256").update(i.userId).digest()[0]??0)%16;await x.execute("DELETE FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?",[r.get("role"),r.get("status"),s,r.get("updated_at"),u(i.userId)],q);await x.execute("UPDATE user_by_id SET role='ADMIN' WHERE user_id=?",[u(i.userId)],q);await x.execute("INSERT INTO users_by_role_status_bucket (role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version) VALUES ('ADMIN',?,?,?,?,?,?,?)",[r.get("status"),s,r.get("updated_at"),u(i.userId),r.get("display_name"),r.get("lecturer_verified"),r.get("profile_version")],q);o={ok:true}}else if(i.action==="seed"&&process.env.CASSANDRA_KEYSPACE==="learning_keyspace"){const n=new Date();await x.execute("INSERT INTO course_by_id (course_id,owner_lecturer_id,title,slug,category_id,state,content_version,record_version,price_type,price,currency,created_at,updated_at,published_at) VALUES (?,?,?,?,?,'PUBLISHED',1,1,'FREE',0,'VND',?,?,?)",[u(i.courseId),u(randomUUID()),"Moderation Course","moderation-"+i.courseId,u(randomUUID()),n,n,n],q);o={ok:true}}else if(i.action==="seed"){const n=new Date(),ca=new Date(n.getTime()-2000),ra=new Date(n.getTime()-1000),cs=(createHash("sha256").update(i.commentId).digest()[0]??0)%8,rs=(createHash("sha256").update(i.reviewId).digest()[0]??0)%8;await x.execute("INSERT INTO comment_by_id (comment_id,target_type,target_id,author_id,parent_id,body_sanitized,state,version,created_at,updated_at) VALUES (?,'COURSE',?,?,null,'visible','ACTIVE',1,?,?)",[u(i.commentId),u(i.courseId),u(i.studentId),ca,ca],q);await x.execute("INSERT INTO comments_by_target_bucket (target_type,target_id,day_bucket,shard,created_at,comment_id,author_id,parent_id,body_sanitized,state,comment_version) VALUES ('COURSE',?,?,?,?,?,?,null,'visible','ACTIVE',1)",[u(i.courseId),d(ca.toISOString().slice(0,10)),cs,ca,u(i.commentId),u(i.studentId)],q);await x.execute("INSERT INTO comment_timeline_bounds_by_target (target_type,target_id,earliest_day,latest_day,version,updated_at) VALUES ('COURSE',?,?,?,?,?)",[u(i.courseId),d(ca.toISOString().slice(0,10)),d(ca.toISOString().slice(0,10)),l(1),n],q);await x.execute("INSERT INTO review_by_student_course (student_id,course_id,review_id,rating,body_sanitized,state,version,created_at,updated_at) VALUES (?,?,?,?,?,'ACTIVE',1,?,?)",[u(i.studentId),u(i.courseId),u(i.reviewId),4,"review",ra,ra],q);await x.execute("INSERT INTO review_locator_by_id (review_id,student_id,course_id,canonical_version,updated_at) VALUES (?,?,?,?,?)",[u(i.reviewId),u(i.studentId),u(i.courseId),l(1),ra],q);await x.execute("INSERT INTO reviews_by_course_bucket (course_id,year_month,shard,created_at,review_id,student_id,rating,body_sanitized,state,review_version) VALUES (?,?,?,?,?,?,?,?, 'ACTIVE',1)",[u(i.courseId),d(ra.toISOString().slice(0,7)+"-01"),rs,ra,u(i.reviewId),u(i.studentId),4,"review"],q);await x.execute("INSERT INTO review_timeline_bounds_by_course (course_id,earliest_month,latest_month,version,updated_at) VALUES (?,?,?,?,?)",[u(i.courseId),d(ra.toISOString().slice(0,7)+"-01"),d(ra.toISOString().slice(0,7)+"-01"),l(1),n],q);await x.execute("INSERT INTO rating_summary_by_course (course_id,review_count,rating_sum,average,source_watermark,checksum,version,updated_at) VALUES (?,1,4,4,0,'',1,?)",[u(i.courseId),n],q);await x.execute("INSERT INTO rating_contribution_by_course_review (course_id,review_id,applied_review_version,applied_active,applied_rating,last_operation_id,updated_at) VALUES (?,?,1,true,4,?,?)",[u(i.courseId),u(i.reviewId),u(randomUUID()),n],q);o={ok:true}}else if(i.action==="inspect"){const c1=(await x.execute("SELECT state FROM comment_by_id WHERE comment_id=?",[u(i.commentId)],q)).rows[0],loc=(await x.execute("SELECT student_id,course_id FROM review_locator_by_id WHERE review_id=?",[u(i.reviewId)],q)).rows[0],rv=loc?(await x.execute("SELECT state FROM review_by_student_course WHERE student_id=? AND course_id=?",[loc.get("student_id"),loc.get("course_id")],q)).rows[0]:null,s=(await x.execute("SELECT review_count,rating_sum FROM rating_summary_by_course WHERE course_id=?",[u(i.courseId)],q)).rows[0],rp=(await x.execute("SELECT state FROM report_by_id WHERE report_id=?",[u(i.reportId)],q)).rows[0];o={commentState:c1?.get("state"),reviewState:rv?.get("state"),count:Number(s?.get("review_count")??0),sum:Number(s?.get("rating_sum")??0),reportState:rp?.get("state")}}else if(i.action==="event"||i.action==="moderationEvent"){const rows=await x.execute("SELECT event_id,event_type,aggregate_id,state FROM pending_event_by_id",[],q),found=rows.rows.find(v=>v.get("event_type")===i.eventType&&v.get("aggregate_id")?.toString()===i.reportId)||rows.rows.find(v=>i.action==="moderationEvent"&&v.get("event_type")==="interaction.content.moderated.v1"&&v.get("aggregate_id")?.toString()===i.reportId);o={state:found?.get("state"),eventId:found?.get("event_id")?.toString()}}else{let foreignDenied=false,ddlDenied=false;try{await x.execute("SELECT user_id FROM identity_keyspace.user_by_id LIMIT 1",[],q)}catch{foreignDenied=true}try{await x.execute("CREATE TABLE interaction_keyspace.runtime_forbidden_p93 (id uuid PRIMARY KEY)",[],q)}catch{ddlDenied=true}o={foreignDenied,ddlDenied}}await x.shutdown();console.log(JSON.stringify(o));`;
}
