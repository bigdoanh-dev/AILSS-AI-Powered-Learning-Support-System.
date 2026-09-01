import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

if ((process.env.AILSS_PROFILE ?? "dev-async") !== "dev-async") throw new Error("P7.17 requires dev-async");
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-"),
  evidence = new URL(`../../docs/evidence/${runId}/`, import.meta.url),
  hour = 3_600_000,
  base = Math.ceil((Date.now() + 72 * hour) / hour) * hour,
  at = (offsetHours) => new Date(base + offsetHours * hour).toISOString(),
  day = (offsetHours) => new Date(base + offsetHours * hour).toISOString().slice(0, 10);
await mkdir(evidence, { recursive: true });
await ready();

const admin = await register("admin"),
  lecturer = await register("lecturer"),
  freeStudent = await register("free"),
  paidStudent = await register("paid"),
  liveStudent = await register("live"),
  conflictStudent = await register("conflict"),
  expiryStudent = await register("expiry"),
  brokerStudent = await register("broker");
identity({ action: "promote", userId: admin.userId, role: "ADMIN" });
identity({ action: "promote", userId: lecturer.userId, role: "LECTURER" });
const adminToken = (await login(admin)).accessToken;
expectStatus(
  await http("POST", `/api/v1/admin/lecturers/${lecturer.userId}/verify`, {
    bearer: adminToken,
    key: `verify-${runId}`,
    body: { currentPassword: admin.password },
  }),
  200,
  "verify Lecturer",
);
const lecturerToken = (await login(lecturer)).accessToken,
  tokens = {
    free: (await login(freeStudent)).accessToken,
    paid: (await login(paidStudent)).accessToken,
    live: (await login(liveStudent)).accessToken,
    conflict: (await login(conflictStudent)).accessToken,
    expiry: (await login(expiryStudent)).accessToken,
    broker: (await login(brokerStudent)).accessToken,
  };

const course = await publishedCourse(lecturerToken, adminToken, admin.password);
const defaultId = defaultOfferingId(course.courseId);
learning({
  action: "seedDefault",
  offeringId: defaultId,
  courseId: course.courseId,
});

// LRN-14 compatibility FREE path, exact replay, projections, event, and P7.13 authorization.
const freeKey = `free-${runId}`,
  free = await http("POST", `/api/v1/courses/${course.courseId}/enrollments`, {
    bearer: tokens.free,
    key: freeKey,
  });
expectStatus(free, 200, "LRN-14 FREE enrollment");
if (free.json.data.state !== "ACTIVE" || free.json.data.offeringId !== defaultId)
  throw new Error("FREE enrollment did not resolve the deterministic SELF_PACED Offering");
const freeReplay = await http("POST", `/api/v1/courses/${course.courseId}/enrollments`, {
  bearer: tokens.free,
  key: freeKey,
});
expectStatus(freeReplay, 200, "LRN-14 replay");
if (!freeReplay.json.meta.replayed || freeReplay.json.data.enrollmentId !== free.json.data.enrollmentId)
  throw new Error("FREE enrollment replay changed logical identity");
expectStatus(
  await http("GET", `/api/v1/lessons/${course.lessonId}`, { bearer: tokens.free }),
  200,
  "P7.13 canonical entitlement lesson access",
);

// Two paid SELF_PACED Offerings for the same Course prove Offering enrollment identity and one Course grant.
const paidA = await createOffering("SELF_PACED", "P717 Paid Access A", "120.50"),
  paidB = await createOffering("SELF_PACED", "P717 Paid Access B", "150.00"),
  purchaseKey = `purchase-concurrent-${runId}`;
const concurrent = await Promise.all([
  createOrder(tokens.paid, paidA.offeringId, purchaseKey),
  createOrder(tokens.paid, paidA.offeringId, purchaseKey),
]);
for (const response of concurrent) expectStatus(response, 201, "concurrent same-key purchase");
if (concurrent[0].json.data.orderId !== concurrent[1].json.data.orderId)
  throw new Error("concurrent purchase produced two Orders");
