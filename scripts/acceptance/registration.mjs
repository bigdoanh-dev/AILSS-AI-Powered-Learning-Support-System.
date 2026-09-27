import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { readEnv, required } from "../dev/env.mjs";

const profile = process.env.AILSS_PROFILE ?? "dev-async";
if (profile !== "dev-async") throw new Error("P7.1 acceptance requires AILSS_PROFILE=dev-async");
const env = await readEnv();
const runId = process.env.AILSS_EVIDENCE_RUN_ID ?? new Date().toISOString().replaceAll(/[:.]/g, "-");
const evidenceDirectory = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidenceDirectory, { recursive: true });

const adminAuth = `Basic ${Buffer.from(
  `${required(env, "RABBITMQ_ADMIN_USERNAME")}:${required(env, "RABBITMQ_ADMIN_PASSWORD")}`,
).toString("base64")}`;
const queue = `p7.1.identity.registration.${runId}.q`.replaceAll(/[^a-zA-Z0-9._-]/g, "-");
const fixture = runId
  .toLowerCase()
  .replaceAll(/[^a-z0-9]/g, "")
  .slice(-24);
const password = `P7.1-${randomUUID()}-safe-fixture`;
const email = `p71-${fixture}@example.test`;
const body = { email, password, displayName: "Phase 7 Learner" };
const rabbitDependentContainers = [
  "ailss-identity-service",
  "ailss-ai-service",
  "ailss-ai-worker",
  "ailss-document-worker",
  "ailss-notification-worker",
  "ailss-audit-worker",
  "ailss-reconciliation-worker",
];
let rabbitStopped = false;
const databaseProbeSource = `
  import cassandra from "cassandra-driver";
  const input = JSON.parse(Buffer.from(process.argv[1], "base64url").toString("utf8"));
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
  let output;
  if (input.kind === "credential") {
    const result = await client.execute(
      "SELECT user_id,password_hash,status FROM credential_by_email WHERE normalized_email=?",
      [input.email],
      { prepare: true, consistency: cassandra.types.consistencies.localQuorum },
    );
    const row = result.rows[0];
    output = {
      rows: result.rows.length,
      userId: row?.get("user_id")?.toString(),
      passwordHashIsArgon2id: String(row?.get("password_hash") ?? "").startsWith("$argon2id$"),
      status: row?.get("status"),
    };
  } else if (input.kind === "user") {
    const result = await client.execute(
      "SELECT user_id,display_name,role,status,lecturer_verified FROM user_by_id WHERE user_id=?",
      [cassandra.types.Uuid.fromString(input.userId)],
      { prepare: true, consistency: cassandra.types.consistencies.localQuorum },
    );
    const row = result.rows[0];
    output = {
      rows: result.rows.length,
      userId: row?.get("user_id")?.toString(),
      displayName: row?.get("display_name"),
      role: row?.get("role"),
      status: row?.get("status"),
      lecturerVerified: row?.get("lecturer_verified"),
    };
  } else if (input.kind === "outbox") {
    const day = cassandra.types.LocalDate.fromString(input.day);
    for (let shard = 0; shard < 16 && !output; shard += 1) {
      const result = await client.execute(
        "SELECT event_id,event_type,aggregate_id,state,retry_count,payload_json FROM pending_events_by_due_bucket WHERE due_day=? AND shard=?",
        [day, shard],
        { prepare: true, consistency: cassandra.types.consistencies.localQuorum },
      );
      const row = result.rows.find((candidate) =>
        candidate.get("aggregate_id").toString() === input.userId &&
        candidate.get("event_type") === input.eventType &&
        candidate.get("state") === input.state
      );
      if (row) {
        const envelope = JSON.parse(row.get("payload_json"));
        output = {
          eventId: row.get("event_id").toString(),
          eventType: row.get("event_type"),
          state: row.get("state"),
          retryCount: row.get("retry_count"),
          data: envelope.data,
        };
      }
    }
  } else if (input.kind === "eventById") {
    const result = await client.execute(
      "SELECT event_id,event_type,state,retry_count,published_at FROM pending_event_by_id WHERE event_id=?",
      [cassandra.types.Uuid.fromString(input.eventId)],
      { prepare: true, consistency: cassandra.types.consistencies.localQuorum },
    );
    const row = result.rows[0];
    if (row && row.get("state") === input.state) output = {
      eventId: row.get("event_id").toString(),
      eventType: row.get("event_type"),
      state: row.get("state"),
      retryCount: row.get("retry_count"),
      publishedAt: row.get("published_at")?.toISOString(),
    };
  }
  console.log(JSON.stringify(output ?? null));
  await client.shutdown();
`;

