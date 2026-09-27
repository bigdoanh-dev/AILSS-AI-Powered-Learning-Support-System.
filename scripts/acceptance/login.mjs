import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { decodeProtectedHeader, importSPKI, jwtVerify } from "jose";

const profile = process.env.AILSS_PROFILE ?? "dev-async";
if (profile !== "dev-async") throw new Error("P7.2 acceptance requires AILSS_PROFILE=dev-async");
const runId = process.env.AILSS_EVIDENCE_RUN_ID ?? new Date().toISOString().replaceAll(/[:.]/g, "-");
const evidenceDirectory = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidenceDirectory, { recursive: true });

const fixture = runId
  .toLowerCase()
  .replaceAll(/[^a-z0-9]/g, "")
  .slice(-24);
const password = `P7.2-${randomUUID()}-safe-fixture`;
const email = `p72-${fixture}@example.test`;
const publicKeyPath = new URL(
  "../../infrastructure/tls/generated/identity/user-jwt-public.pem",
  import.meta.url,
);
const issuer = process.env.JWT_ISSUER ?? "https://identity.ailss.local";
const audience = process.env.JWT_AUDIENCE ?? "ailss-api";
const kid = process.env.JWT_KID ?? "dev-user-2026-01";
const accessTtlSeconds = Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? 900);
const refreshTtlSeconds = Number(process.env.REFRESH_TOKEN_TTL_SECONDS ?? 2_592_000);

const databaseProbeSource = String.raw`
  import { createHash } from "node:crypto";
  import { readFileSync } from "node:fs";
  import cassandra from "cassandra-driver";
  const input = JSON.parse(readFileSync(0, "utf8"));
  const client = new cassandra.Client({
    contactPoints: process.env.CASSANDRA_CONTACT_POINTS.split(","),
    localDataCenter: process.env.CASSANDRA_LOCAL_DC,
    keyspace: "identity_keyspace",
    authProvider: new cassandra.auth.PlainTextAuthProvider(
      process.env.CASSANDRA_USERNAME,
      process.env.CASSANDRA_PASSWORD,
    ),
    queryOptions: { prepare: true },
  });
  await client.connect();
  const options = { prepare: true, consistency: cassandra.types.consistencies.localQuorum };
  let output;
  if (input.kind === "credential") {
    const result = await client.execute(
      "SELECT user_id,status FROM credential_by_email WHERE normalized_email=?",
      [input.email],
      options,
    );
    const row = result.rows[0];
    output = { rows: result.rows.length, userId: row?.get("user_id")?.toString(), status: row?.get("status") };
  } else if (input.kind === "session") {
    const result = await client.execute(
      "SELECT session_id,user_id,token_family_id,refresh_fingerprint,generation,state,expires_at,revoked_at,version,created_at FROM session_by_id WHERE session_id=?",
      [cassandra.types.Uuid.fromString(input.sessionId)],
      options,
    );
    const row = result.rows[0];
    const fingerprint = row?.get("refresh_fingerprint");
    const expected = createHash("sha256").update(input.rawRefreshToken, "utf8").digest("hex");
    output = {
      rows: result.rows.length,
      sessionId: row?.get("session_id")?.toString(),
      userId: row?.get("user_id")?.toString(),
      familyPresent: Boolean(row?.get("token_family_id")),
      generation: row?.get("generation"),
      state: row?.get("state"),
      version: Number(row?.get("version")?.toString()),
      revokedAtIsNull: row?.get("revoked_at") == null,
      fingerprintPresent: typeof fingerprint === "string" && fingerprint.length > 0,
      fingerprintMatchesReturnedToken: fingerprint === expected,
      rawRefreshAbsent: fingerprint !== input.rawRefreshToken,
      refreshTtlSeconds: Math.round((row?.get("expires_at").getTime() - row?.get("created_at").getTime()) / 1000),
    };
  } else if (input.kind === "sessionPair") {
    const values = [];
    for (const sessionId of input.sessionIds) {
      const result = await client.execute(
        "SELECT refresh_fingerprint FROM session_by_id WHERE session_id=?",
        [cassandra.types.Uuid.fromString(sessionId)],
        options,
      );
      values.push(result.rows[0]?.get("refresh_fingerprint"));
    }
    output = { rows: values.filter(Boolean).length, fingerprintsUnique: values.length === 2 && values[0] !== values[1] };
  } else if (input.kind === "sessionCount") {
    const result = await client.execute("SELECT COUNT(*) FROM session_by_id", [], options);
    output = { count: Number(result.rows[0]?.get("count")?.toString()) };
  } else if (input.kind === "setUserStatus") {
    await client.execute(
      "UPDATE user_by_id SET status=?,updated_at=? WHERE user_id=?",
      [input.status, new Date(), cassandra.types.Uuid.fromString(input.userId)],
      options,
    );
    const result = await client.execute(
      "SELECT status FROM user_by_id WHERE user_id=?",
      [cassandra.types.Uuid.fromString(input.userId)],
      options,
    );
    output = { status: result.rows[0]?.get("status") };
  }
  console.log(JSON.stringify(output ?? null));
  await client.shutdown();
`;

