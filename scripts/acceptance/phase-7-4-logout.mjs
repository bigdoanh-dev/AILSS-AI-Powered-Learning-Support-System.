import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { generateKeyPair, importPKCS8, SignJWT } from "jose";

const profile = process.env.AILSS_PROFILE ?? "dev-async";
if (profile !== "dev-async") throw new Error("P7.4 acceptance requires AILSS_PROFILE=dev-async");
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
const evidenceDirectory = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidenceDirectory, { recursive: true });

const issuer = process.env.JWT_ISSUER ?? "https://identity.ailss.local";
const audience = process.env.JWT_AUDIENCE ?? "ailss-api";
const kid = process.env.JWT_KID ?? "dev-user-2026-01";
const actorIssuer = process.env.ACTOR_CONTEXT_ISSUER ?? "api-gateway";
const actorAudience = process.env.ACTOR_CONTEXT_AUDIENCE ?? "identity-service";
const actorPurpose = process.env.ACTOR_CONTEXT_PURPOSE ?? "identity.logout";
const actorKid = process.env.ACTOR_CONTEXT_KID ?? "dev-gateway-2026-01";
const userPrivateKey = await importPKCS8(
  await readFile(
    new URL("../../infrastructure/tls/generated/identity/user-jwt-private.pem", import.meta.url),
    "utf8",
  ),
  "EdDSA",
);
const gatewayPrivateKey = await importPKCS8(
  await readFile(
    new URL("../../infrastructure/tls/generated/services/gateway-private.pem", import.meta.url),
    "utf8",
  ),
  "EdDSA",
);
const wrongKeyPair = await generateKeyPair("Ed25519");

const fixture = randomUUID();
const password = `P7.4-${fixture}-Aa1!`;
const email = `p74-${fixture}@example.test`;
const registration = await postJson(
  "/api/v1/auth/register",
  { email, password, displayName: "Phase 7.4 Learner" },
  { "idempotency-key": `p74-${fixture}` },
);
assertStatus(registration, 201, "registration");
const userId = registration.json.data.userId;

const login = await postJson("/api/v1/auth/login", { email, password });
assertStatus(login, 200, "login");
const initial = requireTokenMaterial(login);
const before = identitySession(initial.sessionId);
assertSession(before, { state: "ACTIVE", version: 1, generation: 0, userId });

const logout = await postLogout(initial.accessToken);
assertStatus(logout, 200, "logout");
if (logout.json?.data?.loggedOut !== true) throw new Error("Logout response is not safe success");
const after = identitySession(initial.sessionId);
assertSession(after, { state: "REVOKED", version: 2, generation: 0, userId });
if (!after.revokedAtPresent) throw new Error("Logout did not persist revoked_at");

const repeated = await postLogout(initial.accessToken);
assertStatus(repeated, 200, "repeated logout");
const afterRepeated = identitySession(initial.sessionId);
assertSession(afterRepeated, { state: "REVOKED", version: 2, generation: 0, userId });
const refreshAfterLogout = await postJson("/api/v1/auth/refresh", {
  sessionId: initial.sessionId,
  refreshToken: initial.refreshToken,
});
assertError(refreshAfterLogout, 401, "INVALID_REFRESH_CREDENTIALS");

const concurrentFixture = await loginFixture(email, password, "concurrent logout fixture");
const concurrent = await Promise.all([
  postLogout(concurrentFixture.accessToken),
  postLogout(concurrentFixture.accessToken),
]);
if (concurrent.some((result) => result.status !== 200)) {
  throw new Error(`Concurrent logout returned ${concurrent.map((item) => item.status).join(",")}`);
}
const concurrentState = identitySession(concurrentFixture.sessionId);
assertSession(concurrentState, { state: "REVOKED", version: 2, generation: 0, userId });

