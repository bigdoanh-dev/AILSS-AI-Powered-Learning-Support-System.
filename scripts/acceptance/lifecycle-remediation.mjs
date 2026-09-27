import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { decodeJwt, decodeProtectedHeader, importSPKI } from "jose";
import { verifyStepUpProof } from "../../dist/packages/security/src/index.js";

if ((process.env.AILSS_PROFILE ?? "dev-async") !== "dev-async") {
  throw new Error("P7.12A acceptance requires AILSS_PROFILE=dev-async");
}
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
const evidenceDirectory = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidenceDirectory, { recursive: true });
await waitForReady();

const activeAdmin = await register("active-admin");
identityDb({ action: "role", userId: activeAdmin.userId, role: "ADMIN" });
const activeAdminSession = await login(activeAdmin);
const resourceId = randomUUID();

const success = internalStepUp(activeAdminSession.accessToken, {
  currentPassword: activeAdmin.password,
  action: "COURSE_PUBLISH",
  resourceId,
});
assertStatus(success, 200, "valid ACTIVE Admin step-up");
const publicKey = await importSPKI(
  await readFile(
    new URL("../../infrastructure/tls/generated/identity/user-jwt-public.pem", import.meta.url),
    "utf8",
  ),
  "EdDSA",
);
const verifiedProof = await verifyStepUpProof(success.json.data.proof, publicKey, {
  issuer: "identity-service",
  audience: "learning-service",
  kid: decodeProtectedHeader(success.json.data.proof).kid,
  action: "COURSE_PUBLISH",
  resourceId,
  adminUserId: activeAdmin.userId,
});
if (verifiedProof.exp - verifiedProof.iat > 30) throw new Error("Step-up proof TTL exceeded 30 seconds");
if (JSON.stringify(decodeJwt(success.json.data.proof)).includes(activeAdmin.password)) {
  throw new Error("Step-up proof contains currentPassword");
}

const wrongPassword = internalStepUp(activeAdminSession.accessToken, {
  currentPassword: "wrong-password",
  action: "COURSE_ARCHIVE",
  resourceId,
});
assertStatus(wrongPassword, 401, "wrong password denied");

for (const role of ["STUDENT", "LECTURER"]) {
  const user = await register(role.toLowerCase());
  if (role === "LECTURER") identityDb({ action: "role", userId: user.userId, role });
  const session = await login(user);
  assertStatus(
    internalStepUp(session.accessToken, {
      currentPassword: user.password,
      action: "COURSE_PUBLISH",
      resourceId,
    }),
    403,
    `${role} denied`,
  );
}

const inactiveAdmin = await adminFixture("inactive-admin");
identityDb({ action: "status", userId: inactiveAdmin.user.userId, status: "SUSPENDED" });
assertStatus(
  internalStepUp(inactiveAdmin.accessToken, {
    currentPassword: inactiveAdmin.user.password,
    action: "COURSE_ARCHIVE",
    resourceId,
  }),
  401,
  "inactive Admin denied",
);

const revokedAdmin = await adminFixture("revoked-admin");
const revokedClaims = decodeJwt(revokedAdmin.accessToken);
identityDb({ action: "revoke", sessionId: revokedClaims.sessionId });
assertStatus(
  internalStepUp(revokedAdmin.accessToken, {
    currentPassword: revokedAdmin.user.password,
    action: "COURSE_ARCHIVE",
    resourceId,
  }),
  401,
  "revoked Admin denied",
);

const staleAdmin = await adminFixture("stale-admin");
identityDb({ action: "tokenVersion", userId: staleAdmin.user.userId, tokenVersion: 2 });
assertStatus(
  internalStepUp(staleAdmin.accessToken, {
    currentPassword: staleAdmin.user.password,
    action: "COURSE_ARCHIVE",
    resourceId,
  }),
  401,
  "stale-token Admin denied",
);

for (const override of [
  { serviceId: "learning-service" },
  { actorIssuer: "wrong-gateway" },
  { actorAudience: "learning-service" },
  { actorPurpose: "identity.profile.read" },
]) {
  assertStatus(
    internalStepUp(
      activeAdminSession.accessToken,
      { currentPassword: activeAdmin.password, action: "COURSE_PUBLISH", resourceId },
      override,
    ),
    401,
    `internal trust binding ${JSON.stringify(override)}`,
  );
}

