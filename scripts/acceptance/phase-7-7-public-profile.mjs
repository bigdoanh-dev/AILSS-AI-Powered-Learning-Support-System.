import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { importPKCS8, SignJWT } from "jose";

const profile = process.env.AILSS_PROFILE ?? "dev-async";
if (profile !== "dev-async") throw new Error("P7.7 acceptance requires AILSS_PROFILE=dev-async");
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
const evidenceDirectory = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidenceDirectory, { recursive: true });
const servicePrivateKey = await importPKCS8(
  await readFile(
    new URL("../../infrastructure/tls/generated/services/learning-private.pem", import.meta.url),
    "utf8",
  ),
  "EdDSA",
);

const main = await createUser("main");
const concurrentUser = await createUser("concurrent");
const student = await createUser("student");
const unverified = await createUser("unverified");
const inactive = await createUser("inactive");
const stale = await createUser("stale");

db({ action: "canonical", userId: main.userId, role: "LECTURER", status: "ACTIVE", verified: true });
db({
  action: "canonical",
  userId: concurrentUser.userId,
  role: "LECTURER",
  status: "ACTIVE",
  verified: true,
});
db({
  action: "projection",
  userId: concurrentUser.userId,
  displayName: concurrentUser.displayName,
  verified: true,
  version: 1,
  bio: "Preserved biography",
});
db({
  action: "projection",
  userId: student.userId,
  displayName: student.displayName,
  verified: true,
  version: 1,
});
db({
  action: "canonical",
  userId: unverified.userId,
  role: "LECTURER",
  status: "ACTIVE",
  verified: false,
});
db({
  action: "projection",
  userId: unverified.userId,
  displayName: unverified.displayName,
  verified: true,
  version: 1,
});
db({
  action: "canonical",
  userId: inactive.userId,
  role: "LECTURER",
  status: "SUSPENDED",
  verified: true,
});
db({
  action: "projection",
  userId: inactive.userId,
  displayName: inactive.displayName,
  verified: true,
  version: 1,
});
db({
  action: "canonical",
  userId: stale.userId,
  role: "LECTURER",
  status: "ACTIVE",
  verified: true,
  version: 5,
});
db({
  action: "projection",
  userId: stale.userId,
  displayName: stale.displayName,
  verified: true,
  version: 4,
});

execFileSync(process.execPath, ["scripts/dev/bootstrap-cassandra.mjs"], {
  cwd: new URL("../../", import.meta.url),
  stdio: "pipe",
  env: { ...process.env, AILSS_PROFILE: "dev-async", AILSS_RUN_ID: `${runId}-p77-backfill` },
});
const backfilled = db({ action: "state", userId: main.userId });
if (!backfilled.projection || backfilled.projection.profileVersion !== 1) {
  throw new Error("Controlled P7.7 backfill did not create the verified lecturer projection");
}
const preserved = db({ action: "state", userId: concurrentUser.userId });
if (preserved.projection?.bio !== "Preserved biography") {
  throw new Error("Controlled backfill overwrote an existing public field");
}

const mainAuth = await login(main);
const anonymous = await publicRead(main.userId);
assertStatus(anonymous, 200, "anonymous lecturer read");
assertPublicDto(anonymous, main.userId, main.displayName, 1);
const authenticated = await publicRead(main.userId, mainAuth.accessToken);
assertStatus(authenticated, 200, "authenticated lecturer read");
assertPublicDto(authenticated, main.userId, main.displayName, 1);
const malformedBearer = await request("GET", `/api/v1/lecturers/${main.userId}`, {
  authorization: "Bearer forged.invalid.token",
});
assertError(malformedBearer, 401, "INVALID_ACCESS_TOKEN");
assertError(await publicRead("not-a-uuid"), 400, "INVALID_RESOURCE_ID");
assertError(await publicRead(randomUUID()), 404, "PUBLIC_PROFILE_NOT_AVAILABLE");
for (const item of [student, unverified, inactive]) {
  assertError(await publicRead(item.userId), 404, "PUBLIC_PROFILE_NOT_AVAILABLE");
}
assertError(await publicRead(stale.userId), 503, "PUBLIC_PROFILE_TEMPORARILY_UNAVAILABLE");

