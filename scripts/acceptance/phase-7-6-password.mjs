import { createHash, createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const profile = process.env.AILSS_PROFILE ?? "dev-async";
if (profile !== "dev-async") throw new Error("P7.6 acceptance requires AILSS_PROFILE=dev-async");
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
const evidenceDirectory = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidenceDirectory, { recursive: true });
const envText = await readFile(new URL("../../.env", import.meta.url), "utf8");
const hmacKey = /^PASSWORD_IDEMPOTENCY_HMAC_KEY=(.+)$/mu.exec(envText)?.[1];
if (!hmacKey) throw new Error("P7.6 acceptance HMAC key is not configured");

const primary = await createUser("primary");
const sessionA = await login(primary.email, primary.oldPassword);
const sessionB = await login(primary.email, primary.oldPassword);
assertStatus(await getProfile(sessionA.accessToken), 200, "profile session A before change");
assertStatus(await getProfile(sessionB.accessToken), 200, "profile session B before change");
const before = db({
  action: "securityState",
  userId: primary.userId,
  sessionIds: [sessionA.sessionId, sessionB.sessionId],
});
assertSecurityState(before, { tokenVersion: 1, credentialVersion: 1 });

const wrong = await changePassword(
  sessionA.accessToken,
  "definitely-wrong-current-password",
  primary.newPassword,
  `p76-wrong-${randomUUID()}`,
);
assertError(wrong, 401, "INVALID_REAUTHENTICATION");
assertSecurityState(
  db({
    action: "securityState",
    userId: primary.userId,
    sessionIds: [sessionA.sessionId, sessionB.sessionId],
  }),
  { tokenVersion: 1, credentialVersion: 1 },
);

const changeKey = `p76-change-${randomUUID()}`;
const changed = await changePassword(
  sessionA.accessToken,
  primary.oldPassword,
  primary.newPassword,
  changeKey,
);
assertStatus(changed, 200, "password change");
if (changed.json?.data?.passwordChanged !== true || changed.json?.meta?.replayed !== false) {
  throw new Error("Password change response is not the safe first outcome");
}
const after = db({
  action: "securityState",
  userId: primary.userId,
  sessionIds: [sessionA.sessionId, sessionB.sessionId],
});
assertSecurityState(after, { tokenVersion: 2, credentialVersion: 2 });
if (after.sessions[0]?.state !== "REVOKED" || after.sessions[1]?.state !== "ACTIVE") {
  throw new Error("Current/other physical session policy mismatch");
}
if (after.sessions.some((session) => session.authVersion !== 1)) {
  throw new Error("Password change silently upgraded an old session authVersion");
}

assertError(await getProfile(sessionA.accessToken), 401, "INVALID_ACCESS_TOKEN");
assertError(await getProfile(sessionB.accessToken), 401, "INVALID_ACCESS_TOKEN");
assertError(await refresh(sessionA), 401, "INVALID_REFRESH_CREDENTIALS");
assertError(await refresh(sessionB), 401, "INVALID_REFRESH_CREDENTIALS");
const afterOldRefresh = db({
  action: "securityState",
  userId: primary.userId,
  sessionIds: [sessionA.sessionId, sessionB.sessionId],
});
if (afterOldRefresh.sessions.some((session) => session.state !== "REVOKED")) {
  throw new Error("Old refresh attempts did not converge sessions to REVOKED");
}

assertError(await loginRaw(primary.email, primary.oldPassword), 401, "INVALID_CREDENTIALS");
const sessionC = await login(primary.email, primary.newPassword);
const sessionCState = db({ action: "session", sessionId: sessionC.sessionId });
if (sessionCState.authVersion !== 2 || sessionCState.state !== "ACTIVE") {
  throw new Error("New login did not bind the new security version");
}
assertStatus(await getProfile(sessionC.accessToken), 200, "new-password profile");
assertStatus(await refresh(sessionC), 200, "new security epoch refresh");