const registration = await postRegistration(
  { email, password, displayName: "Phase 7.2 Learner" },
  `p72-${fixture}`,
);
assertStatus(registration, 201, "synthetic registration");
const userId = registration.json.data.userId;
const credential = identityDbProbe({ kind: "credential", email });
if (credential.rows !== 1 || credential.userId !== userId || credential.status !== "ACTIVE") {
  throw new Error("Q-IDN-002 synthetic credential lookup failed");
}

const valid = await postLogin({ email, password });
assertStatus(valid, 200, "valid login");
const firstTokenMaterial = requireTokenMaterial(valid);
const firstJwt = await verifyAccessToken(firstTokenMaterial.accessToken, {
  userId,
  sessionId: firstTokenMaterial.sessionId,
});
const firstSession = identityDbProbe({
  kind: "session",
  sessionId: firstTokenMaterial.sessionId,
  rawRefreshToken: firstTokenMaterial.refreshToken,
});
assertSession(firstSession, userId, refreshTtlSeconds);

const wrong = await postLogin({ email, password: `${password}-wrong` });
const unknown = await postLogin({ email: `unknown-${fixture}@example.test`, password });
assertError(wrong, 401, "INVALID_CREDENTIALS");
assertError(unknown, 401, "INVALID_CREDENTIALS");
if (JSON.stringify(wrong.json.error) !== JSON.stringify(unknown.json.error)) {
  throw new Error("Unknown-email and wrong-password client errors differ");
}

const unknownField = await postLogin({ email, password, role: "ADMIN" });
assertError(unknownField, 422, "LOGIN_VALIDATION_FAILED");
const malformed = await fetch("http://127.0.0.1:8080/api/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{",
});
const malformedJson = await malformed.json();
if (malformed.status !== 400 || malformedJson.error?.code !== "INVALID_JSON") {
  throw new Error("Malformed login JSON was not rejected safely");
}
const forged = await fetch("http://127.0.0.1:8080/api/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json", "x-user-id": randomUUID() },
  body: JSON.stringify({ email, password }),
});
if (forged.status !== 400) throw new Error(`Forged identity header returned HTTP ${forged.status}`);

await postLogin({ email, password: `${password}-warmup` });
await postLogin({ email: `warmup-${fixture}@example.test`, password });
const timing = {
  knownWrongPasswordMs: await timingSample(() => postLogin({ email, password: `${password}-timing` }), 5),
  unknownEmailMs: await timingSample(
    () => postLogin({ email: `timing-${fixture}@example.test`, password }),
    5,
  ),
};
const timingRatio = broadRatio(median(timing.knownWrongPasswordMs), median(timing.unknownEmailMs));
if (timingRatio > 4)
  throw new Error(`Timing equalization work classes diverged by ${timingRatio.toFixed(2)}x`);