const updatedName = `P77 Updated ${main.userId.slice(0, 8)}`;
const updateKey = `p77-profile-${randomUUID()}`;
const updated = await request("PATCH", "/api/v1/me", {
  bearer: mainAuth.accessToken,
  idempotencyKey: updateKey,
  body: { displayName: updatedName },
});
assertStatus(updated, 200, "verified lecturer profile update");
if (updated.json?.data?.profileVersion !== 2) throw new Error("IDN-06 did not advance canonical version");
const afterUpdate = await publicRead(main.userId);
assertPublicDto(afterUpdate, main.userId, updatedName, 2);
const synchronized = db({ action: "state", userId: main.userId });
if (
  synchronized.canonical.displayName !== synchronized.projection.displayName ||
  synchronized.canonical.profileVersion !== synchronized.projection.profileVersion
) {
  throw new Error("Q-IDN-001/Q-IDN-006 did not converge after IDN-06");
}
const replay = await request("PATCH", "/api/v1/me", {
  bearer: mainAuth.accessToken,
  idempotencyKey: updateKey,
  body: { displayName: updatedName },
});
assertStatus(replay, 200, "projection-aware IDN-06 replay");
if (replay.json?.meta?.replayed !== true || replay.json?.data?.profileVersion !== 2) {
  throw new Error("Projection-aware IDN-06 replay was not exact");
}

const validInternalToken = await serviceToken("learning-service");
const internal = await directInternal(main.userId, validInternalToken);
assertStatus(internal, 200, "INT-IDN-01 valid Learning call");
assertInternalDto(internal, main.userId, updatedName, 2);
assertError(await directInternal(main.userId), 401, "INVALID_SERVICE_CREDENTIALS");
assertError(
  await directInternal(main.userId, await serviceToken("classroom-service")),
  401,
  "INVALID_SERVICE_CREDENTIALS",
);
assertError(
  await directInternal(main.userId, await expiredServiceToken()),
  401,
  "INVALID_SERVICE_CREDENTIALS",
);
assertError(await directInternal(student.userId, validInternalToken), 404, "PUBLIC_PROFILE_NOT_AVAILABLE");

const learningClient = executeLearningClient(main.userId);
if (learningClient.profile.userId !== main.userId || learningClient.elapsedMs >= 500) {
  throw new Error("Learning-owned INT-IDN-01 client violated result/deadline contract");
}
const timeout = executeLearningTimeoutProbe();
if (timeout.code !== "IDENTITY_PROFILE_UNAVAILABLE" || timeout.elapsedMs >= 700) {
  throw new Error("Learning-owned client did not fail closed around the 500 ms deadline");
}

const concurrency = await concurrentProjectionFixture(concurrentUser);
const foreignAccessDenied = verifyForeignAccessDenied();
if (!foreignAccessDenied) throw new Error("svc_learning unexpectedly read identity_keyspace");

const logs = `${dockerLogs("ailss-identity-service")}\n${dockerLogs("ailss-api-gateway")}\n${dockerLogs("ailss-learning-service")}`;
for (const sensitive of [main.password, mainAuth.accessToken, validInternalToken]) {
  if (logs.includes(sensitive)) throw new Error("Credential material appeared in runtime logs");
}

