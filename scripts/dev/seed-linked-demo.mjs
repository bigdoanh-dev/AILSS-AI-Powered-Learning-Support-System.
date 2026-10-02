/** Linked local fixtures created through the same authenticated APIs as web/mobile. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { selectClass, demoAnswers, sessionPlan, pythonQuiz } from "./linked-demo-plan.mjs";

const origin = new URL(process.env.AILSS_GATEWAY_URL || "http://127.0.0.1:8080");
if (
  !["127.0.0.1", "localhost"].includes(origin.hostname) ||
  origin.protocol !== "http:" ||
  (process.env.AILSS_PROFILE || "dev-async") !== "dev-async"
)
  throw Error("Only local dev-async is allowed");
const verifyOnly = process.argv.includes("--verify");
if (process.argv.slice(2).some((arg) => arg !== "--verify"))
  throw Error("Usage: seed-linked-demo.mjs [--verify]");
const accounts = {
  student: {
    email: "student.demo@ailss.local",
    password: process.env.AILSS_DEMO_STUDENT_PASSWORD || "AilssDemo!2026",
    role: "STUDENT",
  },
  lecturer: {
    email: "lecturer.demo@ailss.local",
    password: process.env.AILSS_DEMO_LECTURER_PASSWORD || "AilssLecturer!2026",
    role: "LECTURER",
  },
  python: {
    email: "an.python.demo@ailss.local",
    password: process.env.AILSS_DEMO_SECOND_LECTURER_PASSWORD || "AilssLecturer!2026",
    role: "LECTURER",
  },
  nam: {
    email: "nam.hoang.student@ailss.local",
    password: process.env.AILSS_DEMO_AUX_STUDENT_PASSWORD || "StudentPass!2026",
    role: "STUDENT",
  },
};
const actors = {};
const changes = { commandsApplied: 0, membershipsAdded: 0, feedbackAdded: 0 };
async function api(actor, path, method = "GET", body, key) {
  for (let retry = 0; retry < 4; retry++) {
    const response = await fetch(new URL("/api/v1" + path, origin), {
      method,
      headers: {
        accept: "application/json",
        ...(actors[actor]?.token ? { authorization: `Bearer ${actors[actor].token}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(key ? { "idempotency-key": key } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
    if (response.status === 429 && retry < 3) {
      await delay(Math.min(5000, Math.max(1100, Number(response.headers.get("retry-after") || 1) * 1000)));
      continue;
    }
    const value = await response.json();
    if (!response.ok) {
      const error = Error(`${method} ${path}: ${response.status} ${value.error?.code || "UNKNOWN"}`);
      error.status = response.status;
      throw error;
    }
    return value.data;
  }
}
function list(value) {
  const items = Array.isArray(value) ? value : value?.items;
  if (!Array.isArray(items)) throw Error("Unexpected API list response");
  return items;
}
for (const [role, account] of Object.entries(accounts)) {
  const login = await api(role, "/auth/login", "POST", { email: account.email, password: account.password });
  actors[role] = { token: login.accessToken };
  actors[role].me = await api(role, "/me");
  assert.equal(actors[role].me.role, account.role);
  if (account.role === "LECTURER") assert.equal(actors[role].me.lecturerVerified, true);
}
const directory = new URL("../../tmp/linked-demo/", import.meta.url);
const file = new URL(`${actors.student.me.userId}.json`, directory);
let journal;
try {
  journal = JSON.parse(await readFile(file, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  if (verifyOnly) throw Error("Run seed:lecturer-demo before verifying fixtures");
  journal = {
    createdAt: new Date().toISOString(),
    actors: Object.fromEntries(Object.entries(actors).map(([role, actor]) => [role, actor.me.userId])),
    commands: {},
    attempts: {},
  };
}
assert.deepEqual(
  journal.actors,
  Object.fromEntries(Object.entries(actors).map(([role, actor]) => [role, actor.me.userId])),
  "Demo identities changed; inspect the local journal before continuing",
);
async function save() {
  await mkdir(directory, { recursive: true });
  const temporary = new URL(`${actors.student.me.userId}.tmp`, directory);
  await writeFile(temporary, JSON.stringify(journal, null, 2), { mode: 0o600 });
  await rename(temporary, file);
}
async function command(label, role, path, body = {}, method = "POST") {
  if (journal.commands[label]?.done) return journal.commands[label].data;
  if (verifyOnly) throw Error(`Missing fixture step: ${label}`);
  const record = (journal.commands[label] ||= { key: "linked-demo-" + randomUUID(), path, method, body });
  assert.equal(record.path, path);
  await save();
  await delay(250);
  const result = await api(role, path, method, record.body, record.key);
  changes.commandsApplied++;
  // Completed steps retain only identifiers, not response credentials or join codes.
  record.done = true;
  record.data = result?.classId
    ? { classId: result.classId }
    : result?.quizId
      ? { quizId: result.quizId }
      : result?.attemptId
        ? { attemptId: result.attemptId }
        : { done: true };
  delete record.body;
  await save();
  return result;
}
const access = async () =>
  list(await api("student", "/me/courses"))
    .map((course) => course.courseId)
    .sort();
const beforeAccess = await access();
if (!journal.courseAccess) {
  if (verifyOnly) throw Error("Missing fixture access snapshot");
  journal.courseAccess = beforeAccess;
  await save();
}
const studentClasses = list(await api("student", "/me/classes"));
const membershipIds = new Set(studentClasses.map((item) => item.classId));
const owned = list(await api("lecturer", "/me/owned-classes"));
const courses = list(await api("lecturer", "/me/owned-courses"));
function courseBySlug(items, slug) {
  const found = items.filter((item) => item.slug === slug && item.state === "PUBLISHED");
  assert.equal(found.length, 1, `Missing unique published demo course ${slug}; seed the local catalog first`);
  return found[0];
}
const web = selectClass(
  owned,
  membershipIds,
  actors.lecturer.me.userId,
  courseBySlug(courses, "demo-web-html-css").courseId,
  "Lớp Thực hành Web Fullstack K26",
);
const cassandra = selectClass(
  owned,
  membershipIds,
  actors.lecturer.me.userId,
  courseBySlug(courses, "demo-cassandra").courseId,
  "Lớp Chuyên đề: Cơ sở dữ liệu phân tán Cassandra & Big Data",
);
const secondCourse = courseBySlug(list(await api("python", "/me/owned-courses")), "instructor-demo-1");
const pythonName = "[Demo liên kết] Python thực hành - Minh An";
const pythonClasses = list(await api("python", "/me/owned-classes")).filter(
  (item) => item.name === pythonName && item.state === "ACTIVE",
);
assert.ok(pythonClasses.length <= 1, "Multiple linked Python demo classes found");
let pythonClass = pythonClasses[0];
if (!pythonClass) {
  const created = await command("python:class", "python", "/classes", {
    name: pythonName,
    classKind: "INSTITUTIONAL",
    linkedCourseId: secondCourse.courseId,
    maxMembers: 20,
  });
  pythonClass = await api("python", `/classes/${created.classId}`);
}
assert.equal(pythonClass.ownerLecturerId, actors.python.me.userId);
assert.equal(pythonClass.linkedCourseId, secondCourse.courseId);
if (!journal.pythonSessions) {
  if (verifyOnly) throw Error("Missing fixture session plan");
  const from = new Date(new Date(journal.createdAt).getTime() + 7 * 3600000).toISOString().slice(0, 10);
  const to = new Date(Date.parse(from) + 24 * 86400000).toISOString().slice(0, 10);
  const schedules = [];
  for (const role of ["student", "nam"])
    schedules.push(...list(await api(role, `/me/schedule?from=${from}&to=${to}`)));
  journal.pythonSessions = sessionPlan(journal.createdAt, schedules);
  await save();
}
if (pythonClass.scheduleState !== "PUBLISHED") {
  for (const [index, session] of journal.pythonSessions.entries())
    await command(`python:session:${index}`, "python", `/classes/${pythonClass.classId}/sessions`, session);
  await command("python:publish-schedule", "python", `/classes/${pythonClass.classId}/schedule/publish`);
}

async function ensureMembers(owner, classroom, roles) {
  const members = list(await api(owner, `/classes/${classroom.classId}/members`));
  const missing = roles.filter(
    (role) =>
      !members.some((member) => member.studentId === actors[role].me.userId && member.state === "ACTIVE"),
  );
  if (!missing.length) return;
  if (verifyOnly) throw Error(`Missing active membership in ${classroom.name}`);
  // A code is retrieved only when a join is needed, and is never written to disk.
  const code = await api(
    owner,
    `/classes/${classroom.classId}/join-code/reset`,
    "POST",
    {},
    "linked-demo-code-" + randomUUID(),
  );
  for (const role of missing) {
    await api(role, "/classes/join", "POST", { code: code.joinCode }, "linked-demo-join-" + randomUUID());
    changes.membershipsAdded++;
  }
}
await ensureMembers("lecturer", web, ["student"]);
await ensureMembers("lecturer", cassandra, ["student", "nam"]);
await ensureMembers("python", pythonClass, ["student", "nam"]);

async function getQuiz(owner, classroom, title) {
  const matches = list(await api(owner, `/targets/CLASS/${classroom.classId}/quizzes`)).filter(
    (quiz) => quiz.title === title,
  );
  assert.equal(matches.length, 1, `Expected one existing quiz: ${title}`);
  const detail = await api(owner, `/quizzes/${matches[0].quizId}`);
  assert.equal(detail.ownerId, actors[owner].me.userId);
  assert.equal(detail.targetId, classroom.classId);
  assert.equal(detail.state, "PUBLISHED");
  return detail;
}
const webQuiz = await getQuiz("lecturer", web, "Đề kiểm tra 15 phút: HTML5 & CSS3 Cơ bản");
const cassandraQuiz = await getQuiz(
  "lecturer",
  cassandra,
  "Đề kiểm tra trắc nghiệm: Kiến trúc & Mô hình dữ liệu Apache Cassandra",
);
const pythonQuizzes = list(await api("python", `/targets/CLASS/${pythonClass.classId}/quizzes`)).filter(
  (item) => item.title === pythonQuiz.title,
);
assert.ok(pythonQuizzes.length <= 1, "Multiple linked Python demo quizzes found");
let quiz = pythonQuizzes[0];
if (!quiz)
  quiz = await command("python:quiz", "python", "/quizzes", {
    ...pythonQuiz,
    targetType: "CLASS",
    targetId: pythonClass.classId,
  });
let pythonDetail = await api("python", `/quizzes/${quiz.quizId}`);
if (pythonDetail.state === "DRAFT") {
  await command("python:publish-quiz", "python", `/quizzes/${quiz.quizId}/publish`);
  pythonDetail = await api("python", `/quizzes/${quiz.quizId}`);
}
assert.equal(pythonDetail.ownerId, actors.python.me.userId);
assert.equal(pythonDetail.targetId, pythonClass.classId);
assert.equal(pythonDetail.state, "PUBLISHED");

async function results(owner, detail) {
  const months = new Set([journal.createdAt.slice(0, 7), new Date().toISOString().slice(0, 7)]);
  // Existing demo results may predate this seed. Include the quiz creation month.
  months.add(detail.createdAt.slice(0, 7));
  const rows = [];
  for (const month of months)
    rows.push(...list(await api(owner, `/quizzes/${detail.quizId}/results?month=${month}&limit=100`)));
  return rows;
}
async function ensureSubmission(owner, detail, role, wrongFirst, create = true) {
  const rows = await results(owner, detail);
  let result = rows.find((item) => item.studentId === actors[role].me.userId);
  if (!result) {
    if (!create || verifyOnly) throw Error(`Missing existing result: ${role}/${detail.title}`);
    const attempt = await command(
      `${detail.quizId}:${role}:start`,
      role,
      `/quizzes/${detail.quizId}/attempts`,
    );
    await command(`${detail.quizId}:${role}:submit`, role, `/attempts/${attempt.attemptId}/submit`, {
      clientSubmittedAt: new Date().toISOString(),
      answers: demoAnswers(detail.questions, wrongFirst),
    });
    result = (await results(owner, detail)).find((item) => item.attemptId === attempt.attemptId);
    assert.ok(result, "Submitted result is missing from the lecturer gradebook");
  }
  journal.attempts[`${detail.quizId}:${role}`] = {
    owner,
    role,
    quizId: detail.quizId,
    attemptId: result.attemptId,
  };
  if (!verifyOnly) await save();
  const ownResult = await api(role, `/attempts/${result.attemptId}/result`);
  assert.equal(ownResult.score, result.score);
  assert.equal(ownResult.maxScore, result.maxScore);
  if (!verifyOnly && !result.teacherFeedback) {
    await api(owner, `/quizzes/${detail.quizId}/grades/${result.attemptId}`, "POST", {
      score: result.score,
      expectedResultVersion: result.resultVersion,
      feedback: `[Dữ liệu demo] Bài nộp được chấm tự động ${result.score}/${result.maxScore}. ${Number(result.score) === Number(result.maxScore) ? "Đã trả lời đúng các câu hỏi." : "Xem lại câu trả lời chưa đúng trước lần thử tiếp theo."}`,
    });
    changes.feedbackAdded++;
  }
}
await ensureSubmission("lecturer", webQuiz, "student", true);
await ensureSubmission("lecturer", cassandraQuiz, "student", false, false);
await ensureSubmission("lecturer", cassandraQuiz, "nam", false, false);
await ensureSubmission("python", pythonDetail, "nam", true);
// The main student gets the Python quiz but no automatically created attempt.

const fixtures = [
  ["lecturer", web, webQuiz, ["student"]],
  ["lecturer", cassandra, cassandraQuiz, ["student", "nam"]],
  ["python", pythonClass, pythonDetail, ["student", "nam"]],
];
for (const [owner, classroom, detail, roles] of fixtures) {
  if (!verifyOnly)
    await command(`${classroom.classId}:announcement`, owner, `/classes/${classroom.classId}/announcements`, {
      title: "[Demo] Hướng dẫn học và xem kết quả",
      body: `Dữ liệu thực hành cho tài khoản demo. Lớp: ${classroom.name}. Bài kiểm tra: ${detail.title}. Mở Bài kiểm tra để làm bài; kết quả và phản hồi có trong Bảng điểm. Quyền học nội dung khóa học trả phí vẫn cần đăng ký/thanh toán riêng.`,
    });
  const members = list(await api(owner, `/classes/${classroom.classId}/members`));
  const announcementPath = `/classes/${classroom.classId}/announcements?month=${journal.createdAt.slice(0, 7)}-01`;
  const announcements = list(await api(owner, announcementPath));
  assert.ok(
    announcements.some(
      (item) => item.title === "[Demo] Hướng dẫn học và xem kết quả" && item.body.includes(detail.title),
    ),
  );
  for (const role of roles) {
    assert.ok(
      members.some((member) => member.studentId === actors[role].me.userId && member.state === "ACTIVE"),
    );
    assert.ok(list(await api(role, "/me/classes")).some((item) => item.classId === classroom.classId));
    assert.ok(
      list(await api(role, `/targets/CLASS/${classroom.classId}/quizzes`)).some(
        (item) => item.quizId === detail.quizId,
      ),
    );
    const studentQuiz = await api(role, `/quizzes/${detail.quizId}`);
    assert.ok(
      studentQuiz.questions.every((question) => !("correctAnswer" in question)),
      "Student must not receive quiz answers",
    );
    assert.ok(
      list(await api(role, announcementPath)).some(
        (item) => item.title === "[Demo] Hướng dẫn học và xem kết quả" && item.body.includes(detail.title),
      ),
    );
  }
}
const from = journal.pythonSessions[0].startAt.slice(0, 10);
const to = journal.pythonSessions.at(-1).endAt.slice(0, 10);
const teacherSessions = list(
  await api("python", `/classes/${pythonClass.classId}/sessions?from=${from}&to=${to}`),
);
assert.equal(teacherSessions.length, 3);
for (const role of ["student", "nam"]) {
  const schedule = list(await api(role, `/me/schedule?from=${from}&to=${to}`));
  for (const session of teacherSessions)
    assert.ok(
      schedule.some(
        (item) =>
          item.sessionId === session.sessionId &&
          item.startAt === session.startAt &&
          item.endAt === session.endAt,
      ),
    );
}
for (const [role, deniedQuiz] of [
  ["lecturer", pythonDetail],
  ["python", webQuiz],
]) {
  let denied = false;
  try {
    await api(role, `/quizzes/${deniedQuiz.quizId}/results?month=${new Date().toISOString().slice(0, 7)}`);
  } catch (error) {
    if (![403, 404].includes(error.status)) throw error;
    denied = true;
  }
  assert.ok(denied, "Lecturer must not read another lecturer's results");
}
const namPythonAttempt = journal.attempts[`${pythonDetail.quizId}:nam`];
let privateResultDenied = false;
try {
  await api("student", `/attempts/${namPythonAttempt.attemptId}/result`);
} catch (error) {
  if (![403, 404].includes(error.status)) throw error;
  privateResultDenied = true;
}
assert.ok(privateResultDenied, "A student must not read a classmate's result");
assert.deepEqual(await access(), beforeAccess, "Fixture seed must not grant catalog course access");
console.log(
  JSON.stringify(
    {
      verified: true,
      mode: verifyOnly ? "verify" : "seed",
      lecturers: 2,
      linkedClasses: 3,
      pythonSessions: teacherSessions.length,
      verifiedSubmissions: Object.keys(journal.attempts).length,
      catalogAccessUnchanged: true,
      mainStudentPythonAttemptCreated: false,
      changes,
    },
    null,
    2,
  ),
);
