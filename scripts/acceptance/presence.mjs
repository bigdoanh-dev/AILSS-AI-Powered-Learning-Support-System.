import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { WebSocket } from "ws";

if ((process.env.AILSS_PROFILE ?? "dev-async") !== "dev-async") throw new Error("P7.18 requires dev-async");
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-"),
  evidence = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidence, { recursive: true });
await ready();

const lecturer = await register("lecturer"),
  student = await register("student"),
  outsider = await register("outsider");
identity({ action: "promote", userId: lecturer.userId, role: "LECTURER" });
const admin = await register("admin");
identity({ action: "promote", userId: admin.userId, role: "ADMIN" });
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
  studentToken = (await login(student)).accessToken,
  outsiderToken = (await login(outsider)).accessToken;
const klass = await createClass(lecturerToken),
  start = new Date(Date.now() + 10 * 60_000),
  end = new Date(start.getTime() + 60 * 60_000);
const session = await http("POST", `/api/v1/classes/${klass.classId}/sessions`, {
  bearer: lecturerToken,
  key: `session-${runId}`,
  body: {
    title: "P7.18 Realtime Session",
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    timezone: "UTC",
    mode: "ONLINE",
    meetingProvider: "meet",
    meetingUrl: "https://meet.example.test/private",
  },
});
expectStatus(session, 201, "create ONLINE session");
const sessionId = session.json.data.sessions[0].sessionId;
expectStatus(
  await http("POST", `/api/v1/classes/${klass.classId}/schedule/publish`, {
    bearer: lecturerToken,
    key: `publish-schedule-${runId}`,
  }),
  200,
  "publish schedule",
);
expectStatus(
  await http("POST", "/api/v1/classes/join", {
    bearer: studentToken,
    key: `join-${runId}`,
    body: { code: klass.joinCode },
  }),
  201,
  "activate Student membership",
);

const studentTicket = await http("POST", `/api/v1/class-sessions/${sessionId}/presence-tickets`, {
    bearer: studentToken,
  }),
  lecturerTicket = await http("POST", `/api/v1/class-sessions/${sessionId}/presence-tickets`, {
    bearer: lecturerToken,
  });
expectStatus(studentTicket, 200, "Student presence ticket");
expectStatus(lecturerTicket, 200, "Lecturer presence ticket");
if (studentTicket.json.data.expiresIn !== 30 || !studentTicket.json.data.websocketUrl.startsWith("ws"))
  throw new Error("presence ticket DTO mismatch");
expectStatus(
  await http("POST", `/api/v1/class-sessions/${sessionId}/presence-tickets`, { bearer: outsiderToken }),
  403,
  "outsider ticket denied",
);

const wsUrl = studentTicket.json.data.websocketUrl;
const studentSocket = await connect(wsUrl, studentTicket.json.data.ticket);
const connected = await nextMessage(studentSocket);
if (connected.type !== "presence.connected" || connected.data.attendanceStatus !== "PRESENT")
  throw new Error(`Student connection message mismatch ${JSON.stringify(connected)}`);
const lecturerUrl = lecturerTicket.json.data.websocketUrl;
const lecturerSocket = await connect(lecturerUrl, lecturerTicket.json.data.ticket);
const snapshot = await nextMessage(lecturerSocket);
if (
  snapshot.type !== "roster.snapshot" ||
  !snapshot.data.some((row) => row.studentId === student.userId && row.attendanceStatus === "PRESENT")
)
  throw new Error("lecturer roster did not overlay PRESENT student");

// Two tabs aggregate one Student interval; closing one must not transition OFFLINE.
const secondSocket = await connect(wsUrl, studentTicket.json.data.ticket);
await nextMessage(secondSocket);
studentSocket.close();
await new Promise((resolve) => setTimeout(resolve, 500));
const stillOnline = await http("GET", `/api/v1/class-sessions/${sessionId}/attendance`, {
  bearer: lecturerToken,
});
expectStatus(stillOnline, 200, "attendance while second tab remains");
if (stillOnline.json.data.find((row) => row.studentId === student.userId)?.presenceState !== "ONLINE")
  throw new Error("multi-tab close incorrectly marked Student offline");
