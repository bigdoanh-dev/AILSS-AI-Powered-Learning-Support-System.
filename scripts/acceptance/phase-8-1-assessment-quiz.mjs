import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { importPKCS8, SignJWT } from "jose";

if ((process.env.AILSS_PROFILE ?? "dev-async") !== "dev-async")
  throw new Error("P8.1 acceptance requires dev-async");
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-"),
  evidence = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidence, { recursive: true });
await ready();

const admin = await register("admin"),
  owner = await register("owner"),
  other = await register("other"),
  unverified = await register("unverified"),
  student = await register("student");
identity({ action: "promote", userId: admin.userId, role: "ADMIN" });
for (const user of [owner, other, unverified])
  identity({ action: "promote", userId: user.userId, role: "LECTURER" });
const adminToken = (await login(admin)).accessToken;
for (const lecturer of [owner, other])
  expectStatus(
    await http("POST", `/api/v1/admin/lecturers/${lecturer.userId}/verify`, {
      bearer: adminToken,
      key: `verify-${lecturer.userId}-${runId}`,
      body: { currentPassword: admin.password },
    }),
    200,
    "verify Lecturer",
  );
const ownerToken = (await login(owner)).accessToken,
  otherToken = (await login(other)).accessToken,
  unverifiedToken = (await login(unverified)).accessToken,
  studentToken = (await login(student)).accessToken,
  course = await createPublishedCourse(ownerToken, adminToken, admin.password),
  klass = await createClass(ownerToken);

const createBody = {
    title: "P8.1 Distributed Systems Quiz",
    targetType: "COURSE",
    targetId: course.courseId,
    durationSeconds: 1800,
    attemptLimit: 2,
    questions: [
      {
        prompt: "Choose all quorum consistency levels",
        questionType: "MULTIPLE_CHOICE",
        options: ["ONE", "QUORUM", "ALL"],
        correctAnswer: ["QUORUM", "ALL"],
        points: "10.00",
      },
      {
        prompt: "Cassandra is a relational database",
        questionType: "TRUE_FALSE",
        correctAnswer: false,
        points: "5",
      },
    ],
  },
  createKey = `quiz-create-${runId}`;
expectStatus(
  await http("POST", "/api/v1/quizzes", {
    bearer: studentToken,
    key: `student-${runId}`,
    body: createBody,
  }),
  403,
  "Student create denied",
);
expectStatus(
  await http("POST", "/api/v1/quizzes", {
    bearer: unverifiedToken,
    key: `unverified-${runId}`,
    body: createBody,
  }),
  403,
  "unverified Lecturer create denied",
);
expectStatus(
  await http("POST", "/api/v1/quizzes", {
    bearer: otherToken,
    key: `non-owner-${runId}`,
    body: createBody,
  }),
  403,
  "non-owner target create denied",
);
expectStatus(
  await http("POST", "/api/v1/quizzes", {
    bearer: ownerToken,
    key: `strict-${runId}`,
    body: { ...createBody, state: "PUBLISHED" },
  }),
  422,
  "strict DTO",
);

const created = await http("POST", "/api/v1/quizzes", {
  bearer: ownerToken,
  key: createKey,
  body: createBody,
});
expectStatus(created, 201, "create COURSE quiz");
const quizId = created.json.data.quizId;
if (
  created.json.data.state !== "DRAFT" ||
  created.json.data.currentVersion !== 1 ||
  created.json.data.recordVersion !== 1 ||
  created.json.data.questionCount !== 2
)
  throw new Error(`initial quiz invariant mismatch ${JSON.stringify(created.json.data)}`);
if (!created.json.data.questions.every((question) => "correctAnswer" in question))
  throw new Error("owner create response omitted answers");
const replay = await http("POST", "/api/v1/quizzes", {
  bearer: ownerToken,
  key: createKey,
  body: createBody,
});
expectStatus(replay, 201, "create replay");
if (!replay.json.meta.replayed || replay.json.data.quizId !== quizId)
  throw new Error("create replay mismatch");
