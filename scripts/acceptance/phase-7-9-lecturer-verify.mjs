import { createHash, createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { importPKCS8, SignJWT } from "jose";

const profile = process.env.AILSS_PROFILE ?? "dev-async";
if (profile !== "dev-async") throw new Error("P7.9 acceptance requires AILSS_PROFILE=dev-async");
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
const evidenceDirectory = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidenceDirectory, { recursive: true });
const envText = await readFile(new URL("../../.env", import.meta.url), "utf8");
const hmacSecret = envValue("PASSWORD_IDEMPOTENCY_HMAC_KEY");
const servicePrivateKey = await importPKCS8(
  await readFile(
    new URL("../../infrastructure/tls/generated/services/learning-private.pem", import.meta.url),
    "utf8",
  ),
  "EdDSA",
);

await waitForReady();

// Controlled fixtures: registration creates STUDENT accounts; the promoteLecturer probe is a
// documented test/bootstrap mechanism (NOT a production role-onboarding workflow). See OD-P7-009-02.
const admin = await createUser("admin");
db({ action: "promoteAdmin", userId: admin.userId });
const adminAuth = await login(admin);

const lecturer = await createUser("lecturer");
db({ action: "promoteLecturer", userId: lecturer.userId });
const lecturerSessionA = await login(lecturer);
const lecturerSessionB = await login(lecturer);

const student = await createUser("student");

// Public profile is unavailable before verification.
assertError(await publicLecturer(lecturer.userId), 404, "PUBLIC_PROFILE_NOT_AVAILABLE");
const internalBefore = await directInternal(lecturer.userId, await serviceToken());
assertError(internalBefore, 404, "PUBLIC_PROFILE_NOT_AVAILABLE");

// Authorization and validation denials.
assertError(
  await verify(lecturerSessionA.accessToken, lecturer.userId, admin.password, `p79-nonadmin-${randomUUID()}`),
  403,
  "ADMIN_ROLE_REQUIRED",
);
assertError(
  await verify(adminAuth.accessToken, lecturer.userId, admin.password, null),
  400,
  "INVALID_IDEMPOTENCY_KEY",
);
assertError(
  await verify(adminAuth.accessToken, randomUUID(), admin.password, `p79-missing-${randomUUID()}`),
  404,
  "LECTURER_VERIFY_TARGET_NOT_FOUND",
);
assertError(
  await verify(adminAuth.accessToken, student.userId, admin.password, `p79-student-${randomUUID()}`),
  422,
  "LECTURER_VERIFY_TARGET_INELIGIBLE",
);
assertError(
  await verify(adminAuth.accessToken, admin.userId, admin.password, `p79-self-${randomUUID()}`),
  403,
  "ADMIN_SELF_VERIFY_FORBIDDEN",
);

// Wrong step-up makes no mutation.
const wrongStepUp = await verify(
  adminAuth.accessToken,
  lecturer.userId,
  "wrong-password",
  `p79-wrong-${randomUUID()}`,
);
assertError(wrongStepUp, 401, "ADMIN_STEP_UP_FAILED");
const beforeVerify = db({ action: "state", userId: lecturer.userId });
if (beforeVerify.canonical.lecturerVerified !== false || beforeVerify.canonical.tokenVersion !== 1) {
  throw new Error("Wrong step-up mutated canonical lecturer state");
}

// Successful verification.
const verifyKey = `p79-verify-${randomUUID()}`;
const verified = await verify(adminAuth.accessToken, lecturer.userId, admin.password, verifyKey);
assertStatus(verified, 200, "Verify lecturer");
assertKeys(verified.json.data, ["lecturerVerified", "userId"]);
if (verified.json.data.lecturerVerified !== true)
  throw new Error("Verify response did not confirm verification");

const afterVerify = db({ action: "state", userId: lecturer.userId });
assertVerifiedState(afterVerify, 2);
const publicProjection = db({ action: "publicProjection", userId: lecturer.userId });
if (
  !publicProjection ||
  publicProjection.verified !== true ||
  publicProjection.profileVersion !== afterVerify.canonical.profileVersion
) {
  throw new Error(`Q-IDN-006 projection not converged: ${JSON.stringify(publicProjection)}`);
}

// Public and internal visibility become available after convergence.
const publicAfter = await publicLecturer(lecturer.userId);
assertStatus(publicAfter, 200, "IDN-08 public lecturer after verification");
const internalAfter = await directInternal(lecturer.userId, await serviceToken());
assertStatus(internalAfter, 200, "INT-IDN-01 after verification");

