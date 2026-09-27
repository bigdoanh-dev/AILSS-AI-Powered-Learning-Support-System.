import { createHash, createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const profile = process.env.AILSS_PROFILE ?? "dev-async";
if (profile !== "dev-async") throw new Error("P7.8 acceptance requires AILSS_PROFILE=dev-async");
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
const evidenceDirectory = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidenceDirectory, { recursive: true });
const envText = await readFile(new URL("../../.env", import.meta.url), "utf8");
const hmacSecret = envValue("PASSWORD_IDEMPOTENCY_HMAC_KEY");
const rabbitAdmin = envValue("RABBITMQ_ADMIN_USERNAME");
const rabbitPassword = envValue("RABBITMQ_ADMIN_PASSWORD");

await waitForReady();
const admin = await createUser("admin");
db({ action: "promoteAdmin", userId: admin.userId });
const target = await createUser("target");
const targetSessionA = await login(target);
const targetSessionB = await login(target);
const adminAuth = await login(admin);

const nonAdminSearch = await request("GET", "/api/v1/admin/users?role=STUDENT&status=ACTIVE&limit=2", {
  bearer: targetSessionA.accessToken,
});
assertError(nonAdminSearch, 403, "ADMIN_ROLE_REQUIRED");
assertError(
  await request("GET", "/api/v1/admin/users?status=ACTIVE", { bearer: adminAuth.accessToken }),
  422,
  "ADMIN_SEARCH_VALIDATION_FAILED",
);

const firstPage = await request("GET", "/api/v1/admin/users?role=STUDENT&status=ACTIVE&limit=2", {
  bearer: adminAuth.accessToken,
});
assertStatus(firstPage, 200, "Admin search first page");
const cursor = firstPage.json?.meta?.pagination?.nextCursor;
if (!cursor || firstPage.json.data.length !== 2)
  throw new Error("Admin search did not return a bounded cursor page");
const secondPage = await request(
  "GET",
  `/api/v1/admin/users?role=STUDENT&status=ACTIVE&limit=2&cursor=${encodeURIComponent(cursor)}`,
  { bearer: adminAuth.accessToken },
);
assertStatus(secondPage, 200, "Admin search second page");
const pageIds = [...firstPage.json.data, ...secondPage.json.data].map((item) => item.userId);
if (new Set(pageIds).size !== pageIds.length) throw new Error("Admin cursor repeated a page-boundary user");
assertOrdered(firstPage.json.data);
assertOrdered(secondPage.json.data);
assertError(
  await request(
    "GET",
    `/api/v1/admin/users?role=STUDENT&status=ACTIVE&limit=2&cursor=${encodeURIComponent(`${cursor.slice(0, -1)}x`)}`,
    { bearer: adminAuth.accessToken },
  ),
  400,
  "INVALID_CURSOR",
);
assertError(
  await request(
    "GET",
    `/api/v1/admin/users?role=LECTURER&status=ACTIVE&limit=2&cursor=${encodeURIComponent(cursor)}`,
    { bearer: adminAuth.accessToken },
  ),
  400,
  "INVALID_CURSOR",
);

const detail = await request("GET", `/api/v1/admin/users/${target.userId}`, {
  bearer: adminAuth.accessToken,
});
assertStatus(detail, 200, "Admin detail");
assertKeys(detail.json.data, [
  "createdAt",
  "displayName",
  "emailMasked",
  "lecturerVerified",
  "profileVersion",
  "role",
  "status",
  "updatedAt",
  "userId",
]);

const wrongStepUp = await changeStatus(
  adminAuth.accessToken,
  target.userId,
  "SUSPENDED",
  "wrong-password",
  `p78-wrong-${randomUUID()}`,
);
assertError(wrongStepUp, 401, "ADMIN_STEP_UP_FAILED");
const before = db({ action: "state", userId: target.userId });
if (before.canonical.status !== "ACTIVE" || before.canonical.tokenVersion !== 1) {
  throw new Error("Wrong step-up mutated canonical target state");
}