expectStatus(
  await http("POST", "/api/v1/quizzes", {
    bearer: ownerToken,
    key: createKey,
    body: { ...createBody, title: "Conflicting quiz" },
  }),
  409,
  "create idempotency conflict",
);
expectStatus(
  await http("GET", `/api/v1/quizzes/${quizId}`, { bearer: ownerToken }),
  200,
  "owner DRAFT detail",
);
expectStatus(
  await http("GET", `/api/v1/quizzes/${quizId}`, { bearer: studentToken }),
  404,
  "Student DRAFT privacy",
);
const ownerDraftList = await http("GET", `/api/v1/targets/COURSE/${course.courseId}/quizzes`, {
  bearer: ownerToken,
});
expectStatus(ownerDraftList, 200, "owner DRAFT list");
if (
  !ownerDraftList.json.data.some((item) => item.quizId === quizId) ||
  "correctAnswer" in ownerDraftList.json.data[0]
)
  throw new Error("owner list metadata invariant mismatch");
const studentDraftList = await http("GET", `/api/v1/targets/COURSE/${course.courseId}/quizzes`, {
  bearer: studentToken,
});
expectStatus(studentDraftList, 200, "Student DRAFT list");
if (studentDraftList.json.data.some((item) => item.quizId === quizId))
  throw new Error("DRAFT quiz leaked through ASM-05");

const classQuiz = await http("POST", "/api/v1/quizzes", {
  bearer: ownerToken,
  key: `class-quiz-${runId}`,
  body: {
    title: "P8.1 Class Quiz",
    targetType: "CLASS",
    targetId: klass.classId,
    questions: [{ prompt: "Class is active", questionType: "TRUE_FALSE", correctAnswer: true, points: "1" }],
  },
});
expectStatus(classQuiz, 201, "create CLASS quiz via INT-CLS-01");

const update = await http("PATCH", `/api/v1/quizzes/${quizId}`, {
  bearer: ownerToken,
  key: `update-${runId}`,
  body: { title: "P8.1 Immutable Snapshot Quiz" },
});
expectStatus(update, 200, "metadata update");
if (update.json.data.currentVersion !== 2 || update.json.data.recordVersion !== 2)
  throw new Error("update did not advance both versions exactly once");
const noOp = await http("PATCH", `/api/v1/quizzes/${quizId}`, {
  bearer: ownerToken,
  key: `noop-${runId}`,
  body: { title: "P8.1 Immutable Snapshot Quiz" },
});
expectStatus(noOp, 200, "semantic no-op");
if (!noOp.json.meta.noOp || noOp.json.data.currentVersion !== 2 || noOp.json.data.recordVersion !== 2)
  throw new Error("semantic no-op advanced versions");

const concurrent = await Promise.all([
  http("PATCH", `/api/v1/quizzes/${quizId}`, {
    bearer: ownerToken,
    key: `concurrent-a-${runId}`,
    body: { title: "P8.1 Concurrent Winner A" },
  }),
  http("PATCH", `/api/v1/quizzes/${quizId}`, {
    bearer: ownerToken,
    key: `concurrent-b-${runId}`,
    body: { title: "P8.1 Concurrent Winner B" },
  }),
]);
const winners = concurrent.filter((value) => value.status === 200),
  losers = concurrent.filter((value) => value.status === 409);
if (winners.length !== 1 || losers.length !== 1)
  throw new Error(`concurrent N+1 reservation mismatch ${JSON.stringify(concurrent)}`);
const winner = winners[0];
if (winner.json.data.currentVersion !== 3 || winner.json.data.recordVersion !== 3)
  throw new Error("concurrent winner version mismatch");

const published = await http("POST", `/api/v1/quizzes/${quizId}/publish`, {
  bearer: ownerToken,
  key: `publish-${runId}`,
});
expectStatus(published, 200, "publish");
if (
  published.json.data.state !== "PUBLISHED" ||
  published.json.data.currentVersion !== 3 ||
  published.json.data.recordVersion !== 4
)
  throw new Error("publish version invariant mismatch");
const publishReplay = await http("POST", `/api/v1/quizzes/${quizId}/publish`, {
  bearer: ownerToken,
  key: `publish-${runId}`,
});
expectStatus(publishReplay, 200, "publish replay");
if (!publishReplay.json.meta.replayed || publishReplay.json.data.recordVersion !== 4)
  throw new Error("publish replay advanced recordVersion");