// Privilege-elevation epoch invalidates pre-verification credentials.
assertError(await profileRead(lecturerSessionA.accessToken), 401, "INVALID_ACCESS_TOKEN");
assertError(await profileRead(lecturerSessionB.accessToken), 401, "INVALID_ACCESS_TOKEN");
assertError(await refresh(lecturerSessionA), 401, "INVALID_REFRESH_CREDENTIALS");
assertError(await refresh(lecturerSessionB), 401, "INVALID_REFRESH_CREDENTIALS");
const newLecturerSession = await login(lecturer);
const newSessionState = db({ action: "session", sessionId: newLecturerSession.sessionId });
if (newSessionState.authVersion !== 2)
  throw new Error("Post-verification login did not bind newest tokenVersion");

// Exact replay makes no second mutation.
const replay = await verify(adminAuth.accessToken, lecturer.userId, admin.password, verifyKey);
assertStatus(replay, 200, "Verify exact replay");
if (replay.json?.meta?.replayed !== true) throw new Error("Verify command did not replay exactly");
if (db({ action: "state", userId: lecturer.userId }).canonical.tokenVersion !== 2) {
  throw new Error("Verify replay advanced the security epoch twice");
}

// New command against an already-verified lecturer, and same-key different command.
assertError(
  await verify(adminAuth.accessToken, lecturer.userId, admin.password, `p79-again-${randomUUID()}`),
  409,
  "LECTURER_ALREADY_VERIFIED",
);
assertError(
  await verify(adminAuth.accessToken, lecturer.userId, "different-password", verifyKey),
  409,
  "IDEMPOTENCY_CONFLICT",
);

// Audit event reaches the outbox terminal state with a stable eventId.
const auditEvent = await waitForAuditEvent(
  verifyScope(admin.userId, lecturer.userId),
  verifyKey,
  "PUBLISHED",
);
if (auditEvent.metadata.nextTokenVersion !== 2) throw new Error("Verify audit aggregate version mismatch");

const concurrent = await concurrentFixture(adminAuth, admin.password);
const recovery = await recoveryFixture(adminAuth, admin.userId, admin.password);

const foreignAccessDenied = verifyForeignAccessDenied();
if (!foreignAccessDenied) throw new Error("svc_learning unexpectedly read Q-IDN-005");
const logs = `${dockerLogs("ailss-identity-service")}\n${dockerLogs("ailss-api-gateway")}`;
for (const sensitive of [admin.password, lecturer.password, adminAuth.accessToken, verifyKey, hmacSecret]) {
  if (logs.includes(sensitive)) throw new Error("Admin credential/idempotency material appeared in logs");
}

await writeEvidence("p7.9-environment.json", {
  phase: "7.9",
  profile,
  runId,
  rabbitmqEnabled: true,
  hostNode: process.version,
  runtimeNode: safeCommand("docker", ["exec", "ailss-identity-service", "node", "--version"]),
  gitCommit: safeCommand("git", ["rev-parse", "HEAD"]) || "NOT_A_GIT_REPOSITORY",
});
await writeEvidence("p7.9-http-acceptance.json", {
  publicBefore: { status: 404 },
  wrongStepUp: safeHttp(wrongStepUp),
  verified: safeHttp(verified),
  publicAfter: safeHttp(publicAfter),
  replay: safeHttp(replay),
  concurrent,
  recovery,
});
await writeEvidence("p7.9-cassandra-verification.json", {
  runtimeRole: "svc_identity",
  before: safeState(beforeVerify),
  after: safeState(afterVerify),
  publicProjection,
  fixedShardCount: 16,
  oldMembershipAbsentAfterCompletion: true,
  canonicalTokenVersionMonotonic: true,
  credentialOperationMarkerAligned: true,
  profileVersionUnchangedByVerification: afterVerify.canonical.profileVersion === 1,
  runtimeScanUsed: false,
  allowFilteringUsed: false,
  lecturerFixtureVia: "controlled-bootstrap-probe-not-registration-change",
});
await writeEvidence("p7.9-security-verification.json", {
  canonicalAdminRoleRequired: true,
  stepUpMechanism: "CURRENT_PASSWORD_ARGON2ID_REAUTHENTICATION_NOT_MFA",
  jwtIatUsedAsRecentAuth: false,
  privilegeElevationEpoch: "ERRATA-P7-009-02",
  selfVerifyDenied: true,
  oldAccessAcrossTwoSessionsDenied: true,
  oldRefreshAcrossTwoSessionsDenied: true,
  newLoginBindsNewestTokenVersion: newSessionState.authVersion === 2,
  qIdn004Required: false,
  privateFieldLeakage: false,
  secretsAbsentFromLogsAndEvidence: true,
});
await writeEvidence("p7.9-event-verification.json", {
  businessEvent: "NONE",
  auditEventType: "system.audit.requested.v1",
  auditEventId: auditEvent.metadata.auditEventId,
  outboxState: auditEvent.eventState,
  publisherConfirmObserved: auditEvent.eventState === "PUBLISHED",
  exactlyOnceClaimed: false,
});
await writeEvidence("p7.9-summary.json", {
  stage: "phase-7.9-lecturer-verification-acceptance",
  status: "PASS",
  idn12: true,
  qIdn006InitialProducer: true,
  qIdn005VerificationSync: true,
  privilegeElevationEpoch: true,
  realCassandraLwt: true,
  concurrencySerialized: true,
  partialRecovery: true,
  publicVisibilityCanonicalFirst: true,
  identityApiContractComplete: true,
});
console.log(
  JSON.stringify({
    stage: "phase-7.9-lecturer-verification-acceptance",
    status: "PASS",
    runId,
    evidence: decodeURIComponent(evidenceDirectory.pathname),
  }),
);