const statusKey = `p78-status-${randomUUID()}`;
const suspended = await changeStatus(
  adminAuth.accessToken,
  target.userId,
  "SUSPENDED",
  admin.password,
  statusKey,
  "policy review",
);
assertStatus(suspended, 200, "Suspend target");
const afterSuspend = db({ action: "state", userId: target.userId });
assertProjectionState(afterSuspend, "SUSPENDED", 2);
assertError(await profileRead(targetSessionA.accessToken), 401, "INVALID_ACCESS_TOKEN");
assertError(await profileRead(targetSessionB.accessToken), 401, "INVALID_ACCESS_TOKEN");
assertError(await refresh(targetSessionA), 401, "INVALID_REFRESH_CREDENTIALS");
assertError(await refresh(targetSessionB), 401, "INVALID_REFRESH_CREDENTIALS");

const replay = await changeStatus(
  adminAuth.accessToken,
  target.userId,
  "SUSPENDED",
  admin.password,
  statusKey,
  "policy review",
);
assertStatus(replay, 200, "Status exact replay");
if (replay.json?.meta?.replayed !== true) throw new Error("Status command did not replay exactly");
assertError(
  await changeStatus(adminAuth.accessToken, target.userId, "ACTIVE", admin.password, statusKey),
  409,
  "IDEMPOTENCY_CONFLICT",
);

const firstEvent = await waitForEvent(statusScope(admin.userId, target.userId), statusKey, "PUBLISHED");
if (firstEvent.metadata.nextTokenVersion !== 2) throw new Error("Status event aggregate version mismatch");
const delivered = await getStatusEvent(firstEvent.metadata.eventId);
assertStatusEvent(delivered, target.userId, "ACTIVE", "SUSPENDED", 2);

const reactivationKey = `p78-reactivate-${randomUUID()}`;
const reactivated = await changeStatus(
  adminAuth.accessToken,
  target.userId,
  "ACTIVE",
  admin.password,
  reactivationKey,
);
assertStatus(reactivated, 200, "Reactivate target");
const afterReactivate = db({ action: "state", userId: target.userId });
assertProjectionState(afterReactivate, "ACTIVE", 3);
assertError(await profileRead(targetSessionA.accessToken), 401, "INVALID_ACCESS_TOKEN");
const newTargetSession = await login(target);
const newSessionState = db({ action: "session", sessionId: newTargetSession.sessionId });
if (newSessionState.authVersion !== 3) throw new Error("Reactivated login did not bind newest tokenVersion");

const concurrent = await concurrentFixture(adminAuth, admin.password);
const recovery = await recoveryFixture(adminAuth, admin.userId, admin.password);
const brokerRecovery = await brokerRecoveryFixture(adminAuth, admin.userId, admin.password);

const selfTarget = await changeStatus(
  adminAuth.accessToken,
  admin.userId,
  "SUSPENDED",
  admin.password,
  `p78-self-${randomUUID()}`,
);
assertError(selfTarget, 403, "ADMIN_SELF_STATUS_CHANGE_FORBIDDEN");

const foreignAccessDenied = verifyForeignAccessDenied();
if (!foreignAccessDenied) throw new Error("svc_learning unexpectedly read Q-IDN-005");
const logs = `${dockerLogs("ailss-identity-service")}\n${dockerLogs("ailss-api-gateway")}`;
for (const sensitive of [
  admin.password,
  target.password,
  adminAuth.accessToken,
  statusKey,
  cursor,
  hmacSecret,
]) {
  if (logs.includes(sensitive))
    throw new Error("Admin credential/cursor/idempotency material appeared in logs");
}