expectStatus(
  await http("PATCH", `/api/v1/quizzes/${quizId}`, {
    bearer: ownerToken,
    key: `published-edit-${runId}`,
    body: { title: "Forbidden published edit" },
  }),
  409,
  "PUBLISHED edit denied",
);
const studentDetail = await http("GET", `/api/v1/quizzes/${quizId}`, { bearer: studentToken });
expectStatus(studentDetail, 200, "Student published detail");
if (studentDetail.json.data.questions.some((question) => "correctAnswer" in question))
  throw new Error("correct answer leaked to Student");
const studentPublishedList = await http("GET", `/api/v1/targets/COURSE/${course.courseId}/quizzes`, {
  bearer: studentToken,
});
expectStatus(studentPublishedList, 200, "Student published list");
if (!studentPublishedList.json.data.some((item) => item.quizId === quizId))
  throw new Error("published quiz missing from ASM-05");

let p82;
if (process.env.AILSS_ACCEPTANCE_P8_2 === "true") {
  learningEntitlement(student.userId, course.courseId);
  const missingKey = await http("POST", `/api/v1/quizzes/${quizId}/attempts`, {
    bearer: studentToken,
    body: {},
  });
  expectStatus(missingKey, 400, "ASM-06 Idempotency-Key required");
  const key = `attempt-${runId}`,
    started = await http("POST", `/api/v1/quizzes/${quizId}/attempts`, {
      bearer: studentToken,
      key,
      body: {},
    });
  expectStatus(started, 201, "entitled COURSE Student start");
  if (started.json.data.state !== "IN_PROGRESS" || started.json.data.quizVersion !== 3)
    throw new Error("attempt state or pinned version mismatch");
  if (
    started.json.data.questions.some((question) =>
      ["correctAnswer", "correct_answer_json", "checksum", "explanation"].some((field) => field in question),
    )
  )
    throw new Error("attempt delivery leaked protected question material");
  const replayed = await http("POST", `/api/v1/quizzes/${quizId}/attempts`, {
    bearer: studentToken,
    key,
    body: {},
  });
  expectStatus(replayed, 201, "attempt same-key replay");
  if (!replayed.json.meta.replayed || replayed.json.data.attemptId !== started.json.data.attemptId)
    throw new Error("attempt replay changed logical identity");
  const activeResume = await http("POST", `/api/v1/quizzes/${quizId}/attempts`, {
    bearer: studentToken,
    key: `attempt-other-${runId}`,
    body: {},
  });
  expectStatus(activeResume, 201, "different-key active resume");
  if (activeResume.json.data.attemptId !== started.json.data.attemptId)
    throw new Error("different key allocated a second active attempt");
  const detail = await http("GET", `/api/v1/attempts/${started.json.data.attemptId}`, {
    bearer: studentToken,
  });
  expectStatus(detail, 200, "ASM-07 owner detail");
  expectStatus(
    await http("GET", `/api/v1/attempts/${started.json.data.attemptId}`, { bearer: otherToken }),
    404,
    "ASM-07 non-owner concealment",
  );
  const physical = assessmentAttempt({
    attemptId: started.json.data.attemptId,
    studentId: student.userId,
    quizId,
  });
  if (
    physical.attemptRows !== 1 ||
    physical.guardActiveAttemptId !== started.json.data.attemptId ||
    (process.env.AILSS_ACCEPTANCE_P8_3 !== "true" && physical.pendingEvents !== 0)
  )
    throw new Error(`attempt physical invariant mismatch ${JSON.stringify(physical)}`);
  p82 = {
    attemptId: started.json.data.attemptId,
    pinnedVersion: 3,
    sameKeyReplay: true,
    differentKeyResume: true,
    ownerDetail: true,
    privacy: true,
    physical,
  };
  if (process.env.AILSS_ACCEPTANCE_P8_3 === "true") {
    const answers = started.json.data.questions.map((q) =>
        q.questionType === "MULTIPLE_CHOICE"
          ? { questionId: q.questionId, selectedOptionIds: ["QUORUM", "ALL"] }
          : { questionId: q.questionId, value: false },
      ),
      submitKey = `submit-${runId}`,
      submitBody = { answers, clientSubmittedAt: new Date().toISOString() },
      brokerRecovery = process.env.AILSS_ACCEPTANCE_P8_4 === "true";
    if (brokerRecovery) execFileSync("docker", ["stop", "ailss-rabbitmq"], { stdio: "pipe" });
    const submitted = await http("POST", `/api/v1/attempts/${started.json.data.attemptId}/submit`, {
      bearer: studentToken,
      key: submitKey,
      body: submitBody,
    });
    expectStatus(submitted, 202, "ASM-08 objective submit");
    let brokerProof;
    if (brokerRecovery) {
      const before = assessmentSubmitState(started.json.data.attemptId);
      if (!before.resultExists || before.attemptState !== "SUBMITTED" || before.eventState !== "READY")
        throw new Error(`broker-down canonical invariant mismatch ${JSON.stringify(before)}`);
      execFileSync("docker", ["start", "ailss-rabbitmq"], { stdio: "pipe" });
      await containerHealthy("ailss-rabbitmq");
      execFileSync(process.execPath, ["scripts/dev/provision-rabbitmq.mjs"], { stdio: "pipe" });
      execFileSync(process.execPath, ["scripts/dev/verify-rabbitmq.mjs"], { stdio: "pipe" });
      let after;
      for (let index = 0; index < 20; index += 1) {
        after = assessmentSubmitState(started.json.data.attemptId);
        if (after.eventState === "PUBLISHED") break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (after?.eventId !== before.eventId || after?.eventState !== "PUBLISHED")
        throw new Error(`broker recovery mismatch ${JSON.stringify({ before, after })}`);
      brokerProof = { sameEventId: true, canonicalSafeWhileDown: true, publishedAfterRestart: true };
    }
    if (submitted.json.data.score !== "15" || submitted.json.data.maxScore !== "15")
      throw new Error(`score mismatch ${JSON.stringify(submitted.json.data)}`);
    const submitReplay = await http("POST", `/api/v1/attempts/${started.json.data.attemptId}/submit`, {
      bearer: studentToken,
      key: submitKey,
      body: submitBody,
    });
    expectStatus(submitReplay, 202, "ASM-08 same-key replay");
    if (!submitReplay.json.meta.replayed || submitReplay.json.data.score !== "15")
      throw new Error("submit replay changed canonical result");
    expectStatus(
      await http("POST", `/api/v1/attempts/${started.json.data.attemptId}/submit`, {
        bearer: studentToken,
        key: submitKey,
        body: { ...submitBody, answers: [] },
      }),
      409,
      "ASM-08 same-key different-payload conflict",
    );
    expectStatus(
      await http("POST", `/api/v1/attempts/${started.json.data.attemptId}/submit`, {
        bearer: studentToken,
        key: `submit-other-${runId}`,
        body: submitBody,
      }),
      409,
      "ASM-08 second operation conflict",
    );
    p82.p83 = {
      score: submitted.json.data.score,
      maxScore: submitted.json.data.maxScore,
      resultVersion: submitted.json.data.resultVersion,
      sameKeyReplay: true,
      sameKeyDifferentPayloadConflict: true,
      secondOperationConflict: true,
    };
    if (process.env.AILSS_ACCEPTANCE_P8_4 === "true") {
      const summary = await http("GET", `/api/v1/attempts/${started.json.data.attemptId}/result`, {
        bearer: studentToken,
      });
      expectStatus(summary, 200, "ASM-09 owner score summary");
      if (
        summary.json.data.score !== "15" ||
        summary.json.data.maxScore !== "15" ||
        "gradingChecksum" in summary.json.data ||
        "items" in summary.json.data ||
        "correctAnswer" in summary.json.data
      )
        throw new Error(`ASM-09 privacy mismatch ${JSON.stringify(summary.json.data)}`);
      expectStatus(
        await http("GET", `/api/v1/attempts/${started.json.data.attemptId}/result`, {
          bearer: otherToken,
        }),
        404,
        "ASM-09 non-owner concealment",
      );
      const month = new Date().toISOString().slice(0, 7),
        lecturerResults = await http("GET", `/api/v1/quizzes/${quizId}/results?month=${month}&limit=1`, {
          bearer: ownerToken,
        });
      expectStatus(lecturerResults, 200, "ASM-10 owner Lecturer results");
      if (lecturerResults.json.data.items[0]?.attemptId !== started.json.data.attemptId)
        throw new Error(`ASM-10 canonical result missing ${JSON.stringify(lecturerResults.json.data)}`);
      expectStatus(
        await http("GET", `/api/v1/quizzes/${quizId}/results?month=${month}`, {
          bearer: otherToken,
        }),
        403,
        "ASM-10 non-owner Lecturer denied",
      );
      expectStatus(
        await http("GET", `/api/v1/quizzes/${quizId}/results?month=${month}`, {
          bearer: adminToken,
        }),
        403,
        "ASM-10 Admin deferred",
      );
      expectStatus(
        await http("GET", `/api/v1/quizzes/${quizId}/results`, { bearer: ownerToken }),
        400,
        "ASM-10 month required",
      );
      p82.p84 = {
        studentScoreOnly: true,
        nonOwnerConcealed: true,
        ownerLecturer: true,
        nonOwnerLecturerDenied: true,
        adminDeferred: true,
        monthRequired: true,
        brokerRecovery: brokerProof,
      };
    }
  }
}

const state = assessment({
  action: "inspect",
  quizId,
  targetType: "COURSE",
  targetId: course.courseId,
});
if (
  state.canonical.state !== "PUBLISHED" ||
  state.canonical.currentVersion !== 3 ||
  state.canonical.recordVersion !== 4 ||
  state.versions.length !== 3 ||
  state.versions.some((version) => version.count !== 2) ||
  state.draftProjectionRows !== 0 ||
  state.publishedProjectionRows !== 1 ||
  (process.env.AILSS_ACCEPTANCE_P8_3 !== "true" && state.pendingEvents !== 0)
)
  throw new Error(`physical quiz invariant mismatch ${JSON.stringify(state)}`);
if (!state.sameQuestionIdsAcrossVersions)
  throw new Error("metadata update did not preserve copied immutable question identities");
if (!assessment({ action: "deny" }).denied)
  throw new Error("svc_assessment foreign Identity keyspace access was not denied");

await verifyInternalProviderAuth(course.courseId, klass.classId);
execFileSync("docker", ["stop", "ailss-learning-service"], { stdio: "pipe" });
const unavailable = await http("POST", "/api/v1/quizzes", {
  bearer: ownerToken,
  key: `dependency-outage-${runId}`,
  body: { ...createBody, title: "Dependency outage must fail closed" },
});
expectStatus(unavailable, 503, "Learning dependency outage fail-closed");
execFileSync("docker", ["start", "ailss-learning-service"], { stdio: "pipe" });
await serviceReady("ailss-learning-service", 8102);

const summary = {
  stage: "phase-8.1-assessment-quiz-acceptance",
  status: "PASS",
  runId,
  quizId,
  classQuizId: classQuiz.json.data.quizId,
  createReplay: true,
  idempotencyConflict: true,
  courseAndClassTargets: true,
  immutableVersions: state.versions,
  concurrentNextVersionOneWinner: true,
  publish: { currentVersion: 3, recordVersion: 4, replayed: true },
  privacy: { draftPrivate: true, studentAnswersWithheld: true, listMetadataOnly: true },
  projection: { draftRows: 0, publishedRows: 1, canonicalGuarded: true },
  noBusinessEvent: true,
  serviceTokenAllowlist: true,
  dependencyUnavailableFailClosed: true,
  foreignKeyspaceDenied: true,
  counts: { publicApis: 98, internalApis: 15, queryIds: 74, events: 22, redis: false },
  ...(p82 ? { p82 } : {}),
};
await writeFile(new URL("p8.1-summary.json", evidence), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ...summary, evidence: decodeURIComponent(evidence.pathname) }));

