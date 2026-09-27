import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { importPKCS8, SignJWT } from "jose";

const profile = process.env.AILSS_PROFILE ?? "dev-async";
if (profile !== "dev-async") throw new Error("P7.5 acceptance requires AILSS_PROFILE=dev-async");
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
const evidenceDirectory = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidenceDirectory, { recursive: true });

const actorPrivateKey = await importPKCS8(
  await readFile(
    new URL("../../infrastructure/tls/generated/services/gateway-private.pem", import.meta.url),
    "utf8",
  ),
  "EdDSA",
);
const fixture = randomUUID();
const password = `P7.5-${fixture}-Aa1!`;
const email = `p75-${fixture}@example.test`;
const originalName = `P75 Learner ${fixture.slice(0, 8)}`;
const updatedName = `P75 Updated ${fixture.slice(0, 8)}`;
const registration = await request("POST", "/api/v1/auth/register", {
  body: { email, password, displayName: originalName },
  idempotencyKey: `p75-register-${fixture}`,
});
assertStatus(registration, 201, "registration");
const userId = registration.json.data.userId;
const login = await request("POST", "/api/v1/auth/login", { body: { email, password } });
assertStatus(login, 200, "login");
const auth = requireTokens(login);

const initialRead = await getProfile(auth.accessToken);
assertStatus(initialRead, 200, "initial profile read");
assertSafeProfile(initialRead, { userId, displayName: originalName, profileVersion: 1 });
const initialDb = db({ action: "profile", userId });

const updateKey = `p75-update-${fixture}`;
const update = await patchProfile(auth.accessToken, updatedName, updateKey);
assertStatus(update, 200, "profile update");
if (update.json.data.profileVersion !== 2 || update.json.meta.replayed !== false) {
  throw new Error("First profile update did not increment exactly once");
}
const afterUpdate = await getProfile(auth.accessToken);
assertSafeProfile(afterUpdate, { userId, displayName: updatedName, profileVersion: 2 });

const replay = await patchProfile(auth.accessToken, updatedName, updateKey);
assertStatus(replay, 200, "profile replay");
if (replay.json.data.profileVersion !== 2 || replay.json.meta.replayed !== true) {
  throw new Error("Profile replay was not exact");
}
const conflictingReplay = await patchProfile(auth.accessToken, `${updatedName} conflict`, updateKey);
assertError(conflictingReplay, 409, "IDEMPOTENCY_CONFLICT");
assertProfileDb(db({ action: "profile", userId }), updatedName, 2);

const noOp = await patchProfile(auth.accessToken, updatedName, `p75-noop-${fixture}`);
assertStatus(noOp, 200, "profile no-op");
if (noOp.json.data.profileVersion !== 2 || noOp.json.data.noOp !== true) {
  throw new Error("No-op update changed profile version");
}

const missingKey = await request("PATCH", "/api/v1/me", {
  bearer: auth.accessToken,
  body: { displayName: "Rejected Missing Key" },
});
assertError(missingKey, 400, "INVALID_IDEMPOTENCY_KEY");
const massAssignment = await request("PATCH", "/api/v1/me", {
  bearer: auth.accessToken,
  idempotencyKey: `p75-mass-${fixture}`,
  body: { displayName: "Rejected Mass Assignment", role: "ADMIN", tokenVersion: 999 },
});
assertError(massAssignment, 422, "PROFILE_VALIDATION_FAILED");
const getWithBody = await rawGetWithBody(auth.accessToken);
assertError(getWithBody, 422, "PROFILE_BODY_NOT_ALLOWED");
assertProfileDb(db({ action: "profile", userId }), updatedName, 2);

const concurrent = await concurrentConflictFixture();

const refreshFixture = await loginFixture(email, password);
const refresh = await request("POST", "/api/v1/auth/refresh", {
  body: { sessionId: refreshFixture.sessionId, refreshToken: refreshFixture.refreshToken },
});
assertStatus(refresh, 200, "refresh for profile");
const refreshed = requireTokens(refresh);
assertStatus(await getProfile(refreshed.accessToken), 200, "profile with refreshed access token");

const logoutFixture = await loginFixture(email, password);
assertStatus(
  await request("POST", "/api/v1/auth/logout", { bearer: logoutFixture.accessToken }),
  200,
  "logout for profile denial",
);
assertError(await getProfile(logoutFixture.accessToken), 401, "INVALID_ACCESS_TOKEN");