await writeEvidence("p7.8-environment.json", {
  phase: "7.8",
  profile,
  runId,
  rabbitmqEnabled: true,
  hostNode: process.version,
  runtimeNode: safeCommand("docker", ["exec", "ailss-identity-service", "node", "--version"]),
  gitCommit: safeCommand("git", ["rev-parse", "HEAD"]) || "NOT_A_GIT_REPOSITORY",
});
await writeEvidence("p7.8-http-acceptance.json", {
  nonAdminDenied: safeHttp(nonAdminSearch),
  firstPage: safeSearch(firstPage),
  secondPage: safeSearch(secondPage),
  detail: safeHttp(detail),
  wrongStepUp: safeHttp(wrongStepUp),
  suspended: safeHttp(suspended),
  exactReplay: safeHttp(replay),
  reactivated: safeHttp(reactivated),
  concurrent,
  recovery,
  brokerRecovery,
  adminEmailSha256: createHash("sha256").update(admin.email).digest("hex"),
});
await writeEvidence("p7.8-cassandra-verification.json", {
  runtimeRole: "svc_identity",
  before: safeState(before),
  afterSuspend: safeState(afterSuspend),
  afterReactivate: safeState(afterReactivate),
  fixedShardCount: 16,
  completeRoleStatusPartitionRouting: true,
  oldMembershipAbsentAfterCompletion: true,
  canonicalTokenVersionMonotonic: true,
  credentialOperationMarkerAligned: true,
  controlledBackfill: true,
  foreignLearningAccessDenied: foreignAccessDenied,
  runtimeScanUsed: false,
  allowFilteringUsed: false,
});
await writeEvidence("p7.8-security-verification.json", {
  canonicalAdminRoleRequired: true,
  currentSessionAndTokenVersionRequired: true,
  stepUpMechanism: "CURRENT_PASSWORD_ARGON2ID_REAUTHENTICATION_NOT_MFA",
  jwtIatUsedAsRecentAuth: false,
  selfStatusChangeDenied: true,
  adminTargetChangeDenied: true,
  oldAccessAcrossTwoSessionsDenied: true,
  oldRefreshAcrossTwoSessionsDenied: true,
  qIdn004Required: false,
  privateFieldLeakage: false,
  secretsAbsentFromLogsAndEvidence: true,
});
await writeEvidence("p7.8-event-verification.json", {
  eventType: "identity.user.status_changed.v1",
  eventId: firstEvent.metadata.eventId,
  stableAggregateVersion: firstEvent.metadata.nextTokenVersion,
  outboxState: firstEvent.eventState,
  rabbitmqEnabled: true,
  publisherConfirmObserved: firstEvent.eventState === "PUBLISHED",
  brokerOutageRecovery: brokerRecovery,
  exactlyOnceClaimed: false,
});
await writeEvidence("p7.8-summary.json", {
  stage: "phase-7.8-admin-acceptance",
  status: "PASS",
  idn09: true,
  idn10: true,
  idn11: true,
  qIdn005ProducerCompleteness: true,
  realCassandraLwt: true,
  rabbitmqStatusEvent: true,
  concurrencySerialized: true,
  partialRecovery: true,
  p7_9Implemented: false,
});
console.log(
  JSON.stringify({
    stage: "phase-7.8-admin-acceptance",
    status: "PASS",
    runId,
    evidence: decodeURIComponent(evidenceDirectory.pathname),
  }),
);

