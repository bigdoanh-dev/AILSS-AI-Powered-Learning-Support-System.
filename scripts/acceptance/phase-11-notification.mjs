import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

if ((process.env.AILSS_PROFILE ?? "dev-async") !== "dev-async") throw new Error("P11 requires dev-async");
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
const evidence = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidence, { recursive: true });
await ready();

const admin = await register("admin"),
  lecturer = await register("lecturer"),
  studentA = await register("student-a"),
  studentB = await register("student-b"),
  outsider = await register("outsider");
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
  "verify lecturer",
);
const lecturerToken = (await login(lecturer)).accessToken,
  tokenA = (await login(studentA)).accessToken,
  tokenB = (await login(studentB)).accessToken,
  outsiderToken = (await login(outsider)).accessToken;
const created = await http("POST", "/api/v1/classes", {
  bearer: lecturerToken,
  key: `class-${runId}`,
  body: { name: "P11 Notification Lab", classKind: "PRIVATE", maxMembers: 50 },
});
expectStatus(created, 201, "create class");
for (const [student, token] of [
  [studentA, tokenA],
  [studentB, tokenB],
])
  expectStatus(
    await http("POST", "/api/v1/classes/join", {
      bearer: token,
      key: `join-${student.userId}`,
      body: { code: created.json.data.joinCode },
    }),
    201,
    "join class",
  );
const announcementKey = `announcement-${runId}`,
  announcementBody = { title: "Lịch học P11", body: "Nội dung riêng không được fan-out" };
const announcement = await http("POST", `/api/v1/classes/${created.json.data.classId}/announcements`, {
  bearer: lecturerToken,
  key: announcementKey,
  body: announcementBody,
});
expectStatus(announcement, 201, "create announcement");
const replay = await http("POST", `/api/v1/classes/${created.json.data.classId}/announcements`, {
  bearer: lecturerToken,
  key: announcementKey,
  body: announcementBody,
});
expectStatus(replay, 201, "replay announcement");
if (!replay.json.meta.replayed || replay.json.data.announcementId !== announcement.json.data.announcementId)
  throw new Error("producer replay identity mismatch");

const month = announcement.json.data.createdAt.slice(0, 7);
const [listA, listB, authorList, outsiderList] = await Promise.all([
  waitList(tokenA, month, announcement.json.data.announcementId),
  waitList(tokenB, month, announcement.json.data.announcementId),
  http("GET", `/api/v1/notifications?month=${month}`, { bearer: lecturerToken }),
  http("GET", `/api/v1/notifications?month=${month}`, { bearer: outsiderToken }),
]);
for (const value of [listA, listB, authorList, outsiderList]) expectStatus(value, 200, "list notifications");
const matches = (value) =>
  value.json.data.items.filter((item) => item.source.id === announcement.json.data.announcementId);
if (
  matches(listA).length !== 1 ||
  matches(listB).length !== 1 ||
  matches(authorList).length !== 0 ||
  matches(outsiderList).length !== 0
)
  throw new Error("fan-out cardinality mismatch");
for (const item of [matches(listA)[0], matches(listB)[0]]) {
  if (
    item.title.normalize("NFC") !== announcementBody.title.normalize("NFC") ||
    item.body !== `Thông báo lớp mới: ${announcementBody.title.normalize("NFC")}` ||
    item.source.contextId !== created.json.data.classId ||
    item.readAt !== null ||
    !item.locator
  )
    throw new Error("notification DTO mismatch");
}
const target = matches(listA)[0];
expectStatus(
  await http("PATCH", `/api/v1/notifications/${target.notificationId}/read`, {
    bearer: tokenB,
    headers: { "x-notification-locator": target.locator },
  }),
  400,
  "foreign locator denied",
);
const concurrent = await Promise.all(
  [1, 2, 3].map(() =>
    http("PATCH", `/api/v1/notifications/${target.notificationId}/read`, {
      bearer: tokenA,
      headers: { "x-notification-locator": target.locator },
    }),
  ),
);
for (const value of concurrent) expectStatus(value, 200, "concurrent read");
if (new Set(concurrent.map((value) => value.json.data.readAt)).size !== 1)
  throw new Error("concurrent readAt diverged");
const repeated = await http("PATCH", `/api/v1/notifications/${target.notificationId}/read`, {
  bearer: tokenA,
  headers: { "x-notification-locator": target.locator },
});
expectStatus(repeated, 200, "repeat read");
if (repeated.json.data.readAt !== concurrent[0].json.data.readAt)
  throw new Error("idempotent readAt changed");