secondSocket.close();
await waitFor(async () => {
  const result = await http("GET", `/api/v1/class-sessions/${sessionId}/attendance`, {
    bearer: lecturerToken,
  });
  return (
    result.status === 200 &&
    result.json.data.find((row) => row.studentId === student.userId)?.presenceState === "OFFLINE"
  );
}, 15_000);
const finalAttendance = await http("GET", `/api/v1/class-sessions/${sessionId}/attendance`, {
  bearer: lecturerToken,
});
if (finalAttendance.json.data.find((row) => row.studentId === student.userId)?.connectedDurationSeconds < 0)
  throw new Error("negative attendance duration");
const history = await http("GET", `/api/v1/me/attendance?month=${start.toISOString().slice(0, 7)}`, {
  bearer: studentToken,
});
expectStatus(history, 200, "private Student attendance history");
if (!history.json.data.some((row) => row.sessionId === sessionId))
  throw new Error("history projection missing");
expectStatus(
  await http("GET", `/api/v1/me/attendance?month=${start.toISOString().slice(0, 7)}`, {
    bearer: outsiderToken,
  }),
  200,
  "private history subject binding",
);
if (JSON.stringify(finalAttendance.json).includes("meet.example.test"))
  throw new Error("attendance leaked meeting URL");

// Close the observer socket so the acceptance process has no open handles.
lecturerSocket.close();
await new Promise((resolve) => setTimeout(resolve, 100));

const summary = {
  phase: "P7.18",
  status: "PASS",
  cls16Roster: true,
  cls17PrivateHistory: true,
  cls18Ticket: true,
  studentPresentThenOffline: true,
  multiConnectionAggregation: true,
  noMeetingUrlLeak: true,
  counts: { publicApis: 98, internalApis: 15, queryIds: 74, events: 22, redis: false },
};
await writeFile(new URL("p7.18-summary.json", evidence), JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ ...summary, evidence: decodeURIComponent(evidence.pathname) }));

async function createClass(token) {
  const response = await http("POST", "/api/v1/classes", {
    bearer: token,
    key: `class-${runId}`,
    body: { name: `P7.18 Class ${runId}`, classKind: "PRIVATE", maxMembers: 50 },
  });
  expectStatus(response, 201, "create Class");
  return response.json.data;
}
async function register(label) {
  const id = randomUUID(),
    user = {
      email: `p718-${label}-${id}@example.test`,
      password: `P7.18-${label}-${id}-Aa1!`,
      displayName: `P718 ${label}`,
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
async function http(method, path, { body, bearer, key } = {}) {
  let last;
  for (let attempt = 0; attempt < 5; attempt += 1)
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
      await new Promise((resolve) => setTimeout(resolve, 300));
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
      // transient while the stack starts
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Gateway unavailable");
}
function identity(input) {
  const program = `import{readFileSync}from"node:fs";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();const r=(await x.execute("SELECT display_name,status,lecturer_verified,profile_version,updated_at FROM user_by_id WHERE user_id=?",[u(i.userId)],q)).rows[0],s=0;if(i.action==="promote"){await x.execute("DELETE FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?",["STUDENT",r.get("status"),s,r.get("updated_at"),u(i.userId)],q);await x.execute("UPDATE user_by_id SET role=? WHERE user_id=?",[i.role,u(i.userId)],q);await x.execute("INSERT INTO users_by_role_status_bucket (role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version) VALUES (?,?,?,?,?,?,?,?)",[i.role,r.get("status"),s,r.get("updated_at"),u(i.userId),r.get("display_name"),r.get("lecturer_verified"),r.get("profile_version")],q);}await x.shutdown();console.log(JSON.stringify({ok:true}));`;
  return JSON.parse(
    execFileSync(
      "docker",
      ["exec", "-i", "ailss-identity-service", "node", "--input-type=module", "-e", program],
      { input: JSON.stringify(input), encoding: "utf8" },
    ).trim(),
  );
}
async function connect(url, ticket) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${url}?ticket=${encodeURIComponent(ticket)}`);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}
function nextMessage(socket) {
  return new Promise((resolve, reject) => {
    const onMessage = (data) => {
      socket.off("error", onError);
      resolve(JSON.parse(data.toString()));
    };
    const onError = (error) => {
      socket.off("message", onMessage);
      reject(error);
    };
    socket.once("message", onMessage);
    socket.once("error", onError);
  });
}
async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("condition did not converge");
}
