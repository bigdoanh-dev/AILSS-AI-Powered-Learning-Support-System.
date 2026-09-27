import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
if ((process.env.AILSS_PROFILE ?? "dev-async") !== "dev-async") throw Error("Requires dev-async");
const base = "http://127.0.0.1:8080/api/v1",
  evidence = [];
async function call(path, method = "GET", body, token, key) {
  const r = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  return { status: r.status, ...(await r.json()) };
}
function ok(r, status = 200) {
  assert.equal(r.status, status, JSON.stringify({ status: r.status, code: r.error?.code }));
  return r.data;
}
async function account(label) {
  const email = `p122b-${label}-${randomUUID()}@example.test`,
    password = `P122b!${randomUUID()}`;
  const data = ok(
    await call(
      "/auth/register",
      "POST",
      { email, password, displayName: `P12.2B ${label}` },
      undefined,
      randomUUID(),
    ),
    201,
  );
  return { email, password, userId: data.userId ?? data.account?.userId };
}
async function login(a) {
  return ok(await call("/auth/login", "POST", { email: a.email, password: a.password }));
}
const admin = await account("admin");
assert.ok(admin.userId);
const adminOwnApplication = ok(
  await call(
    "/lecturer-applications",
    "POST",
    {
      professionalTitle: "Lecturer",
      institution: "Admin Fixture School",
      teachingArea: "Databases",
      motivation: "Dedicated fixture application for self-review denial.",
    },
    (await login(admin)).accessToken,
    randomUUID(),
  ),
  201,
);
// Sole privileged bootstrap: the dedicated Admin actor. Applicant role and application are never seeded.
const source = `import{readFileSync}from'node:fs';import{createHash}from'node:crypto';import c from'cassandra-driver';const id=JSON.parse(readFileSync(0,'utf8')).id,u=c.types.Uuid.fromString(id),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(','),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum};await x.connect();const r=(await x.execute('SELECT role,status,updated_at,display_name,profile_version,lecturer_verified FROM user_by_id WHERE user_id=?',[u],q)).rows[0],s=createHash('sha256').update(id).digest()[0]%16;await x.execute('DELETE FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?',[r.role,r.status,s,r.updated_at,u],q);await x.execute("UPDATE user_by_id SET role='ADMIN' WHERE user_id=?",[u],q);await x.execute("INSERT INTO users_by_role_status_bucket(role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version) VALUES ('ADMIN',?,?,?,?,?,?,?)",[r.status,s,r.updated_at,u,r.display_name,r.lecturer_verified,r.profile_version],q);await x.shutdown();`;
execFileSync(
  "docker",
  ["compose", "exec", "-T", "identity-service", "node", "--input-type=module", "-e", source],
  { input: JSON.stringify({ id: admin.userId }), stdio: ["pipe", "pipe", "pipe"] },
);
const at = (await login(admin)).accessToken,
  student = await account("applicant"),
  st = (await login(student)).accessToken;
const body = {
    professionalTitle: "Lecturer",
    institution: "Test University",
    teachingArea: "Databases",
    motivation: "I want to teach relational and distributed database systems.",
  },
  key = randomUUID();
assert.equal((await call("/lecturer-applications", "POST", body, undefined, randomUUID())).status, 401);
assert.equal(
  (
    await call(
      `/admin/lecturer-applications/${adminOwnApplication.applicationId}/decision`,
      "POST",
      { decision: "APPROVE", currentPassword: admin.password },
      at,
      randomUUID(),
    )
  ).status,
  403,
);
const submittedResponse = await call("/lecturer-applications", "POST", body, st, key);
const submitted = ok(submittedResponse, 201);
assert.deepEqual(await call("/lecturer-applications", "POST", body, st, key), submittedResponse);
assert.equal(submitted.status, "SUBMITTED");
assert.deepEqual(ok(await call("/lecturer-applications", "POST", body, st, key), 201), submitted);
assert.equal(
  (await call("/lecturer-applications", "POST", { ...body, institution: "Changed" }, st, key)).error.code,
  "IDEMPOTENCY_CONFLICT",
);
assert.equal(
  (await call("/lecturer-applications", "POST", body, st, randomUUID())).error.code,
  "APPLICATION_EXISTS",
);
assert.equal(ok(await call("/me", "GET", undefined, st)).role, "STUDENT");
const shard = createHash("sha256").update(student.userId).digest()[0] % 16;
const queue = `/admin/lecturer-applications?month=${submitted.submittedAt.slice(0, 7)}&shard=${shard}`;
assert.equal((await call(queue, "GET", undefined, st)).status, 403);
assert.ok(
  ok(await call(queue, "GET", undefined, at)).items.some((x) => x.applicationId === submitted.applicationId),
);
const detail = `/admin/lecturer-applications/${submitted.applicationId}`,
  decision = detail + "/decision";