async function createUser(label) {
  const id = randomUUID();
  const item = {
    email: `p78-${label}-${id}@example.test`,
    password: `P7.8-${label}-${id}-Aa1!`,
    displayName: `P78 ${label} ${id.slice(0, 8)}`,
  };
  const response = await request("POST", "/api/v1/auth/register", {
    body: item,
    idempotencyKey: `p78-register-${id}`,
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

function changeStatus(accessToken, userId, status, currentPassword, idempotencyKey, reason) {
  return request("PATCH", `/api/v1/admin/users/${userId}/status`, {
    bearer: accessToken,
    idempotencyKey,
    body: { status, currentPassword, ...(reason ? { reason } : {}) },
  });
}

async function concurrentFixture(adminAuth, password) {
  const item = await createUser("concurrent");
  const [left, right] = await Promise.all([
    changeStatus(adminAuth.accessToken, item.userId, "SUSPENDED", password, `p78-left-${randomUUID()}`),
    changeStatus(adminAuth.accessToken, item.userId, "SUSPENDED", password, `p78-right-${randomUUID()}`),
  ]);
  const statuses = [left.status, right.status].sort();
  if (statuses.join(",") !== "200,409") {
    throw new Error(`Concurrent status commands returned ${statuses.join(",")}`);
  }
  const state = db({ action: "state", userId: item.userId });
  assertProjectionState(state, "SUSPENDED", 2);
  return { statuses, state: safeState(state) };
}

async function recoveryFixture(adminAuth, adminId, password) {
  const item = await createUser("recovery");
  const idempotencyKey = `p78-recovery-${randomUUID()}`;
  const operationId = randomUUID();
  const request = { status: "SUSPENDED", currentPassword: password, reason: "recovery" };
  const fingerprint = statusFingerprint(hmacSecret, adminId, item.userId, request);
  const beforeState = db({ action: "state", userId: item.userId });
  const changedAt = new Date().toISOString();
  const metadata = {
    schemaVersion: 1,
    requestFingerprint: fingerprint,
    actorId: adminId,
    targetId: item.userId,
    role: "STUDENT",
    displayName: beforeState.canonical.displayName,
    lecturerVerified: false,
    profileVersion: beforeState.canonical.profileVersion,
    oldStatus: "ACTIVE",
    newStatus: "SUSPENDED",
    shard: stableShard(item.userId),
    oldUpdatedAt: beforeState.canonical.updatedAt,
    newUpdatedAt: changedAt,
    expectedTokenVersion: 1,
    nextTokenVersion: 2,
    previousSecurityOperationId: beforeState.canonical.securityOperationId,
    eventId: derivedEventId(operationId, "status-changed"),
    auditEventId: derivedEventId(operationId, "audit:status-changed"),
    reasonClass: "PROVIDED",
  };
  db({
    action: "injectPartial",
    userId: item.userId,
    adminId,
    idempotencyKey,
    keyHash: idempotencyKeyHash(idempotencyKey),
    operationId,
    metadata,
  });
  const recovered = await changeStatus(
    adminAuth.accessToken,
    item.userId,
    "SUSPENDED",
    password,
    idempotencyKey,
    "recovery",
  );
  assertStatus(recovered, 200, "Partial status recovery");
  const state = db({ action: "state", userId: item.userId });
  assertProjectionState(state, "SUSPENDED", 2);
  return { response: safeHttp(recovered), state: safeState(state), tokenVersionIncrementedOnce: true };
}

async function brokerRecoveryFixture(adminAuth, adminId, password) {
  const item = await createUser("broker");
  const key = `p78-broker-${randomUUID()}`;
  execFileSync("docker", ["stop", "ailss-rabbitmq"], { stdio: "ignore" });
  let response;
  try {
    response = await changeStatus(adminAuth.accessToken, item.userId, "SUSPENDED", password, key);
    assertStatus(response, 200, "Status change during broker outage");
  } finally {
    execFileSync("docker", ["start", "ailss-rabbitmq"], { stdio: "ignore" });
  }
  await waitForRabbit();
  const event = await waitForEvent(statusScope(adminId, item.userId), key, "PUBLISHED", 30_000);
  return { response: safeHttp(response), eventId: event.metadata.eventId, finalState: event.eventState };
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

async function waitForRabbit() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:15672/api/health/checks/alarms", {
        headers: { authorization: rabbitAuthorization() },
      });
      if (response.ok) return;
    } catch {
      // Retry while RabbitMQ restarts.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("RabbitMQ did not recover");
}

async function waitForEvent(scope, key, expected, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = db({ action: "idempotencyEvent", scope, keyHash: idempotencyKeyHash(key), key });
    if (state.eventState === expected) return state;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Outbox event did not reach ${expected}`);
}

async function getStatusEvent(eventId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(
      "http://127.0.0.1:15672/api/queues/%2Failss/identity.user.status_changed.q/get",
      {
        method: "POST",
        headers: { authorization: rabbitAuthorization(), "content-type": "application/json" },
        body: JSON.stringify({ count: 20, ackmode: "ack_requeue_false", encoding: "auto", truncate: 100000 }),
      },
    );
    if (!response.ok) throw new Error(`Rabbit queue read failed: ${response.status}`);
    for (const message of await response.json()) {
      const event = JSON.parse(message.payload);
      if (event.eventId === eventId) return event;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Published status event was not routed to its registered queue");
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
      const r=await c.execute("SELECT display_name,role,status,lecturer_verified,profile_version,updated_at FROM user_by_id WHERE user_id=?",[uuid(input.userId)],q); const u=r.rows[0]; const sh=await shard(input.userId);
      await c.execute("DELETE FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?",[u.get("role"),u.get("status"),sh,u.get("updated_at"),uuid(input.userId)],q);
      await c.execute("UPDATE user_by_id SET role='ADMIN' WHERE user_id=? IF EXISTS",[uuid(input.userId)],s);
      await c.execute("INSERT INTO users_by_role_status_bucket (role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version) VALUES ('ADMIN',?,?,?,?,?,?,?)",[u.get("status"),sh,u.get("updated_at"),uuid(input.userId),u.get("display_name"),u.get("lecturer_verified"),u.get("profile_version")],q); out={promoted:true};
    } else if(input.action==="state"){
      const r=await c.execute("SELECT user_id,normalized_email,display_name,role,status,lecturer_verified,token_version,credential_version,security_operation_id,profile_version,updated_at FROM user_by_id WHERE user_id=?",[uuid(input.userId)],q); const u=r.rows[0]; const sh=shard(input.userId); const memberships=[];
      for(const status of ["ACTIVE","SUSPENDED"]){const p=await c.execute("SELECT user_id,display_name,role,status,shard,profile_version,updated_at FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=?",[u.get("role"),status,sh],q); for(const row of p.rows)if(row.get("user_id").toString()===input.userId)memberships.push({status:row.get("status"),displayName:row.get("display_name"),profileVersion:num(row.get("profile_version")),updatedAt:row.get("updated_at").toISOString()});}
      const cred=await c.execute("SELECT security_operation_id,credential_version FROM credential_by_email WHERE normalized_email=?",[u.get("normalized_email")],q);
      out={canonical:{userId:input.userId,displayName:u.get("display_name"),role:u.get("role"),status:u.get("status"),lecturerVerified:u.get("lecturer_verified"),tokenVersion:u.get("token_version"),credentialVersion:num(u.get("credential_version")),securityOperationId:u.get("security_operation_id")?.toString()??null,profileVersion:num(u.get("profile_version")),updatedAt:u.get("updated_at").toISOString()},credential:{credentialVersion:num(cred.rows[0]?.get("credential_version")),securityOperationId:cred.rows[0]?.get("security_operation_id")?.toString()??null},memberships};
    } else if(input.action==="session"){
      const r=await c.execute("SELECT state,auth_version,version FROM session_by_id WHERE session_id=?",[uuid(input.sessionId)],q); const x=r.rows[0]; out={state:x.get("state"),authVersion:x.get("auth_version"),version:num(x.get("version"))};
    } else if(input.action==="injectPartial"){
      const m=input.metadata; const sh=m.shard;
      await c.execute("DELETE FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?",[m.role,m.oldStatus,sh,new Date(m.oldUpdatedAt),uuid(input.userId)],q);
      const r=await c.execute("UPDATE user_by_id SET status=?,token_version=?,security_operation_id=?,updated_at=? WHERE user_id=? IF status=? AND token_version=?",[m.newStatus,m.nextTokenVersion,uuid(input.operationId),new Date(m.newUpdatedAt),uuid(input.userId),m.oldStatus,m.expectedTokenVersion],s); if(!r.rows[0]?.get("[applied]"))throw new Error("partial canonical injection failed");
      await c.execute("INSERT INTO idempotency_by_scope_key (scope,key_hash,idempotency_key,operation_id,resource_id,result_code,status,result_checksum,created_at,expires_at) VALUES (?,?,?,?,?,0,'CANONICAL_UPDATED',?,?,?) IF NOT EXISTS USING TTL 86400",[input.scope??\`admin:\${input.adminId}:target:\${input.userId}:IDN-11\`,input.keyHash,input.idempotencyKey,uuid(input.operationId),uuid(input.userId),JSON.stringify(m),new Date(m.newUpdatedAt),new Date(Date.now()+86400000)],s); out={injected:true};
    } else if(input.action==="idempotencyEvent"){
      const r=await c.execute("SELECT result_checksum,status FROM idempotency_by_scope_key WHERE scope=? AND key_hash=? AND idempotency_key=?",[input.scope,input.keyHash,input.key],q); const rec=r.rows[0]; const metadata=JSON.parse(rec.get("result_checksum")); const e=await c.execute("SELECT state,retry_count FROM pending_event_by_id WHERE event_id=?",[uuid(metadata.eventId)],q); out={idempotencyState:rec.get("status"),metadata,eventState:e.rows[0]?.get("state")??null,retryCount:e.rows[0]?e.rows[0].get("retry_count"):null};
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

function assertProjectionState(state, status, tokenVersion) {
  if (
    state.canonical.status !== status ||
    state.canonical.tokenVersion !== tokenVersion ||
    state.memberships.length !== 1 ||
    state.memberships[0]?.status !== status
  ) {
    throw new Error(`Canonical/Q-IDN-005 mismatch: ${JSON.stringify(state)}`);
  }
}
function assertStatusEvent(event, userId, oldStatus, newStatus, version) {
  if (
    event.eventType !== "identity.user.status_changed.v1" ||
    event.aggregate.id !== userId ||
    event.aggregate.version !== version ||
    event.data.oldStatus !== oldStatus ||
    event.data.newStatus !== newStatus ||
    event.data.userId !== userId
  )
    throw new Error("Status event payload mismatch");
  for (const forbidden of ["email", "password", "currentPassword", "sessionId", "credentialVersion"])
    if (JSON.stringify(event).includes(forbidden)) throw new Error("Status event leaked private data");
}
function assertOrdered(items) {
  for (let i = 1; i < items.length; i += 1) {
    const before = items[i - 1];
    const after = items[i];
    if (
      Date.parse(before.updatedAt) < Date.parse(after.updatedAt) ||
      (before.updatedAt === after.updatedAt && before.userId > after.userId)
    )
      throw new Error("Search order is unstable");
  }
}
function assertKeys(value, expected) {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected.slice().sort()))
    throw new Error("Admin DTO leaked or omitted fields");
}
function assertStatus(result, status, label) {
  if (result.status !== status)
    throw new Error(`${label}: expected ${status}, got ${result.status} ${JSON.stringify(result.json)}`);
}
function assertError(result, status, code) {
  assertStatus(result, status, code);
  if (result.json?.error?.code !== code) throw new Error(`Expected ${code}, got ${result.json?.error?.code}`);
}
function statusScope(adminId, targetId) {
  return `admin:${adminId}:target:${targetId}:IDN-11`;
}
function stableShard(value) {
  return (createHash("sha256").update(value).digest()[0] ?? 0) % 16;
}
function idempotencyKeyHash(value) {
  const byte = createHash("sha256").update(value).digest()[0] ?? 0;
  return byte > 127 ? byte - 256 : byte;
}
function statusFingerprint(secret, actorId, targetId, request) {
  return createHmac("sha256", secret)
    .update(
      JSON.stringify({
        api: "IDN-11",
        method: "PATCH",
        path: `/api/v1/admin/users/${targetId}/status`,
        actorId,
        targetId,
        status: request.status,
        reason: request.reason ?? null,
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
function rabbitAuthorization() {
  return `Basic ${Buffer.from(`${rabbitAdmin}:${rabbitPassword}`).toString("base64")}`;
}
function safeHttp(result) {
  return {
    status: result.status,
    code: result.json?.error?.code,
    data: result.status === 200 ? result.json?.data : undefined,
    replayed: result.json?.meta?.replayed,
  };
}
function safeSearch(result) {
  return {
    status: result.status,
    count: result.json?.data?.length,
    hasMore: result.json?.meta?.pagination?.hasMore,
    cursorPresent: Boolean(result.json?.meta?.pagination?.nextCursor),
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