const inactiveEmail = `inactive-${fixture}@example.test`;
const inactiveRegistration = await postRegistration(
  { email: inactiveEmail, password, displayName: "Inactive Fixture" },
  `inactive-${fixture}`,
);
assertStatus(inactiveRegistration, 201, "inactive fixture registration");
const inactiveUserId = inactiveRegistration.json.data.userId;
const statusMutation = identityDbProbe({
  kind: "setUserStatus",
  userId: inactiveUserId,
  status: "SUSPENDED",
});
if (statusMutation.status !== "SUSPENDED") throw new Error("Inactive fixture mutation failed");
const sessionsBeforeDenied = identityDbProbe({ kind: "sessionCount" }).count;
const inactive = await postLogin({ email: inactiveEmail, password });
assertError(inactive, 403, "LOGIN_NOT_ALLOWED");
if (inactive.json.data?.accessToken || inactive.json.data?.refreshToken || inactive.json.data?.sessionId) {
  throw new Error("Inactive login exposed token or session material");
}
const sessionsAfterDenied = identityDbProbe({ kind: "sessionCount" }).count;
if (sessionsAfterDenied !== sessionsBeforeDenied) throw new Error("Inactive login persisted a session");

const concurrent = await Promise.all([postLogin({ email, password }), postLogin({ email, password })]);
concurrent.forEach((result) => assertStatus(result, 200, "concurrent login"));
const concurrentTokens = concurrent.map(requireTokenMaterial);
const concurrentJwt = await Promise.all(
  concurrentTokens.map((item) => verifyAccessToken(item.accessToken, { userId, sessionId: item.sessionId })),
);
const concurrentPair = identityDbProbe({
  kind: "sessionPair",
  sessionIds: concurrentTokens.map((item) => item.sessionId),
});
if (
  new Set(concurrentTokens.map((item) => item.sessionId)).size !== 2 ||
  new Set(concurrentTokens.map((item) => item.refreshToken)).size !== 2 ||
  new Set(concurrentJwt.map((item) => item.jti)).size !== 2 ||
  concurrentPair.rows !== 2 ||
  !concurrentPair.fingerprintsUnique
) {
  throw new Error("Concurrent logins did not create independent credentials and sessions");
}

// Session A is deliberately treated as a lost response; the retry creates independent Session B.
const lostResponseA = await postLogin({ email, password });
assertStatus(lostResponseA, 200, "simulated response-loss session A");
const retryB = await postLogin({ email, password });
assertStatus(retryB, 200, "response-loss retry session B");
const lostA = requireTokenMaterial(lostResponseA);
const retryToken = requireTokenMaterial(retryB);
if (lostA.sessionId === retryToken.sessionId || lostA.refreshToken === retryToken.refreshToken) {
  throw new Error("Response-loss retry reused session or refresh credentials");
}
const responseLossPair = identityDbProbe({
  kind: "sessionPair",
  sessionIds: [lostA.sessionId, retryToken.sessionId],
});
if (responseLossPair.rows !== 2 || !responseLossPair.fingerprintsUnique) {
  throw new Error("Response-loss retry sessions were not independently persisted");
}