assert.equal(ok(await call(detail, "GET", undefined, at)).applicantId, student.userId);
assert.equal((await call(detail, "GET", undefined, st)).status, 403);
assert.ok(
  [401, 403].includes(
    (
      await call(
        decision,
        "POST",
        { decision: "APPROVE", currentPassword: student.password },
        st,
        randomUUID(),
      )
    ).status,
  ),
);
assert.equal(
  (
    await call(
      decision,
      "POST",
      { decision: "APPROVE", currentPassword: "invalid-fixture" },
      at,
      randomUUID(),
    )
  ).status,
  401,
);
const dk = randomUUID(),
  approval = ok(
    await call(decision, "POST", { decision: "APPROVE", currentPassword: admin.password }, at, dk),
  );
assert.equal(approval.status, "APPROVED");
assert.deepEqual(
  ok(await call(decision, "POST", { decision: "APPROVE", currentPassword: admin.password }, at, dk)),
  approval,
);
assert.equal(
  (await call(decision, "POST", { decision: "REJECT", currentPassword: admin.password }, at, dk)).error.code,
  "IDEMPOTENCY_CONFLICT",
);
assert.equal((await call("/me", "GET", undefined, st)).status, 401);
let lt = (await login(student)).accessToken;
assert.equal(ok(await call("/me", "GET", undefined, lt)).role, "LECTURER");
assert.equal(ok(await call("/me", "GET", undefined, lt)).lecturerVerified, false);
assert.deepEqual(ok(await call("/lecturer-applications", "POST", body, lt, key), 201), submitted);
assert.equal((await call("/lecturer-applications", "POST", body, lt, randomUUID())).status, 403);
assert.equal(
  ok(await call("/me/lecturer-application", "GET", undefined, lt)).result,
  "APPROVED_AWAITING_VERIFICATION",
);
ok(
  await call(
    `/admin/lecturers/${student.userId}/verify`,
    "POST",
    { currentPassword: admin.password },
    at,
    randomUUID(),
  ),
);
lt = (await login(student)).accessToken;
assert.equal(ok(await call("/me/lecturer-application", "GET", undefined, lt)).result, "APPROVED_VERIFIED");
const rejected = await account("rejected"),
  rt = (await login(rejected)).accessToken,
  ra = ok(await call("/lecturer-applications", "POST", body, rt, randomUUID()), 201);
ok(
  await call(
    `/admin/lecturer-applications/${ra.applicationId}/decision`,
    "POST",
    { decision: "REJECT", currentPassword: admin.password },
    at,
    randomUUID(),
  ),
);
assert.equal(ok(await call("/me", "GET", undefined, rt)).role, "STUDENT");
assert.equal(ok(await call("/me/lecturer-application", "GET", undefined, rt)).result, "REJECTED");
evidence.push(
  "api-only submission",
  "no role on submit",
  "stable submit historical replay after approval",
  "changed and duplicate key conflict",
  "Admin list/detail",
  "non-admin and invalid reauth denied",
  "authoritative approval",
  "old session invalidated",
  "Lecturer unverified",
  "separate IDN-12 verification",
  "rejection preserves Student",
);
await mkdir("docs/evidence/p12.2b-backend", { recursive: true });
await writeFile(
  "docs/evidence/p12.2b-backend/report.json",
  JSON.stringify({ status: "PASS", profile: "dev-async", inventory: [98, 15, 74, 22], evidence }, null, 2),
);
console.log(JSON.stringify({ status: "PASS", checks: evidence.length }));