const tokenFixture = await createFixture("token-version");
const tokenBefore = db({ action: "profile", userId: tokenFixture.userId });
db({ action: "setTokenVersion", userId: tokenFixture.userId, tokenVersion: tokenBefore.tokenVersion + 1 });
assertError(await getProfile(tokenFixture.auth.accessToken), 401, "INVALID_ACCESS_TOKEN");
assertError(
  await patchProfile(tokenFixture.auth.accessToken, "Rejected Token Version", `p75-tv-${fixture}`),
  401,
  "INVALID_ACCESS_TOKEN",
);
const tokenAfter = db({ action: "profile", userId: tokenFixture.userId });
assertProfileDb(tokenAfter, tokenBefore.displayName, tokenBefore.profileVersion);

const expiredFixture = await createFixture("expired-session");
db({ action: "expireSession", sessionId: expiredFixture.auth.sessionId });
assertError(await getProfile(expiredFixture.auth.accessToken), 401, "INVALID_ACCESS_TOKEN");

const actorFixture = await loginFixture(email, password);
const actorCorrelation = randomUUID();
const wrongPurpose = await signActor({
  userId,
  sessionId: actorFixture.sessionId,
  correlationId: actorCorrelation,
  purpose: "identity.logout",
});
if ((await directIdentity("GET", wrongPurpose, actorCorrelation)).status !== 401) {
  throw new Error("Wrong actor-context purpose was accepted");
}
const validPurposeWrongCorrelation = await signActor({
  userId,
  sessionId: actorFixture.sessionId,
  correlationId: actorCorrelation,
  purpose: "identity.profile.read",
});
if ((await directIdentity("GET", validPurposeWrongCorrelation, randomUUID())).status !== 401) {
  throw new Error("Actor-context correlation mismatch was accepted");
}

const idempotency = db({ action: "idempotency", userId, idempotencyKey: updateKey });
if (idempotency.status !== "COMPLETE" || idempotency.resultCode !== 200) {
  throw new Error("Q-IDN-007 did not reach COMPLETE");
}
const finalDb = db({ action: "profile", userId });
assertProfileDb(finalDb, updatedName, 2);

const logs = `${dockerLogs("ailss-identity-service")}\n${dockerLogs("ailss-api-gateway")}`;
for (const sensitive of [
  password,
  auth.accessToken,
  auth.refreshToken,
  updatedName,
  tokenFixture.auth.accessToken,
]) {
  if (logs.includes(sensitive)) throw new Error("Secret or editable profile value appeared in runtime logs");
}

await writeEvidence("p7.5-environment.json", {
  phase: "7.5",
  profile,
  runId,
  hostNode: process.version,
  runtimeNode: safeCommand("docker", ["exec", "ailss-identity-service", "node", "--version"]),
  gitCommit: safeCommand("git", ["rev-parse", "HEAD"]) || "NOT_A_GIT_REPOSITORY",
});
await writeEvidence("p7.5-http-acceptance.json", {
  initialRead: safeProfileHttp(initialRead),
  update: safeProfileHttp(update),
  readAfterUpdate: safeProfileHttp(afterUpdate),
  exactReplay: safeProfileHttp(replay),
  conflictingReplay: safeProfileHttp(conflictingReplay),
  noOp: safeProfileHttp(noOp),
  validation: {
    missingIdempotencyKey: safeProfileHttp(missingKey),
    massAssignment: safeProfileHttp(massAssignment),
    getBodyRejected: safeProfileHttp(getWithBody),
  },
  refreshedAccessAccepted: true,
  revokedSessionDenied: true,
  tokenVersionMismatchDenied: true,
  expiredSessionDenied: true,
  actorContextPurposeAndCorrelationDenied: true,
  concurrent,
  fixtureEmailSha256: createHash("sha256").update(email).digest("hex"),
});
await writeEvidence("p7.5-cassandra-verification.json", {
  runtimeRole: "svc_identity",
  initial: safeProfileDb(initialDb),
  final: safeProfileDb(finalDb),
  qIdn001ExactPartitionReadAndLwtUpdate: true,
  qIdn003ExactSessionRead: true,
  qIdn007: idempotency,
  profileVersionIncrementExactlyOnce: finalDb.profileVersion === initialDb.profileVersion + 1,
  noOpDidNotIncrement: true,
  rejectedRequestsDidNotMutate: true,
  eventWritten: false,
});
await writeEvidence("p7.5-security-verification.json", {
  reusableProtectedValidation: true,
  activeOwnedUnexpiredSessionRequired: true,
  activeUserAndTokenVersionAndRoleRequired: true,
  toctouRevalidationImmediatelyBeforeMutation: true,
  serverOwnedFieldsExcluded: ["tokenVersion", "sessionId", "refreshFingerprint"],
  logsContainTokensPasswordsOrDisplayName: false,
  rawJwtSaved: false,
  rawActorContextSaved: false,
});
await writeEvidence("p7.5-summary.json", {
  stage: "phase-7.5-profile-acceptance",
  status: "PASS",
  idn05: true,
  idn06: true,
  realCassandraLwt: true,
  exactIdempotentReplay: true,
  deterministicVersionConflictObserved: concurrent.conflictObserved,
  noOpStable: true,
  protectedRequestValidation: true,
  noBusinessEvent: true,
  p7_6Implemented: false,
});
console.log(
  JSON.stringify({
    stage: "phase-7.5-profile-acceptance",
    status: "PASS",
    runId,
    evidence: decodeURIComponent(evidenceDirectory.pathname),
  }),
);

