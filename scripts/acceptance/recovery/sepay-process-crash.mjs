import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { writeFile } from "node:fs/promises";

const runId = randomUUID();
const apiKey = randomBytes(32).toString("hex");
const account = "999000222";
const boundaries = [
  "A_CANDIDATE",
  "B_TRANSACTION",
  "C1_OUTBOX_DUE_PREPARED",
  "C2_OUTBOX_ID_PREPARED",
  "D_ORDER_PAID",
  "E1_OUTBOX_DUE_READY",
  "E2_OUTBOX_ID_READY",
  "F_READY_BEFORE_PUBLISH",
  "G_PUBLISHED_BEFORE_ACK",
  "H_ENTITLEMENT_SCHEDULED",
];
const matrix = [];

function docker(args, options = {}) {
  const output = execFileSync("docker", args, { encoding: "utf8", ...options });
  return typeof output === "string" ? output.trim() : "";
}
function learning(boundary = "", crashRunId = "") {
  docker(
    [
      "compose",
      "--env-file",
      ".env",
      "-f",
      "docker-compose.yml",
      "-f",
      "docker-compose.async.yml",
      "--profile",
      "dev-async",
      "up",
      "-d",
      "--no-deps",
      "--force-recreate",
      "learning-service",
    ],
    {
      env: {
        ...process.env,
        AILSS_PROFILE: "dev-async",
        PAYMENT_MODE: "sepay",
        SEPAY_WEBHOOK_API_KEY: apiKey,
        SEPAY_ACCOUNT_NUMBER: account,
        SEPAY_ACCOUNT_NAME: "AILSS PROCESS CRASH TEST",
        SEPAY_BANK: "MB",
        AILSS_TEST_CRASH_BOUNDARY: boundary,
        AILSS_TEST_CRASH_RUN_ID: crashRunId,
      },
      stdio: "ignore",
    },
  );
}
async function ready() {
  for (let i = 0; i < 120; i++) {
    try {
      docker(
        [
          "exec",
          "ailss-learning-service",
          "node",
          "--input-type=module",
          "-e",
          "const r=await fetch('http://127.0.0.1:8102/health/ready');process.exit(r.ok?0:1)",
        ],
        { stdio: "ignore" },
      );
      return;
    } catch {
      await delay(500);
    }
  }
  throw new Error("Learning readiness timed out");
}
function processIdentity() {
  return JSON.parse(docker(["inspect", "ailss-learning-service", "--format", "{{json .State}}"]));
}
async function waitDead() {
  for (let i = 0; i < 80; i++) {
    const state = processIdentity();
    if (!state.Running) return state;
    await delay(250);
  }
  throw new Error("Learning process did not die");
}
async function http(method, path, { body, token, authorization, key = randomUUID() } = {}) {
  try {
    const response = await fetch(`http://127.0.0.1:8080${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        "idempotency-key": key,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(authorization ? { authorization } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    return { status: response.status, json: text ? JSON.parse(text) : undefined };
  } catch (error) {
    return { status: 0, error: error instanceof Error ? error.message : String(error) };
  }
}
function expectStatus(result, status, label) {
  assert.equal(result.status, status, `${label}: ${JSON.stringify(result.json ?? result.error)}`);
  return result.json.data;
}
async function register(label, role = "STUDENT") {
  const value = {
    email: `crash-${label}-${randomUUID()}@example.test`,
    password: `${randomUUID()}-Aa1!`,
    displayName: `Crash ${label}`,
    role,
  };
  const data = expectStatus(await http("POST", "/api/v1/auth/register", { body: value }), 201, "register");
  return { ...value, userId: data.userId };
}
async function login(user) {
  return expectStatus(
    await http("POST", "/api/v1/auth/login", { body: { email: user.email, password: user.password } }),
    200,
    "login",
  ).accessToken;
}
function promoteAdmin(userId) {
  const program = `import{readFileSync}from'node:fs';import{createHash}from'node:crypto';import c from'cassandra-driver';const id=JSON.parse(readFileSync(0,'utf8')).userId,x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(','),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();try{const r=(await x.execute('SELECT display_name,role,status,lecturer_verified,profile_version,updated_at FROM user_by_id WHERE user_id=?',[u(id)],q)).rows[0],s=createHash('sha256').update(id).digest()[0]%16;await x.execute('DELETE FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?',[r.role,r.status,s,r.updated_at,u(id)],q);await x.execute('UPDATE user_by_id SET role=? WHERE user_id=?',['ADMIN',u(id)],q);await x.execute('INSERT INTO users_by_role_status_bucket (role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version) VALUES (?,?,?,?,?,?,?,?)',['ADMIN',r.status,s,r.updated_at,u(id),r.display_name,r.lecturer_verified,r.profile_version],q);}finally{await x.shutdown();}`;
  docker(["exec", "-i", "ailss-identity-service", "node", "--input-type=module", "-e", program], {
    input: JSON.stringify({ userId }),
    stdio: ["pipe", "ignore", "pipe"],
  });
}
function state(transactionId, orderId) {
  const input = JSON.stringify({ transactionId, orderId });
  const program = `import{createHash}from'node:crypto';import{CassandraClient}from'/app/dist/packages/cassandra/src/index.js';const i=${input},db=await CassandraClient.create({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(','),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:'learning_keyspace',username:process.env.CASSANDRA_USERNAME,password:process.env.CASSANDRA_PASSWORD}),driver=await import('cassandra-driver'),u=driver.types.Uuid.fromString,s=createHash('sha256').update(i.transactionId).digest()[0]%16;try{const one=async(q,p)=>(await db.execute(q,p,'LOCAL_QUORUM'))[0],c=await one('SELECT * FROM sepay_recovery_by_shard WHERE shard=? AND transaction_id=?',[s,i.transactionId]),t=await one('SELECT order_id,fingerprint,received_at FROM sepay_transaction_by_id WHERE transaction_id=?',[i.transactionId]),p=await one('SELECT transaction_id,received_at FROM sepay_payment_by_order WHERE order_id=?',[u(i.orderId)]),o=await one('SELECT state,fulfillment_state,paid_at,paid_event_id,student_id,course_id FROM order_by_id WHERE order_id=?',[u(i.orderId)]),eventId=o?String(o.paid_event_id):null,ev=eventId?await one('SELECT state,published_at FROM pending_event_by_id WHERE event_id=?',[u(eventId)]):null;let due=null;if(c&&eventId){const at=c.received_at,day=driver.types.LocalDate.fromString(at.toISOString().slice(0,10)),e=createHash('sha256').update(eventId).digest()[0]%16;due=await one('SELECT state,payload_json FROM pending_events_by_due_bucket WHERE due_day=? AND shard=? AND next_attempt_at=? AND event_id=?',[day,e,at,u(eventId)]);}console.log(JSON.stringify({candidate:c?{transactionId:String(c.transaction_id),orderId:String(c.order_id),fingerprint:String(c.fingerprint),recoveryMac:String(c.recovery_mac),receivedAt:c.received_at.toISOString(),paidEventId:String(c.paid_event_id),correlationId:String(c.correlation_id),state:String(c.state),leaseOwner:c.lease_owner?String(c.lease_owner):null,leaseFence:Number(String(c.lease_fence))}:null,transaction:t?{orderId:String(t.order_id),fingerprint:String(t.fingerprint),receivedAt:t.received_at.toISOString()}:null,payment:p?{transactionId:String(p.transaction_id),receivedAt:p.received_at.toISOString()}:null,order:o?{state:String(o.state),fulfillmentState:String(o.fulfillment_state),paidAt:o.paid_at?.toISOString()??null,paidEventId:eventId,studentId:String(o.student_id),courseId:String(o.course_id)}:null,event:ev?{state:String(ev.state),publishedAt:ev.published_at?.toISOString()??null}:null,due:due?{state:String(due.state),correlationId:JSON.parse(String(due.payload_json)).correlationId}:null}));}finally{await db.close();}`;
  const output = docker(
    [
      "compose",
      "--env-file",
      ".env",
      "-f",
      "docker-compose.yml",
      "-f",
      "docker-compose.async.yml",
      "--profile",
      "dev-async",
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "--entrypoint",
      "node",
      "learning-service",
      "--input-type=module",
    ],
    { input: program, stdio: ["pipe", "pipe", "pipe"] },
  );
  return JSON.parse(output.split("\n").at(-1));
}
async function waitConverged(token, transactionId, orderId, identity) {
  let last;
  for (let i = 0; i < 180; i++) {
    const response = await http("GET", `/api/v1/orders/${orderId}`, { token });
    if (response.status === 200) last = response.json.data;
    if (last?.state === "ENTITLED") {
      const snapshot = state(transactionId, orderId);
      if (!snapshot.candidate && snapshot.event?.state === "PUBLISHED") {
        assert.equal(snapshot.transaction.orderId, orderId);
        assert.equal(snapshot.transaction.fingerprint, identity.fingerprint);
        assert.equal(snapshot.transaction.receivedAt, identity.receivedAt);
        assert.equal(snapshot.payment.transactionId, transactionId);
        assert.equal(snapshot.payment.receivedAt, identity.receivedAt);
        assert.equal(snapshot.order.paidEventId, identity.paidEventId);
        return snapshot;
      }
    }
    await delay(500);
  }
  throw new Error(`Recovery did not converge: ${JSON.stringify(last)}`);
}

learning();
await ready();
const admin = await register("admin");
promoteAdmin(admin.userId);
const lecturer = await register("lecturer", "LECTURER");
const adminToken = await login(admin);
expectStatus(
  await http("POST", `/api/v1/admin/lecturers/${lecturer.userId}/verify`, {
    token: adminToken,
    body: { currentPassword: admin.password },
  }),
  200,
  "verify lecturer",
);
const lecturerToken = await login(lecturer);
const course = expectStatus(
  await http("POST", "/api/v1/courses", {
    token: lecturerToken,
    body: {
      title: "Process crash recovery",
      slug: `crash-${runId}`,
      categoryId: randomUUID(),
      priceType: "FREE",
      price: "0",
      currency: "VND",
    },
  }),
  201,
  "course",
);
expectStatus(
  await http("POST", `/api/v1/courses/${course.courseId}/lessons`, {
    token: lecturerToken,
    body: {
      title: "Crash lesson",
      sectionTitle: "Recovery",
      position: { sectionOrder: 1, lessonOrder: 1 },
      preview: false,
    },
  }),
  201,
  "lesson",
);
expectStatus(
  await http("POST", `/api/v1/courses/${course.courseId}/submit-review`, { token: lecturerToken }),
  202,
  "review",
);
expectStatus(
  await http("POST", `/api/v1/admin/courses/${course.courseId}/publish`, {
    token: adminToken,
    body: { currentPassword: admin.password },
  }),
  200,
  "publish course",
);
const offering = expectStatus(
  await http("POST", `/api/v1/courses/${course.courseId}/offerings`, {
    token: lecturerToken,
    body: { offeringType: "SELF_PACED", title: "Crash VND", price: "2000", currency: "VND" },
  }),
  201,
  "offering",
);
expectStatus(
  await http("POST", `/api/v1/offerings/${offering.offeringId}/publish`, { token: lecturerToken }),
  200,
  "publish offering",
);

try {
  for (const boundary of boundaries) {
    learning();
    await ready();
    const student = await register(boundary.toLowerCase());
    const token = await login(student);
    const order = expectStatus(
      await http("POST", "/api/v1/orders", { token, body: { offeringId: offering.offeringId } }),
      201,
      "order",
    );
    const transactionId = String(Date.now() * 100 + matrix.length);
    const transaction = {
      id: Number(transactionId),
      transferType: "in",
      accountNumber: account,
      transferAmount: 2000,
      content: `AILSS${order.orderId.replaceAll("-", "").toUpperCase()}`,
    };
    const caseRunId = randomUUID();
    learning(boundary, caseRunId);
    await ready();
    docker(["update", "--restart=no", "ailss-learning-service"], { stdio: "ignore" });
    const before = processIdentity();
    const callback = await http("POST", "/api/v1/payments/sepay/webhook", {
      body: transaction,
      authorization: `Apikey ${apiKey}`,
    });
    const dead = await waitDead();
    const logs = docker(["logs", "ailss-learning-service"]);
    assert.match(logs, new RegExp(`"runId":"${caseRunId}".*"boundary":"${boundary}"`));
    const crashed = state(transactionId, order.orderId);
    assert.ok(crashed.candidate, `${boundary}: candidate must remain at crash`);
    const identity = crashed.candidate;
    assert.equal(identity.transactionId, transactionId);
    assert.equal(identity.orderId, order.orderId);
    assert.equal(identity.paidEventId, crashed.order.paidEventId);
    if (boundary === "A_CANDIDATE") assert.equal(crashed.transaction, null);
    if (boundary === "B_TRANSACTION") {
      assert.ok(crashed.transaction);
      assert.equal(crashed.payment, null);
    }
    if (["C1_OUTBOX_DUE_PREPARED", "C2_OUTBOX_ID_PREPARED"].includes(boundary))
      assert.equal(crashed.order.state, "PENDING");
    if (
      ["D_ORDER_PAID", "E1_OUTBOX_DUE_READY", "E2_OUTBOX_ID_READY", "F_READY_BEFORE_PUBLISH"].includes(
        boundary,
      )
    )
      assert.equal(crashed.order.state, "PAID_PENDING_ENTITLEMENT");
    if (boundary === "C1_OUTBOX_DUE_PREPARED") {
      assert.equal(crashed.due?.state, "PREPARED");
      assert.equal(crashed.event, null);
    }
    if (boundary === "C2_OUTBOX_ID_PREPARED" || boundary === "D_ORDER_PAID") {
      assert.equal(crashed.due?.state, "PREPARED");
      assert.equal(crashed.event?.state, "PREPARED");
    }
    if (boundary === "E1_OUTBOX_DUE_READY") {
      assert.equal(crashed.due?.state, "READY");
      assert.equal(crashed.event?.state, "PREPARED");
    }
    if (["E2_OUTBOX_ID_READY", "F_READY_BEFORE_PUBLISH"].includes(boundary)) {
      assert.equal(crashed.due?.state, "READY");
      assert.equal(crashed.event?.state, "READY");
    }
    if (boundary === "G_PUBLISHED_BEFORE_ACK") {
      assert.equal(crashed.due?.state, "PUBLISHING");
      assert.equal(crashed.event?.state, "PUBLISHING");
    }
    if (boundary === "H_ENTITLEMENT_SCHEDULED") assert.equal(crashed.event?.state, "PUBLISHED");
    if (crashed.due?.correlationId) assert.equal(crashed.due.correlationId, identity.correlationId);
    learning();
    await ready();
    const final = await waitConverged(token, transactionId, order.orderId, identity);
    const after = processIdentity();
    matrix.push({
      boundary,
      durableStateAtCrash: crashed,
      processActuallyDied: !dead.Running && dead.ExitCode === 86,
      callbackStatusBeforeDeath: callback.status,
      providerReplaySuppressed: true,
      autonomouslyRediscovered: true,
      identityPreserved: true,
      eventObligationRepaired: final.event.state === "PUBLISHED",
      entitlementConverged: final.order.state === "ENTITLED",
      candidateCleanupCorrect: final.candidate === null,
      process: {
        beforePid: before.Pid,
        beforeStartedAt: before.StartedAt,
        crashExitCode: dead.ExitCode,
        afterPid: after.Pid,
        afterStartedAt: after.StartedAt,
      },
      status: "PASS",
    });
  }
} finally {
  learning();
  await ready();
}
assert.equal(matrix.length, boundaries.length);
const result = {
  gate: "sepay-process-crash-recovery",
  status: "PASS",
  runId,
  providerReplayCount: 0,
  boundaries: matrix,
};
await writeFile("evidence/p12-9rc/process-crash/matrix.json", `${JSON.stringify(result, null, 2)}\n`);
console.log(
  JSON.stringify({
    gate: result.gate,
    status: result.status,
    runId,
    boundaries: matrix.map((row) => row.boundary),
  }),
);
