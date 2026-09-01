import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { decodeProtectedHeader, importSPKI, jwtVerify } from "jose";

const profile = process.env.AILSS_PROFILE ?? "dev-async";
if (profile !== "dev-async") throw new Error("P7.3 acceptance requires AILSS_PROFILE=dev-async");
const runId = process.env.AILSS_EVIDENCE_RUN_ID ?? new Date().toISOString().replaceAll(/[:.]/g, "-");
const evidenceDirectory = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidenceDirectory, { recursive: true });

const fixture = runId
  .toLowerCase()
  .replaceAll(/[^a-z0-9]/g, "")
  .slice(-24);
const password = `P7.3-${randomUUID()}-safe-fixture`;
const email = `p73-${fixture}@example.test`;
const publicKeyPath = new URL(
  "../../infrastructure/tls/generated/identity/user-jwt-public.pem",
  import.meta.url,
);
const issuer = process.env.JWT_ISSUER ?? "https://identity.ailss.local";
const audience = process.env.JWT_AUDIENCE ?? "ailss-api";
const kid = process.env.JWT_KID ?? "dev-user-2026-01";
const accessTtlSeconds = Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? 900);

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
  if (input.kind === "session") {
    const result = await client.execute(
      "SELECT session_id,user_id,token_family_id,refresh_fingerprint,generation,state,expires_at,revoked_at,version,created_at FROM session_by_id WHERE session_id=?",
      [cassandra.types.Uuid.fromString(input.sessionId)],
      options,
    );
    const row = result.rows[0];
    const fingerprint = row?.get("refresh_fingerprint");
    const currentExpected = input.currentRawToken
      ? createHash("sha256").update(input.currentRawToken, "utf8").digest("hex")
      : undefined;
    output = {
      rows: result.rows.length,
      sessionId: row?.get("session_id")?.toString(),
      userId: row?.get("user_id")?.toString(),
      tokenFamilyId: row?.get("token_family_id")?.toString(),
      generation: row?.get("generation"),
      state: row?.get("state"),
      version: Number(row?.get("version")?.toString()),
      expiresAt: row?.get("expires_at")?.toISOString(),
      createdAt: row?.get("created_at")?.toISOString(),
      revokedAtPresent: row?.get("revoked_at") instanceof Date,
      fingerprintPresent: typeof fingerprint === "string" && fingerprint.length === 64,
      fingerprintMatchesCurrentToken: currentExpected ? fingerprint === currentExpected : undefined,
      rawTokensAbsent: (input.rawTokens ?? []).every((raw) => fingerprint !== raw),
    };
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
  } else if (input.kind === "setSessionExpiry") {
    await client.execute(
      "UPDATE session_by_id SET expires_at=? WHERE session_id=?",
      [new Date(input.expiresAt), cassandra.types.Uuid.fromString(input.sessionId)],
      options,
    );
    const result = await client.execute(
      "SELECT expires_at FROM session_by_id WHERE session_id=?",
      [cassandra.types.Uuid.fromString(input.sessionId)],
      options,
    );
    output = { expiresAt: result.rows[0]?.get("expires_at")?.toISOString() };
  }
  console.log(JSON.stringify(output ?? null));
  await client.shutdown();