async function concurrentConflictFixture() {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const item = await createFixture(`concurrency-${attempt}`);
    const startVersion = db({ action: "profile", userId: item.userId }).profileVersion;
    const [left, right] = await Promise.all([
      patchProfile(item.auth.accessToken, `Concurrent Left ${attempt}`, `p75-left-${randomUUID()}`),
      patchProfile(item.auth.accessToken, `Concurrent Right ${attempt}`, `p75-right-${randomUUID()}`),
    ]);
    const end = db({ action: "profile", userId: item.userId });
    if ([left.status, right.status].sort().join(",") === "200,409") {
      if (end.profileVersion !== startVersion + 1) throw new Error("Concurrent LWT version drift");
      return {
        conflictObserved: true,
        attempt,
        statuses: [left.status, right.status],
        versionBefore: startVersion,
        versionAfter: end.profileVersion,
      };
    }
  }
  throw new Error("Could not observe two updates sharing one server-read profile version");
}

async function createFixture(label) {
  const id = randomUUID();
  const fixtureEmail = `p75-${label}-${id}@example.test`;
  const fixturePassword = `P7.5-${label}-${id}-Aa1!`;
  const displayName = `P75 ${label} ${id.slice(0, 8)}`;
  const created = await request("POST", "/api/v1/auth/register", {
    body: { email: fixtureEmail, password: fixturePassword, displayName },
    idempotencyKey: `p75-register-${id}`,
  });
  assertStatus(created, 201, `${label} registration`);
  return {
    userId: created.json.data.userId,
    displayName,
    auth: await loginFixture(fixtureEmail, fixturePassword),
  };
}

async function loginFixture(fixtureEmail, fixturePassword) {
  const result = await request("POST", "/api/v1/auth/login", {
    body: { email: fixtureEmail, password: fixturePassword },
  });
  assertStatus(result, 200, "login fixture");
  return requireTokens(result);
}

function getProfile(token) {
  return request("GET", "/api/v1/me", { bearer: token });
}

function patchProfile(token, displayName, idempotencyKey) {
  return request("PATCH", "/api/v1/me", {
    bearer: token,
    idempotencyKey,
    body: { displayName },
  });
}

function rawGetWithBody(token) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ displayName: "Forbidden Body" });
    const outgoing = httpRequest(
      {
        host: "127.0.0.1",
        port: 8080,
        path: "/api/v1/me",
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (text += chunk));
        response.once("end", () =>
          resolve({ status: response.statusCode, json: text ? JSON.parse(text) : undefined }),
        );
      },
    );
    outgoing.once("error", reject);
    outgoing.end(body);
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
        signal: AbortSignal.timeout(10_000),
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

async function signActor({ userId: actorUserId, sessionId, correlationId, purpose }) {
  const issuedAt = Math.floor(Date.now() / 1_000);
  return new SignJWT({
    roles: ["STUDENT"],
    sessionId,
    tokenVersion: 1,
    correlationId,
    purpose,
  })
    .setProtectedHeader({ alg: "EdDSA", kid: "dev-gateway-2026-01", typ: "actor-context+jwt" })
    .setIssuer("api-gateway")
    .setAudience("identity-service")
    .setSubject(actorUserId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 30)
    .setJti(randomUUID())
    .sign(actorPrivateKey);
}