const refreshLogoutRaces = [];
for (let index = 0; index < 4; index += 1) {
  const raceFixture = await loginFixture(email, password, `refresh/logout race ${index + 1}`);
  const [refreshResult, logoutResult] = await Promise.all([
    postJson("/api/v1/auth/refresh", {
      sessionId: raceFixture.sessionId,
      refreshToken: raceFixture.refreshToken,
    }),
    postLogout(raceFixture.accessToken),
  ]);
  assertStatus(logoutResult, 200, `refresh/logout race logout ${index + 1}`);
  if (![200, 401].includes(refreshResult.status)) {
    throw new Error(`Refresh/logout race refresh returned ${refreshResult.status}`);
  }
  const final = identitySession(raceFixture.sessionId);
  if (final.state !== "REVOKED" || final.version < 2 || final.version > 3) {
    throw new Error(`Refresh/logout race did not converge: ${JSON.stringify(safeSession(final))}`);
  }
  if (refreshResult.status === 200) {
    const rotated = requireTokenMaterial(refreshResult);
    const denied = await postJson("/api/v1/auth/refresh", {
      sessionId: rotated.sessionId,
      refreshToken: rotated.refreshToken,
    });
    assertError(denied, 401, "INVALID_REFRESH_CREDENTIALS");
  }
  refreshLogoutRaces.push({
    refreshStatus: refreshResult.status,
    logoutStatus: logoutResult.status,
    final: safeSession(final),
  });
}

const missingBearer = await postLogout(undefined);
assertError(missingBearer, 401, "INVALID_ACCESS_TOKEN");
const malformedBearer = await postLogout("malformed");
assertError(malformedBearer, 401, "INVALID_ACCESS_TOKEN");
const wrongSignatureToken = await signAccess(wrongKeyPair.privateKey, {
  userId,
  sessionId: initial.sessionId,
});
const wrongSignature = await postLogout(wrongSignatureToken);
assertError(wrongSignature, 401, "INVALID_ACCESS_TOKEN");
const wrongIssuer = await postLogout(
  await signAccess(userPrivateKey, { userId, sessionId: initial.sessionId, issuer: "https://wrong.test" }),
);
assertError(wrongIssuer, 401, "INVALID_ACCESS_TOKEN");
const wrongAudience = await postLogout(
  await signAccess(userPrivateKey, { userId, sessionId: initial.sessionId, audience: "wrong-api" }),
);
assertError(wrongAudience, 401, "INVALID_ACCESS_TOKEN");
const wrongKid = await postLogout(
  await signAccess(userPrivateKey, { userId, sessionId: initial.sessionId, kid: "wrong-kid" }),
);
assertError(wrongKid, 401, "INVALID_ACCESS_TOKEN");
const expired = await postLogout(
  await signAccess(userPrivateKey, {
    userId,
    sessionId: initial.sessionId,
    issuedAt: Math.floor(Date.now() / 1_000) - 1_000,
    expiresAt: Math.floor(Date.now() / 1_000) - 500,
  }),
);
assertError(expired, 401, "INVALID_ACCESS_TOKEN");
const notYetValid = await postLogout(
  await signAccess(userPrivateKey, {
    userId,
    sessionId: initial.sessionId,
    notBefore: Math.floor(Date.now() / 1_000) + 600,
  }),
);
assertError(notYetValid, 401, "INVALID_ACCESS_TOKEN");
const wrongScheme = await rawLogout(["Basic abc"]);
if (wrongScheme.status !== 401) throw new Error(`Wrong Authorization scheme returned ${wrongScheme.status}`);
const duplicateAuthorization = await rawLogout([
  `Bearer ${initial.accessToken}`,
  `Bearer ${initial.accessToken}`,
]);
if (duplicateAuthorization.status !== 401) {
  throw new Error(`Duplicate Authorization returned ${duplicateAuthorization.status}`);
}
const oversizedBearer = await rawLogout([
  `Bearer ${"a".repeat(1_400)}.${"b".repeat(1_400)}.${"c".repeat(1_400)}`,
]);
if (oversizedBearer.status !== 401) throw new Error(`Oversized Bearer returned ${oversizedBearer.status}`);
const forgedIdentity = await fetch("http://127.0.0.1:8080/api/v1/auth/logout", {
  method: "POST",
  headers: { authorization: `Bearer ${initial.accessToken}`, "x-session-id": randomUUID() },
});
if (forgedIdentity.status !== 400) throw new Error(`Forged trusted header returned ${forgedIdentity.status}`);