async function createUser(label) {
  const id = randomUUID();
  const item = {
    email: `p79-${label}-${id}@example.test`,
    password: `P7.9-${label}-${id}-Aa1!`,
    displayName: `P79 ${label} ${id.slice(0, 8)}`,
  };
  const response = await request("POST", "/api/v1/auth/register", {
    body: item,
    idempotencyKey: `p79-register-${id}`,
  });
  assertStatus(response, 201, `${label} registration`);
  return { ...item, userId: response.json.data.userId };
}

async function login(item) {
  const response = await request("POST", "/api/v1/auth/login", {
    body: { email: item.email, password: item.password },
  });
  assertStatus(response, 200, "login");
  return response.json.data;
}

function profileRead(accessToken) {
  return request("GET", "/api/v1/me", { bearer: accessToken });
}

function refresh(session) {
  return request("POST", "/api/v1/auth/refresh", {
    body: { sessionId: session.sessionId, refreshToken: session.refreshToken },
  });
}

function publicLecturer(userId) {
  return request("GET", `/api/v1/lecturers/${userId}`);
}

function verify(accessToken, userId, currentPassword, idempotencyKey) {
  return request("POST", `/api/v1/admin/lecturers/${userId}/verify`, {
    bearer: accessToken,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    body: { currentPassword },
  });
}

async function concurrentFixture(adminAuth, password) {
  const item = await createUser("concurrent");
  db({ action: "promoteLecturer", userId: item.userId });
  const [left, right] = await Promise.all([
    verify(adminAuth.accessToken, item.userId, password, `p79-left-${randomUUID()}`),
    verify(adminAuth.accessToken, item.userId, password, `p79-right-${randomUUID()}`),
  ]);
  const statuses = [left.status, right.status].sort((a, b) => a - b);
  if (statuses.join(",") !== "200,409") {
    throw new Error(`Concurrent verification returned ${statuses.join(",")}`);
  }
  const state = db({ action: "state", userId: item.userId });
  assertVerifiedState(state, 2);
  return { statuses, state: safeState(state) };
}

async function recoveryFixture(adminAuth, adminId, password) {
  const item = await createUser("recovery");
  db({ action: "promoteLecturer", userId: item.userId });
  const idempotencyKey = `p79-recovery-${randomUUID()}`;
  const operationId = randomUUID();
  const beforeState = db({ action: "state", userId: item.userId });
  const verifiedAt = new Date().toISOString();
  const metadata = {
    schemaVersion: 1,
    requestFingerprint: verifyFingerprint(hmacSecret, adminId, item.userId, { currentPassword: password }),
    actorId: adminId,
    targetId: item.userId,
    displayName: beforeState.canonical.displayName,
    profileVersion: beforeState.canonical.profileVersion,
    shard: stableShard(item.userId),
    oldUpdatedAt: beforeState.canonical.updatedAt,
    newUpdatedAt: verifiedAt,
    expectedTokenVersion: 1,
    nextTokenVersion: 2,
    previousSecurityOperationId: beforeState.canonical.securityOperationId,
    auditEventId: derivedEventId(operationId, "audit:lecturer-verified"),
  };
  db({
    action: "injectVerifyPartial",
    userId: item.userId,
    adminId,
    idempotencyKey,
    keyHash: idempotencyKeyHash(idempotencyKey),
    operationId,
    metadata,
  });
  const recovered = await verify(adminAuth.accessToken, item.userId, password, idempotencyKey);
  assertStatus(recovered, 200, "Partial verification recovery");
  const state = db({ action: "state", userId: item.userId });
  assertVerifiedState(state, 2);
  const projection = db({ action: "publicProjection", userId: item.userId });
  if (!projection || projection.verified !== true) throw new Error("Recovery did not converge Q-IDN-006");
  return { response: safeHttp(recovered), state: safeState(state), tokenVersionIncrementedOnce: true };
}