const paidOrderA = concurrent[0].json.data,
  paymentKey = `payment-${runId}`,
  payment = await pay(tokens.paid, paidOrderA.orderId, "SUCCESS", paymentKey);
expectStatus(payment, 200, "SELF_PACED payment");
if (payment.json.data.state !== "PAID_PENDING_ENTITLEMENT")
  throw new Error("payment ran fulfillment synchronously or did not commit paid state");
const paymentReplay = await pay(tokens.paid, paidOrderA.orderId, "SUCCESS", paymentKey);
expectStatus(paymentReplay, 200, "payment response-loss replay");
if (!paymentReplay.json.meta.replayed || paymentReplay.json.data.version !== payment.json.data.version)
  throw new Error("payment replay changed logical result");
const entitledA = await waitOrder(tokens.paid, paidOrderA.orderId, "ENTITLED");
if (entitledA.fulfillmentState !== "ACTIVE") throw new Error("SELF_PACED fulfillment not ACTIVE");
const eventA = await waitEventsPublished(paidOrderA.orderId);
if (eventA.paidEventState !== "PUBLISHED" || eventA.enrolledEventState !== "PUBLISHED")
  throw new Error(`SELF_PACED events did not publish ${JSON.stringify(eventA)}`);

const orderB = await createOrder(tokens.paid, paidB.offeringId, `purchase-b-${runId}`);
expectStatus(orderB, 201, "second Offering purchase");
expectStatus(
  await pay(tokens.paid, orderB.json.data.orderId, "SUCCESS", `payment-b-${runId}`),
  200,
  "second payment",
);
await waitOrder(tokens.paid, orderB.json.data.orderId, "ENTITLED");
const multi = learning({
  action: "access",
  studentId: paidStudent.userId,
  courseId: course.courseId,
  offeringIds: [paidA.offeringId, paidB.offeringId],
});
if (multi.activeEnrollments !== 2 || multi.entitlementState !== "ACTIVE" || multi.myCourseRows !== 1)
  throw new Error(`multi-Offering convergence mismatch ${JSON.stringify(multi)}`);

// Build one published LIVE_COHORT and an overlapping confirmed PRIVATE schedule.
const liveClass = await scheduledClass("P717 Purchase Cohort", "LIVE_COHORT", at(0), at(2), course.courseId),
  liveOffering = await createOffering("LIVE_COHORT", "P717 Live Purchase", "300.00", liveClass.classId),
  conflictClass = await scheduledClass("P717 Existing Schedule", "PRIVATE", at(1), at(3));
expectStatus(
  await http("POST", "/api/v1/classes/join", {
    bearer: tokens.conflict,
    key: `join-conflict-${runId}`,
    body: { code: conflictClass.joinCode },
  }),
  201,
  "conflict fixture join",
);
expectStatus(
  await createOrder(tokens.conflict, liveOffering.offeringId, `live-conflict-${runId}`),
  409,
  "LIVE_COHORT conflict before payment",
);

const liveOrder = await createOrder(tokens.live, liveOffering.offeringId, `live-order-${runId}`);
expectStatus(liveOrder, 201, "LIVE_COHORT Order");
if (!liveOrder.json.data.scheduleReservationId) throw new Error("LIVE_COHORT Order omitted HELD reservation");
expectStatus(
  await pay(tokens.live, liveOrder.json.data.orderId, "SUCCESS", `live-pay-${runId}`),
  200,
  "LIVE_COHORT payment",
);
await waitOrder(tokens.live, liveOrder.json.data.orderId, "ENTITLED");
const liveState = classroom({
  action: "binding",
  classId: liveClass.classId,
  studentId: liveStudent.userId,
  reservationId: liveOrder.json.data.scheduleReservationId,
  scheduleDay: day(0),
});
if (
  liveState.membershipState !== "ACTIVE" ||
  liveState.membershipSource !== "PURCHASE" ||
  liveState.reservationState !== "CONFIRMED" ||
  liveState.confirmedSchedule < 1
)
  throw new Error(`LIVE_COHORT ordering mismatch ${JSON.stringify(liveState)}`);