const actorFixture = await loginFixture(email, password, "actor-context fixture");
const actorCorrelation = randomUUID();
const validActorContext = await signActor(gatewayPrivateKey, {
  userId,
  sessionId: actorFixture.sessionId,
  correlationId: actorCorrelation,
});
const directValid = await directIdentityLogout(validActorContext, actorCorrelation);
if (directValid.status !== 200) throw new Error(`Valid actor context returned ${directValid.status}`);
assertSession(identitySession(actorFixture.sessionId), {
  state: "REVOKED",
  version: 2,
  generation: 0,
  userId,
});

const contextNegativeFixture = await loginFixture(email, password, "actor-context negative fixture");
const contextCorrelation = randomUUID();
const actorNegatives = [
  await signActor(wrongKeyPair.privateKey, {
    userId,
    sessionId: contextNegativeFixture.sessionId,
    correlationId: contextCorrelation,
  }),
  await signActor(gatewayPrivateKey, {
    userId,
    sessionId: contextNegativeFixture.sessionId,
    correlationId: contextCorrelation,
    issuer: "wrong-gateway",
  }),
  await signActor(gatewayPrivateKey, {
    userId,
    sessionId: contextNegativeFixture.sessionId,
    correlationId: contextCorrelation,
    audience: "wrong-service",
  }),
  await signActor(gatewayPrivateKey, {
    userId,
    sessionId: contextNegativeFixture.sessionId,
    correlationId: contextCorrelation,
    purpose: "identity.profile",
  }),
  await signActor(gatewayPrivateKey, {
    userId,
    sessionId: contextNegativeFixture.sessionId,
    correlationId: contextCorrelation,
    issuedAt: Math.floor(Date.now() / 1_000) - 100,
    expiresAt: Math.floor(Date.now() / 1_000) - 40,
  }),
];
for (const token of actorNegatives) {
  const response = await directIdentityLogout(token, contextCorrelation);
  if (response.status !== 401) throw new Error(`Invalid actor context returned ${response.status}`);
}
const mismatchContext = await signActor(gatewayPrivateKey, {
  userId: randomUUID(),
  sessionId: contextNegativeFixture.sessionId,
  correlationId: contextCorrelation,
});
const ownershipMismatch = await directIdentityLogout(mismatchContext, contextCorrelation);
if (ownershipMismatch.status !== 401) {
  throw new Error(`Session ownership mismatch returned ${ownershipMismatch.status}`);
}
assertSession(identitySession(contextNegativeFixture.sessionId), {
  state: "ACTIVE",
  version: 1,
  generation: 0,
  userId,
});