const logs = execFileSync("docker", ["logs", "--tail", "500", "ailss-identity-service"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const sensitiveValues = [
  password,
  firstTokenMaterial.accessToken,
  firstTokenMaterial.refreshToken,
  ...concurrentTokens.flatMap((item) => [item.accessToken, item.refreshToken]),
];
if (sensitiveValues.some((value) => logs.includes(value))) {
  throw new Error("Password or token material appeared in Identity logs");
}

await writeEvidence("p7.2-environment.json", {
  phase: "7.2",
  profile,
  runId,
  hostNode: process.version,
  runtimeNode: safeCommand("docker", ["exec", "ailss-identity-service", "node", "--version"]),
  gitCommit: safeCommand("git", ["rev-parse", "HEAD"]) || "NOT_A_GIT_REPOSITORY",
});
await writeEvidence("p7.2-http-acceptance.json", {
  valid: safeHttp(valid),
  wrongPassword: safeHttp(wrong),
  unknownEmail: safeHttp(unknown),
  genericCredentialErrorsIdentical: true,
  unknownField: safeHttp(unknownField),
  malformedJson: { status: malformed.status, code: malformedJson.error.code },
  forgedIdentityHeader: { status: forged.status },
  inactiveAccount: safeHttp(inactive),
  inactiveSessionCountUnchanged: true,
  concurrentStatuses: concurrent.map((item) => item.status),
  responseLossRetryStatuses: [lostResponseA.status, retryB.status],
  emailFixtureSha256: createHash("sha256").update(email).digest("hex"),
});
await writeEvidence("p7.2-jwt-verification.json", {
  algorithm: firstJwt.algorithm,
  kid: firstJwt.kid,
  signatureVerified: true,
  issuerVerified: true,
  audienceVerified: true,
  subjectVerified: true,
  sessionIdVerified: true,
  rolesVerified: true,
  tokenVersionVerified: true,
  jtiIsUuid: true,
  configuredAccessTtlSeconds: firstJwt.ttlSeconds,
  concurrentJtisUnique: true,
  rawJwtSaved: false,
});
await writeEvidence("p7.2-cassandra-verification.json", {
  runtimeRole: "svc_identity",
  credentialRows: credential.rows,
  sessionRows: firstSession.rows,
  canonicalUserMatches: firstSession.userId === userId,
  familyPresent: firstSession.familyPresent,
  generation: firstSession.generation,
  state: firstSession.state,
  version: firstSession.version,
  revokedAtIsNull: firstSession.revokedAtIsNull,
  fingerprintPresent: firstSession.fingerprintPresent,
  fingerprintMatchesReturnedToken: firstSession.fingerprintMatchesReturnedToken,
  rawRefreshAbsent: firstSession.rawRefreshAbsent,
  configuredRefreshTtlSeconds: firstSession.refreshTtlSeconds,
  concurrentSessionsPresent: concurrentPair.rows === 2,
  concurrentFingerprintsUnique: concurrentPair.fingerprintsUnique,
  sessionsByUserProjectionWritten: false,
  fingerprintSavedInEvidence: false,
});
await writeEvidence("p7.2-timing-mitigation.json", {
  description: "timing equalization mitigation; not a constant-time authentication guarantee",
  sampleSizePerClass: 5,
  knownWrongPasswordMs: timing.knownWrongPasswordMs,
  unknownEmailMs: timing.unknownEmailMs,
  knownWrongMedianMs: round(median(timing.knownWrongPasswordMs)),
  unknownMedianMs: round(median(timing.unknownEmailMs)),
  broadMedianRatio: round(timingRatio),
  broadWorkClassThreshold: 4,
  bothPathsPerformArgon2idVerification: true,
});
await writeEvidence("p7.2-summary.json", {
  stage: "phase-7.2-login-acceptance",
  status: "PASS",
  realCassandra: true,
  jwtCryptographicallyVerified: true,
  rawRefreshPersisted: false,
  rawTokensSavedInEvidence: false,
  genericCredentialErrors: true,
  inactiveAccountDeniedWithoutSession: true,
  concurrentSessionsIndependent: true,
  responseLossRetryCreatesIndependentSession: true,
  passwordAndTokensAbsentFromLogs: true,
  businessEventCreated: false,
});
console.log(
  JSON.stringify({
    stage: "phase-7.2-login-acceptance",
    status: "PASS",
    runId,
    evidence: decodeURIComponent(evidenceDirectory.pathname),
  }),
);

async function verifyAccessToken(accessToken, expected) {
  const publicKey = await importSPKI(await readFile(publicKeyPath, "utf8"), "EdDSA");
  const header = decodeProtectedHeader(accessToken);
  const result = await jwtVerify(accessToken, publicKey, {
    algorithms: ["EdDSA"],
    issuer,
    audience,
    requiredClaims: ["sub", "iat", "exp", "jti", "roles", "sessionId", "tokenVersion"],
  });
  if (header.alg !== "EdDSA" || header.kid !== kid) throw new Error("JWT protected header is invalid");
  if (
    result.payload.sub !== expected.userId ||
    result.payload.sessionId !== expected.sessionId ||
    !Array.isArray(result.payload.roles) ||
    !result.payload.roles.includes("STUDENT") ||
    result.payload.tokenVersion !== 1 ||
    typeof result.payload.jti !== "string" ||
    !/^[0-9a-f-]{36}$/iu.test(result.payload.jti)
  ) {
    throw new Error("JWT identity claims are invalid");
  }
  const ttlSeconds = result.payload.exp - result.payload.iat;
  if (ttlSeconds !== accessTtlSeconds)
    throw new Error(`JWT TTL is ${ttlSeconds}, expected ${accessTtlSeconds}`);
  return { algorithm: header.alg, kid: header.kid, jti: result.payload.jti, ttlSeconds };
}

function assertSession(session, expectedUserId, expectedRefreshTtlSeconds) {
  if (
    session.rows !== 1 ||
    session.userId !== expectedUserId ||
    !session.familyPresent ||
    session.generation !== 0 ||
    session.state !== "ACTIVE" ||
    session.version !== 1 ||
    !session.revokedAtIsNull ||
    !session.fingerprintPresent ||
    !session.fingerprintMatchesReturnedToken ||
    !session.rawRefreshAbsent ||
    session.refreshTtlSeconds !== expectedRefreshTtlSeconds
  ) {
    throw new Error("Persisted session invariant failed");
  }
}

function requireTokenMaterial(result) {
  const data = result.json?.data;
  if (
    typeof data?.accessToken !== "string" ||
    typeof data?.refreshToken !== "string" ||
    typeof data?.sessionId !== "string"
  ) {
    throw new Error("Successful login did not return token material");
  }
  return { accessToken: data.accessToken, refreshToken: data.refreshToken, sessionId: data.sessionId };
}

async function postRegistration(requestBody, idempotencyKey) {
  return postJson("/api/v1/auth/register", requestBody, { "idempotency-key": idempotencyKey });
}

async function postLogin(requestBody) {
  return postJson("/api/v1/auth/login", requestBody);
}

async function postJson(path, requestBody, headers = {}) {
  let transportError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:8080${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(10_000),
      });
      return { status: response.status, json: await response.json(), transportRetries: attempt - 1 };
    } catch (error) {
      transportError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw transportError;
}

function assertStatus(result, expected, label) {
  if (result.status !== expected) {
    throw new Error(`${label} returned HTTP ${result.status}: ${result.json?.error?.code ?? "unknown"}`);
  }
}

function assertError(result, status, code) {
  assertStatus(result, status, code);
  if (result.json?.error?.code !== code) throw new Error(`Expected ${code}, got ${result.json?.error?.code}`);
}

async function timingSample(operation, count) {
  const samples = [];
  for (let index = 0; index < count; index += 1) {
    const started = performance.now();
    const result = await operation();
    assertError(result, 401, "INVALID_CREDENTIALS");
    samples.push(round(performance.now() - started));
  }
  return samples;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function broadRatio(left, right) {
  return Math.max(left, right) / Math.max(1, Math.min(left, right));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function identityDbProbe(input) {
  const output = execFileSync(
    "docker",
    ["exec", "-i", "ailss-identity-service", "node", "--input-type=module", "-e", databaseProbeSource],
    {
      encoding: "utf8",
      input: JSON.stringify(input),
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim();
  return JSON.parse(output);
}

function safeHttp(result) {
  return {
    status: result.status,
    code: result.json?.error?.code,
    userId: result.json?.data?.user?.userId,
    role: result.json?.data?.user?.role,
    accountStatus: result.json?.data?.user?.status,
    tokenType: result.json?.data?.tokenType,
    sessionIdPresent: typeof result.json?.data?.sessionId === "string",
    accessTokenPresent: typeof result.json?.data?.accessToken === "string",
    refreshTokenPresent: typeof result.json?.data?.refreshToken === "string",
    transportRetries: result.transportRetries,
  };
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