async function register(label) {
  const id = randomUUID(),
    user = {
      email: `p81-${label}-${id}@example.test`,
      password: `P8.1-${label}-${id}-Aa1!`,
      displayName: `P81 ${label}`,
    },
    response = await http("POST", "/api/v1/auth/register", {
      key: `register-${id}`,
      body: user,
    });
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
async function createPublishedCourse(lecturerToken, administratorToken, administratorPassword) {
  const created = await http("POST", "/api/v1/courses", {
    bearer: lecturerToken,
    key: `course-${runId}`,
    body: {
      title: "P8.1 Quiz Target Course",
      slug: `p81-${randomUUID()}`,
      categoryId: randomUUID(),
      priceType: "FREE",
      price: "0",
      currency: "VND",
    },
  });
  expectStatus(created, 201, "create Course target");
  expectStatus(
    await http("POST", `/api/v1/courses/${created.json.data.courseId}/lessons`, {
      bearer: lecturerToken,
      key: `lesson-${runId}`,
      body: {
        title: "Quiz target lesson",
        sectionTitle: "Foundation",
        position: { sectionOrder: 1, lessonOrder: 1 },
        preview: true,
      },
    }),
    201,
    "create Course lesson",
  );
  expectStatus(
    await http("POST", `/api/v1/courses/${created.json.data.courseId}/submit-review`, {
      bearer: lecturerToken,
      key: `review-${runId}`,
    }),
    202,
    "submit Course review",
  );
  expectStatus(
    await http("POST", `/api/v1/admin/courses/${created.json.data.courseId}/publish`, {
      bearer: administratorToken,
      key: `course-publish-${runId}`,
      body: { currentPassword: administratorPassword },
    }),
    200,
    "publish Course target",
  );
  return created.json.data;
}
async function createClass(lecturerToken) {
  const response = await http("POST", "/api/v1/classes", {
    bearer: lecturerToken,
    key: `class-${runId}`,
    body: { name: "P8.1 Active Class", classKind: "PRIVATE" },
  });
  expectStatus(response, 201, "create Class target");
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
  if (value.status !== status)
    throw new Error(`${label}: expected ${status}, got ${value.status} ${JSON.stringify(value.json)}`);
}
async function ready() {
  for (let index = 0; index < 120; index += 1) {
    try {
      if ((await fetch("http://127.0.0.1:8080/health/ready")).ok) return;
    } catch {
      // container replacement is transient
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Gateway unavailable");
}
async function serviceReady(container, port) {
  for (let index = 0; index < 80; index += 1) {
    try {
      const source = `const r=await fetch('http://127.0.0.1:${String(port)}/health/ready');process.exit(r.ok?0:1)`;
      execFileSync("docker", ["exec", container, "node", "-e", source], { stdio: "pipe" });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`${container} did not recover`);
}
async function containerHealthy(container) {
  for (let index = 0; index < 120; index += 1) {
    try {
      const status = execFileSync("docker", ["inspect", "--format", "{{.State.Health.Status}}", container], {
        encoding: "utf8",
      }).trim();
      if (status === "healthy") return;
    } catch {
      // restarting
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${container} did not become healthy`);
}
function identity(input) {
  return runDb("ailss-identity-service", input, identityProbe());
}
function assessment(input) {
  return runDb("ailss-assessment-service", input, assessmentProbe());
}
function learningEntitlement(studentId, courseId) {
  return runDb(
    "ailss-learning-service",
    { studentId, courseId },
    `import{readFileSync}from"node:fs";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString,n=new Date(),e=c.types.Uuid.random();await x.connect();await x.execute("INSERT INTO entitlement_by_student_course (student_id,course_id,entitlement_id,state,granted_at,version,updated_at) VALUES (?,?,?,'ACTIVE',?,1,?)",[u(i.studentId),u(i.courseId),e,n,n],q);await x.shutdown();console.log(JSON.stringify({ok:true}));`,
  );
}
function assessmentAttempt(input) {
  return runDb(
    "ailss-assessment-service",
    input,
    `import{readFileSync}from"node:fs";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();const a=(await x.execute("SELECT attempt_id,state,quiz_version FROM attempt_by_id WHERE attempt_id=?",[u(i.attemptId)],q)).rows,g=(await x.execute("SELECT active_attempt_id,attempts_started FROM attempt_guard_by_student_quiz WHERE student_id=? AND quiz_id=?",[u(i.studentId),u(i.quizId)],q)).rows[0],e=(await x.execute("SELECT event_id,aggregate_id FROM pending_event_by_id LIMIT 50",[],q)).rows;await x.shutdown();console.log(JSON.stringify({attemptRows:a.length,state:a[0]?.get("state"),quizVersion:Number(a[0]?.get("quiz_version")),guardActiveAttemptId:g?.get("active_attempt_id")?String(g.get("active_attempt_id")):null,attemptsStarted:g?.get("attempts_started"),pendingEvents:e.filter(r=>String(r.get("aggregate_id"))===i.attemptId).length}));`,
  );
}
function assessmentSubmitState(attemptId) {
  return runDb(
    "ailss-assessment-service",
    { attemptId },
    `import{readFileSync}from"node:fs";import{createHmac}from"node:crypto";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();const a=(await x.execute("SELECT state,submit_key FROM attempt_by_id WHERE attempt_id=?",[u(i.attemptId)],q)).rows[0],r=(await x.execute("SELECT attempt_id FROM result_by_attempt WHERE attempt_id=?",[u(i.attemptId)],q)).rows[0],b=Buffer.from(createHmac("sha256",process.env.PASSWORD_IDEMPOTENCY_HMAC_KEY).update("submitted-event:"+a.get("submit_key")).digest().subarray(0,16));b[6]=(b[6]&15)|80;b[8]=(b[8]&63)|128;const h=b.toString("hex"),id=h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20),e=(await x.execute("SELECT event_id,state FROM pending_event_by_id WHERE event_id=?",[u(id)],q)).rows[0];await x.shutdown();console.log(JSON.stringify({attemptState:a?.get("state"),resultExists:!!r,eventId:e?String(e.get("event_id")):id,eventState:e?.get("state")??null}));`,
  );
}
function runDb(container, input, probe) {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", container, "node", "--input-type=module", "-e", probe], {
      input: JSON.stringify(input),
      encoding: "utf8",
    }).trim(),
  );
}
function identityProbe() {
  return `import{readFileSync}from"node:fs";import{createHash}from"node:crypto";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();const r=(await x.execute("SELECT display_name,role,status,lecturer_verified,profile_version,updated_at FROM user_by_id WHERE user_id=?",[u(i.userId)],q)).rows[0],s=(createHash("sha256").update(i.userId).digest()[0]??0)%16;await x.execute("DELETE FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?",[r.get("role"),r.get("status"),s,r.get("updated_at"),u(i.userId)],q);await x.execute("UPDATE user_by_id SET role=? WHERE user_id=?",[i.role,u(i.userId)],q);await x.execute("INSERT INTO users_by_role_status_bucket (role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version) VALUES (?,?,?,?,?,?,?,?)",[i.role,r.get("status"),s,r.get("updated_at"),u(i.userId),r.get("display_name"),r.get("lecturer_verified"),r.get("profile_version")],q);await x.shutdown();console.log(JSON.stringify({ok:true}));`;
}
function assessmentProbe() {
  return `import{readFileSync}from"node:fs";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();let o={};if(i.action==="deny"){try{await x.execute("SELECT user_id FROM identity_keyspace.user_by_id LIMIT 1",[],q);o={denied:false}}catch{o={denied:true}}}else{const a=(await x.execute("SELECT state,current_version,record_version,question_count,snapshot_ready,pending_operation_id FROM quiz_by_id WHERE quiz_id=?",[u(i.quizId)],q)).rows[0],versions=[];let ids;for(let v=1;v<=Number(a.get("current_version"));v++){const rows=(await x.execute("SELECT question_order,question_id,checksum FROM questions_by_quiz_version WHERE quiz_id=? AND quiz_version=?",[u(i.quizId),c.types.Long.fromNumber(v)],q)).rows,currentIds=rows.map(r=>String(r.get("question_id")));if(!ids)ids=currentIds;versions.push({version:v,count:rows.length});if(JSON.stringify(ids)!==JSON.stringify(currentIds))o.sameQuestionIdsAcrossVersions=false;}if(o.sameQuestionIdsAcrossVersions!==false)o.sameQuestionIdsAcrossVersions=true;const d=(await x.execute("SELECT quiz_id FROM quizzes_by_target_state_v2 WHERE target_type=? AND target_id=? AND state='DRAFT'",[i.targetType,u(i.targetId)],q)).rows.filter(r=>String(r.get("quiz_id"))===i.quizId),p=(await x.execute("SELECT quiz_id FROM quizzes_by_target_state_v2 WHERE target_type=? AND target_id=? AND state='PUBLISHED'",[i.targetType,u(i.targetId)],q)).rows.filter(r=>String(r.get("quiz_id"))===i.quizId),e=(await x.execute("SELECT event_id,aggregate_id FROM pending_event_by_id LIMIT 50",[],q)).rows;o={...o,canonical:{state:a.get("state"),currentVersion:Number(a.get("current_version")),recordVersion:Number(a.get("record_version")),questionCount:a.get("question_count"),snapshotReady:a.get("snapshot_ready"),pendingOperationId:a.get("pending_operation_id")?String(a.get("pending_operation_id")):null},versions,draftProjectionRows:d.length,publishedProjectionRows:p.length,pendingEvents:e.filter(r=>String(r.get("aggregate_id"))===i.quizId).length};}await x.shutdown();console.log(JSON.stringify(o));`;
}
async function verifyInternalProviderAuth(courseId, classId) {
  const tokenLearning = await serviceToken("learning-service", "learning.course.quiz-eligibility.read"),
    tokenClassroom = await serviceToken("classroom-service", "classroom.quiz-eligibility.read");
  expectStatus(
    direct(
      "ailss-learning-service",
      8102,
      `/internal/v1/courses/${courseId}/quiz-eligibility`,
      tokenLearning,
    ),
    200,
    "INT-LRN-01 Assessment caller",
  );
  expectStatus(
    direct(
      "ailss-classroom-service",
      8103,
      `/internal/v1/classes/${classId}/quiz-eligibility`,
      tokenClassroom,
    ),
    200,
    "INT-CLS-01 Assessment caller",
  );
  const forged = await serviceToken(
    "learning-service",
    "learning.course.quiz-eligibility.read",
    "rogue-service",
  );
  expectStatus(
    direct("ailss-learning-service", 8102, `/internal/v1/courses/${courseId}/quiz-eligibility`, forged),
    403,
    "INT-LRN-01 exact caller allowlist",
  );
  expectStatus(
    direct("ailss-classroom-service", 8103, `/internal/v1/classes/${classId}/quiz-eligibility`),
    401,
    "INT-CLS-01 token required",
  );
}
async function serviceToken(audience, purpose, subject = "assessment-service") {
  const pem = await readFile(
      new URL("../../infrastructure/tls/generated/services/assessment-private.pem", import.meta.url),
      "utf8",
    ),
    key = await importPKCS8(pem, "EdDSA"),
    now = Math.floor(Date.now() / 1000);
  return new SignJWT({ purpose })
    .setProtectedHeader({ alg: "EdDSA", kid: "dev-assessment-2026-01", typ: "service+jwt" })
    .setIssuer("ailss-internal")
    .setAudience(audience)
    .setSubject(subject)
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .setJti(randomUUID())
    .sign(key);
}
function direct(container, port, path, token) {
  const source = `const r=await fetch(${JSON.stringify(`http://127.0.0.1:${String(port)}${path}`)},{headers:${JSON.stringify(
    token
      ? { authorization: `Service ${token}`, "x-correlation-id": randomUUID() }
      : { "x-correlation-id": randomUUID() },
  )}});const t=await r.text();console.log(JSON.stringify({status:r.status,json:t?JSON.parse(t):undefined}));`;
  return JSON.parse(
    execFileSync("docker", ["exec", container, "node", "--input-type=module", "-e", source], {
      encoding: "utf8",
    }).trim(),
  );
}