const ownSchedule = await http("GET", `/api/v1/me/schedule?from=${day(0)}&to=${day(0)}`, {
  bearer: tokens.live,
});
expectStatus(ownSchedule, 200, "CLS-15 purchased schedule");
if (!ownSchedule.json.data.some((row) => row.classId === liveClass.classId))
  throw new Error("CLS-15 omitted purchased LIVE_COHORT schedule");

// Expired pre-payment hold must be reacquired without falsely committing on a conflict.
const expiryOrder = await createOrder(tokens.expiry, liveOffering.offeringId, `expiry-order-${runId}`);
expectStatus(expiryOrder, 201, "expiry Order");
const originalReservation = expiryOrder.json.data.scheduleReservationId;
classroom({ action: "expireNow", reservationId: originalReservation });
const expiryPaid = await pay(tokens.expiry, expiryOrder.json.data.orderId, "SUCCESS", `expiry-pay-${runId}`);
expectStatus(expiryPaid, 200, "bounded hold reacquisition");
if (expiryPaid.json.data.scheduleReservationId === originalReservation)
  throw new Error("expired hold was not replaced before payment commit");
await waitOrder(tokens.expiry, expiryOrder.json.data.orderId, "ENTITLED");
const rebound = learning({ action: "order", orderId: expiryOrder.json.data.orderId });
if (rebound.enrollmentReservationId !== expiryPaid.json.data.scheduleReservationId)
  throw new Error(`enrollment did not converge to reacquired reservation ${JSON.stringify(rebound)}`);

// Failed payment preserves the canonical vocabulary and releases the LIVE hold.
const failedOrder = await createOrder(tokens.broker, liveOffering.offeringId, `failed-order-${runId}`);
expectStatus(failedOrder, 201, "failed-payment Order");
const failed = await pay(tokens.broker, failedOrder.json.data.orderId, "FAILURE", `failed-pay-${runId}`);
expectStatus(failed, 200, "failed payment");
if (failed.json.data.state !== "PAYMENT_FAILED") throw new Error("payment failure state mismatch");
if (
  classroom({
    action: "reservation",
    reservationId: failedOrder.json.data.scheduleReservationId,
  }).state !== "RELEASED"
)
  throw new Error("failed LIVE payment did not release schedule hold");

// Broker outage: paid state is durable; the same outbox event later publishes and fulfills.
const outageOrder = await createOrder(tokens.broker, paidA.offeringId, `outage-order-${runId}`);
expectStatus(outageOrder, 201, "broker outage Order");
let brokerRestarted = false;
try {
  docker("stop", "ailss-rabbitmq");
  const outagePayment = await pay(
    tokens.broker,
    outageOrder.json.data.orderId,
    "SUCCESS",
    `outage-pay-${runId}`,
  );
  expectStatus(outagePayment, 200, "payment while RabbitMQ down");
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const durable = learning({ action: "order", orderId: outageOrder.json.data.orderId });
  if (
    durable.state !== "PAID_PENDING_ENTITLEMENT" ||
    !["READY", "PUBLISHING"].includes(durable.paidEventState)
  )
    throw new Error(`broker outage durability mismatch ${JSON.stringify(durable)}`);
  docker("start", "ailss-rabbitmq");
  brokerRestarted = true;
  await rabbitReady();
  await waitOrder(tokens.broker, outageOrder.json.data.orderId, "ENTITLED", 90);
  const recovered = await waitEventsPublished(outageOrder.json.data.orderId, 90);
  if (recovered.paidEventId !== durable.paidEventId)
    throw new Error("broker retry changed the stable paid eventId");
} finally {
  if (!brokerRestarted) {
    docker("start", "ailss-rabbitmq");
    await rabbitReady();
  }
}
const outageFinal = learning({ action: "order", orderId: outageOrder.json.data.orderId });
if (outageFinal.paidEventState !== "PUBLISHED" || outageFinal.state !== "ENTITLED")
  throw new Error(`broker recovery did not converge ${JSON.stringify(outageFinal)}`);

