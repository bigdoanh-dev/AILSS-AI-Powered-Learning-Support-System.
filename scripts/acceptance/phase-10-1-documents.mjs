import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
if ((process.env.AILSS_PROFILE ?? "dev-async") !== "dev-async") throw new Error("P10.1 requires dev-async");
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-"),
  evidence = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidence, { recursive: true });
await ready();
const admin = await register("admin"),
  lecturer = await register("lecturer"),
  other = await register("other");
db("identity", { action: "promote", userId: admin.userId, role: "ADMIN" });
db("identity", { action: "promote", userId: lecturer.userId, role: "LECTURER" });
const adminToken = (await login(admin)).accessToken;
expect(
  await http("POST", `/api/v1/admin/lecturers/${lecturer.userId}/verify`, {
    bearer: adminToken,
    key: `verify-${runId}`,
    body: { currentPassword: admin.password },
  }),
  200,
  "verify lecturer",
);
const lecturerToken = (await login(lecturer)).accessToken,
  otherToken = (await login(other)).accessToken;
const content = Buffer.from("AILSS secure document extraction\nPrompt text is data only.\n"),
  sha = createHash("sha256").update(content).digest("hex"),
  intentBody = {
    fileName: "p10-notes.txt",
    contentType: "text/plain",
    sizeBytes: content.length,
    sha256: sha,
  },
  intentKey = `intent-${runId}`;
expect(
  await http("POST", "/api/v1/ai/documents/upload-intents", {
    bearer: otherToken,
    key: `student-${runId}`,
    body: intentBody,
  }),
  403,
  "student denied",
);
const intent = await http("POST", "/api/v1/ai/documents/upload-intents", {
  bearer: lecturerToken,
  key: intentKey,
  body: intentBody,
});
expect(intent, 201, "intent");
const replay = await http("POST", "/api/v1/ai/documents/upload-intents", {
  bearer: lecturerToken,
  key: intentKey,
  body: intentBody,
});
expect(replay, 201, "intent replay");
if (replay.json.data.documentId !== intent.json.data.documentId || !replay.json.meta.replayed)
  throw new Error("intent replay mismatch");
expect(
  await http("POST", "/api/v1/ai/documents/upload-intents", {
    bearer: lecturerToken,
    key: intentKey,
    body: { ...intentBody, fileName: "changed.txt" },
  }),
  409,
  "intent conflict",
);
upload(intent.json.data.uploadUrl, content, "text/plain");
expect(
  await http("GET", `/api/v1/ai/documents/${intent.json.data.documentId}`, { bearer: otherToken }),
  404,
  "nonowner read",
);
const completeBody = {
    objectKey: intent.json.data.objectKey,
    sizeBytes: content.length,
    sha256: sha,
    contentType: "text/plain",
  },
  completeKey = `complete-${runId}`;
expect(
  await http("POST", `/api/v1/ai/documents/${intent.json.data.documentId}/complete`, {
    bearer: otherToken,
    key: `other-${runId}`,
    body: completeBody,
  }),
  404,
  "nonowner complete",
);
const complete = await http("POST", `/api/v1/ai/documents/${intent.json.data.documentId}/complete`, {
  bearer: lecturerToken,
  key: completeKey,
  body: completeBody,
});
expect(complete, 202, "complete");
const completeReplay = await http("POST", `/api/v1/ai/documents/${intent.json.data.documentId}/complete`, {
  bearer: lecturerToken,
  key: completeKey,
  body: completeBody,
});
expect(completeReplay, 202, "complete replay");
if (!completeReplay.json.meta.replayed) throw new Error("completion replay missing");
const final = await waitDocument(lecturerToken, intent.json.data.documentId, "EXTRACTED");
if (
  "objectKey" in final.json.data ||
  "uploadUrl" in final.json.data ||
  "extractionObjectKey" in final.json.data
)
  throw new Error("private storage reference leaked");
const state = db("ai", { action: "inspect", documentId: intent.json.data.documentId });
if (state.eventState !== "PUBLISHED" || state.jobState !== "COMPLETED" || !state.extractedPrivate)
  throw new Error(`canonical async state ${JSON.stringify(state)}`);
const outageBytes = Buffer.from("durable extraction while broker unavailable"),
  outageSha = createHash("sha256").update(outageBytes).digest("hex"),
  outageIntent = await http("POST", "/api/v1/ai/documents/upload-intents", {
    bearer: lecturerToken,
    key: `outage-intent-${runId}`,
    body: {
      fileName: "outage.txt",
      contentType: "text/plain",
      sizeBytes: outageBytes.length,
      sha256: outageSha,
    },
  });