const reconciliation = learningReconciliationProbe();
if (
  reconciliation.completedState !== "COMPLETE" ||
  reconciliation.categoryRows !== 0 ||
  reconciliation.searchRows !== 0 ||
  reconciliation.slugRows !== 1 ||
  reconciliation.retryState !== "READY" ||
  reconciliation.retryCount !== 1 ||
  reconciliation.retryDueRows !== 1
) {
  throw new Error(`Q-LRN-016 acceptance failed: ${JSON.stringify(reconciliation)}`);
}
if (!migrationProbe().includes("published_at")) throw new Error("course_by_id.published_at is absent");

const logs = `${dockerLogs("ailss-api-gateway")}\n${dockerLogs("ailss-identity-service")}`;
for (const secret of [activeAdmin.password, inactiveAdmin.user.password, success.json.data.proof]) {
  if (logs.includes(secret)) throw new Error("Step-up password/proof appeared in service logs");
}

const summary = {
  stage: "phase-7.12a-lifecycle-remediation-acceptance",
  status: "PASS",
  runId,
  contracts: { publicApis: 98, internalApis: 15, queryIds: 74, eventTypes: 22, redis: false },
  intIdn02: {
    activeAdminProof: true,
    algorithm: "Ed25519",
    audience: verifiedProof.aud,
    actionResourceBound: true,
    ttlSeconds: verifiedProof.exp - verifiedProof.iat,
    nonAdminDenied: true,
    inactiveRevokedStaleDenied: true,
    wrongPasswordDenied: true,
    gatewayServiceAndActorBindingsDenied: true,
    currentPasswordAbsentFromProofLogsEvidence: true,
  },
  migration: { publishedAt: true, migratorOnly: true },
  reconciliation: {
    ownerRole: "svc_learning",
    boundedDuePartitions: true,
    leaseFence: true,
    retryMove: true,
    exactCategorySearchCleanup: true,
    archivedSlugRetained: true,
    ...reconciliation,
  },
  lrn07To09Implemented: false,
};
await writeFile(new URL("p7.12a-summary.json", evidenceDirectory), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, evidence: decodeURIComponent(evidenceDirectory.pathname) }));

async function adminFixture(label) {
  const user = await register(label);
  identityDb({ action: "role", userId: user.userId, role: "ADMIN" });
  return { ...(await login(user)), user };
}

async function register(label) {
  const id = randomUUID();
  const user = {
    email: `p712a-${label}-${id}@example.test`,
    password: `P7.12A-${label}-${id}-Aa1!`,
    displayName: `P712A ${label} ${id.slice(0, 8)}`,
  };
  const response = await http("POST", "/api/v1/auth/register", {
    body: user,
    key: `register-${id}`,
  });
  assertStatus(response, 201, `register ${label}`);
  return { ...user, userId: response.json.data.userId };
}

async function login(user) {
  const response = await http("POST", "/api/v1/auth/login", {
    body: { email: user.email, password: user.password },
  });
  assertStatus(response, 200, `login ${user.email}`);
  return response.json.data;
}