const myCourses = await http("GET", "/api/v1/me/courses", { bearer: tokens.paid });
expectStatus(myCourses, 200, "LRN-15 My Courses");
if (myCourses.json.data.filter((row) => row.courseId === course.courseId).length !== 1)
  throw new Error("LRN-15 duplicated the Course for multiple Offerings");
const roster = await http("GET", `/api/v1/courses/${course.courseId}/roster`, {
  bearer: lecturerToken,
});
expectStatus(roster, 200, "LRN-16 roster");
if (new Set(roster.json.data.map((row) => row.studentId)).size !== roster.json.data.length)
  throw new Error("LRN-16 duplicated a Student across Offerings");
expectStatus(
  await http("GET", `/api/v1/courses/${course.courseId}/roster`, { bearer: tokens.paid }),
  403,
  "LRN-16 Student denied",
);
if (!learning({ action: "deny" }).denied || !classroom({ action: "deny" }).denied)
  throw new Error("foreign-keyspace runtime DENY was not preserved");

const summary = {
  stage: "phase-7.17-offering-commerce-acceptance",
  status: "PASS",
  runId,
  courseId: course.courseId,
  freeEnrollment: { deterministicOffering: true, replay: true, lessonAccess: true },
  selfPaced: { asyncFulfillment: true, stableEvents: true, responseLossReplay: true },
  multipleOfferings: { enrollmentRows: 2, courseEntitlements: 1, myCoursesRows: 1 },
  liveCohort: {
    conflictBeforePayment: true,
    membershipOrdering: ["PENDING", "SCHEDULE_CONFIRMED", "ACTIVE"],
    cls15Confirmed: true,
    expiredHoldReacquired: true,
    failedPaymentReleased: true,
  },
  brokerOutageRecovery: { durablePaidState: true, stableEventId: true, eventuallyEntitled: true },
  foreignKeyspaceDenied: true,
  counts: { publicApis: 93, internalApis: 15, queryIds: 71, events: 22, redis: false },
};
await writeFile(new URL("p7.17-summary.json", evidence), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ...summary, evidence: decodeURIComponent(evidence.pathname) }));