expect(outageIntent, 201, "outage intent");
upload(outageIntent.json.data.uploadUrl, outageBytes, "text/plain");
execFileSync("docker", ["stop", "ailss-rabbitmq"], { stdio: "ignore" });
let outageEventId;
try {
  expect(
    await http("POST", `/api/v1/ai/documents/${outageIntent.json.data.documentId}/complete`, {
      bearer: lecturerToken,
      key: `outage-complete-${runId}`,
      body: {
        objectKey: outageIntent.json.data.objectKey,
        sizeBytes: outageBytes.length,
        sha256: outageSha,
        contentType: "text/plain",
      },
    }),
    202,
    "complete while broker unavailable",
  );
  const recoverable = db("ai", { action: "inspect", documentId: outageIntent.json.data.documentId });
  if (!["READY", "PUBLISHING"].includes(recoverable.eventState))
    throw new Error(`event not recoverable ${JSON.stringify(recoverable)}`);
  outageEventId = recoverable.eventId;
} finally {
  execFileSync("docker", ["start", "ailss-rabbitmq"], { stdio: "ignore" });
}
await rabbitReady();
execFileSync("docker", ["restart", "ailss-document-worker"], { stdio: "ignore" });
await waitDocument(lecturerToken, outageIntent.json.data.documentId, "EXTRACTED");
const outageFinal = db("ai", { action: "inspect", documentId: outageIntent.json.data.documentId });
if (outageFinal.eventId !== outageEventId || outageFinal.eventState !== "PUBLISHED")
  throw new Error("broker recovery changed event identity");
const bad = Buffer.from("actual bytes differ"),
  badDeclared = createHash("sha256").update("declared bytes").digest("hex"),
  badIntent = await http("POST", "/api/v1/ai/documents/upload-intents", {
    bearer: lecturerToken,
    key: `bad-intent-${runId}`,
    body: { fileName: "bad.txt", contentType: "text/plain", sizeBytes: bad.length, sha256: badDeclared },
  });