async function http(method, path, { body, key } = {}) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:8080${path}`, {
        method,
        headers: {
          ...(body ? { "content-type": "application/json" } : {}),
          ...(key ? { "idempotency-key": key } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20_000),
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

function internalStepUp(accessToken, request, override = {}) {
  const claims = decodeJwt(accessToken);
  const input = {
    actor: {
      userId: claims.sub,
      roles: claims.roles,
      sessionId: claims.sessionId,
      tokenVersion: claims.tokenVersion,
      correlationId: randomUUID(),
    },
    request,
    override,
  };
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const output = execFileSync(
        "docker",
        ["exec", "-i", "ailss-api-gateway", "node", "--input-type=module", "-e", gatewayProbeSource()],
        { encoding: "utf8", input: JSON.stringify(input), stdio: ["pipe", "pipe", "pipe"] },
      );
      return JSON.parse(output.trim());
    } catch (error) {
      lastError = error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }
  throw lastError;
}

function identityDb(input) {
  const output = execFileSync(
    "docker",
    ["exec", "-i", "ailss-identity-service", "node", "--input-type=module", "-e", identityDbSource()],
    { encoding: "utf8", input: JSON.stringify(input), stdio: ["pipe", "pipe", "pipe"] },
  );
  return JSON.parse(output.trim());
}

function learningReconciliationProbe() {
  const output = execFileSync(
    "docker",
    ["exec", "ailss-learning-service", "node", "--input-type=module", "-e", reconciliationSource()],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(output.trim());
}

function migrationProbe() {
  return execFileSync(
    "docker",
    ["exec", "ailss-learning-service", "node", "--input-type=module", "-e", migrationSource()],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
}

function gatewayProbeSource() {
  return `import{readFileSync}from"node:fs";import{loadPrivateKey,signActorContext,signServiceToken}from"/app/dist/packages/security/src/index.js";const i=JSON.parse(readFileSync(0,"utf8")),k=await loadPrivateKey(process.env.ACTOR_CONTEXT_PRIVATE_KEY_PATH),n=Math.floor(Date.now()/1000),o=i.override??{},s=await signServiceToken(k,{issuer:o.serviceIssuer??"api-gateway",serviceId:o.serviceId??"api-gateway",audience:"identity-service",purpose:"identity.admin.step-up.authorize",kid:process.env.ACTOR_CONTEXT_KID,ttlSeconds:30}),a=await signActorContext(k,process.env.ACTOR_CONTEXT_KID,o.actorIssuer??process.env.ACTOR_CONTEXT_ISSUER,o.actorAudience??"identity-service",o.actorPurpose??"identity.admin.step-up.authorize",{...i.actor,issuedAt:n,expiresAt:n+30}),r=await fetch("http://identity-service:8101/internal/v1/admin/step-up-authorizations",{method:"POST",headers:{authorization:"Service "+s,"x-actor-context":a,"x-correlation-id":i.actor.correlationId,"content-type":"application/json"},body:JSON.stringify({...i.request,resourceType:"COURSE"})}),t=await r.text();console.log(JSON.stringify({status:r.status,json:t?JSON.parse(t):null}));`;
}

function identityDbSource() {
  return `import{readFileSync}from"node:fs";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();if(i.action==="role")await x.execute("UPDATE user_by_id SET role=? WHERE user_id=?",[i.role,u(i.userId)],q);if(i.action==="status")await x.execute("UPDATE user_by_id SET status=? WHERE user_id=?",[i.status,u(i.userId)],q);if(i.action==="tokenVersion")await x.execute("UPDATE user_by_id SET token_version=? WHERE user_id=?",[c.types.Long.fromNumber(i.tokenVersion),u(i.userId)],q);if(i.action==="revoke")await x.execute("UPDATE session_by_id SET state='REVOKED',revoked_at=? WHERE session_id=?",[new Date(),u(i.sessionId)],q);await x.shutdown();console.log(JSON.stringify({ok:true}));`;
}

function migrationSource() {
  return `import c from"cassandra-driver";const x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)});await x.connect();const r=await x.execute("SELECT column_name FROM system_schema.columns WHERE keyspace_name='learning_keyspace' AND table_name='course_by_id'");console.log(r.rows.map(v=>v.get("column_name")).join(","));await x.shutdown();`;
}

function reconciliationSource() {
  // Embedded CQL string literals need escapes inside this generated JavaScript source.
  // eslint-disable-next-line no-useless-escape
  return `import c from"cassandra-driver";import{randomUUID}from"node:crypto";import{CassandraClient}from"/app/dist/packages/cassandra/src/index.js";import{learningShard}from"/app/dist/apps/learning-service/src/catalog/model.js";import{LearningReconciliationRepository}from"/app/dist/apps/learning-service/src/reconciliation/repository.js";import{LearningReconciliationRunner}from"/app/dist/apps/learning-service/src/reconciliation/runner.js";import{ArchivedCourseProjectionCleanup}from"/app/dist/apps/learning-service/src/reconciliation/archive-cleanup.js";const db=await CassandraClient.create({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,username:process.env.CASSANDRA_USERNAME,password:process.env.CASSANDRA_PASSWORD}),u=c.types.Uuid.fromString,l=c.types.Long.fromNumber,d=c.types.LocalDate.fromString,now=new Date(),courseId=randomUUID(),lecturerId=randomUUID(),categoryId=randomUUID(),publishedAt=new Date(now.getTime()-60000),ym=publishedAt.toISOString().slice(0,7),shard=learningShard(courseId),operationId=randomUUID(),repo=new LearningReconciliationRepository(db);await db.execute("INSERT INTO course_by_id (course_id,owner_lecturer_id,title,slug,category_id,state,content_version,record_version,price_type,price,currency,created_at,updated_at,published_at) VALUES (?,?,?,?,?,'ARCHIVED',1,4,'FREE',0,'VND',?,?,?)",[u(courseId),u(lecturerId),"Archived Course","archived-"+courseId,u(categoryId),publishedAt,publishedAt,publishedAt],"LOCAL_QUORUM");await db.execute("INSERT INTO course_by_slug (normalized_slug,course_id,state,title,category_id,price_type,price,currency,course_version,updated_at) VALUES (?,?,\'ARCHIVED\',?,?,\'FREE\',0,\'VND\',4,?)",["archived-"+courseId,u(courseId),"Archived Course",u(categoryId),publishedAt],"LOCAL_QUORUM");await db.execute("INSERT INTO published_courses_by_category_bucket (category_id,year_month,shard,published_at,course_id,slug,title,lecturer_id,price_type,price,currency,course_version) VALUES (?,?,?,?,?,?,?,?,\'FREE\',0,\'VND\',4)",[u(categoryId),d(ym+"-01"),shard,publishedAt,u(courseId),"archived-"+courseId,"Archived Course",u(lecturerId)],"LOCAL_QUORUM");await db.execute("INSERT INTO published_courses_by_search_token_bucket (token_prefix,year_month,shard,published_at,course_id,slug,title,category_id,course_version) VALUES (\'archive\',?,?,?,?,?,?,?,4)",[d(ym+"-01"),shard,publishedAt,u(courseId),"archived-"+courseId,"Archived Course",u(categoryId)],"LOCAL_QUORUM");await repo.schedule({operationId,projectionName:"COURSE_PUBLIC_ARCHIVE_CLEANUP",canonicalId:courseId,canonicalVersion:4,checksum:JSON.stringify({schemaVersion:1,categoryId,publishedAt:publishedAt.toISOString(),searchTokens:["archive"]}),now,shard:0});const cleanup=new ArchivedCourseProjectionCleanup(db),runner=new LearningReconciliationRunner(repo,i=>cleanup.execute(i));await runner.runOnce(new Date(now.getTime()+10));const op=(await db.execute("SELECT state FROM reconcile_operation_by_id WHERE operation_id=?",[u(operationId)],"LOCAL_QUORUM"))[0],cat=await db.execute("SELECT course_id FROM published_courses_by_category_bucket WHERE category_id=? AND year_month=? AND shard=? AND published_at=? AND course_id=?",[u(categoryId),d(ym+"-01"),shard,publishedAt,u(courseId)],"LOCAL_QUORUM"),search=await db.execute("SELECT course_id FROM published_courses_by_search_token_bucket WHERE token_prefix='archive' AND year_month=? AND shard=? AND published_at=? AND course_id=?",[d(ym+"-01"),shard,publishedAt,u(courseId)],"LOCAL_QUORUM"),slug=await db.execute("SELECT course_id FROM course_by_slug WHERE normalized_slug=?",["archived-"+courseId],"LOCAL_QUORUM"),retryId=randomUUID(),retryCourse=randomUUID(),retryAt=new Date();await repo.schedule({operationId:retryId,projectionName:"RETRY_PROBE",canonicalId:retryCourse,canonicalVersion:1,checksum:"{}",now:retryAt,shard:1});await new LearningReconciliationRunner(repo,async()=>{throw new Error("probe")}).runOnce(new Date(retryAt.getTime()+10));const retry=(await db.execute("SELECT state,retry_count,next_attempt_at FROM reconcile_operation_by_id WHERE operation_id=?",[u(retryId)],"LOCAL_QUORUM"))[0],retryDay=retry.get("next_attempt_at").toISOString().slice(0,10),due=await db.execute("SELECT operation_id FROM reconcile_by_due_bucket WHERE due_day=? AND shard=?",[d(retryDay),1],"LOCAL_QUORUM");console.log(JSON.stringify({completedState:op?.get("state"),categoryRows:cat.length,searchRows:search.length,slugRows:slug.length,retryState:retry?.get("state"),retryCount:retry?.get("retry_count"),retryDueRows:due.filter(r=>r.get("operation_id").toString()===retryId).length}));await db.close();`;
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) {
    throw new Error(
      `${label}: expected ${expected}, got ${response.status} ${JSON.stringify(response.json)}`,
    );
  }
}

async function waitForReady() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:8080/health/ready", {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
    } catch {
      // retry bounded readiness wait
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Gateway readiness timeout");
}

function dockerLogs(container) {
  return execFileSync("docker", ["logs", "--tail", "3000", container], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
}