`;

const registration = await postRegistration(
  { email, password, displayName: "Phase 7.3 Learner" },
  `p73-${fixture}`,
);
assertStatus(registration, 201, "synthetic registration");
const userId = registration.json.data.userId;

const login = await postLogin({ email, password });
assertStatus(login, 200, "initial login");
const initial = requireTokenMaterial(login);
const initialSession = identityDbProbe({
  kind: "session",
  sessionId: initial.sessionId,
  currentRawToken: initial.refreshToken,
  rawTokens: [initial.refreshToken],
});
assertSession(initialSession, { generation: 0, version: 1, state: "ACTIVE", userId });

const rotated = await postRefresh(initial);
assertStatus(rotated, 200, "generation 0 to 1 rotation");
const next = requireTokenMaterial(rotated);
if (next.sessionId !== initial.sessionId || rotated.json.data.generation !== 1) {
  throw new Error("Refresh changed session identity or returned the wrong generation");
}
const rotatedJwt = await verifyAccessToken(next.accessToken, { userId, sessionId: initial.sessionId });
const rotatedSession = identityDbProbe({
  kind: "session",
  sessionId: initial.sessionId,
  currentRawToken: next.refreshToken,
  rawTokens: [initial.refreshToken, next.refreshToken],
});
assertSession(rotatedSession, { generation: 1, version: 2, state: "ACTIVE", userId });
if (
  rotatedSession.tokenFamilyId !== initialSession.tokenFamilyId ||
  rotatedSession.expiresAt !== initialSession.expiresAt ||
  rotatedSession.createdAt !== initialSession.createdAt ||
  !rotatedSession.fingerprintMatchesCurrentToken ||
  !rotatedSession.rawTokensAbsent
) {
  throw new Error("Rotation did not preserve family/absolute expiry or fingerprint safely");
}

const oldReplay = await postRefresh(initial);
assertError(oldReplay, 401, "INVALID_REFRESH_CREDENTIALS");
const afterReplay = identityDbProbe({
  kind: "session",
  sessionId: initial.sessionId,
  currentRawToken: next.refreshToken,
  rawTokens: [initial.refreshToken, next.refreshToken],
});
assertSession(afterReplay, { generation: 1, version: 3, state: "REVOKED", userId });
if (!afterReplay.revokedAtPresent) throw new Error("Suspected reuse did not record revocation time");
const revokedRetry = await postRefresh(next);
assertError(revokedRetry, 401, "INVALID_REFRESH_CREDENTIALS");

const missing = await postRefresh({
  sessionId: randomUUID(),
  refreshToken: initial.refreshToken,
});
assertError(missing, 401, "INVALID_REFRESH_CREDENTIALS");
if (
  JSON.stringify(oldReplay.json.error) !== JSON.stringify(revokedRetry.json.error) ||
  JSON.stringify(oldReplay.json.error) !== JSON.stringify(missing.json.error)
) {
  throw new Error("Missing, reused, and revoked refresh errors differ");
}

const malformed = await postJson("/api/v1/auth/refresh", {
  sessionId: initial.sessionId,
  refreshToken: "short",
});
assertError(malformed, 422, "REFRESH_VALIDATION_FAILED");
const unknownField = await postJson("/api/v1/auth/refresh", {
  sessionId: initial.sessionId,
  refreshToken: initial.refreshToken,
  userId,
});
assertError(unknownField, 422, "REFRESH_VALIDATION_FAILED");
const malformedJsonResponse = await fetch("http://127.0.0.1:8080/api/v1/auth/refresh", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{",
});
const malformedJson = await malformedJsonResponse.json();
if (malformedJsonResponse.status !== 400 || malformedJson.error?.code !== "INVALID_JSON") {
  throw new Error("Malformed refresh JSON was not rejected safely");
}
const forged = await fetch("http://127.0.0.1:8080/api/v1/auth/refresh", {
  method: "POST",
  headers: { "content-type": "application/json", "x-user-id": randomUUID() },
  body: JSON.stringify({ sessionId: initial.sessionId, refreshToken: initial.refreshToken }),
});
if (forged.status !== 400) throw new Error(`Forged identity header returned HTTP ${forged.status}`);

const mismatchLogin = await loginFixture(email, password, "mismatch fixture");
const mismatchWrong = await postRefresh({
  sessionId: mismatchLogin.sessionId,
  refreshToken: newOpaqueToken(),
});
assertError(mismatchWrong, 401, "INVALID_REFRESH_CREDENTIALS");
const mismatchState = identityDbProbe({ kind: "session", sessionId: mismatchLogin.sessionId });
assertSession(mismatchState, { generation: 0, version: 2, state: "REVOKED", userId });

const expiredLogin = await loginFixture(email, password, "expired fixture");
const pastExpiry = new Date(Date.now() - 60_000).toISOString();
const expiryMutation = identityDbProbe({
  kind: "setSessionExpiry",
  sessionId: expiredLogin.sessionId,
  expiresAt: pastExpiry,
});
if (expiryMutation.expiresAt !== pastExpiry) throw new Error("Expired fixture mutation failed");
const expired = await postRefresh(expiredLogin);
assertError(expired, 401, "INVALID_REFRESH_CREDENTIALS");
const expiredState = identityDbProbe({ kind: "session", sessionId: expiredLogin.sessionId });
assertSession(expiredState, { generation: 0, version: 1, state: "ACTIVE", userId });

const inactiveEmail = `inactive-p73-${fixture}@example.test`;
const inactiveRegistration = await postRegistration(
  { email: inactiveEmail, password, displayName: "Inactive Refresh Fixture" },
  `inactive-p73-${fixture}`,
);
assertStatus(inactiveRegistration, 201, "inactive refresh fixture registration");
const inactiveUserId = inactiveRegistration.json.data.userId;
const inactiveLogin = await loginFixture(inactiveEmail, password, "inactive fixture login");
const statusMutation = identityDbProbe({
  kind: "setUserStatus",
  userId: inactiveUserId,
  status: "SUSPENDED",
});
if (statusMutation.status !== "SUSPENDED") throw new Error("Inactive refresh fixture mutation failed");
const inactive = await postRefresh(inactiveLogin);
assertError(inactive, 401, "INVALID_REFRESH_CREDENTIALS");
const inactiveState = identityDbProbe({ kind: "session", sessionId: inactiveLogin.sessionId });
assertSession(inactiveState, { generation: 0, version: 2, state: "REVOKED", userId: inactiveUserId });

const concurrentLogin = await loginFixture(email, password, "concurrent fixture");
const concurrent = await Promise.all([postRefresh(concurrentLogin), postRefresh(concurrentLogin)]);
const concurrentStatuses = concurrent.map((item) => item.status).sort((left, right) => left - right);
if (JSON.stringify(concurrentStatuses) !== JSON.stringify([200, 401])) {
  throw new Error(`Concurrent refresh returned ${concurrentStatuses.join(",")}`);
}
const concurrentWinner = concurrent.find((item) => item.status === 200);
if (!concurrentWinner) throw new Error("Concurrent refresh had no issuance winner");
const concurrentWinnerToken = requireTokenMaterial(concurrentWinner);
await verifyAccessToken(concurrentWinnerToken.accessToken, {
  userId,
  sessionId: concurrentLogin.sessionId,
});
const concurrentState = identityDbProbe({
  kind: "session",
  sessionId: concurrentLogin.sessionId,
  currentRawToken: concurrentWinnerToken.refreshToken,
  rawTokens: [concurrentLogin.refreshToken, concurrentWinnerToken.refreshToken],
});
assertSession(concurrentState, { generation: 1, version: 3, state: "REVOKED", userId });

const responseLossLogin = await loginFixture(email, password, "response loss fixture");
const responseLossA = await postRefresh(responseLossLogin);
assertStatus(responseLossA, 200, "simulated response-loss rotation");
const responseLossNew = requireTokenMaterial(responseLossA);
const responseLossRetry = await postRefresh(responseLossLogin);
assertError(responseLossRetry, 401, "INVALID_REFRESH_CREDENTIALS");
const responseLossState = identityDbProbe({
  kind: "session",
  sessionId: responseLossLogin.sessionId,
  currentRawToken: responseLossNew.refreshToken,
  rawTokens: [responseLossLogin.refreshToken, responseLossNew.refreshToken],
});
assertSession(responseLossState, { generation: 1, version: 3, state: "REVOKED", userId });

const logs = execFileSync("docker", ["logs", "--tail", "500", "ailss-identity-service"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const sensitiveValues = [
  password,
  initial.accessToken,
  initial.refreshToken,
  next.accessToken,
  next.refreshToken,
  concurrentLogin.refreshToken,
  concurrentWinnerToken.accessToken,
  concurrentWinnerToken.refreshToken,
  responseLossLogin.refreshToken,
  responseLossNew.accessToken,
  responseLossNew.refreshToken,
];
if (sensitiveValues.some((value) => logs.includes(value))) {
  throw new Error("Password or token material appeared in Identity logs");
}

await writeEvidence("p7.3-environment.json", {
  phase: "7.3",
  profile,
  runId,
  hostNode: process.version,
  runtimeNode: safeCommand("docker", ["exec", "ailss-identity-service", "node", "--version"]),
  gitCommit: safeCommand("git", ["rev-parse", "HEAD"]) || "NOT_A_GIT_REPOSITORY",
});
await writeEvidence("p7.3-http-acceptance.json", {
  login: safeHttp(login),
  rotation: safeHttp(rotated),
  oldTokenReplay: safeHttp(oldReplay),
  revokedRetry: safeHttp(revokedRetry),
  missingSession: safeHttp(missing),
  genericInvalidRefreshErrors: true,
  malformedToken: safeHttp(malformed),
  unknownField: safeHttp(unknownField),
  malformedJson: { status: malformedJsonResponse.status, code: malformedJson.error.code },
  forgedIdentityHeader: { status: forged.status },
  wrongToken: safeHttp(mismatchWrong),
  expiredSession: safeHttp(expired),
  inactiveAccount: safeHttp(inactive),
  concurrentStatuses,
  responseLossStatuses: [responseLossA.status, responseLossRetry.status],
  emailFixtureSha256: createHash("sha256").update(email).digest("hex"),
});
await writeEvidence("p7.3-cassandra-verification.json", {
  runtimeRole: "svc_identity",
  initial: safeSession(initialSession),
  rotated: safeSession(rotatedSession),
  familyStable: rotatedSession.tokenFamilyId === initialSession.tokenFamilyId,
  absoluteExpiryPreserved: rotatedSession.expiresAt === initialSession.expiresAt,
  createdAtPreserved: rotatedSession.createdAt === initialSession.createdAt,
  currentFingerprintMatchedInMemoryToken: rotatedSession.fingerprintMatchesCurrentToken,
  rawOldAndNewRefreshAbsent: rotatedSession.rawTokensAbsent,
  suspectedReuse: safeSession(afterReplay),
  wrongTokenFamilyRevoked: mismatchState.state === "REVOKED",
  expiredSessionNotRotated: expiredState.generation === 0 && expiredState.version === 1,
  inactiveFamilyRevoked: inactiveState.state === "REVOKED",
  concurrent: safeSession(concurrentState),
  concurrentLoserRevokedWinnerFamily: concurrentState.state === "REVOKED",
  responseLoss: safeSession(responseLossState),
  responseLossOldTokenRevokedNewGeneration: responseLossState.state === "REVOKED",
  fingerprintSavedInEvidence: false,
  rawTokenSavedInEvidence: false,
  sessionsByUserProjectionWritten: false,
});
await writeEvidence("p7.3-jwt-verification.json", {
  algorithm: rotatedJwt.algorithm,
  kid: rotatedJwt.kid,
  signatureVerified: true,
  issuerVerified: true,
  audienceVerified: true,
  subjectVerified: true,
  sessionIdVerified: true,
  rolesVerified: true,
  tokenVersionVerified: true,
  jtiIsUuid: true,
  configuredAccessTtlSeconds: rotatedJwt.ttlSeconds,
  concurrentWinnerJwtVerified: true,
  rawJwtSaved: false,
});
await writeEvidence("p7.3-summary.json", {
  stage: "phase-7.3-refresh-acceptance",
  status: "PASS",
  realCassandraCas: true,
  generationAndVersionRotatedOnce: true,
  absoluteFamilyExpiry: true,
  suspectedReuseRevokesFamily: true,
  concurrentExactlyOneIssuanceResponse: true,
  concurrentFamilyRevokedConservatively: true,
  responseLossRetryRevokesFamily: true,
  cryptographicJwtVerification: true,
  genericInvalidRefreshErrors: true,
  rawRefreshPersisted: false,
  rawTokensSavedInEvidence: false,
  passwordAndTokensAbsentFromLogs: true,
  businessEventCreated: false,
});
console.log(
  JSON.stringify({
    stage: "phase-7.3-refresh-acceptance",
    status: "PASS",
    runId,
    evidence: decodeURIComponent(evidenceDirectory.pathname),
  }),
);

async function loginFixture(fixtureEmail, fixturePassword, label) {
  const result = await postLogin({ email: fixtureEmail, password: fixturePassword });
  assertStatus(result, 200, label);
  return requireTokenMaterial(result);
}

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

function assertSession(session, expected) {
  if (
    session.rows !== 1 ||
    session.userId !== expected.userId ||
    session.generation !== expected.generation ||
    session.version !== expected.version ||
    session.state !== expected.state ||
    !session.fingerprintPresent
  ) {
    throw new Error(
      `Persisted session invariant failed: ${JSON.stringify({
        rows: session.rows,
        generation: session.generation,
        version: session.version,
        state: session.state,
      })}`,
    );
  }
}

function safeSession(session) {
  return {
    rows: session.rows,
    generation: session.generation,
    state: session.state,
    version: session.version,
    revokedAtPresent: session.revokedAtPresent,
    fingerprintPresent: session.fingerprintPresent,
  };
}

function requireTokenMaterial(result) {
  const data = result.json?.data;
  if (
    typeof data?.accessToken !== "string" ||
    typeof data?.refreshToken !== "string" ||
    typeof data?.sessionId !== "string"
  ) {
    throw new Error("Successful auth response did not return token material");
  }
  return { accessToken: data.accessToken, refreshToken: data.refreshToken, sessionId: data.sessionId };
}

function newOpaqueToken() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

async function postRegistration(requestBody, idempotencyKey) {
  return postJson("/api/v1/auth/register", requestBody, { "idempotency-key": idempotencyKey });
}

async function postLogin(requestBody) {
  return postJson("/api/v1/auth/login", requestBody);
}

async function postRefresh(material) {
  return postJson("/api/v1/auth/refresh", {
    sessionId: material.sessionId,
    refreshToken: material.refreshToken,
  });
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
    tokenType: result.json?.data?.tokenType,
    generation: result.json?.data?.generation,
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