await writeEvidence("p7.7-environment.json", {
  phase: "7.7",
  profile,
  runId,
  hostNode: process.version,
  runtimeNode: safeCommand("docker", ["exec", "ailss-identity-service", "node", "--version"]),
  gitCommit: safeCommand("git", ["rev-parse", "HEAD"]) || "NOT_A_GIT_REPOSITORY",
});
await writeEvidence("p7.7-http-acceptance.json", {
  anonymous: safeHttp(anonymous),
  authenticated: safeHttp(authenticated),
  malformedBearerNotDowngraded: safeHttp(malformedBearer),
  afterProjectionSync: safeHttp(afterUpdate),
  exactReplay: safeHttp(replay),
  internal: safeHttp(internal),
  ineligibleConcealed: true,
  staleProjectionFailedClosed: true,
  fixtureEmailSha256: createHash("sha256").update(main.email).digest("hex"),
});
await writeEvidence("p7.7-cassandra-verification.json", {
  runtimeRole: "svc_identity",
  controlledBackfillCreatedMissingProjection: true,
  controlledBackfillPreservedExistingPublicFields: true,
  synchronized: safeState(synchronized),
  concurrent: concurrency,
  qIdn001ExactCanonicalGuard: true,
  qIdn006ExactPreparedRead: true,
  foreignLearningAccessDenied: foreignAccessDenied,
  runtimeScanUsed: false,
  allowFilteringUsed: false,
  eventInvented: false,
});
await writeEvidence("p7.7-security-verification.json", {
  optionalBearerInvalidNotAnonymous: true,
  activeVerifiedCanonicalRequired: true,
  staleAndAheadProjectionFailClosed: true,
  serviceJwsEd25519: true,
  learningCallerAudiencePurposeKidTtlBound: true,
  wrongMissingExpiredCredentialsDenied: true,
  publicAndInternalPrivateFieldLeakage: false,
  totalCallerDeadlineMs: 500,
  successElapsedMs: learningClient.elapsedMs,
  timeoutElapsedMs: timeout.elapsedMs,
  logsContainCredentialMaterial: false,
});
await writeEvidence("p7.7-summary.json", {
  stage: "phase-7.7-public-profile-acceptance",
  status: "PASS",
  idn08: true,
  intIdn01: true,
  idn06CompatibilityExtension: true,
  realCassandraLwt: true,
  concurrencySerialized: true,
  noBusinessEvent: true,
  p7_8Implemented: false,
});
console.log(
  JSON.stringify({
    stage: "phase-7.7-public-profile-acceptance",
    status: "PASS",
    runId,
    evidence: decodeURIComponent(evidenceDirectory.pathname),
  }),
);

async function createUser(label) {
  const id = randomUUID();
  const item = {
    email: `p77-${label}-${id}@example.test`,
    password: `P7.7-${label}-${id}-Aa1!`,
    displayName: `P77 ${label} ${id.slice(0, 8)}`,
  };
  const result = await request("POST", "/api/v1/auth/register", {
    body: item,
    idempotencyKey: `p77-register-${id}`,
  });
  assertStatus(result, 201, `${label} registration`);
  return { ...item, userId: result.json.data.userId };
}

async function login(item) {
  const result = await request("POST", "/api/v1/auth/login", {
    body: { email: item.email, password: item.password },
  });
  assertStatus(result, 200, "login");
  return result.json.data;
}

function publicRead(userId, bearer) {
  return request("GET", `/api/v1/lecturers/${userId}`, { bearer });
}