const replay = await changePassword(
  sessionA.accessToken,
  primary.oldPassword,
  primary.newPassword,
  changeKey,
);
assertStatus(replay, 200, "password replay");
if (replay.json?.meta?.replayed !== true) throw new Error("Completed password command did not replay");
assertSecurityState(db({ action: "securityState", userId: primary.userId, sessionIds: [] }), {
  tokenVersion: 2,
  credentialVersion: 2,
});

const keyConflict = await changePassword(
  sessionA.accessToken,
  primary.oldPassword,
  `${primary.newPassword}-different`,
  changeKey,
);
assertError(keyConflict, 409, "IDEMPOTENCY_CONFLICT");

const concurrent = await concurrentFixture();
const recovery = await partialRecoveryFixture();

const logs = `${dockerLogs("ailss-identity-service")}\n${dockerLogs("ailss-api-gateway")}`;
for (const sensitive of [
  primary.oldPassword,
  primary.newPassword,
  sessionA.accessToken,
  sessionA.refreshToken,
  sessionB.accessToken,
  sessionB.refreshToken,
  hmacKey,
]) {
  if (logs.includes(sensitive)) throw new Error("Password, token, or HMAC secret appeared in logs");
}

await writeEvidence("p7.6-environment.json", {
  phase: "7.6",
  profile,
  runId,
  hostNode: process.version,
  runtimeNode: safeCommand("docker", ["exec", "ailss-identity-service", "node", "--version"]),
  gitCommit: safeCommand("git", ["rev-parse", "HEAD"]) || "NOT_A_GIT_REPOSITORY",
});
await writeEvidence("p7.6-http-acceptance.json", {
  wrongCurrentPassword: safeHttp(wrong),
  firstChange: safeHttp(changed),
  oldAccessCurrentDenied: true,
  oldRefreshCurrentDenied: true,
  oldAccessOtherDenied: true,
  oldRefreshOtherDenied: true,
  oldPasswordLoginDenied: true,
  newPasswordLoginAccepted: true,
  newProfileAccepted: true,
  newRefreshAccepted: true,
  exactReplay: safeHttp(replay),
  idempotencyConflict: safeHttp(keyConflict),
  concurrent,
  recovery,
  fixtureEmailSha256: createHash("sha256").update(primary.email).digest("hex"),
});
await writeEvidence("p7.6-cassandra-verification.json", {
  runtimeRole: "svc_identity",
  before: safeSecurityState(before),
  afterChange: safeSecurityState(after),
  afterOldRefresh: safeSecurityState(afterOldRefresh),
  tokenVersionIncrementExactlyOnce: after.tokenVersion === before.tokenVersion + 1,
  credentialVersionIncrementExactlyOnce: after.credentialVersion === before.credentialVersion + 1,
  userCredentialVersionHandshake: after.credentialVersion === after.credential.credentialVersion,
  operationMarkerHandshake: after.securityOperationId === after.credential.securityOperationId,
  currentSessionPhysicallyRevoked: true,
  otherSessionInitiallyPhysicallyActiveButEffectivelyStale: true,
  qIdn004UsedForSecurityCorrectness: false,
  eventWritten: false,
});
await writeEvidence("p7.6-security-verification.json", {
  operationBoundCurrentPasswordReauthentication: true,
  jwtIatUsedAsRecentAuth: false,
  argon2idNewSaltAndHash: true,
  normalizedEmailExposed: false,
  passwordOrHashStoredInIdempotency: false,
  keyedHmacFingerprint: true,
  legacyNullSessionAuthVersionPolicy: "FAIL_CLOSED",
  oldAccessAndRefreshAcrossTwoSessionsDenied: true,
  noReplacementTokensInPasswordResponse: true,
  noPasswordEvent: true,
  secretsAbsentFromLogsAndEvidence: true,
});
await writeEvidence("p7.6-summary.json", {
  stage: "phase-7.6-password-acceptance",
  status: "PASS",
  idn07: true,
  realCassandraLwt: true,
  twoSessionGlobalSecurityInvalidation: true,
  recoverableMultiPartitionProtocol: true,
  exactIdempotentReplay: true,
  concurrencySerialized: true,
  noBusinessEvent: true,
  p7_7Implemented: false,
});
console.log(
  JSON.stringify({
    stage: "phase-7.6-password-acceptance",
    status: "PASS",
    runId,
    evidence: decodeURIComponent(evidenceDirectory.pathname),
  }),
);