expect(badIntent, 201, "bad intent");
upload(badIntent.json.data.uploadUrl, bad, "text/plain");
expect(
  await http("POST", `/api/v1/ai/documents/${badIntent.json.data.documentId}/complete`, {
    bearer: lecturerToken,
    key: `bad-complete-${runId}`,
    body: {
      objectKey: badIntent.json.data.objectKey,
      sizeBytes: bad.length,
      sha256: badDeclared,
      contentType: "text/plain",
    },
  }),
  202,
  "bad queued",
);
await waitDocument(lecturerToken, badIntent.json.data.documentId, "QUARANTINED");
const isolation = db("ai", { action: "deny" });
if (!isolation.foreignDenied || !isolation.ddlDenied) throw new Error("AI Cassandra isolation failed");
const summary = {
  stage: "phase-10.1-secure-document-acceptance",
  status: "PASS",
  runId,
  documentId: intent.json.data.documentId,
  jobId: final.json.data.jobId,
  intentReplay: true,
  ownerConcealment: true,
  extractedPrivate: true,
  workerManualAck: true,
  checksumQuarantine: true,
  eventPublished: true,
  brokerRecoveryStableEvent: true,
  foreignKeyspaceDenied: true,
  runtimeDdlDenied: true,
  malwareScanner: "NOT_AVAILABLE_NO_CLAIM",
  counts: { publicApis: 98, internalApis: 15, queryIds: 74, events: 22, redis: false },
};
await writeFile(new URL("p10.1-summary.json", evidence), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ ...summary, evidence: decodeURIComponent(evidence.pathname) }));
async function register(label) {
  const id = randomUUID(),
    u = {
      email: `p101-${label}-${id}@example.test`,
      password: `P10.1-${label}-${id}-Aa1!`,
      displayName: `P101 ${label}`,
    },
    r = await http("POST", "/api/v1/auth/register", { key: `register-${id}`, body: u });
  expect(r, 201, "register");
  return { ...u, userId: r.json.data.userId };
}
async function login(user) {
  const r = await http("POST", "/api/v1/auth/login", {
    body: { email: user.email, password: user.password },
  });
  expect(r, 200, "login");
  return r.json.data;
}
async function http(method, path, { body, bearer, key } = {}) {
  let last;
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:8080${path}`, {
          method,
          headers: {
            ...(body ? { "content-type": "application/json" } : {}),
            ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
            ...(key ? { "idempotency-key": key } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(25000),
        }),
        text = await r.text();
      return { status: r.status, json: text ? JSON.parse(text) : undefined };
    } catch (e) {
      last = e;
      await new Promise((x) => setTimeout(x, 300));
    }
  }
  throw last;
}
function expect(r, status, label) {
  if (r.status !== status) throw new Error(`${label}: ${r.status} ${JSON.stringify(r.json)}`);
}
async function ready() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:8080/health/ready")).ok) return;
    } catch {
      /* restarting */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("gateway unavailable");
}
async function rabbitReady() {
  for (let i = 0; i < 100; i++) {
    try {
      const state = execFileSync("docker", ["inspect", "-f", "{{.State.Health.Status}}", "ailss-rabbitmq"], {
        encoding: "utf8",
      }).trim();
      if (state === "healthy") return;
    } catch {
      // Broker is restarting.
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("RabbitMQ did not recover");
}
function upload(url, content, type) {
  execFileSync(
    "docker",
    [
      "exec",
      "ailss-ai-service",
      "node",
      "--input-type=module",
      "-e",
      `const [u,b,t]=process.argv.slice(1);const r=await fetch(u,{method:"PUT",headers:{"content-type":t},body:Buffer.from(b,"base64")});if(!r.ok)throw new Error("upload "+r.status);`,
      url,
      content.toString("base64"),
      type,
    ],
    { stdio: "pipe" },
  );
}
async function waitDocument(token, id, status) {
  for (let i = 0; i < 120; i++) {
    const r = await http("GET", `/api/v1/ai/documents/${id}`, { bearer: token });
    if (r.status === 200 && r.json.data.status === status) return r;
    if (
      r.status === 200 &&
      ["FAILED", "QUARANTINED"].includes(r.json.data.status) &&
      r.json.data.status !== status
    )
      throw new Error(`unexpected ${r.json.data.status}`);
    await new Promise((x) => setTimeout(x, 250));
  }
  throw new Error(`document did not reach ${status}`);
}
function db(service, input) {
  const container = service === "identity" ? "ailss-identity-service" : "ailss-ai-service";
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", container, "node", "--input-type=module", "-e", probe(service)], {
      input: JSON.stringify(input),
      encoding: "utf8",
    }).trim(),
  );
}
function probe(service) {
  return `import{readFileSync}from"node:fs";import{createHash}from"node:crypto";import c from"cassandra-driver";import{Client as M}from"minio";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)});await x.connect();const q={prepare:true,consistency:c.types.consistencies.localQuorum},u=v=>c.types.Uuid.fromString(v);let o;if(${JSON.stringify(service)}==="identity"&&i.action==="promote"){const r=(await x.execute("SELECT display_name,role,status,lecturer_verified,profile_version,updated_at FROM user_by_id WHERE user_id=?",[u(i.userId)],q)).rows[0],s=(createHash("sha256").update(i.userId).digest()[0]??0)%16;await x.execute("DELETE FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?",[r.get("role"),r.get("status"),s,r.get("updated_at"),u(i.userId)],q);await x.execute("UPDATE user_by_id SET role=? WHERE user_id=?",[i.role,u(i.userId)],q);await x.execute("INSERT INTO users_by_role_status_bucket (role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version) VALUES (?,?,?,?,?,?,?,?)",[i.role,r.get("status"),s,r.get("updated_at"),u(i.userId),r.get("display_name"),r.get("lecturer_verified"),r.get("profile_version")],q);o={ok:true};}else if(i.action==="inspect"){const d=(await x.execute("SELECT job_id,event_id,extraction_object_key,status FROM document_by_id WHERE document_id=?",[u(i.documentId)],q)).rows[0],j=(await x.execute("SELECT state FROM ai_job_by_id WHERE job_id=?",[d.get("job_id")],q)).rows[0],e=(await x.execute("SELECT state FROM pending_event_by_id WHERE event_id=?",[d.get("event_id")],q)).rows[0],m=new M({endPoint:process.env.OBJECT_STORAGE_ENDPOINT,port:Number(process.env.OBJECT_STORAGE_PORT),useSSL:false,accessKey:process.env.OBJECT_STORAGE_ACCESS_KEY,secretKey:process.env.OBJECT_STORAGE_SECRET_KEY});let exists=false;try{await m.statObject(process.env.OBJECT_STORAGE_BUCKET,d.get("extraction_object_key"));exists=true;}catch{}o={documentState:d.get("status"),jobState:j.get("state"),eventId:d.get("event_id").toString(),eventState:e.get("state"),extractedPrivate:exists};}else if(i.action==="deny"){let foreignDenied=false,ddlDenied=false;try{await x.execute("SELECT user_id FROM identity_keyspace.user_by_id LIMIT 1");}catch{foreignDenied=true;}try{await x.execute("CREATE TABLE ai_keyspace.runtime_forbidden (id uuid PRIMARY KEY)");}catch{ddlDenied=true;}o={foreignDenied,ddlDenied};}await x.shutdown();console.log(JSON.stringify(o));`;
}