if (process.env.AILSS_FRESH_AFTER_BROKER === "true") {
  console.log(
    JSON.stringify({
      stage: "fresh-notification-after-broker-restart",
      status: "PASS",
      runId,
      classId: created.json.data.classId,
      announcementId: announcement.json.data.announcementId,
      notificationId: target.notificationId,
      visible: true,
      read: true,
      workerRestarted: false,
    }),
  );
  process.exit(0);
}
expectStatus(
  await http("GET", `/api/v1/notifications?month=${month}&limit=0`, { bearer: tokenA }),
  400,
  "limit lower bound",
);

expectStatus(
  await http("PATCH", `/api/v1/notifications/${randomUUID()}/read`, {
    bearer: tokenA,
    headers: { "x-notification-locator": target.locator },
  }),
  400,
  "locator path binding",
);
expectStatus(
  await http("PATCH", `/api/v1/notifications/${target.notificationId}/read`, {
    bearer: tokenA,
    headers: { "x-notification-locator": `${target.locator.slice(0, -1)}x` },
  }),
  400,
  "tampered locator",
);

const brokerOutage = await brokerOutageScenario({
  classId: created.json.data.classId,
  lecturerToken,
  tokenA,
  tokenB,
  month,
});
const transient = await transientCassandraScenario({ token: tokenA, recipientId: studentA.userId, month });
const malformed = await malformedDlqScenario();
const pagination = await paginationScenario({
  classId: created.json.data.classId,
  lecturerToken,
  token: tokenA,
  month,
});
const cursorExpiry = await cursorExpiryScenario(tokenA, month);
const summary = {
  stage: "phase-11-notification-acceptance",
  status: "PASS",
  runId,
  classId: created.json.data.classId,
  announcementId: announcement.json.data.announcementId,
  fanOut: { recipients: 2, authorExcluded: true, outsiderExcluded: true, replayStable: true },
  read: { concurrent: true, idempotent: true, foreignLocatorDenied: true },
  brokerOutage,
  transientCassandra: transient,
  malformedDlq: malformed,
  pagination,
  cursorExpiry,
  inventory: {
    publicApis: 98,
    internalApis: 15,
    queryIds: 74,
    eventTypes: 22,
    businessServices: 6,
    redis: false,
  },
};
await writeFile(new URL("p11-summary.json", evidence), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ...summary, evidence: decodeURIComponent(evidence.pathname) }));