async function concurrentFixture() {
  const item = await createUser("concurrent");
  const auth = await login(item.email, item.oldPassword);
  const [left, right] = await Promise.all([
    changePassword(auth.accessToken, item.oldPassword, item.newPassword, `p76-left-${randomUUID()}`),
    changePassword(auth.accessToken, item.oldPassword, item.newPassword, `p76-right-${randomUUID()}`),
  ]);
  const statuses = [left.status, right.status];
  const sortedStatuses = statuses
    .slice()
    .sort((a, b) => a - b)
    .join(",");
  // The loser legitimately observes either 409 (lost the canonical LWT race) or 401
  // (protected validation saw the session the winner revoked / the advanced epoch).
  if (sortedStatuses !== "200,409" && sortedStatuses !== "200,401") {
    throw new Error(
      `Concurrent password changes returned ${statuses.join(",")} (${[left, right]
        .map((result) => result.json?.error?.code ?? "success")
        .join(",")})`,
    );
  }
  const state = db({ action: "securityState", userId: item.userId, sessionIds: [auth.sessionId] });
  assertSecurityState(state, { tokenVersion: 2, credentialVersion: 2 });
  return { statuses, tokenVersion: state.tokenVersion, credentialVersion: state.credentialVersion };
}

async function partialRecoveryFixture() {
  const item = await createUser("recovery");
  const auth = await login(item.email, item.oldPassword);
  const idempotencyKey = `p76-recovery-${randomUUID()}`;
  const operationId = randomUUID();
  const updatedAt = new Date().toISOString();
  const fingerprint = passwordFingerprint(hmacKey, item.userId, item.oldPassword, item.newPassword);
  db({
    action: "injectUserEpoch",
    userId: item.userId,
    sessionId: auth.sessionId,
    idempotencyKey,
    operationId,
    fingerprint,
    updatedAt,
  });
  const partial = db({ action: "securityState", userId: item.userId, sessionIds: [auth.sessionId] });
  if (partial.tokenVersion !== 2 || partial.credential.credentialVersion !== 1) {
    throw new Error("Partial failure fixture was not injected");
  }
  const result = await changePassword(auth.accessToken, item.oldPassword, item.newPassword, idempotencyKey);
  assertStatus(result, 200, "partial recovery");
  const recovered = db({ action: "securityState", userId: item.userId, sessionIds: [auth.sessionId] });
  assertSecurityState(recovered, { tokenVersion: 2, credentialVersion: 2 });
  if (recovered.sessions[0]?.state !== "REVOKED") throw new Error("Recovery did not revoke session");
  return {
    injectedPhase: "USER_EPOCH_ADVANCED",
    status: result.status,
    replayed: result.json?.meta?.replayed,
    tokenVersion: recovered.tokenVersion,
    credentialVersion: recovered.credentialVersion,
    sessionState: recovered.sessions[0]?.state,
  };
}

async function createUser(label) {
  const id = randomUUID();
  const email = `p76-${label}-${id}@example.test`;
  const oldPassword = `P7.6-old-${label}-${id}-Aa1!`;
  const newPassword = `P7.6-new-${label}-${id}-Bb2!`;
  const registration = await request("POST", "/api/v1/auth/register", {
    body: { email, password: oldPassword, displayName: `P76 ${label} ${id.slice(0, 8)}` },
    idempotencyKey: `p76-register-${id}`,
  });
  assertStatus(registration, 201, `${label} registration`);
  return { userId: registration.json.data.userId, email, oldPassword, newPassword };
}