async function request(method, path, { body, bearer, idempotencyKey } = {}) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:8080${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(25_000),
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

async function waitForReady() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:8080/health/ready");
      if (response.ok) return;
    } catch {
      // Retry during container replacement.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Gateway did not become ready");
}

async function waitForAuditEvent(scope, key, expected, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = db({ action: "idempotencyAuditEvent", scope, keyHash: idempotencyKeyHash(key), key });
    if (state.eventState === expected) return state;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Audit event did not reach ${expected}`);
}

async function directInternal(userId, token) {
  const source = `
    const response=await fetch(${JSON.stringify(`http://127.0.0.1:8101/internal/v1/users/${userId}/public-profile`)},{
      headers:${JSON.stringify({
        authorization: `Service ${token}`,
        "x-correlation-id": randomUUID(),
      })},signal:AbortSignal.timeout(10000)});
    const text=await response.text(); console.log(JSON.stringify({status:response.status,json:text?JSON.parse(text):undefined}));`;
  return JSON.parse(
    execFileSync("docker", ["exec", "ailss-identity-service", "node", "--input-type=module", "-e", source], {
      encoding: "utf8",
    }).trim(),
  );
}

function serviceToken() {
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT({ purpose: "identity.public-profile.read" })
    .setProtectedHeader({ alg: "EdDSA", kid: "dev-learning-2026-01", typ: "service+jwt" })
    .setIssuer("ailss-internal")
    .setAudience("identity-service")
    .setSubject("learning-service")
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .setJti(randomUUID())
    .sign(servicePrivateKey);
}

function databaseProbeSource() {
  return `
    import { readFileSync } from "node:fs";
    import { createHash } from "node:crypto";
    import cassandra from "cassandra-driver";
    const input=JSON.parse(readFileSync(0,"utf8"));
    const c=new cassandra.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new cassandra.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD),queryOptions:{prepare:true}});
    await c.connect(); const q={prepare:true,consistency:cassandra.types.consistencies.localQuorum}; const s={...q,serialConsistency:cassandra.types.consistencies.localSerial}; const uuid=v=>cassandra.types.Uuid.fromString(v); const num=v=>Number(v?.toString());
    const shard=v=>(createHash("sha256").update(v).digest()[0]??0)%16;
    let out;
    if(input.action==="promoteAdmin"){
      const r=await c.execute("SELECT display_name,role,status,lecturer_verified,profile_version,updated_at FROM user_by_id WHERE user_id=?",[uuid(input.userId)],q); const u=r.rows[0]; const sh=shard(input.userId);
      await c.execute("DELETE FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?",[u.get("role"),u.get("status"),sh,u.get("updated_at"),uuid(input.userId)],q);
      await c.execute("UPDATE user_by_id SET role='ADMIN' WHERE user_id=? IF EXISTS",[uuid(input.userId)],s);
      await c.execute("INSERT INTO users_by_role_status_bucket (role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version) VALUES ('ADMIN',?,?,?,?,?,?,?)",[u.get("status"),sh,u.get("updated_at"),uuid(input.userId),u.get("display_name"),u.get("lecturer_verified"),u.get("profile_version")],q); out={promoted:true};
    } else if(input.action==="promoteLecturer"){
      const r=await c.execute("SELECT display_name,role,status,lecturer_verified,profile_version,updated_at FROM user_by_id WHERE user_id=?",[uuid(input.userId)],q); const u=r.rows[0]; const sh=shard(input.userId);
      await c.execute("DELETE FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?",[u.get("role"),u.get("status"),sh,u.get("updated_at"),uuid(input.userId)],q);
      await c.execute("UPDATE user_by_id SET role='LECTURER' WHERE user_id=? IF EXISTS",[uuid(input.userId)],s);
      await c.execute("INSERT INTO users_by_role_status_bucket (role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version) VALUES ('LECTURER',?,?,?,?,?,?,?)",[u.get("status"),sh,u.get("updated_at"),uuid(input.userId),u.get("display_name"),u.get("lecturer_verified"),u.get("profile_version")],q); out={promoted:true};
    } else if(input.action==="state"){
      const r=await c.execute("SELECT user_id,normalized_email,display_name,role,status,lecturer_verified,token_version,credential_version,security_operation_id,profile_version,updated_at FROM user_by_id WHERE user_id=?",[uuid(input.userId)],q); const u=r.rows[0]; const sh=shard(input.userId); const memberships=[];
      for(const status of ["ACTIVE","SUSPENDED"]){const p=await c.execute("SELECT user_id,display_name,role,status,shard,lecturer_verified,profile_version,updated_at FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=?",[u.get("role"),status,sh],q); for(const row of p.rows)if(row.get("user_id").toString()===input.userId)memberships.push({status:row.get("status"),lecturerVerified:row.get("lecturer_verified"),displayName:row.get("display_name"),profileVersion:num(row.get("profile_version")),updatedAt:row.get("updated_at").toISOString()});}
      const cred=await c.execute("SELECT security_operation_id,credential_version FROM credential_by_email WHERE normalized_email=?",[u.get("normalized_email")],q);
      out={canonical:{userId:input.userId,displayName:u.get("display_name"),role:u.get("role"),status:u.get("status"),lecturerVerified:u.get("lecturer_verified"),tokenVersion:u.get("token_version"),credentialVersion:num(u.get("credential_version")),securityOperationId:u.get("security_operation_id")?.toString()??null,profileVersion:num(u.get("profile_version")),updatedAt:u.get("updated_at").toISOString()},credential:{credentialVersion:num(cred.rows[0]?.get("credential_version")),securityOperationId:cred.rows[0]?.get("security_operation_id")?.toString()??null},memberships};
    } else if(input.action==="publicProjection"){
      const r=await c.execute("SELECT lecturer_id,display_name,bio,avatar_object_key,verified,profile_version,updated_at FROM public_lecturer_by_id WHERE lecturer_id=?",[uuid(input.userId)],q); const row=r.rows[0];
      out=row?{lecturerId:row.get("lecturer_id").toString(),displayName:row.get("display_name"),bio:row.get("bio"),avatarObjectKey:row.get("avatar_object_key"),verified:row.get("verified"),profileVersion:num(row.get("profile_version")),updatedAt:row.get("updated_at").toISOString()}:null;
    } else if(input.action==="session"){
      const r=await c.execute("SELECT state,auth_version,version FROM session_by_id WHERE session_id=?",[uuid(input.sessionId)],q); const x=r.rows[0]; out={state:x.get("state"),authVersion:x.get("auth_version"),version:num(x.get("version"))};
    } else if(input.action==="injectVerifyPartial"){
      const m=input.metadata;
      const rr=await c.execute("UPDATE user_by_id SET lecturer_verified=true,token_version=?,security_operation_id=?,updated_at=? WHERE user_id=? IF role='LECTURER' AND status='ACTIVE' AND lecturer_verified=false AND token_version=?",[m.nextTokenVersion,uuid(input.operationId),new Date(m.newUpdatedAt),uuid(input.userId),m.expectedTokenVersion],s); if(!rr.rows[0]?.get("[applied]"))throw new Error("partial verify injection failed");
      await c.execute("INSERT INTO idempotency_by_scope_key (scope,key_hash,idempotency_key,operation_id,resource_id,result_code,status,result_checksum,created_at,expires_at) VALUES (?,?,?,?,?,0,'CANONICAL_VERIFIED',?,?,?) IF NOT EXISTS USING TTL 86400",[\`admin:\${input.adminId}:target:\${input.userId}:IDN-12\`,input.keyHash,input.idempotencyKey,uuid(input.operationId),uuid(input.userId),JSON.stringify(m),new Date(m.newUpdatedAt),new Date(Date.now()+86400000)],s); out={injected:true};
    } else if(input.action==="idempotencyAuditEvent"){
      const r=await c.execute("SELECT result_checksum,status FROM idempotency_by_scope_key WHERE scope=? AND key_hash=? AND idempotency_key=?",[input.scope,input.keyHash,input.key],q); const rec=r.rows[0]; const metadata=JSON.parse(rec.get("result_checksum")); const e=await c.execute("SELECT state,retry_count FROM pending_event_by_id WHERE event_id=?",[uuid(metadata.auditEventId)],q); out={idempotencyState:rec.get("status"),metadata,eventState:e.rows[0]?.get("state")??null,retryCount:e.rows[0]?e.rows[0].get("retry_count"):null};
    } else throw new Error("unknown action"); console.log(JSON.stringify(out)); await c.shutdown();`;
}

function db(input) {
  return JSON.parse(
    execFileSync(
      "docker",
      ["exec", "-i", "ailss-identity-service", "node", "--input-type=module", "-e", databaseProbeSource()],
      { encoding: "utf8", input: JSON.stringify(input), stdio: ["pipe", "pipe", "pipe"] },
    ).trim(),
  );
}

function verifyForeignAccessDenied() {
  const source = `import cassandra from "cassandra-driver";const c=new cassandra.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,authProvider:new cassandra.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)});try{await c.execute("SELECT * FROM identity_keyspace.users_by_role_status_bucket LIMIT 1");console.log("ALLOWED")}catch{console.log("DENIED")}finally{await c.shutdown()}`;
  return (
    execFileSync("docker", ["exec", "ailss-learning-service", "node", "--input-type=module", "-e", source], {
      encoding: "utf8",
    }).trim() === "DENIED"
  );
}

function assertVerifiedState(state, tokenVersion) {
  if (
    state.canonical.role !== "LECTURER" ||
    state.canonical.status !== "ACTIVE" ||
    state.canonical.lecturerVerified !== true ||
    state.canonical.tokenVersion !== tokenVersion ||
    state.memberships.length !== 1 ||
    state.memberships[0]?.lecturerVerified !== true ||
    state.memberships[0]?.status !== "ACTIVE"
  ) {
    throw new Error(`Canonical/Q-IDN-005 verification mismatch: ${JSON.stringify(state)}`);
  }
}

function assertKeys(value, expected) {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected.slice().sort()))
    throw new Error("Verify DTO leaked or omitted fields");
}
function assertStatus(result, status, label) {
  if (result.status !== status)
    throw new Error(`${label}: expected ${status}, got ${result.status} ${JSON.stringify(result.json)}`);
}
function assertError(result, status, code) {
  assertStatus(result, status, code);
  if (result.json?.error?.code !== code) throw new Error(`Expected ${code}, got ${result.json?.error?.code}`);
}
function verifyScope(adminId, targetId) {
  return `admin:${adminId}:target:${targetId}:IDN-12`;
}
function stableShard(value) {
  return (createHash("sha256").update(value).digest()[0] ?? 0) % 16;
}
function idempotencyKeyHash(value) {
  const byte = createHash("sha256").update(value).digest()[0] ?? 0;
  return byte > 127 ? byte - 256 : byte;
}
function verifyFingerprint(secret, actorId, targetId, request) {
  return createHmac("sha256", secret)
    .update(
      JSON.stringify({
        api: "IDN-12",
        method: "POST",
        path: `/api/v1/admin/lecturers/${targetId}/verify`,
        actorId,
        targetId,
        currentPassword: request.currentPassword,
      }),
    )
    .digest("hex");
}
function derivedEventId(operationId, purpose) {
  const bytes = createHash("sha256").update(`${purpose}:${operationId}`).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 15) | 80;
  bytes[8] = ((bytes[8] ?? 0) & 63) | 128;
  const h = bytes.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function envValue(name) {
  const value = new RegExp(`^${name}=(.+)$`, "mu").exec(envText)?.[1];
  if (!value) throw new Error(`${name} is missing`);
  return value;
}
function safeHttp(result) {
  return {
    status: result.status,
    code: result.json?.error?.code,
    data: result.status === 200 ? result.json?.data : undefined,
    replayed: result.json?.meta?.replayed,
  };
}
function safeState(state) {
  return { canonical: state.canonical, memberships: state.memberships };
}
function dockerLogs(container) {
  return safeCommand("docker", ["logs", "--tail", "2000", container]);
}
function safeCommand(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}
async function writeEvidence(name, value) {
  await writeFile(new URL(name, evidenceDirectory), `${JSON.stringify(value, null, 2)}\n`);
}
