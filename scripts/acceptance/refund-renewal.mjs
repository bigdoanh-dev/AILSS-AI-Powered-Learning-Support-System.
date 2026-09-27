import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readEnv, required } from "../dev/env.mjs";

// Local commerce boundary proof, never a paid-provider attestation. No direct
// mutation of orders/enrollments/entitlements: all writes go through HTTP commands.
const fixture = await readEnv(new URL("../../.env.media-acceptance", import.meta.url));
const base = "http://127.0.0.1:8080/api/v1";
let step = "environment";
const passed = [];
function check(label, condition) {
  assert.ok(condition, label);
  passed.push(label);
  console.log(`PASS ${label}`);
}
function docker(program, input = {}) {
  return execFileSync(
    "docker",
    ["exec", "-i", "ailss-learning-service", "node", "--input-type=module", "-e", program],
    { input: JSON.stringify(input), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}
async function api(token, route, method = "GET", body, key, expected = 200) {
  const response = await fetch(base + route, {
    method,
    headers: {
      Connection: "close",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const value = await response.json();
  assert.equal(response.status, expected, `${route}: HTTP ${response.status} ${value.error?.code ?? ""}`);
  return expected >= 400 ? value.error : value.data;
}
async function bytes(url, expected = 200) {
  const response = await fetch(url, {
    headers: { Connection: "close" },
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, expected, `Delivery HTTP ${response.status}`);
  return expected === 200 ? response.text() : undefined;
}
async function playback(token) {
  const session = await api(
    token,
    `/lessons/${required(fixture, "PHASE42_LESSON_ID")}/media-session`,
    "POST",
    {},
  );
  const master = await bytes(session.playlistUrl);
  assert.ok(master.startsWith("#EXTM3U"));
  const variant = new URL(
    master.split("\n").find((line) => line && !line.startsWith("#")),
    session.playlistUrl,
  );
  const playlist = await bytes(variant);
  const segment = new URL(
    playlist.split("\n").find((line) => line && !line.startsWith("#")),
    variant,
  );
  const response = await fetch(segment, {
    headers: { Connection: "close" },
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 200);
  assert.ok((await response.arrayBuffer()).byteLength > 188);
  return session;
}
function durable(studentId, orderId, refundId) {
  const program = `import{readFileSync}from"node:fs";import{Client,types}from"cassandra-driver";
const i=JSON.parse(readFileSync(0,"utf8")),db=new Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,credentials:{username:process.env.CASSANDRA_USERNAME,password:process.env.CASSANDRA_PASSWORD}}),u=types.Uuid.fromString,q={prepare:true,consistency:types.consistencies.localQuorum};
try{
const entitlement=(await db.execute("SELECT state,version FROM entitlement_by_student_course WHERE student_id=? AND course_id=?",[u(i.studentId),u(i.courseId)],q)).rows[0];
const refund=(await db.execute("SELECT status,order_id,student_id FROM course_refund_by_id WHERE refund_id=?",[u(i.refundId)],q)).rows[0];
const locator=(await db.execute("SELECT status,refund_id FROM course_refund_by_order WHERE order_id=?",[u(i.orderId)],q)).rows[0];
console.log(JSON.stringify({entitlement:entitlement.state,version:String(entitlement.version),refund:refund.status,orderId:String(refund.order_id),studentId:String(refund.student_id),locator:locator.status,refundId:String(locator.refund_id)}));
}finally{await db.shutdown();}`;
  return JSON.parse(
    docker(program, { studentId, courseId: required(fixture, "PHASE42_COURSE_ID"), orderId, refundId }),
  );
}
try {
  const settings = JSON.parse(
    docker(
      `console.log(JSON.stringify({nodeEnv:process.env.NODE_ENV,paymentMode:process.env.PAYMENT_MODE,paymentProvider:process.env.PAYMENT_PROVIDER}));`,
    ),
  );
  assert.notEqual(settings.nodeEnv, "production", "Never enable simulation against production");
  assert.equal(settings.paymentMode, "simulation", "Requires pre-existing explicit local simulation mode");
  assert.ok(!settings.paymentProvider || settings.paymentProvider === "simulation");
  step = "authoritative-offering";
  const lecturer = (
    await api(undefined, "/auth/login", "POST", {
      email: required(fixture, "PHASE42_LECTURER_EMAIL"),
      password: required(fixture, "PHASE42_LECTURER_PASSWORD"),
    })
  ).accessToken;
  const suffix = randomUUID();
  const offering = await api(
    lecturer,
    `/courses/${required(fixture, "PHASE42_COURSE_ID")}/offerings`,
    "POST",
    {
      offeringType: "SELF_PACED",
      title: `Media refund acceptance ${suffix.slice(0, 8)}`,
      price: "10000",
      currency: "VND",
    },
    randomUUID(),
    201,
  );
  await api(lecturer, `/offerings/${offering.offeringId}/publish`, "POST", {}, randomUUID());
  check("Owned paid Offering published through domain HTTP API", true);
  step = "student-order";
  const account = {
    email: `phase42-refund-${suffix}@example.test`,
    password: `Phase42-${suffix}-Aa1!`,
    displayName: "Phase42 refund acceptance",
  };
  const registered = await api(undefined, "/auth/register", "POST", account, randomUUID(), 201);
  const student = (
    await api(undefined, "/auth/login", "POST", { email: account.email, password: account.password })
  ).accessToken;
  const denied = await api(
    student,
    `/lessons/${required(fixture, "PHASE42_LESSON_ID")}/media-session`,
    "POST",
    {},
    undefined,
    403,
  );
  assert.equal(denied.code, "MEDIA_ENTITLEMENT_REQUIRED");
  check("New student cannot play before purchase/fulfillment", true);
  const order = await api(student, "/orders", "POST", { offeringId: offering.offeringId }, randomUUID(), 201);
  check(
    "Order uses authoritative Offering price and currency",
    order.price === "10000" && order.currency === "VND",
  );
  await api(
    student,
    `/orders/${order.orderId}/simulate-payment`,
    "POST",
    { outcome: "SUCCESS" },
    randomUUID(),
  );
  step = "async-fulfillment";
  const deadline = Date.now() + 120_000;
  let entitled = false;
  while (Date.now() < deadline) {
    const current = await api(student, `/orders/${order.orderId}`);
    if (current.state === "ENTITLED") {
      entitled = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.equal(entitled, true, "Actual outbox/consumer must complete commerce fulfillment");
  const session = await playback(student);
  check("Actual payment command/event fulfillment grants playback", true);
  step = "expiry";
  const expiry = Date.parse(session.expiresAt);
  assert.ok(Number.isFinite(expiry) && expiry > Date.now() && expiry - Date.now() < 301_000);
  console.log(`WAIT_REAL_SESSION_EXPIRY seconds=${Math.ceil((expiry - Date.now()) / 1000)}`);
  // Short intervals allow the surrounding task to report progress during this
  // real configured TTL. No timestamp/key/token mutation or forged expiry proof.
  while (Date.now() <= expiry + 1500)
    await new Promise((resolve) => setTimeout(resolve, Math.min(5000, expiry + 1501 - Date.now())));
  await bytes(session.playlistUrl, 403);
  check("Original production-issued playback token expires and delivery denies it", true);
  step = "renewal";
  const renewed = await playback(student);
  check(
    "ACTIVE entitlement obtains new session and actual HLS resumes",
    renewed.mediaAssetId === session.mediaAssetId && renewed.playlistUrl !== session.playlistUrl,
  );
  step = "refund-domain-command";
  const other = (
    await api(undefined, "/auth/login", "POST", {
      email: required(fixture, "PHASE42_OTHER_EMAIL"),
      password: required(fixture, "PHASE42_OTHER_PASSWORD"),
    })
  ).accessToken;
  await api(
    other,
    "/learning/refunds",
    "POST",
    { orderId: order.orderId, reason: "Phase42 unauthorized refund probe" },
    randomUUID(),
    403,
  );
  const refund = await api(
    student,
    "/learning/refunds",
    "POST",
    { orderId: order.orderId, reason: "Phase42 internal refund/revocation acceptance" },
    randomUUID(),
  );
  assert.equal(refund.status, "PROCESSED");
  const persisted = durable(registered.userId, order.orderId, refund.refundId);
  assert.equal(persisted.entitlement, "REVOKED");
  assert.equal(persisted.refund, "PROCESSED");
  assert.equal(persisted.locator, "PROCESSED");
  assert.equal(persisted.orderId, order.orderId);
  assert.equal(persisted.studentId, registered.userId);
  assert.equal(persisted.refundId, refund.refundId);
  check("Refund command persists refund ledger/locator and REVOKED entitlement", true);
  step = "revoked-renewal";
  const revoked = await api(
    student,
    `/lessons/${required(fixture, "PHASE42_LESSON_ID")}/media-session`,
    "POST",
    {},
    undefined,
    403,
  );
  assert.equal(revoked.code, "MEDIA_ENTITLEMENT_REQUIRED");
  check("Revocation denies new playback session at authoritative boundary", true);
  console.log(
    `PHASE42_REFUND_RENEWAL_PASS checks=${passed.length} order=${order.orderId} refund=${refund.refundId} student=${registered.userId} entitlementVersion=${persisted.version} provider=LOCAL_SIMULATION noDirectEntitlementMutation=true`,
  );
} catch (error) {
  console.error(
    `PHASE42_REFUND_RENEWAL_FAIL step=${step} name=${error.name} message=${String(error.message).replace(/https?:\/\/[^\s]+/g, "[URL REDACTED]")}`,
  );
  process.exitCode = 1;
}