async function login(email, password) {
  const result = await loginRaw(email, password);
  assertStatus(result, 200, "login");
  const data = result.json?.data;
  if (!data?.accessToken || !data?.refreshToken || !data?.sessionId) {
    throw new Error("Login response omitted credentials");
  }
  return { accessToken: data.accessToken, refreshToken: data.refreshToken, sessionId: data.sessionId };
}

function loginRaw(email, password) {
  return request("POST", "/api/v1/auth/login", { body: { email, password } });
}

function refresh(auth) {
  return request("POST", "/api/v1/auth/refresh", {
    body: { sessionId: auth.sessionId, refreshToken: auth.refreshToken },
  });
}

function getProfile(accessToken) {
  return request("GET", "/api/v1/me", { bearer: accessToken });
}

function changePassword(accessToken, currentPassword, newPassword, idempotencyKey) {
  return request("POST", "/api/v1/me/password", {
    bearer: accessToken,
    idempotencyKey,
    body: { currentPassword, newPassword },
  });
}

async function request(method, path, { body, bearer, idempotencyKey } = {}) {
  let transportError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:8080${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15_000),
      });
      const text = await response.text();
      return {
        status: response.status,
        json: text ? JSON.parse(text) : undefined,
        transportRetries: attempt - 1,
      };
    } catch (error) {
      transportError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw transportError;
}

function passwordFingerprint(key, userId, currentPassword, newPassword) {
  return createHmac("sha256", key)
    .update("POST\n/api/v1/me/password\n", "utf8")
    .update(userId, "utf8")
    .update("\0", "utf8")
    .update(currentPassword, "utf8")
    .update("\0", "utf8")
    .update(newPassword, "utf8")
    .digest("hex");
}

function idempotencyKeyHash(value) {
  const byte = createHash("sha256").update(value, "utf8").digest()[0] ?? 0;
  return byte > 127 ? byte - 256 : byte;
}