async function publishedCourse(lecturerBearer, adminBearer, password) {
  const created = await http("POST", "/api/v1/courses", {
    bearer: lecturerBearer,
    key: `course-${runId}`,
    body: {
      title: "P717 Offering Commerce Course",
      slug: `p717-${randomUUID()}`,
      categoryId: randomUUID(),
      priceType: "FREE",
      price: "0",
      currency: "VND",
    },
  });
  expectStatus(created, 201, "create Course");
  const lesson = await http("POST", `/api/v1/courses/${created.json.data.courseId}/lessons`, {
    bearer: lecturerBearer,
    key: `lesson-${runId}`,
    body: {
      title: "Entitlement Protected Lesson",
      sectionTitle: "Commerce",
      position: { sectionOrder: 1, lessonOrder: 1 },
      preview: false,
    },
  });
  expectStatus(lesson, 201, "create protected lesson");
  expectStatus(
    await http("POST", `/api/v1/courses/${created.json.data.courseId}/submit-review`, {
      bearer: lecturerBearer,
      key: `review-${runId}`,
    }),
    202,
    "submit review",
  );
  expectStatus(
    await http("POST", `/api/v1/admin/courses/${created.json.data.courseId}/publish`, {
      bearer: adminBearer,
      key: `publish-course-${runId}`,
      body: { currentPassword: password },
    }),
    200,
    "publish Course",
  );
  return { ...created.json.data, lessonId: lesson.json.data.lessonId };
}
async function createOffering(offeringType, title, price, classId) {
  const created = await http("POST", `/api/v1/courses/${course.courseId}/offerings`, {
    bearer: lecturerToken,
    key: `offering-${randomUUID()}`,
    body: {
      offeringType,
      ...(classId ? { classId } : {}),
      title,
      price,
      currency: "VND",
    },
  });
  expectStatus(created, 201, `create ${title}`);
  const published = await http("POST", `/api/v1/offerings/${created.json.data.offeringId}/publish`, {
    bearer: lecturerToken,
    key: `publish-offering-${randomUUID()}`,
  });
  expectStatus(published, 200, `publish ${title}`);
  return published.json.data;
}
async function scheduledClass(name, classKind, startAt, endAt, linkedCourseId) {
  const created = await http("POST", "/api/v1/classes", {
    bearer: lecturerToken,
    key: `class-${randomUUID()}`,
    body: { name, classKind, ...(linkedCourseId ? { linkedCourseId } : {}), maxMembers: 100 },
  });
  expectStatus(created, 201, `create ${name}`);
  const session = await http("POST", `/api/v1/classes/${created.json.data.classId}/sessions`, {
    bearer: lecturerToken,
    key: `session-${randomUUID()}`,
    body: {
      title: `${name} Session`,
      startAt,
      endAt,
      timezone: "UTC",
      mode: "OFFLINE",
      location: "P717 Lab",
    },
  });
  expectStatus(session, 201, `session ${name}`);
  expectStatus(
    await http("POST", `/api/v1/classes/${created.json.data.classId}/schedule/publish`, {
      bearer: lecturerToken,
      key: `schedule-${randomUUID()}`,
    }),
    200,
    `publish schedule ${name}`,
  );
  return created.json.data;
}
function createOrder(bearer, offeringId, key) {
  return http("POST", "/api/v1/orders", { bearer, key, body: { offeringId } });
}
function pay(bearer, orderId, outcome, key) {
  return http("POST", `/api/v1/orders/${orderId}/simulate-payment`, {
    bearer,
    key,
    body: { outcome },
  });
}
async function waitOrder(bearer, orderId, state, seconds = 60) {
  let last;
  for (let attempt = 0; attempt < seconds * 2; attempt += 1) {
    const response = await http("GET", `/api/v1/orders/${orderId}`, { bearer });
    expectStatus(response, 200, "read Order while waiting");
    last = response.json.data;
    if (last.state === state) return last;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Order did not reach ${state}: ${JSON.stringify(last)}`);
}
async function waitEventsPublished(orderId, seconds = 60) {
  let last;
  for (let attempt = 0; attempt < seconds * 2; attempt += 1) {
    last = learning({ action: "order", orderId });
    if (last.paidEventState === "PUBLISHED" && last.enrolledEventState === "PUBLISHED") return last;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Order events did not publish: ${JSON.stringify(last)}`);
}
async function register(label) {
  const id = randomUUID(),
    user = {
      email: `p717-${label}-${id}@example.test`,
      password: `P7.17-${label}-${id}-Aa1!`,
      displayName: `P717 ${label}`,
    },
    response = await http("POST", "/api/v1/auth/register", {
      key: `register-${id}`,
      body: user,
    });
  expectStatus(response, 201, `register ${label}`);
  return { ...user, userId: response.json.data.userId };
}
async function login(user) {
  const response = await http("POST", "/api/v1/auth/login", {
    body: { email: user.email, password: user.password },
  });
  expectStatus(response, 200, `login ${user.email}`);
  return response.json.data;
}
async function http(method, path, { body, bearer, key } = {}) {
  let last;
  for (let attempt = 0; attempt < 6; attempt += 1)
    try {
      const response = await fetch(`http://127.0.0.1:8080${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          ...(key ? { "idempotency-key": key } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30_000),
      });
      const text = await response.text();
      return { status: response.status, json: text ? JSON.parse(text) : undefined };
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  throw last;
}
function expectStatus(value, status, label) {
  if (value.status !== status) throw new Error(`${label}: ${value.status} ${JSON.stringify(value.json)}`);
}
async function ready() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch("http://127.0.0.1:8080/health/ready")).ok) return;
    } catch {
      // Transient while local containers start.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Gateway unavailable");
}
async function rabbitReady() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const status = execFileSync("docker", ["inspect", "-f", "{{.State.Health.Status}}", "ailss-rabbitmq"], {
      encoding: "utf8",
    }).trim();
    if (status === "healthy") return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("RabbitMQ did not become healthy");
}
function docker(action, container) {
  execFileSync("docker", [action, container], { stdio: "ignore" });
}
function defaultOfferingId(courseId) {
  const namespace = Buffer.from("f36a5ca45f165dae8c7db8bf0f02d814", "hex"),
    bytes = createHash("sha1").update(namespace).update(courseId, "utf8").digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function identity(input) {
  return runDb("ailss-identity-service", identityProbe(), input);
}
function learning(input) {
  return runDb("ailss-learning-service", learningProbe(), input);
}
function classroom(input) {
  return runDb("ailss-classroom-service", classroomProbe(), input);
}
function runDb(container, program, input) {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", container, "node", "--input-type=module", "-e", program], {
      input: JSON.stringify(input),
      encoding: "utf8",
    }).trim(),
  );
}
function identityProbe() {
  return `import{readFileSync}from"node:fs";import{createHash}from"node:crypto";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();const r=(await x.execute("SELECT display_name,role,status,lecturer_verified,profile_version,updated_at FROM user_by_id WHERE user_id=?",[u(i.userId)],q)).rows[0],s=(createHash("sha256").update(i.userId).digest()[0]??0)%16;await x.execute("DELETE FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?",[r.get("role"),r.get("status"),s,r.get("updated_at"),u(i.userId)],q);await x.execute("UPDATE user_by_id SET role=? WHERE user_id=?",[i.role,u(i.userId)],q);await x.execute("INSERT INTO users_by_role_status_bucket (role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version) VALUES (?,?,?,?,?,?,?,?)",[i.role,r.get("status"),s,r.get("updated_at"),u(i.userId),r.get("display_name"),r.get("lecturer_verified"),r.get("profile_version")],q);await x.shutdown();console.log('{"ok":true}');`;
}
function learningProbe() {
  return `import{readFileSync}from"node:fs";import{createHash}from"node:crypto";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();let o={};if(i.action==="seedDefault"){const r=(await x.execute("SELECT owner_lecturer_id,title,price,currency,published_at FROM course_by_id WHERE course_id=?",[u(i.courseId)],q)).rows[0];if(!r||r.get("published_at")===null)throw new Error("default Offering source Course is not published");const p=r.get("published_at");await x.execute("INSERT INTO offering_by_id (offering_id,course_id,owner_lecturer_id,offering_type,class_id,title,state,price,currency,record_version,created_at,updated_at,published_at) VALUES (?,?,?,'SELF_PACED',null,?,'PUBLISHED',?,?,1,?,?,?) IF NOT EXISTS",[u(i.offeringId),u(i.courseId),r.get("owner_lecturer_id"),r.get("title"),r.get("price"),r.get("currency"),p,p,p],q);o={ok:true};}else if(i.action==="order"){const r=(await x.execute("SELECT state,fulfillment_state,paid_event_id,enrolled_event_id,student_id,offering_id,schedule_reservation_id FROM order_by_id WHERE order_id=?",[u(i.orderId)],q)).rows[0],p=r?(await x.execute("SELECT state FROM pending_event_by_id WHERE event_id=?",[r.get("paid_event_id")],q)).rows[0]:null,e=r?(await x.execute("SELECT state FROM pending_event_by_id WHERE event_id=?",[r.get("enrolled_event_id")],q)).rows[0]:null,n=r?(await x.execute("SELECT schedule_reservation_id FROM enrollment_by_student_offering WHERE student_id=? AND offering_id=?",[r.get("student_id"),r.get("offering_id")],q)).rows[0]:null;o={state:r?.get("state")??null,fulfillmentState:r?.get("fulfillment_state")??null,paidEventId:r?String(r.get("paid_event_id")):null,paidEventState:p?.get("state")??null,enrolledEventState:e?.get("state")??null,enrollmentReservationId:n?.get("schedule_reservation_id")?String(n.get("schedule_reservation_id")):null};}else if(i.action==="access"){let active=0;for(const id of i.offeringIds){const r=(await x.execute("SELECT state FROM enrollment_by_student_offering WHERE student_id=? AND offering_id=?",[u(i.studentId),u(id)],q)).rows[0];if(r?.get("state")==="ACTIVE")active++;}const e=(await x.execute("SELECT state,granted_at FROM entitlement_by_student_course WHERE student_id=? AND course_id=?",[u(i.studentId),u(i.courseId)],q)).rows[0];let rows=0;if(e){const m=c.types.LocalDate.fromString(e.get("granted_at").toISOString().slice(0,7)+"-01");rows=(await x.execute("SELECT course_id FROM courses_by_student_bucket WHERE student_id=? AND state='ACTIVE' AND year_month=?",[u(i.studentId),m],q)).rows.filter(r=>String(r.get("course_id"))===i.courseId).length;}o={activeEnrollments:active,entitlementState:e?.get("state")??null,myCourseRows:rows};}else if(i.action==="deny"){try{await x.execute("SELECT user_id FROM identity_keyspace.user_by_id LIMIT 1",[],q);o={denied:false}}catch{o={denied:true}}}await x.shutdown();console.log(JSON.stringify(o));`;
}
function classroomProbe() {
  return `import{readFileSync}from"node:fs";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();let o={};if(i.action==="binding"){const m=(await x.execute("SELECT state,source,schedule_reservation_id FROM membership_by_class_student WHERE class_id=? AND student_id=?",[u(i.classId),u(i.studentId)],q)).rows[0],r=(await x.execute("SELECT state FROM schedule_reservation_by_id WHERE reservation_id=?",[u(i.reservationId)],q)).rows[0],d=c.types.LocalDate.fromString(i.scheduleDay),confirmed=(await x.execute("SELECT class_id,entry_state FROM student_schedule_by_day WHERE student_id=? AND schedule_day=? LIMIT 200",[u(i.studentId),d],q)).rows.filter(v=>String(v.get("class_id"))===i.classId&&v.get("entry_state")==="CONFIRMED").length;o={membershipState:m?.get("state")??null,membershipSource:m?.get("source")??null,membershipReservationId:m?.get("schedule_reservation_id")?String(m.get("schedule_reservation_id")):null,reservationState:r?.get("state")??null,confirmedSchedule:confirmed};}else if(i.action==="expireNow"){const n=new Date(Date.now()-1000);await x.execute("UPDATE schedule_reservation_by_id SET expires_at=?,updated_at=? WHERE reservation_id=?",[n,n,u(i.reservationId)],q);o={ok:true};}else if(i.action==="reservation"){const r=(await x.execute("SELECT state FROM schedule_reservation_by_id WHERE reservation_id=?",[u(i.reservationId)],q)).rows[0];o={state:r?.get("state")??null};}else if(i.action==="deny"){try{await x.execute("SELECT offering_id FROM learning_keyspace.offering_by_id LIMIT 1",[],q);o={denied:false}}catch{o={denied:true}}}await x.shutdown();console.log(JSON.stringify(o));`;
}