try {
  await rabbitApi(`/queues/%2Failss/${encodeURIComponent(queue)}`, "PUT", {
    durable: true,
    auto_delete: false,
    arguments: {},
  });
  await rabbitApi(
    `/bindings/%2Failss/e/${encodeURIComponent("ailss.domain.events")}/q/${encodeURIComponent(queue)}`,
    "POST",
    { routing_key: "identity.user.registered.v1", arguments: {} },
  );

  const first = await postRegistration(body, `first-${fixture}`);
  assertStatus(first, 201, "first registration");
  const replay = await postRegistration(body, `first-${fixture}`);
  assertStatus(replay, 201, "idempotent replay");
  if (first.json.data.userId !== replay.json.data.userId || replay.json.meta.replayed !== true) {
    throw new Error("Idempotent replay did not preserve the original logical result");
  }

  const changedPayload = await postRegistration({ ...body, displayName: "Changed Name" }, `first-${fixture}`);
  assertError(changedPayload, 409, "IDEMPOTENCY_CONFLICT");
  const duplicate = await postRegistration(body, `duplicate-${fixture}`);
  assertError(duplicate, 409, "EMAIL_ALREADY_REGISTERED");
  const invalid = await postRegistration({ ...body, password: "short" }, `invalid-${fixture}`);
  assertError(invalid, 422, "REGISTRATION_VALIDATION_FAILED");
  const massAssignment = await postRegistration(
    { ...body, email: `mass-${fixture}@example.test`, role: "ADMIN", lecturerVerified: true },
    `mass-${fixture}`,
  );
  assertError(massAssignment, 422, "REGISTRATION_VALIDATION_FAILED");

  const malformed = await fetch("http://127.0.0.1:8080/api/v1/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": `json-${fixture}` },
    body: "{",
  });
  if (malformed.status !== 400) throw new Error(`Malformed JSON returned HTTP ${malformed.status}`);
  const malformedJson = await malformed.json();
  if (malformedJson.error?.code !== "INVALID_JSON")
    throw new Error("Malformed JSON error was unsafe or unstable");

  const forged = await fetch("http://127.0.0.1:8080/api/v1/auth/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": `forged-${fixture}`,
      "x-user-id": randomUUID(),
    },
    body: JSON.stringify(body),
  });
  if (forged.status !== 400) throw new Error(`Forged identity header returned HTTP ${forged.status}`);

  const missingIdempotency = await fetch("http://127.0.0.1:8080/api/v1/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const missingIdempotencyJson = await missingIdempotency.json();
  if (missingIdempotency.status !== 400 || missingIdempotencyJson.error?.code !== "INVALID_IDEMPOTENCY_KEY") {
    throw new Error("Missing Idempotency-Key was not rejected safely");
  }

  const oversized = await fetch("http://127.0.0.1:8080/api/v1/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": `oversized-${fixture}` },
    body: JSON.stringify({ ...body, displayName: "x".repeat(1_100_000) }),
  });
  const oversizedJson = await oversized.json();
  if (oversized.status !== 413 || oversizedJson.error?.code !== "PAYLOAD_TOO_LARGE") {
    throw new Error("Oversized registration was not rejected safely");
  }

  const injectionBody = {
    ...body,
    email: `cql-${fixture}@example.test`,
    displayName: "Robert'); DROP TABLE user_by_id;--",
  };
  const injection = await postRegistration(injectionBody, `cql-${fixture}`);
  assertStatus(injection, 201, "bound CQL-like displayName");

  const raceEmail = `race-${fixture}@example.test`;
  const race = await Promise.all([
    postRegistration({ ...body, email: raceEmail }, `race-a-${fixture}`),
    postRegistration({ ...body, email: raceEmail }, `race-b-${fixture}`),
  ]);
  const raceStatuses = race.map((item) => item.status).sort((a, b) => a - b);
  if (JSON.stringify(raceStatuses) !== JSON.stringify([201, 409])) {
    throw new Error(`Concurrent uniqueness returned ${raceStatuses.join(",")}`);
  }

  const canonical = identityDbProbe({ kind: "credential", email });
  if (canonical.rows !== 1) throw new Error("Canonical credential lookup did not return exactly one row");
  const credentialUserId = canonical.userId;
  if (credentialUserId !== first.json.data.userId || !canonical.passwordHashIsArgon2id) {
    throw new Error("Credential/user binding or Argon2id hash is invalid");
  }
  const user = identityDbProbe({ kind: "user", userId: credentialUserId });
  if (user.rows !== 1 || user.role !== "STUDENT") {
    throw new Error("Canonical user row is missing or privileged");
  }
  const injectionUser = identityDbProbe({ kind: "user", userId: injection.json.data.userId });
  if (injectionUser.displayName !== injectionBody.displayName) {
    throw new Error("Prepared CQL did not preserve the display name safely");
  }

  execFileSync("docker", ["stop", "ailss-rabbitmq"], { stdio: "ignore" });
  rabbitStopped = true;
  const outageEmail = `outage-${fixture}@example.test`;
  const outage = await postRegistration(
    { ...body, email: outageEmail, displayName: "Broker Outage Learner" },
    `outage-${fixture}`,
  );
  assertStatus(outage, 201, "registration while RabbitMQ is unavailable");
  const readyEvent = await waitForOutbox(
    outage.json.data.userId,
    "identity.user.registered.v1",
    "READY",
    30_000,
  );
  const readyAudit = await waitForOutbox(
    outage.json.data.userId,
    "system.audit.requested.v1",
    "READY",
    30_000,
  );

  execFileSync("docker", ["start", "ailss-rabbitmq"], { stdio: "ignore" });
  rabbitStopped = false;
  await waitUntil(async () => rabbitApi("/health/checks/ready-to-serve-clients"), 90_000);
  const publishedEvent = {
    ...(await waitForPublished(readyEvent.eventId, 90_000)),
    data: readyEvent.data,
  };
  const publishedAudit = {
    ...(await waitForPublished(readyAudit.eventId, 90_000)),
    data: readyAudit.data,
  };
  if (publishedEvent.eventId !== readyEvent.eventId) throw new Error("Outbox retry changed eventId");
  if (publishedAudit.eventId !== readyAudit.eventId || publishedAudit.data.action !== "USER_REGISTERED") {
    throw new Error("Registration audit intent was not delivered safely");
  }
  const delivered = await waitForDeliveredEvent(publishedEvent.eventId, 30_000);
  if (delivered.eventId !== publishedEvent.eventId)
    throw new Error("Delivered eventId does not match outbox");

  const logs = execFileSync("docker", ["logs", "--tail", "500", "ailss-identity-service"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (logs.includes(password)) throw new Error("Registration password appeared in Identity logs");

  await writeEvidence("environment.json", {
    phase: "7.1",
    profile,
    runId,
    hostNode: process.version,
    runtimeNode: safeCommand("docker", ["exec", "ailss-identity-service", "node", "--version"]),
    gitCommit: safeCommand("git", ["rev-parse", "HEAD"]) || "NOT_A_GIT_REPOSITORY",
  });
  await writeEvidence("http-acceptance.json", {
    first: safeHttp(first),
    replay: safeHttp(replay),
    idempotencyConflict: safeHttp(changedPayload),
    duplicateEmail: safeHttp(duplicate),
    invalidPassword: safeHttp(invalid),
    massAssignment: safeHttp(massAssignment),
    malformedJson: { status: malformed.status, code: malformedJson.error.code },
    forgedIdentity: { status: forged.status },
    missingIdempotencyKey: {
      status: missingIdempotency.status,
      code: missingIdempotencyJson.error.code,
    },
    oversizedRequest: { status: oversized.status, code: oversizedJson.error.code },
    concurrentStatuses: raceStatuses,
    cqlLikeDisplayName: { status: injection.status, persistedExactly: true },
    emailFixtureSha256: createHash("sha256").update(email).digest("hex"),
  });
  await writeEvidence("cassandra-verification.json", {
    runtimeRole: "svc_identity",
    credentialRows: canonical.rows,
    userRows: user.rows,
    userId: credentialUserId,
    role: user.role,
    status: user.status,
    lecturerVerified: user.lecturerVerified,
    passwordHashAlgorithm: "argon2id",
    preparedCqlInjectionSafe: true,
  });
  await writeEvidence("outbox-broker-recovery.json", {
    registrationDuringOutageStatus: outage.status,
    readyEvent,
    publishedEvent,
    readyAudit,
    publishedAudit,
    deliveredEventId: delivered.eventId,
    stableEventId: delivered.eventId === readyEvent.eventId,
    passwordAbsentFromEvent: !JSON.stringify(delivered).toLowerCase().includes("password"),
  });
  await writeEvidence("summary.json", {
    stage: "phase-7.1-registration-acceptance",
    status: "PASS",
    realCassandra: true,
    rabbitFailureRecovery: true,
    stableEventId: true,
    auditAction: publishedAudit.data.action,
    passwordAbsentFromLogs: true,
  });
  console.log(
    JSON.stringify({
      stage: "phase-7.1-registration-acceptance",
      status: "PASS",
      runId,
      evidence: decodeURIComponent(evidenceDirectory.pathname),
    }),
  );
} finally {
  if (rabbitStopped) {
    try {
      execFileSync("docker", ["start", "ailss-rabbitmq"], { stdio: "ignore" });
      await waitUntil(async () => rabbitApi("/health/checks/ready-to-serve-clients"), 90_000);
    } catch {
      // Preserve the original acceptance error; the final report must surface an unhealthy environment.
    }
  }
  try {
    await rabbitApi(`/queues/%2Failss/${encodeURIComponent(queue)}`, "DELETE");
  } catch {
    // Evidence queue cleanup is best-effort after a failed run.
  }
  try {
    execFileSync("docker", ["restart", ...rabbitDependentContainers], { stdio: "ignore" });
  } catch {
    // The surrounding environment gate will report a failed restart.
  }
}

async function postRegistration(requestBody, idempotencyKey) {
  let transportError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:8080/api/v1/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify(requestBody),
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

async function waitForOutbox(userId, eventType, state, timeoutMs) {
  return waitUntil(async () => {
    return identityDbProbe({
      kind: "outbox",
      userId,
      eventType,
      state,
      day: new Date().toISOString().slice(0, 10),
    });
  }, timeoutMs);
}

async function waitForPublished(eventId, timeoutMs) {
  return waitUntil(
    async () => identityDbProbe({ kind: "eventById", eventId, state: "PUBLISHED" }),
    timeoutMs,
  );
}

async function waitForDeliveredEvent(eventId, timeoutMs) {
  return waitUntil(async () => {
    const messages = await rabbitApi(`/queues/%2Failss/${encodeURIComponent(queue)}/get`, "POST", {
      count: 100,
      ackmode: "ack_requeue_false",
      encoding: "auto",
      truncate: 100_000,
    });
    for (const message of messages ?? []) {
      const event = JSON.parse(message.payload);
      if (event.eventId === eventId) return event;
    }
    return undefined;
  }, timeoutMs);
}

async function waitUntil(operation, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await operation();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError ?? new Error(`Acceptance wait timed out after ${timeoutMs}ms`);
}

async function rabbitApi(path, method = "GET", body) {
  const response = await fetch(`http://127.0.0.1:15672/api${path}`, {
    method,
    headers: { authorization: adminAuth, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error(`RabbitMQ management API returned HTTP ${response.status}`);
  if (response.status === 204) return true;
  return response.json().catch(() => true);
}

function safeHttp(result) {
  return {
    status: result.status,
    code: result.json?.error?.code,
    userId: result.json?.data?.userId,
    role: result.json?.data?.role,
    accountStatus: result.json?.data?.status,
    replayed: result.json?.meta?.replayed,
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

function identityDbProbe(input) {
  const encoded = Buffer.from(JSON.stringify(input), "utf8").toString("base64url");
  const output = execFileSync(
    "docker",
    ["exec", "ailss-identity-service", "node", "--input-type=module", "-e", databaseProbeSource, encoded],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  return JSON.parse(output);
}