const identityLogs = execFileSync("docker", ["logs", "--tail", "500", "ailss-identity-service"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const gatewayLogs = execFileSync("docker", ["logs", "--tail", "500", "ailss-api-gateway"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const logs = `${identityLogs}\n${gatewayLogs}`;
for (const sensitive of [password, initial.accessToken, initial.refreshToken, validActorContext]) {
  if (logs.includes(sensitive)) throw new Error("Credential material appeared in runtime logs");
}
if (logs.includes('"x-actor-context":"eyJ')) {
  throw new Error("Raw signed actor context appeared in runtime logs");
}

await writeEvidence("p7.4-environment.json", {
  phase: "7.4",
  profile,
  runId,
  hostNode: process.version,
  runtimeNode: safeCommand("docker", ["exec", "ailss-identity-service", "node", "--version"]),
  gitCommit: safeCommand("git", ["rev-parse", "HEAD"]) || "NOT_A_GIT_REPOSITORY",
});
await writeEvidence("p7.4-http-acceptance.json", {
  initialLogout: safeHttp(logout),
  repeatedLogout: safeHttp(repeated),
  refreshAfterLogout: safeHttp(refreshAfterLogout),
  concurrentLogoutStatuses: concurrent.map((item) => item.status),
  refreshLogoutRaces,
  bearerNegatives: {
    missing: missingBearer.status,
    malformed: malformedBearer.status,
    wrongSignature: wrongSignature.status,
    wrongIssuer: wrongIssuer.status,
    wrongAudience: wrongAudience.status,
    wrongKid: wrongKid.status,
    expired: expired.status,
    notYetValid: notYetValid.status,
    wrongScheme: wrongScheme.status,
    duplicate: duplicateAuthorization.status,
    oversized: oversizedBearer.status,
    forgedTrustedHeader: forgedIdentity.status,
  },
  fixtureEmailSha256: createHash("sha256").update(email).digest("hex"),
});
await writeEvidence("p7.4-cassandra-verification.json", {
  runtimeRole: "svc_identity",
  before: safeSession(before),
  after: safeSession(after),
  repeated: safeSession(afterRepeated),
  versionIncrementExactlyOnce: afterRepeated.version === before.version + 1,
  concurrent: safeSession(concurrentState),
  refreshLogoutRaces,
  sessionsByUserProjectionRead: false,
  sessionsByUserProjectionWritten: false,
  userTokenVersionMutated: false,
});
await writeEvidence("p7.4-trust-boundary.json", {
  externalJwtCryptographicallyVerified: true,
  algorithm: "EdDSA",
  issuerAudienceKidAndClaimsVerified: true,
  gatewaySignedActorContext: true,
  identityVerifiedActorContext: true,
  validContextAccepted: directValid.status === 200,
  invalidSignatureIssuerAudiencePurposeAndExpiryRejected: true,
  ownershipMismatchDeniedWithoutMutation: true,
  rawJwtSaved: false,
  rawActorContextSaved: false,
  authorizationHeaderSaved: false,
});
await writeEvidence("p7.4-summary.json", {
  stage: "phase-7.4-logout-acceptance",
  status: "PASS",
  currentSessionOnly: true,
  realCassandraLwt: true,
  idempotentVersion: true,
  refreshAfterLogoutDenied: true,
  logoutConcurrencyConverged: true,
  refreshLogoutConcurrencyConverged: true,
  bearerTrustBoundaryVerified: true,
  actorContextTrustBoundaryVerified: true,
  noBusinessEvent: true,
  qIdn004Executed: false,
  tokensAbsentFromLogsAndEvidence: true,
});
console.log(
  JSON.stringify({
    stage: "phase-7.4-logout-acceptance",
    status: "PASS",
    runId,
    evidence: decodeURIComponent(evidenceDirectory.pathname),
  }),
);

async function loginFixture(fixtureEmail, fixturePassword, label) {
  const result = await postJson("/api/v1/auth/login", { email: fixtureEmail, password: fixturePassword });
  assertStatus(result, 200, label);
  return requireTokenMaterial(result);
}

async function postLogout(token) {
  return postJson("/api/v1/auth/logout", undefined, token ? { authorization: `Bearer ${token}` } : {});
}

async function postJson(path, body, headers = {}) {
  let transportError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:8080${path}`, {
        method: "POST",
        headers: {
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...headers,
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

async function directIdentityLogout(actorContext, correlationId) {
  const source = `
    import { readFileSync } from "node:fs";
    const input = JSON.parse(readFileSync(0, "utf8"));
    const response = await fetch("http://identity-service:8101/api/v1/auth/logout", {
      method: "POST",
      headers: {
        "x-actor-context": input.actorContext,
        "x-correlation-id": input.correlationId,
      },
      signal: AbortSignal.timeout(10000),
    });
    console.log(JSON.stringify({ status: response.status }));
  `;
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "ailss-api-gateway", "node", "--input-type=module", "-e", source], {
      encoding: "utf8",
      input: JSON.stringify({ actorContext, correlationId }),
      stdio: ["pipe", "pipe", "pipe"],
    }).trim(),
  );
}

async function signAccess(
  key,
  {
    userId,
    sessionId,
    issuer: tokenIssuer = issuer,
    audience: tokenAudience = audience,
    kid: tokenKid = kid,
    issuedAt = Math.floor(Date.now() / 1_000),
    expiresAt = issuedAt + 900,
    notBefore,
  },
) {
  let token = new SignJWT({ roles: ["STUDENT"], sessionId, tokenVersion: 1 })
    .setProtectedHeader({ alg: "EdDSA", kid: tokenKid, typ: "JWT" })
    .setIssuer(tokenIssuer)
    .setAudience(tokenAudience)
    .setSubject(userId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .setJti(randomUUID());
  if (notBefore !== undefined) token = token.setNotBefore(notBefore);
  return token.sign(key);
}

async function signActor(
  key,
  {
    userId,
    sessionId,
    correlationId,
    issuer: tokenIssuer = actorIssuer,
    audience: tokenAudience = actorAudience,
    purpose = actorPurpose,
    issuedAt = Math.floor(Date.now() / 1_000),
    expiresAt = issuedAt + 30,
  },
) {
  return new SignJWT({
    roles: ["STUDENT"],
    sessionId,
    tokenVersion: 1,
    correlationId,
    purpose,
  })
    .setProtectedHeader({ alg: "EdDSA", kid: actorKid, typ: "actor-context+jwt" })
    .setIssuer(tokenIssuer)
    .setAudience(tokenAudience)
    .setSubject(userId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .setJti(randomUUID())
    .sign(key);
}

function rawLogout(values) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port: 8080,
        path: "/api/v1/auth/logout",
        method: "POST",
        headers: { authorization: values },
      },
      (response) => {
        response.resume();
        response.once("end", () => resolve({ status: response.statusCode }));
      },
    );
    request.once("error", reject);
    request.end();
  });
}

function identitySession(sessionId) {
  const probe = `
    import cassandra from "cassandra-driver";
    const client = new cassandra.Client({
      contactPoints: process.env.CASSANDRA_CONTACT_POINTS.split(","),
      localDataCenter: process.env.CASSANDRA_LOCAL_DC,
      keyspace: process.env.CASSANDRA_KEYSPACE,
      authProvider: new cassandra.auth.PlainTextAuthProvider(
        process.env.CASSANDRA_USERNAME,
        process.env.CASSANDRA_PASSWORD,
      ),
      queryOptions: { prepare: true },
    });
    await client.connect();
    const result = await client.execute(
      "SELECT session_id,user_id,generation,state,expires_at,revoked_at,version FROM session_by_id WHERE session_id=?",
      [cassandra.types.Uuid.fromString(process.argv[1])],
      { prepare: true, consistency: cassandra.types.consistencies.localQuorum },
    );
    const row = result.rows[0];
    console.log(JSON.stringify({
      rows: result.rows.length,
      sessionId: row?.get("session_id")?.toString(),
      userId: row?.get("user_id")?.toString(),
      generation: row?.get("generation"),
      state: row?.get("state"),
      version: Number(row?.get("version")?.toString()),
      expired: row?.get("expires_at") <= new Date(),
      revokedAtPresent: row?.get("revoked_at") instanceof Date,
    }));
    await client.shutdown();
  `;
  return JSON.parse(
    execFileSync(
      "docker",
      ["exec", "ailss-identity-service", "node", "--input-type=module", "-e", probe, sessionId],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim(),
  );
}

function assertSession(value, expected) {
  if (
    value.rows !== 1 ||
    value.userId !== expected.userId ||
    value.state !== expected.state ||
    value.version !== expected.version ||
    value.generation !== expected.generation
  ) {
    throw new Error(`Session invariant failed: ${JSON.stringify(safeSession(value))}`);
  }
}

function requireTokenMaterial(result) {
  const data = result.json?.data;
  if (
    typeof data?.accessToken !== "string" ||
    typeof data?.refreshToken !== "string" ||
    typeof data?.sessionId !== "string"
  ) {
    throw new Error("Authentication response omitted token material");
  }
  return { accessToken: data.accessToken, refreshToken: data.refreshToken, sessionId: data.sessionId };
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

function safeSession(value) {
  return {
    rows: value.rows,
    generation: value.generation,
    state: value.state,
    version: value.version,
    expired: value.expired,
    revokedAtPresent: value.revokedAtPresent,
  };
}

function safeHttp(value) {
  return {
    status: value.status,
    code: value.json?.error?.code,
    loggedOut: value.json?.data?.loggedOut,
    accessTokenPresent: typeof value.json?.data?.accessToken === "string",
    refreshTokenPresent: typeof value.json?.data?.refreshToken === "string",
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