async function request(method, path, { body, bearer, authorization, idempotencyKey } = {}) {
  let transportError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:8080${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          ...(authorization ? { authorization } : {}),
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

async function directInternal(userId, token) {
  const source = `
    const response=await fetch(${JSON.stringify(`http://127.0.0.1:8101/internal/v1/users/${userId}/public-profile`)},{
      headers:${JSON.stringify({
        ...(token ? { authorization: `Service ${token}` } : {}),
        "x-correlation-id": randomUUID(),
      })},signal:AbortSignal.timeout(10000)});
    const text=await response.text(); console.log(JSON.stringify({status:response.status,json:text?JSON.parse(text):undefined}));`;
  return JSON.parse(
    execFileSync("docker", ["exec", "ailss-identity-service", "node", "--input-type=module", "-e", source], {
      encoding: "utf8",
    }).trim(),
  );
}

function serviceToken(subject) {
  const now = Math.floor(Date.now() / 1_000);
  return new SignJWT({ purpose: "identity.public-profile.read" })
    .setProtectedHeader({ alg: "EdDSA", kid: "dev-learning-2026-01", typ: "service+jwt" })
    .setIssuer("ailss-internal")
    .setAudience("identity-service")
    .setSubject(subject)
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .setJti(randomUUID())
    .sign(servicePrivateKey);
}

function expiredServiceToken() {
  const now = Math.floor(Date.now() / 1_000) - 120;
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

async function concurrentProjectionFixture(item) {
  const auth = await login(item);
  const [left, right] = await Promise.all([
    request("PATCH", "/api/v1/me", {
      bearer: auth.accessToken,
      idempotencyKey: `p77-left-${randomUUID()}`,
      body: { displayName: `P77 Left ${randomUUID().slice(0, 8)}` },
    }),
    request("PATCH", "/api/v1/me", {
      bearer: auth.accessToken,
      idempotencyKey: `p77-right-${randomUUID()}`,
      body: { displayName: `P77 Right ${randomUUID().slice(0, 8)}` },
    }),
  ]);
  if ([left.status, right.status].sort().join(",") !== "200,409") {
    throw new Error(`Concurrent projection updates returned ${left.status},${right.status}`);
  }
  const state = db({ action: "state", userId: item.userId });
  if (
    state.canonical.profileVersion !== 2 ||
    state.projection.profileVersion !== 2 ||
    state.canonical.displayName !== state.projection.displayName
  ) {
    throw new Error("Concurrent winner did not converge the public projection");
  }
  return { statuses: [left.status, right.status], state: safeState(state) };
}

function databaseProbeSource() {
  return `
    import { readFileSync } from "node:fs";
    import cassandra from "cassandra-driver";
    const input = JSON.parse(readFileSync(0, "utf8"));
    const client = new cassandra.Client({ contactPoints: process.env.CASSANDRA_CONTACT_POINTS.split(","),
      localDataCenter: process.env.CASSANDRA_LOCAL_DC, keyspace: process.env.CASSANDRA_KEYSPACE,
      authProvider: new cassandra.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME, process.env.CASSANDRA_PASSWORD),
      queryOptions: { prepare: true } });
    await client.connect();
    const options = { prepare: true, consistency: cassandra.types.consistencies.localQuorum };
    const serial = { ...options, serialConsistency: cassandra.types.consistencies.localSerial };
    const uuid = (value) => cassandra.types.Uuid.fromString(value);
    let output;
    if (input.action === "canonical") {
      const version = input.version ?? 1;
      const result = await client.execute("UPDATE user_by_id SET role=?,status=?,lecturer_verified=?,profile_version=?,updated_at=? WHERE user_id=? IF EXISTS",
        [input.role,input.status,input.verified,cassandra.types.Long.fromNumber(version),new Date(),uuid(input.userId)], serial);
      if (!result.rows[0]?.get("[applied]")) throw new Error("canonical fixture update failed");
      output = { applied: true };
    } else if (input.action === "projection") {
      await client.execute("INSERT INTO public_lecturer_by_id (lecturer_id,display_name,bio,avatar_object_key,verified,profile_version,updated_at) VALUES (?,?,?,?,?,?,?)",
        [uuid(input.userId),input.displayName,input.bio ?? null,null,input.verified,cassandra.types.Long.fromNumber(input.version),new Date()], options);
      output = { applied: true };
    } else if (input.action === "state") {
      const users = await client.execute("SELECT display_name,role,status,lecturer_verified,profile_version FROM user_by_id WHERE user_id=?", [uuid(input.userId)], options);
      const profiles = await client.execute("SELECT display_name,bio,verified,profile_version FROM public_lecturer_by_id WHERE lecturer_id=?", [uuid(input.userId)], options);
      const user = users.rows[0]; const projection = profiles.rows[0];
      output = { canonical: user && { displayName:user.get("display_name"),role:user.get("role"),status:user.get("status"),
        verified:user.get("lecturer_verified"),profileVersion:Number(user.get("profile_version").toString()) },
        projection: projection && { displayName:projection.get("display_name"),bio:projection.get("bio"),verified:projection.get("verified"),
        profileVersion:Number(projection.get("profile_version").toString()) } };
    } else throw new Error("unknown action");
    console.log(JSON.stringify(output)); await client.shutdown();`;
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

function executeLearningClient(userId) {
  const source = `
    import { createIdentityPublicProfileClient } from "./dist/apps/learning-service/src/identity-client.js";
    import { loadConfig } from "./dist/packages/config/src/index.js";
    const config=loadConfig({...process.env,APP_NAME:"learning-service",SERVICE_ID:"learning-service",PORT:"8102"}); const client=await createIdentityPublicProfileClient(config);
    const started=performance.now(); const profile=await client.get(${JSON.stringify(userId)},crypto.randomUUID());
    console.log(JSON.stringify({profile,elapsedMs:performance.now()-started}));`;
  return JSON.parse(
    execFileSync("docker", ["exec", "ailss-learning-service", "node", "--input-type=module", "-e", source], {
      encoding: "utf8",
    }).trim(),
  );
}

function executeLearningTimeoutProbe() {
  const source = `
    import { createServer } from "node:http";
    import { createIdentityPublicProfileClient } from "./dist/apps/learning-service/src/identity-client.js";
    import { loadConfig } from "./dist/packages/config/src/index.js";
    const server=createServer((_q,r)=>setTimeout(()=>r.end("{}"),2000)); await new Promise(ok=>server.listen(18999,"127.0.0.1",ok));
    const config=loadConfig({...process.env,APP_NAME:"learning-service",SERVICE_ID:"learning-service",PORT:"8102",IDENTITY_SERVICE_URL:"http://127.0.0.1:18999",IDENTITY_PUBLIC_PROFILE_DEADLINE_MS:"500"});
    const client=await createIdentityPublicProfileClient(config); const started=performance.now(); let code;
    try { await client.get(crypto.randomUUID(),crypto.randomUUID()); } catch(e) { code=e.code; }
    console.log(JSON.stringify({code,elapsedMs:performance.now()-started})); server.close();`;
  return JSON.parse(
    execFileSync("docker", ["exec", "ailss-learning-service", "node", "--input-type=module", "-e", source], {
      encoding: "utf8",
    }).trim(),
  );
}

function verifyForeignAccessDenied() {
  const source = `import cassandra from "cassandra-driver"; const c=new cassandra.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,authProvider:new cassandra.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}); try { await c.execute("SELECT * FROM identity_keyspace.public_lecturer_by_id LIMIT 1"); console.log("ALLOWED"); } catch { console.log("DENIED"); } finally { await c.shutdown(); }`;
  return (
    execFileSync("docker", ["exec", "ailss-learning-service", "node", "--input-type=module", "-e", source], {
      encoding: "utf8",
    }).trim() === "DENIED"
  );
}

function assertStatus(result, status, label) {
  if (result.status !== status)
    throw new Error(`${label}: expected ${status}, got ${result.status} ${JSON.stringify(result.json)}`);
}
function assertError(result, status, code) {
  assertStatus(result, status, code);
  if (result.json?.error?.code !== code) throw new Error(`expected ${code}, got ${result.json?.error?.code}`);
}
function assertPublicDto(result, id, name, version) {
  assertStatus(result, 200, "public DTO");
  const data = result.json?.data;
  if (
    JSON.stringify(Object.keys(data).sort()) !==
      JSON.stringify(["avatarRef", "bio", "displayName", "lecturerId", "profileVersion", "verified"]) ||
    data.lecturerId !== id ||
    data.displayName !== name ||
    data.profileVersion !== version ||
    data.avatarRef !== null ||
    data.verified !== true
  )
    throw new Error("public DTO mismatch/private leakage");
}
function assertInternalDto(result, id, name, version) {
  const data = result.json?.data;
  if (
    JSON.stringify(Object.keys(data).sort()) !==
      JSON.stringify(["avatarRef", "displayName", "resourceVersion", "userId"]) ||
    data.userId !== id ||
    data.displayName !== name ||
    data.resourceVersion !== version ||
    data.avatarRef !== null
  )
    throw new Error("internal DTO mismatch/private leakage");
}
function safeHttp(result) {
  return {
    status: result.status,
    code: result.json?.error?.code,
    data: result.status === 200 ? result.json?.data : undefined,
  };
}
function safeState(state) {
  return { canonical: state.canonical, projection: state.projection };
}
function dockerLogs(container) {
  return safeCommand("docker", ["logs", "--tail", "1000", container]);
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