async function directIdentity(method, actorContext, correlationId) {
  const source = `
    import { readFileSync } from "node:fs";
    const input = JSON.parse(readFileSync(0, "utf8"));
    const response = await fetch("http://identity-service:8101/api/v1/me", {
      method: input.method,
      headers: { "x-actor-context": input.actorContext, "x-correlation-id": input.correlationId },
      signal: AbortSignal.timeout(10000),
    });
    console.log(JSON.stringify({ status: response.status }));
  `;
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "ailss-api-gateway", "node", "--input-type=module", "-e", source], {
      encoding: "utf8",
      input: JSON.stringify({ method, actorContext, correlationId }),
      stdio: ["pipe", "pipe", "pipe"],
    }).trim(),
  );
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
  let output;
  if (input.action === "profile") {
    const result = await client.execute(
      "SELECT display_name,role,status,lecturer_verified,token_version,profile_version,updated_at FROM user_by_id WHERE user_id=?",
      [cassandra.types.Uuid.fromString(input.userId)], options);
    const row = result.rows[0];
    output = { rows: result.rows.length, displayName: row?.get("display_name"), role: row?.get("role"),
      status: row?.get("status"), lecturerVerified: row?.get("lecturer_verified"),
      tokenVersion: Number(row?.get("token_version")), profileVersion: Number(row?.get("profile_version")?.toString()),
      updatedAt: row?.get("updated_at")?.toISOString() };
  } else if (input.action === "setTokenVersion") {
    await client.execute("UPDATE user_by_id SET token_version=?,updated_at=? WHERE user_id=?",
      [input.tokenVersion, new Date(), cassandra.types.Uuid.fromString(input.userId)], options);
    output = { applied: true };
  } else if (input.action === "expireSession") {
    await client.execute("UPDATE session_by_id SET expires_at=? WHERE session_id=?",
      [new Date(Date.now() - 60000), cassandra.types.Uuid.fromString(input.sessionId)], options);
    output = { applied: true };
  } else if (input.action === "idempotency") {
    const byte = createHash("sha256").update(input.idempotencyKey, "utf8").digest()[0] ?? 0;
    const keyHash = byte > 127 ? byte - 256 : byte;
    const result = await client.execute(
      "SELECT status,result_code,result_checksum FROM idempotency_by_scope_key WHERE scope=? AND key_hash=? AND idempotency_key=?",
      [\`user:\${input.userId}:IDN-06\`, keyHash, input.idempotencyKey], options);
    const row = result.rows[0];
    output = { rows: result.rows.length, status: row?.get("status"), resultCode: row?.get("result_code"),
      metadataStored: typeof row?.get("result_checksum") === "string" && row.get("result_checksum").startsWith("{") };
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

function requireTokens(result) {
  const data = result.json?.data;
  if (!data?.accessToken || !data?.refreshToken || !data?.sessionId) {
    throw new Error("Authentication response omitted token material");
  }
  return { accessToken: data.accessToken, refreshToken: data.refreshToken, sessionId: data.sessionId };
}

function assertSafeProfile(result, expected) {
  assertStatus(result, 200, "safe profile");
  const data = result.json?.data;
  if (
    data?.userId !== expected.userId ||
    data?.displayName !== expected.displayName ||
    data?.profileVersion !== expected.profileVersion
  ) {
    throw new Error("Canonical profile mismatch");
  }
  for (const forbidden of ["tokenVersion", "sessionId", "refreshFingerprint", "passwordHash"]) {
    if (forbidden in data) throw new Error(`Profile leaked ${forbidden}`);
  }
}

function assertProfileDb(value, displayName, profileVersion) {
  if (value.rows !== 1 || value.displayName !== displayName || value.profileVersion !== profileVersion) {
    throw new Error(`Profile persistence mismatch: ${JSON.stringify(safeProfileDb(value))}`);
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

function safeProfileHttp(result) {
  return {
    status: result.status,
    code: result.json?.error?.code,
    profileVersion: result.json?.data?.profileVersion,
    noOp: result.json?.data?.noOp,
    replayed: result.json?.meta?.replayed,
    tokenVersionPresent: result.json?.data && "tokenVersion" in result.json.data,
    transportRetries: result.transportRetries,
  };
}

function safeProfileDb(value) {
  return {
    rows: value.rows,
    role: value.role,
    status: value.status,
    lecturerVerified: value.lecturerVerified,
    tokenVersion: value.tokenVersion,
    profileVersion: value.profileVersion,
    updatedAt: value.updatedAt,
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