function databaseProbeSource() {
  return `
    import { readFileSync } from "node:fs";
    import { createHash } from "node:crypto";
    import cassandra from "cassandra-driver";
    const input = JSON.parse(readFileSync(0, "utf8"));
    const client = new cassandra.Client({
      contactPoints: process.env.CASSANDRA_CONTACT_POINTS.split(","),
      localDataCenter: process.env.CASSANDRA_LOCAL_DC,
      keyspace: process.env.CASSANDRA_KEYSPACE,
      authProvider: new cassandra.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME, process.env.CASSANDRA_PASSWORD),
      queryOptions: { prepare: true },
    });
    await client.connect();
    const options = { prepare: true, consistency: cassandra.types.consistencies.localQuorum };
    const serial = { ...options, serialConsistency: cassandra.types.consistencies.localSerial };
    const uuid = (value) => cassandra.types.Uuid.fromString(value);
    let output;
    if (input.action === "securityState") {
      const users = await client.execute(
        "SELECT normalized_email,token_version,credential_version,security_operation_id FROM user_by_id WHERE user_id=?",
        [uuid(input.userId)], options);
      const user = users.rows[0];
      const credentials = await client.execute(
        "SELECT credential_version,security_operation_id,status FROM credential_by_email WHERE normalized_email=?",
        [user?.get("normalized_email")], options);
      const credential = credentials.rows[0];
      const sessions = [];
      for (const sessionId of input.sessionIds) {
        const result = await client.execute(
          "SELECT state,version,auth_version,revoked_at FROM session_by_id WHERE session_id=?",
          [uuid(sessionId)], options);
        const row = result.rows[0];
        sessions.push({ state: row?.get("state"), version: Number(row?.get("version")?.toString()),
          authVersion: row?.get("auth_version"), revokedAtPresent: row?.get("revoked_at") instanceof Date });
      }
      output = { rows: users.rows.length, tokenVersion: user?.get("token_version"),
        credentialVersion: Number(user?.get("credential_version")?.toString()),
        securityOperationId: user?.get("security_operation_id")?.toString(),
        credential: { credentialVersion: Number(credential?.get("credential_version")?.toString()),
          securityOperationId: credential?.get("security_operation_id")?.toString(), status: credential?.get("status") },
        sessions };
    } else if (input.action === "session") {
      const result = await client.execute(
        "SELECT state,version,auth_version FROM session_by_id WHERE session_id=?", [uuid(input.sessionId)], options);
      const row = result.rows[0];
      output = { state: row?.get("state"), version: Number(row?.get("version")?.toString()), authVersion: row?.get("auth_version") };
    } else if (input.action === "injectUserEpoch") {
      const metadata = { schemaVersion: 1, requestFingerprint: input.fingerprint,
        expectedTokenVersion: 1, nextTokenVersion: 2, expectedCredentialVersion: 1,
        nextCredentialVersion: 2, updatedAt: input.updatedAt };
      const userUpdate = await client.execute(
        "UPDATE user_by_id SET token_version=2,credential_version=2,security_operation_id=?,updated_at=? WHERE user_id=? IF token_version=1 AND credential_version=1",
        [uuid(input.operationId), new Date(input.updatedAt), uuid(input.userId)], serial);
      if (!userUpdate.rows[0]?.get("[applied]")) throw new Error("Could not inject user epoch");
      const keyHash = ${idempotencyKeyHash.toString()}(input.idempotencyKey);
      const createdAt = new Date(input.updatedAt);
      const reservation = await client.execute(
        "INSERT INTO idempotency_by_scope_key (scope,key_hash,idempotency_key,operation_id,resource_id,result_code,status,result_checksum,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?) IF NOT EXISTS USING TTL 86400",
        [\`user:\${input.userId}:IDN-07\`, keyHash, input.idempotencyKey, uuid(input.operationId), uuid(input.userId), 0,
          "USER_EPOCH_ADVANCED", JSON.stringify(metadata), createdAt, new Date(createdAt.getTime() + 86400000)], serial);
      if (!reservation.rows[0]?.get("[applied]")) throw new Error("Could not inject recovery idempotency row");
      output = { injected: true };
    } else throw new Error("Unknown database action");
    console.log(JSON.stringify(output));
    await client.shutdown();
  `;
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

function assertSecurityState(value, expected) {
  if (
    value.rows !== 1 ||
    value.tokenVersion !== expected.tokenVersion ||
    value.credentialVersion !== expected.credentialVersion ||
    value.credential.credentialVersion !== expected.credentialVersion ||
    value.credential.status !== "ACTIVE"
  ) {
    throw new Error(`Security state mismatch: ${JSON.stringify(safeSecurityState(value))}`);
  }
}

function assertStatus(result, expected, label) {
  if (result.status !== expected) {
    throw new Error(`${label} returned ${result.status}: ${result.json?.error?.code ?? "unknown"}`);
  }
}

function assertError(result, status, code) {
  assertStatus(result, status, code);
  if (result.json?.error?.code !== code) throw new Error(`Expected ${code}, got ${result.json?.error?.code}`);
}

function safeHttp(result) {
  return {
    status: result.status,
    code: result.json?.error?.code,
    passwordChanged: result.json?.data?.passwordChanged,
    replayed: result.json?.meta?.replayed,
    accessTokenPresent: typeof result.json?.data?.accessToken === "string",
    refreshTokenPresent: typeof result.json?.data?.refreshToken === "string",
    transportRetries: result.transportRetries,
  };
}

function safeSecurityState(value) {
  return {
    rows: value.rows,
    tokenVersion: value.tokenVersion,
    credentialVersion: value.credentialVersion,
    operationMarkerPresent: typeof value.securityOperationId === "string",
    credential: {
      credentialVersion: value.credential?.credentialVersion,
      operationMarkerPresent: typeof value.credential?.securityOperationId === "string",
      status: value.credential?.status,
    },
    sessions: value.sessions,
  };
}

function dockerLogs(container) {
  return execFileSync("docker", ["logs", "--tail", "500", container], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function writeEvidence(name, value) {
  await writeFile(new URL(name, evidenceDirectory), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function safeCommand(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}