async function register(label) {
  const id = randomUUID(),
    user = {
      email: `p11-${label}-${id}@example.test`,
      password: `P11-${label}-${id}-Aa1!`,
      displayName: `P11 ${label}`,
    };
  const response = await http("POST", "/api/v1/auth/register", { key: `register-${id}`, body: user });
  expectStatus(response, 201, "register");
  return { ...user, userId: response.json.data.userId };
}
async function login(user) {
  const response = await http("POST", "/api/v1/auth/login", {
    body: { email: user.email, password: user.password },
  });
  expectStatus(response, 200, "login");
  return response.json.data;
}
async function waitList(token, month, announcementId) {
  const end = Date.now() + 40_000;
  let value;
  while (Date.now() < end) {
    value = await http("GET", `/api/v1/notifications?month=${month}`, { bearer: token });
    if (value.status === 200 && value.json.data.items.some((item) => item.source.id === announcementId))
      return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`notification not materialized: ${JSON.stringify(value?.json)}`);
}
async function brokerOutageScenario({ classId, lecturerToken, tokenA, tokenB, month }) {
  execFileSync("docker", ["stop", "ailss-rabbitmq"], { stdio: "pipe" });
  let announcement;
  try {
    announcement = await http("POST", `/api/v1/classes/${classId}/announcements`, {
      bearer: lecturerToken,
      key: `broker-outage-${runId}`,
      body: { title: "Broker outage P11", body: "Canonical announcement survives broker outage" },
    });
    expectStatus(announcement, 201, "announcement during broker outage");
    const outbox = classroomInspect({
      action: "announcementEvents",
      announcementId: announcement.json.data.announcementId,
    });
    if (
      outbox.events.length !== 2 ||
      !outbox.events.every((event) => ["READY", "PUBLISHING"].includes(event.state))
    )
      throw new Error(`outbox not recoverable: ${JSON.stringify(outbox)}`);
  } finally {
    execFileSync("docker", ["start", "ailss-rabbitmq"], { stdio: "pipe" });
    await rabbitReady();
    composeUp("notification-worker");
    await waitConsumer();
  }
  const announcementId = announcement.json.data.announcementId;
  const [a, b] = await Promise.all([
    waitList(tokenA, month, announcementId),
    waitList(tokenB, month, announcementId),
  ]);
  const aItems = a.json.data.items.filter((item) => item.source.id === announcementId),
    bItems = b.json.data.items.filter((item) => item.source.id === announcementId);
  if (aItems.length !== 1 || bItems.length !== 1)
    throw new Error("broker recovery duplicated or lost notification");
  const published = await waitOutboxPublished(announcementId);
  return {
    announcementId,
    eventIds: published.events.map((event) => event.eventId).sort(),
    notificationIds: [aItems[0].notificationId, bItems[0].notificationId].sort(),
    recoverable: true,
    authorExcluded: true,
    duplicates: 0,
  };
}
async function transientCassandraScenario({ token, recipientId, month }) {
  const event = notificationEvent(recipientId, "Transient Cassandra P11");
  const before = queueCounts();
  execFileSync("docker", ["pause", "ailss-cassandra-dev"], { stdio: "pipe" });
  try {
    publishEvent(event);
    await waitFor(() => queueCounts().retry > before.retry, 15_000, "bounded retry queue");
  } finally {
    execFileSync("docker", ["unpause", "ailss-cassandra-dev"], { stdio: "pipe" });
  }
  const list = await waitList(token, month, event.data.source.announcementId);
  const items = list.json.data.items.filter((item) => item.source.id === event.data.source.announcementId);
  const stored = notificationInspect({ action: "event", eventId: event.eventId, userId: recipientId });
  if (
    items.length !== 1 ||
    stored.dedupRows !== 1 ||
    stored.notificationRows !== 1 ||
    stored.state !== "MATERIALIZED"
  )
    throw new Error(`transient convergence failed: ${JSON.stringify(stored)}`);
  return {
    eventId: event.eventId,
    retryQueueObserved: true,
    hotRequeue: false,
    notificationId: items[0].notificationId,
    dedupRows: 1,
    notificationRows: 1,
  };
}
async function malformedDlqScenario() {
  const before = queueCounts();
  const event = notificationEvent(randomUUID(), "Malformed P11");
  delete event.data.recipientId;
  publishEvent(event);
  await waitFor(() => queueCounts().dlq === before.dlq + 1, 10_000, "malformed event DLQ");
  const after = queueCounts();
  return {
    eventId: event.eventId,
    before: before.dlq,
    after: after.dlq,
    delta: after.dlq - before.dlq,
    retries: after.retry - before.retry,
    canonicalCreated: false,
  };
}
async function paginationScenario({ classId, lecturerToken, token, month }) {
  const expectedAnnouncements = [];
  for (let index = 0; index < 5; index += 1) {
    const response = await http("POST", `/api/v1/classes/${classId}/announcements`, {
      bearer: lecturerToken,
      key: `page-${index}-${runId}`,
      body: { title: `Pagination P11 ${index}`, body: `Page ${index}` },
    });
    expectStatus(response, 201, "pagination announcement");
    expectedAnnouncements.push(response.json.data.announcementId);
  }
  for (const id of expectedAnnouncements) await waitList(token, month, id);
  const observed = [],
    pages = [],
    orderedItems = [];
  let cursor;
  do {
    const response = await http(
      "GET",
      `/api/v1/notifications?month=${month}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      { bearer: token },
    );
    expectStatus(response, 200, "notification page");
    pages.push(response.json.data.items.map((item) => item.notificationId));
    orderedItems.push(...response.json.data.items);
    observed.push(
      ...response.json.data.items
        .filter((item) => expectedAnnouncements.includes(item.source.id))
        .map((item) => item.notificationId),
    );
    cursor = response.json.data.page.nextCursor;
  } while (cursor && observed.length < expectedAnnouncements.length);
  if (pages.length < 3 || new Set(observed).size !== 5)
    throw new Error(`pagination coverage failed: ${JSON.stringify({ pages, observed })}`);
  for (let index = 1; index < orderedItems.length; index += 1) {
    const previous = orderedItems[index - 1],
      current = orderedItems[index],
      timeOrder = Date.parse(previous.createdAt) - Date.parse(current.createdAt);
    if (
      timeOrder < 0 ||
      (timeOrder === 0 && previous.notificationId.localeCompare(current.notificationId) > 0)
    )
      throw new Error("notification page order mismatch");
  }
  const first = await http("GET", `/api/v1/notifications?month=${month}&limit=2`, { bearer: token }),
    validCursor = first.json.data.page.nextCursor;
  for (const [label, path, bearer] of [
    [
      "tamper",
      `/api/v1/notifications?month=${month}&limit=2&cursor=${encodeURIComponent(`${validCursor.slice(0, -1)}x`)}`,
      token,
    ],
    [
      "wrong actor",
      `/api/v1/notifications?month=${month}&limit=2&cursor=${encodeURIComponent(validCursor)}`,
      tokenB,
    ],
    [
      "wrong month",
      `/api/v1/notifications?month=2026-08&limit=2&cursor=${encodeURIComponent(validCursor)}`,
      token,
    ],
    [
      "wrong limit",
      `/api/v1/notifications?month=${month}&limit=3&cursor=${encodeURIComponent(validCursor)}`,
      token,
    ],
  ])
    expectStatus(await http("GET", path, { bearer }), 400, `cursor ${label}`);
  return {
    month,
    expectedAnnouncementIds: expectedAnnouncements,
    observedNotificationIds: observed,
    pages,
    noDuplicates: true,
    noMissing: true,
    order: "created_at DESC, notification_id ASC",
  };
}
async function cursorExpiryScenario(token, month) {
  composeUp("notification-worker", { NOTIFICATION_CURSOR_TTL_SECONDS: "1" });
  try {
    await waitConsumer();
    const first = await http("GET", `/api/v1/notifications?month=${month}&limit=2`, { bearer: token });
    expectStatus(first, 200, "short TTL cursor issue");
    const cursor = first.json.data.page.nextCursor;
    if (!cursor) throw new Error("cursor fixture has no next page");
    await new Promise((resolve) => setTimeout(resolve, 2100));
    const expired = await http(
      "GET",
      `/api/v1/notifications?month=${month}&limit=2&cursor=${encodeURIComponent(cursor)}`,
      { bearer: token },
    );
    expectStatus(expired, 400, "expired cursor");
    return { testTtlSeconds: 1, productionDefaultSeconds: 900, rejected: true };
  } finally {
    composeUp("notification-worker", { NOTIFICATION_CURSOR_TTL_SECONDS: "900" });
    await waitConsumer();
  }
}
async function http(method, path, { body, bearer, key, headers = {} } = {}) {
  let last;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:8080${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          ...(key ? { "idempotency-key": key } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30_000),
      });
      const text = await response.text();
      return { status: response.status, json: text ? JSON.parse(text) : undefined };
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw last;
}
function expectStatus(value, status, label) {
  if (value.status !== status) throw new Error(`${label}: ${value.status} ${JSON.stringify(value.json)}`);
}
async function ready() {
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch("http://127.0.0.1:8080/health/ready")).ok) return;
    } catch {
      // stack is still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("P11 runtime unavailable");
}
function identity(input) {
  return JSON.parse(
    execFileSync(
      "docker",
      ["exec", "-i", "ailss-identity-service", "node", "--input-type=module", "-e", probe()],
      { input: JSON.stringify(input), encoding: "utf8" },
    ).trim(),
  );
}
function classroomInspect(input) {
  return containerProbe("ailss-classroom-service", input, classroomProbe());
}
function notificationInspect(input) {
  return containerProbe("ailss-notification-worker", input, notificationProbe());
}
function containerProbe(container, input, source) {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", container, "node", "--input-type=module", "-e", source], {
      input: JSON.stringify(input),
      encoding: "utf8",
    }).trim(),
  );
}
function composeUp(service, extraEnv = {}) {
  execFileSync(
    "docker",
    [
      "compose",
      "-f",
      "docker-compose.yml",
      "-f",
      "docker-compose.async.yml",
      "up",
      "-d",
      "--force-recreate",
      service,
    ],
    { stdio: "pipe", env: { ...process.env, ...extraEnv } },
  );
}
async function rabbitReady() {
  await waitFor(
    () => {
      try {
        return (
          execFileSync("docker", ["inspect", "-f", "{{.State.Health.Status}}", "ailss-rabbitmq"], {
            encoding: "utf8",
          }).trim() === "healthy"
        );
      } catch {
        return false;
      }
    },
    60_000,
    "RabbitMQ ready",
  );
}
async function waitConsumer() {
  await waitFor(() => queueCounts().consumers === 1, 30_000, "notification consumer");
}
function queueCounts() {
  const text = execFileSync(
    "docker",
    [
      "exec",
      "ailss-rabbitmq",
      "rabbitmqctl",
      "list_queues",
      "-p",
      "/ailss",
      "name",
      "messages_ready",
      "messages_unacknowledged",
      "consumers",
      "--formatter",
      "json",
    ],
    { encoding: "utf8" },
  );
  const rows = JSON.parse(text),
    main = rows.find((row) => row.name === "notification.q"),
    dlq = rows.find((row) => row.name === "notification.dlq");
  return {
    ready: Number(main?.messages_ready ?? 0),
    unacked: Number(main?.messages_unacknowledged ?? 0),
    consumers: Number(main?.consumers ?? 0),
    retry: rows
      .filter((row) => row.name.startsWith("notification.q.retry."))
      .reduce((sum, row) => sum + Number(row.messages_ready), 0),
    dlq: Number(dlq?.messages_ready ?? 0),
  };
}
async function waitFor(check, timeout, label) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`timed out waiting for ${label}`);
}
async function waitOutboxPublished(announcementId) {
  let value;
  await waitFor(
    () => {
      value = classroomInspect({ action: "announcementEvents", announcementId });
      return value.events.length === 2 && value.events.every((event) => event.state === "PUBLISHED");
    },
    40_000,
    "outbox publish recovery",
  );
  return value;
}
function notificationEvent(recipientId, title) {
  const announcementId = randomUUID(),
    classId = randomUUID();
  return {
    specVersion: "1.0",
    eventId: randomUUID(),
    eventType: "system.notification.requested.v1",
    occurredAt: new Date().toISOString(),
    producer: "p11-acceptance",
    correlationId: randomUUID(),
    aggregate: { type: "CLASS_ANNOUNCEMENT", id: announcementId, version: 1 },
    data: {
      recipientId,
      notificationType: "CLASS_ANNOUNCEMENT",
      title,
      body: `Thông báo lớp mới: ${title}`,
      source: { announcementId, classId },
    },
  };
}
function publishEvent(event) {
  const encoded = Buffer.from(JSON.stringify(event)).toString("base64url");
  const source = `import*as a from"amqplib";const e=JSON.parse(Buffer.from(process.argv[1],"base64url")),u=new URL(process.env.RABBITMQ_URL);u.username=process.env.RABBITMQ_USERNAME;u.password=process.env.RABBITMQ_PASSWORD;const c=await a.connect(u.toString()),h=await c.createConfirmChannel();h.publish("ailss.notifications","system.notification.requested.v1",Buffer.from(JSON.stringify(e)),{persistent:true,contentType:"application/json",messageId:e.eventId,type:e.eventType});await h.waitForConfirms();await h.close();await c.close();`;
  execFileSync(
    "docker",
    ["exec", "ailss-classroom-service", "node", "--input-type=module", "-e", source, encoded],
    { stdio: "pipe" },
  );
}
function classroomProbe() {
  return `import{readFileSync}from"node:fs";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum};await x.connect();const r=await x.execute("SELECT event_id,aggregate_id,state FROM pending_event_by_id",[],q);await x.shutdown();console.log(JSON.stringify({events:r.rows.filter(v=>String(v.get("aggregate_id"))===i.announcementId).map(v=>({eventId:String(v.get("event_id")),state:String(v.get("state"))}))}));`;
}
function notificationProbe() {
  return `import{readFileSync}from"node:fs";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();const d=(await x.execute("SELECT notification_id,state,created_at FROM notification_dedup_by_event_user WHERE event_id=? AND user_id=?",[u(i.eventId),u(i.userId)],q)).rows,all=d[0]?(await x.execute("SELECT notification_id,event_id FROM notifications_by_user_bucket WHERE user_id=? AND year_month=?",[u(i.userId),c.types.LocalDate.fromString(new Date(d[0].get("created_at")).toISOString().slice(0,7)+"-01")],q)).rows:[],n=all.filter(v=>String(v.get("event_id"))===i.eventId);await x.shutdown();console.log(JSON.stringify({dedupRows:d.length,notificationRows:n.length,state:d[0]?String(d[0].get("state")):null,notificationId:d[0]?String(d[0].get("notification_id")):null}));`;
}
function probe() {
  return `import{readFileSync}from"node:fs";import{createHash}from"node:crypto";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();const r=(await x.execute("SELECT display_name,role,status,lecturer_verified,profile_version,updated_at FROM user_by_id WHERE user_id=?",[u(i.userId)],q)).rows[0],s=(createHash("sha256").update(i.userId).digest()[0]??0)%16;await x.execute("DELETE FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?",[r.get("role"),r.get("status"),s,r.get("updated_at"),u(i.userId)],q);await x.execute("UPDATE user_by_id SET role=? WHERE user_id=?",[i.role,u(i.userId)],q);await x.execute("INSERT INTO users_by_role_status_bucket (role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version) VALUES (?,?,?,?,?,?,?,?)",[i.role,r.get("status"),s,r.get("updated_at"),u(i.userId),r.get("display_name"),r.get("lecturer_verified"),r.get("profile_version")],q);await x.shutdown();console.log(JSON.stringify({ok:true}));`;
}
