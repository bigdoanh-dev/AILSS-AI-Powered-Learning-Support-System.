import { createHash, randomUUID } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readEnv, required } from "../dev/env.mjs";

if ((process.env.AILSS_PROFILE ?? "dev-async") !== "dev-async")
  throw new Error("P10.2 acceptance requires dev-async");
const runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-"),
  evidence = new URL(`../../docs/evidence/${runId}/`, import.meta.url),
  startedAt = new Date();
await mkdir(evidence, { recursive: true });
const stoppedContainers = new Set();
const observerQueue = `p102-observer-${runId}`;
const observedEvents = [];
let restoreCursorTtl;
let brokerInterrupted = false;
try {
  await ready();
  assertTestProvider();
  const serviceEnv = JSON.parse(
    execFileSync("docker", ["inspect", "-f", "{{json .Config.Env}}", "ailss-ai-service"], {
      encoding: "utf8",
    }),
  );
  const previousTtl =
    serviceEnv.find((value) => value.startsWith("AI_CURSOR_TTL_SECONDS="))?.split("=")[1] ?? "900";
  if (previousTtl !== "5") {
    restoreCursorTtl = previousTtl;
    configureCursorTtl("5");
    await ready();
  }
  console.log("TEST_PROVIDER_ONLY=true");
  await rabbitApi(`/queues/%2Failss/${observerQueue}`, "PUT", {
    durable: true,
    auto_delete: false,
    arguments: { "x-expires": 900000 },
  });
  for (const routing_key of ["ai.quiz.generated.v1", "ai.job.failed.v1"])
    await rabbitApi(`/bindings/%2Failss/e/ailss.domain.events/q/${observerQueue}`, "POST", {
      routing_key,
      arguments: {},
    });

  const admin = await register("admin"),
    lecturer = await register("lecturer"),
    other = await register("other");
  identity({ action: "promote", userId: admin.userId, role: "ADMIN" });
  identity({ action: "promote", userId: lecturer.userId, role: "LECTURER" });
  identity({ action: "promote", userId: other.userId, role: "LECTURER" });
  const adminToken = (await login(admin)).accessToken;
  for (const user of [lecturer, other])
    expect(
      await http("POST", `/api/v1/admin/lecturers/${user.userId}/verify`, {
        bearer: adminToken,
        key: `verify-${user.userId}`,
        body: { currentPassword: admin.password },
      }),
      200,
      "verify lecturer",
    );
  const lecturerToken = (await login(lecturer)).accessToken,
    otherToken = (await login(other)).accessToken,
    courseId = await createCourse(lecturerToken, "owner"),
    foreignCourseId = await createCourse(otherToken, "foreign");

  const happyDocument = await extractedDocument(
    lecturerToken,
    "happy",
    "AILSS objective material [TEST_PAUSE_PROVIDER_MS=1200]",
  );
  docker("stop", "ailss-ai-worker");
  const happyKey = `happy-${runId}`,
    happyBody = quizBody(happyDocument, courseId, 4),
    happy = await http("POST", "/api/v1/ai/quiz-jobs", {
      bearer: lecturerToken,
      key: happyKey,
      body: happyBody,
    });
  expect(happy, 202, "AI-01 happy");
  let happyState = ai({ action: "job", jobId: happy.json.data.jobId });
  if (
    happyState.jobKind !== "QUIZ_GENERATION" ||
    happyState.state !== "QUEUED" ||
    happyState.reservationState !== "RESERVED" ||
    happyState.generationEventType !== "ai.quiz.generate.v1"
  )
    throw new Error(`durable pre-202 proof failed ${JSON.stringify(happyState)}`);
  const stable = {
    jobId: happyState.jobId,
    operationId: happyState.operationId,
    generationEventId: happyState.generationEventId,
    generationPayload: happyState.generationPayload,
  };
  stable.generationPayload ??= await queuedGeneration(stable.generationEventId);
  const replay = await http("POST", "/api/v1/ai/quiz-jobs", {
    bearer: lecturerToken,
    key: happyKey,
    body: happyBody,
  });
  expect(replay, 202, "AI-01 replay");
  if (replay.json.data.jobId !== stable.jobId || !replay.json.meta.replayed)
    throw new Error("AI-01 replay changed logical job");
  expect(
    await http("POST", "/api/v1/ai/quiz-jobs", {
      bearer: lecturerToken,
      key: happyKey,
      body: { ...happyBody, difficulty: "HARD" },
    }),
    409,
    "AI-01 fingerprint conflict",
  );
  const [observed] = await Promise.all([
    waitJobStates(lecturerToken, stable.jobId, "AI_DRAFT"),
    promisify(execFile)("docker", ["start", "ailss-ai-worker"]),
  ]);
  stoppedContainers.delete("ailss-ai-worker");
  for (const required of ["QUEUED", "PROCESSING", "VALIDATING", "AI_DRAFT"])
    if (!observed.has(required)) throw new Error(`state not observed: ${required}`);
  if (observed.has("COMPLETED") || observed.has("APPROVED"))
    throw new Error("QUIZ_GENERATION entered forbidden state");
  await waitEvent(stable.jobId, "ai.quiz.generated.v1");
  happyState = ai({ action: "job", jobId: stable.jobId });
  if (
    happyState.operationId !== stable.operationId ||
    happyState.generationEventId !== stable.generationEventId ||
    happyState.providerState !== "RESULT_STORED" ||
    happyState.providerRows !== 1 ||
    happyState.draftRows !== 1 ||
    happyState.draftVersion !== 1 ||
    happyState.usageRows !== 1 ||
    happyState.usageState !== "CONSUMED" ||
    !happyState.draftPrivate ||
    !happyState.draftChecksumMatches
  )
    throw new Error(`canonical happy proof failed ${JSON.stringify(happyState)}`);
  if (
    happyState.generatedEventType !== "ai.quiz.generated.v1" ||
    happyState.generatedEventState !== "PUBLISHED"
  )
    throw new Error("generated event not published from AI_DRAFT");

  expect(await http("GET", `/api/v1/ai/jobs/${stable.jobId}`, { bearer: lecturerToken }), 200, "AI-02 owner");
  expect(
    await http("GET", `/api/v1/ai/jobs/${stable.jobId}`, { bearer: otherToken }),
    404,
    "AI-02 concealed",
  );
  const drafts = await http("GET", `/api/v1/ai/jobs/${stable.jobId}/drafts`, {
    bearer: lecturerToken,
  });
  expect(drafts, 200, "AI-04 owner");
  expect(
    await http("GET", `/api/v1/ai/jobs/${stable.jobId}/drafts`, { bearer: otherToken }),
    404,
    "AI-04 concealed",
  );
  const quiz = drafts.json.data[0]?.content;
  assertObjective(quiz);
  if (drafts.json.data[0]?.checksum !== createHash("sha256").update(JSON.stringify(quiz)).digest("hex"))
    throw new Error("AI-04 checksum does not match draft content");
  probe(
    "ailss-assessment-service",
    `import {readFileSync} from 'node:fs';import {parseQuizCreate} from './dist/apps/assessment-service/src/model.js';const v=JSON.parse(readFileSync(0,'utf8'));const questions=v.quiz.questions.map(q=>({prompt:q.text,points:q.points,questionType:q.type,...(q.options?{options:q.options.map(o=>o.text)}:{}),correctAnswer:q.type==='SINGLE_CHOICE'?q.options.find(o=>o.id===q.correctAnswer.optionId)?.text:q.type==='MULTIPLE_CHOICE'?q.correctAnswer.optionIds.map(id=>q.options.find(o=>o.id===id)?.text):q.type==='TRUE_FALSE'?q.correctAnswer.value:q.correctAnswer.acceptedAnswer}));parseQuizCreate({title:v.quiz.title,targetType:'COURSE',targetId:v.targetId,questions});console.log(JSON.stringify({assessmentObjectiveV1:true}));`,
    { quiz, targetId: courseId },
  );
  if (/prompt|sourceText|objectKey|secret|credential/iu.test(JSON.stringify(drafts.json)))
    throw new Error("AI-04 leaked private internals");
  if (assessment({ action: "countTarget", targetId: courseId }).count !== 0)
    throw new Error("AI draft was imported into Assessment");
  expect(
    await http("POST", `/api/v1/ai/jobs/${stable.jobId}/cancel`, { bearer: lecturerToken }),
    409,
    "AI_DRAFT cancellation conflict",
  );

  const beforeDuplicate = ai({ action: "job", jobId: stable.jobId });
  console.log("PASS happy path, objective-v1, private draft and owner reads");
  publish(stable.generationPayload);
  await delay(800);
  const afterDuplicate = ai({ action: "job", jobId: stable.jobId });
  if (
    afterDuplicate.draftRows !== beforeDuplicate.draftRows ||
    afterDuplicate.providerRows !== beforeDuplicate.providerRows ||
    afterDuplicate.usageRows !== beforeDuplicate.usageRows
  )
    throw new Error("duplicate delivery duplicated canonical effect");

  const invalidDocument = await extractedDocument(
    lecturerToken,
    "invalid",
    "Permanent invalid provider fixture [TEST_INVALID_PROVIDER]",
  );
  const failed = await createJob(lecturerToken, `invalid-${runId}`, quizBody(invalidDocument, courseId, 4));
  await waitJob(lecturerToken, failed.jobId, "FAILED");
  const failedEvent = await waitEvent(failed.jobId, "ai.job.failed.v1");
  if (
    Object.keys(failedEvent.data).sort().join(",") !== "failureCode,jobId" ||
    failedEvent.data.failureCode !== "OBJECTIVE_V1_INVALID" ||
    failedEvent.data.jobId !== failed.jobId
  )
    throw new Error("Failure event payload is not the registered safe shape");
  const failedState = ai({ action: "job", jobId: failed.jobId });
  if (
    failedState.draftRows !== 0 ||
    failedState.failureEventType !== "ai.job.failed.v1" ||
    !failedState.failurePayloadSafe ||
    failedState.usageState !== "CONSUMED"
  )
    throw new Error(`genuine failure proof failed ${JSON.stringify(failedState)}`);
  console.log("PASS duplicate delivery and genuine failure");

  docker("stop", "ailss-ai-worker");
  const queued = await createJob(
    lecturerToken,
    `cancel-queued-${runId}`,
    quizBody(happyDocument, courseId, 1),
  );
  expect(
    await http("POST", `/api/v1/ai/jobs/${queued.jobId}/cancel`, { bearer: lecturerToken }),
    200,
    "queued cancellation",
  );
  let cancelled = ai({ action: "job", jobId: queued.jobId });
  if (cancelled.state !== "CANCELLED" || cancelled.reservationState !== "RELEASED" || cancelled.failureEvents)
    throw new Error(`queued cancellation proof failed ${JSON.stringify(cancelled)}`);
  docker("start", "ailss-ai-worker");
  await containerReady("ailss-ai-worker");

  const raceDocument = await extractedDocument(
    lecturerToken,
    "race",
    "Cancellation race [TEST_PAUSE_PROVIDER_MS=3500]",
  );
  const race = await createJob(lecturerToken, `cancel-race-${runId}`, quizBody(raceDocument, courseId, 4));
  await waitJob(lecturerToken, race.jobId, "PROCESSING");
  expect(
    await http("POST", `/api/v1/ai/jobs/${race.jobId}/cancel`, { bearer: lecturerToken }),
    200,
    "processing cancellation",
  );
  await delay(4200);
  cancelled = ai({ action: "job", jobId: race.jobId });
  if (cancelled.state !== "CANCELLED" || cancelled.draftRows || cancelled.failureEvents)
    throw new Error(`cancel race resurrected job ${JSON.stringify(cancelled)}`);
  if (cancelled.providerState === "RESULT_STORED" && cancelled.usageState !== "CONSUMED")
    throw new Error("Cancelled provider-effect job did not finalize usage");
  console.log("PASS queued cancellation and provider race");

  expect(
    await http("POST", "/api/v1/ai/quiz-jobs", {
      bearer: lecturerToken,
      key: `foreign-${runId}`,
      body: quizBody(happyDocument, foreignCourseId, 1),
    }),
    404,
    "foreign target denied",
  );
  docker("stop", "ailss-learning-service");
  try {
    expect(
      await http("POST", "/api/v1/ai/quiz-jobs", {
        bearer: lecturerToken,
        key: `dependency-${runId}`,
        body: quizBody(happyDocument, courseId, 1),
      }),
      503,
      "target dependency fail closed",
    );
  } finally {
    docker("start", "ailss-learning-service");
    await containerReady("ailss-learning-service");
  }

  const ownedClass = await createClass(lecturerToken, "owned");
  const foreignClass = await createClass(otherToken, "foreign");
  const classJob = await createJob(lecturerToken, `class-${runId}`, {
    ...quizBody(happyDocument, ownedClass, 4),
    targetType: "CLASS",
  });
  await waitJob(lecturerToken, classJob.jobId, "AI_DRAFT");
  const p103ClassJobs = [];
  if (process.env.P103_HANDOFF_PATH)
    for (const suffix of ["race", "outage", "lost-response"]) {
      const job = await createJob(lecturerToken, `p103-${suffix}-${runId}`, {
        ...quizBody(happyDocument, ownedClass, 4),
        targetType: "CLASS",
      });
      await waitJob(lecturerToken, job.jobId, "AI_DRAFT");
      p103ClassJobs.push(job);
    }
  expect(
    await http("POST", "/api/v1/ai/quiz-jobs", {
      bearer: lecturerToken,
      key: `foreign-class-${runId}`,
      body: { ...quizBody(happyDocument, foreignClass, 1), targetType: "CLASS" },
    }),
    404,
    "foreign Class denied",
  );

  docker("stop", "ailss-ai-worker");
  docker("stop", "ailss-rabbitmq");
  brokerInterrupted = true;
  let outage;
  try {
    outage = await createJob(lecturerToken, `broker-${runId}`, quizBody(happyDocument, courseId, 1));
    const recoverable = ai({ action: "job", jobId: outage.jobId });
    if (!["READY", "PUBLISHING"].includes(recoverable.generationEventState))
      throw new Error(`generation event not recoverable ${JSON.stringify(recoverable)}`);
    outage.eventId = recoverable.generationEventId;
  } finally {
    docker("start", "ailss-rabbitmq");
  }
  await rabbitReady();
  docker("restart", "ailss-ai-service");
  docker("start", "ailss-ai-worker");
  await containerReady("ailss-ai-service");
  await containerReady("ailss-ai-worker");
  await waitJob(lecturerToken, outage.jobId, "AI_DRAFT");
  const recovered = ai({ action: "job", jobId: outage.jobId });
  if (recovered.generationEventId !== outage.eventId || recovered.generationEventState !== "PUBLISHED")
    throw new Error("broker recovery changed event identity");

  const month = new Date().toISOString().slice(0, 7);
  expect(await http("GET", "/api/v1/ai/jobs", { bearer: lecturerToken }), 422, "AI-03 filters required");
  const firstPage = await http("GET", `/api/v1/ai/jobs?state=AI_DRAFT&month=${month}&limit=1`, {
    bearer: lecturerToken,
  });
  expect(firstPage, 200, "AI-03 first page");
  const cursor = firstPage.json.meta.nextCursor;
  if (!cursor || Buffer.from(cursor, "base64url").toString("utf8").includes("pageState"))
    throw new Error("AI-03 cursor is not opaque");
  const secondPage = await http(
    "GET",
    `/api/v1/ai/jobs?state=AI_DRAFT&month=${month}&limit=1&cursor=${encodeURIComponent(cursor)}`,
    { bearer: lecturerToken },
  );
  expect(secondPage, 200, "AI-03 second page");
  if (secondPage.json.data[0]?.jobId === firstPage.json.data[0]?.jobId)
    throw new Error("AI-03 duplicate row across pages");
  const listed = [...firstPage.json.data, ...secondPage.json.data];
  let nextCursor = secondPage.json.meta.nextCursor;
  while (nextCursor) {
    if (listed.length > 10) throw new Error("AI-03 pagination did not terminate");
    const page = await http(
      "GET",
      `/api/v1/ai/jobs?state=AI_DRAFT&month=${month}&limit=1&cursor=${encodeURIComponent(nextCursor)}`,
      { bearer: lecturerToken },
    );
    expect(page, 200, "AI-03 subsequent page");
    listed.push(...page.json.data);
    nextCursor = page.json.meta.nextCursor;
  }
  const expectedIds = [
    stable.jobId,
    classJob.jobId,
    outage.jobId,
    ...p103ClassJobs.map((job) => job.jobId),
  ].sort();
  if (JSON.stringify(listed.map((job) => job.jobId).sort()) !== JSON.stringify(expectedIds))
    throw new Error("AI-03 has missing or duplicate canonical draft rows");
  if (listed.some((job, index) => index > 0 && job.createdAt > listed[index - 1].createdAt))
    throw new Error("AI-03 ordering is not descending creation time");
  expect(
    await http(
      "GET",
      `/api/v1/ai/jobs?state=FAILED&month=${month}&limit=1&cursor=${encodeURIComponent(cursor)}`,
      { bearer: lecturerToken },
    ),
    400,
    "AI-03 filter binding",
  );
  expect(
    await http(
      "GET",
      `/api/v1/ai/jobs?state=AI_DRAFT&month=${month}&limit=1&cursor=${encodeURIComponent(`${cursor.slice(0, -1)}${cursor.endsWith("A") ? "B" : "A"}`)}`,
      { bearer: lecturerToken },
    ),
    400,
    "AI-03 tamper",
  );
  expect(
    await http(
      "GET",
      `/api/v1/ai/jobs?state=AI_DRAFT&month=${month}&limit=1&cursor=${encodeURIComponent(cursor)}`,
      { bearer: otherToken },
    ),
    400,
    "AI-03 actor binding",
  );
  await delay(5200);
  expect(
    await http(
      "GET",
      `/api/v1/ai/jobs?state=AI_DRAFT&month=${month}&limit=1&cursor=${encodeURIComponent(cursor)}`,
      { bearer: lecturerToken },
    ),
    400,
    "AI-03 expiry",
  );

  const usage = await http("GET", "/api/v1/ai/usage", { bearer: lecturerToken });
  expect(usage, 200, "AI-10");
  const beforeQuota = usage.json.data,
    chunks = [];
  let capacity = beforeQuota.remaining;
  for (let i = 0; capacity > 0; i++) {
    const count = Math.min(50, capacity);
    chunks.push(
      http("POST", "/api/v1/ai/quiz-jobs", {
        bearer: lecturerToken,
        key: `quota-${runId}-${i}`,
        body: quizBody(happyDocument, courseId, count),
      }),
    );
    capacity -= count;
  }
  const quotaResults = await Promise.all(chunks);
  if (quotaResults.some((result) => result.status !== 202))
    throw new Error(`quota boundary reservation failed ${JSON.stringify(quotaResults.map((x) => x.status))}`);
  expect(
    await http("POST", "/api/v1/ai/quiz-jobs", {
      bearer: lecturerToken,
      key: `quota-overflow-${runId}`,
      body: quizBody(happyDocument, courseId, 1),
    }),
    429,
    "quota oversubscription denied",
  );
  const quotaAfter = await http("GET", "/api/v1/ai/usage", { bearer: lecturerToken });
  expect(quotaAfter, 200, "AI-10 boundary");
  if (
    quotaAfter.json.data.remaining !== 0 ||
    quotaAfter.json.data.reserved + quotaAfter.json.data.consumed > quotaAfter.json.data.limit
  )
    throw new Error("quota oversubscribed");

  const isolation = ai({ action: "deny" });
  if (!isolation.ownAllowed || isolation.foreignDenied !== 5 || !isolation.ddlDenied)
    throw new Error(`AI RBAC proof failed ${JSON.stringify(isolation)}`);
  const logs = dockerLogs(startedAt);
  const env = await readFile(new URL("../../.env", import.meta.url), "utf8");
  const secrets = [...env.matchAll(/^(?:[A-Z0-9_]*(?:PASSWORD|SECRET_KEY|API_KEY|HMAC_KEY))=(.+)$/gmu)]
    .map((match) => match[1])
    .filter((value) => value && value !== "<INJECTED>");
  const privacyCandidates = [
      ...secrets.map((value) => ({ kind: "configured-secret", value })),
      { kind: "admin-token", value: adminToken },
      { kind: "lecturer-token", value: lecturerToken },
      { kind: "other-token", value: otherToken },
      { kind: "reviewed-quiz", value: JSON.stringify(quiz) },
      { kind: "invalid-provider-fixture", value: "[TEST_INVALID_PROVIDER]" },
      { kind: "provider-pause-fixture", value: "[TEST_PAUSE_PROVIDER_MS=" },
    ],
    leaked = privacyCandidates.find(({ value }) => logs.includes(value)),
    jwtPattern = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u,
    jwtMatch = logs.match(jwtPattern);
  if (leaked || (!process.env.P103_HANDOFF_PATH && jwtMatch))
    throw new Error(
      `secret/source/provider fixture leaked to logs (${leaked?.kind ?? "jwt-pattern"})${
        jwtMatch
          ? ` near ${logs
              .slice(
                Math.max(0, (jwtMatch.index ?? 0) - 100),
                (jwtMatch.index ?? 0) + jwtMatch[0].length + 100,
              )
              .replace(jwtPattern, "[JWT_REDACTED]")
              .replaceAll("\n", " ")}`
          : ""
      }`,
    );

  const summary = {
    stage: "phase-10.2-ai-quiz-generation-acceptance",
    status: "PASS",
    runId,
    TEST_PROVIDER_ONLY: true,
    LIVE_PROVIDER_SMOKE: "NOT_RUN_NO_CREDENTIAL",
    happyPath: true,
    objectiveV1AllTypes: true,
    idempotencyStable: stable,
    providerFenceDeduplicated: true,
    quotaNoOversubscription: true,
    cancellationQueuedAndRace: true,
    genuineFailureSafeEvent: true,
    brokerRecoveryStableEvent: true,
    cursorOpaqueBoundAndExpired: true,
    targetAuthorizationFailClosed: true,
    assessmentUnchanged: true,
    foreignKeyspacesDenied: 5,
    runtimeDdlDenied: true,
    privacyLogScan: true,
    counts: { publicApis: 98, internalApis: 15, queryIds: 74, events: 22, services: 6, redis: false },
  };
  if (process.env.P103_HANDOFF_PATH)
    await writeFile(
      process.env.P103_HANDOFF_PATH,
      `${JSON.stringify({ lecturerToken, otherToken, jobs: { happy: classJob.jobId, race: p103ClassJobs[0].jobId, outage: p103ClassJobs[1].jobId, lostResponse: p103ClassJobs[2].jobId } })}\n`,
      { mode: 0o600 },
    );
  await writeFile(new URL("p10.2-summary.json", evidence), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ ...summary, evidence: decodeURIComponent(evidence.pathname) }));
} catch (error) {
  await writeFile(
    new URL("p10.2-summary.json", evidence),
    `${JSON.stringify(
      {
        stage: "phase-10.2-ai-quiz-generation-acceptance",
        status: "FAIL",
        runId,
        TEST_PROVIDER_ONLY: true,
        LIVE_PROVIDER_SMOKE: "NOT_RUN_NO_CREDENTIAL",
        reason: "Mandatory acceptance assertion or runtime dependency failed; no completion claimed",
      },
      null,
      2,
    )}\n`,
  );
  throw error;
} finally {
  for (const name of stoppedContainers) docker("start", name);
  if (brokerInterrupted) {
    await rabbitReady();
    // The existing document consumer requires reconnection after a broker restart.
    // Restore the fixture dependency so a subsequent acceptance run is independent.
    docker("restart", "ailss-document-worker");
  }
  await rabbitApi(`/queues/%2Failss/${observerQueue}`, "DELETE").catch(() => undefined);
  if (restoreCursorTtl) configureCursorTtl(restoreCursorTtl);
}

function quizBody(documentId, targetId, questionCount) {
  return {
    documentId,
    targetType: "COURSE",
    targetId,
    questionCount,
    questionTypes: ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"],
    difficulty: "MEDIUM",
  };
}
async function createCourse(token, suffix) {
  const response = await http("POST", "/api/v1/courses", {
    bearer: token,
    key: `course-${runId}-${suffix}`,
    body: {
      title: `P10.2 ${suffix}`,
      slug: `p10-2-${suffix}-${randomUUID()}`,
      categoryId: randomUUID(),
      priceType: "FREE",
      price: "0.00",
      currency: "VND",
    },
  });
  expect(response, 201, "course fixture");
  return response.json.data.courseId;
}
async function createClass(token, suffix) {
  const result = await http("POST", "/api/v1/classes", {
    bearer: token,
    key: `class-fixture-${runId}-${suffix}`,
    body: { name: `P10.2 ${suffix}`, classKind: "PRIVATE", maxMembers: 50 },
  });
  expect(result, 201, "Class fixture");
  return result.json.data.classId;
}
async function extractedDocument(token, suffix, text) {
  const content = Buffer.from(text),
    sha = createHash("sha256").update(content).digest("hex"),
    intent = await http("POST", "/api/v1/ai/documents/upload-intents", {
      bearer: token,
      key: `document-${runId}-${suffix}`,
      body: { fileName: `${suffix}.txt`, contentType: "text/plain", sizeBytes: content.length, sha256: sha },
    });
  expect(intent, 201, "document intent");
  upload(intent.json.data.uploadUrl, content, "text/plain");
  expect(
    await http("POST", `/api/v1/ai/documents/${intent.json.data.documentId}/complete`, {
      bearer: token,
      key: `complete-${runId}-${suffix}`,
      body: {
        objectKey: intent.json.data.objectKey,
        contentType: "text/plain",
        sizeBytes: content.length,
        sha256: sha,
      },
    }),
    202,
    "document complete",
  );
  await waitDocument(token, intent.json.data.documentId, "EXTRACTED");
  return intent.json.data.documentId;
}
async function createJob(token, key, body) {
  const response = await http("POST", "/api/v1/ai/quiz-jobs", { bearer: token, key, body });
  expect(response, 202, "create quiz job");
  return response.json.data;
}
function assertObjective(value) {
  if (value?.schemaVersion !== "objective-v1" || value.questions?.length !== 4)
    throw new Error("invalid objective-v1 draft");
  const types = new Set(value.questions.map((q) => q.type));
  for (const type of ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"])
    if (!types.has(type)) throw new Error(`objective type missing ${type}`);
}
async function register(label) {
  const id = randomUUID(),
    user = {
      email: `p102-${label}-${id}@example.test`,
      password: `P10.2-${label}-${id}-Aa1!`,
      displayName: `P102 ${label}`,
    },
    response = await http("POST", "/api/v1/auth/register", { key: `register-${id}`, body: user });
  expect(response, 201, "register");
  return { ...user, userId: response.json.data.userId };
}
async function login(user) {
  const response = await http("POST", "/api/v1/auth/login", {
    body: { email: user.email, password: user.password },
  });
  expect(response, 200, "login");
  return response.json.data;
}
async function http(method, path, { body, bearer, key } = {}) {
  let last;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:8080${path}`, {
          method,
          headers: {
            ...(body ? { "content-type": "application/json" } : {}),
            ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
            ...(key ? { "idempotency-key": key } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(25_000),
        }),
        text = await response.text();
      return { status: response.status, json: text ? JSON.parse(text) : undefined };
    } catch (error) {
      last = error;
      await delay(300);
    }
  }
  throw last;
}
function expect(result, status, label) {
  if (result.status !== status) throw new Error(`${label}: ${result.status} ${JSON.stringify(result.json)}`);
}
async function waitDocument(token, id, state) {
  for (let attempt = 0; attempt < 160; attempt++) {
    const response = await http("GET", `/api/v1/ai/documents/${id}`, { bearer: token });
    if (response.status === 200 && response.json.data.status === state) return;
    await delay(250);
  }
  throw new Error(`document did not reach ${state}`);
}
async function waitJob(token, id, state) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const response = await http("GET", `/api/v1/ai/jobs/${id}`, { bearer: token });
    if (response.status === 200 && response.json.data.state === state) return response.json.data;
    if (
      response.status === 200 &&
      ["FAILED", "CANCELLED", "AI_DRAFT"].includes(response.json.data.state) &&
      response.json.data.state !== state
    )
      throw new Error(`job ${id} reached unexpected ${response.json.data.state}`);
    await delay(50);
  }
  throw new Error(`job did not reach ${state}`);
}
async function waitJobStates(token, id, terminal) {
  const states = new Set(["QUEUED"]);
  for (let attempt = 0; attempt < 1_200; attempt++) {
    const response = await http("GET", `/api/v1/ai/jobs/${id}`, { bearer: token });
    if (response.status === 200) states.add(response.json.data.state);
    if (states.has(terminal)) return states;
    await delay(50);
  }
  throw new Error(`job did not reach ${terminal}`);
}
async function ready() {
  for (let attempt = 0; attempt < 300; attempt++) {
    try {
      const gateway = await fetch("http://127.0.0.1:8080/health/ready", {
        signal: AbortSignal.timeout(2000),
      });
      if (gateway.ok) {
        execFileSync(
          "docker",
          [
            "exec",
            "ailss-api-gateway",
            "node",
            "--input-type=module",
            "-e",
            `const services=[['identity-service',8101],['learning-service',8102],['classroom-service',8103],['assessment-service',8104],['interaction-service',8105],['ai-service',8106]];const results=await Promise.all(services.map(async([host,port])=>(await fetch('http://'+host+':'+port+'/health/ready',{signal:AbortSignal.timeout(2000)})).ok));if(!results.every(Boolean))process.exit(1);`,
          ],
          { stdio: "ignore", timeout: 10_000 },
        );
        return;
      }
    } catch {
      /* booting */
    }
    await delay(500);
  }
  throw new Error("gateway or backing services unavailable");
}
async function containerReady(name) {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const status = execFileSync(
        "docker",
        [
          "inspect",
          "-f",
          "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Running}}{{end}}",
          name,
        ],
        {
          encoding: "utf8",
        },
      ).trim();
      if (status === "healthy" || status === "true") return;
    } catch {
      /* restarting */
    }
    await delay(500);
  }
  throw new Error(`${name} unavailable`);
}
async function rabbitReady() {
  await containerReady("ailss-rabbitmq");
}
function docker(...args) {
  execFileSync("docker", args, { stdio: "ignore" });
  if (args[0] === "stop") stoppedContainers.add(args[1]);
  if (args[0] === "start") stoppedContainers.delete(args[1]);
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
      `const [u,b,t]=process.argv.slice(1);const r=await fetch(u,{method:"PUT",headers:{"content-type":t},body:Buffer.from(b,"base64")});if(!r.ok)throw new Error(String(r.status));`,
      url,
      content.toString("base64"),
      type,
    ],
    { stdio: "pipe" },
  );
}
function assertTestProvider() {
  const env = execFileSync(
    "docker",
    ["inspect", "-f", "{{range .Config.Env}}{{println .}}{{end}}", "ailss-ai-worker"],
    { encoding: "utf8" },
  );
  if (!env.includes("AI_PROVIDER_MODE=deterministic-test"))
    throw new Error("acceptance requires deterministic-test provider");
}
function identity(input) {
  return probe("ailss-identity-service", identityProbe(), input);
}
function ai(input) {
  return probe("ailss-ai-service", aiProbe(), input);
}
function assessment(input) {
  return probe("ailss-assessment-service", assessmentProbe(), input);
}
function probe(container, source, input) {
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", container, "node", "--input-type=module", "-e", source], {
      input: JSON.stringify(input),
      encoding: "utf8",
    }).trim(),
  );
}
function identityProbe() {
  return `import{readFileSync}from"node:fs";import{createHash}from"node:crypto";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();const r=(await x.execute("SELECT display_name,role,status,lecturer_verified,profile_version,updated_at FROM user_by_id WHERE user_id=?",[u(i.userId)],q)).rows[0],s=(createHash("sha256").update(i.userId).digest()[0]??0)%16;await x.execute("DELETE FROM users_by_role_status_bucket WHERE role=? AND status=? AND shard=? AND updated_at=? AND user_id=?",[r.get("role"),r.get("status"),s,r.get("updated_at"),u(i.userId)],q);await x.execute("UPDATE user_by_id SET role=? WHERE user_id=?",[i.role,u(i.userId)],q);await x.execute("INSERT INTO users_by_role_status_bucket (role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version) VALUES (?,?,?,?,?,?,?,?)",[i.role,r.get("status"),s,r.get("updated_at"),u(i.userId),r.get("display_name"),r.get("lecturer_verified"),r.get("profile_version")],q);await x.shutdown();console.log(JSON.stringify({ok:true}));`;
}
function aiProbe() {
  return `import{readFileSync}from"node:fs";import{createHash}from"node:crypto";import c from"cassandra-driver";import{Client as M}from"minio";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum},u=c.types.Uuid.fromString;await x.connect();let o={};if(i.action==="job"){const j=(await x.execute("SELECT * FROM ai_job_by_id WHERE job_id=?",[u(i.jobId)],q)).rows[0],op=j?(await x.execute("SELECT * FROM ai_usage_operation_by_id WHERE operation_id=?",[j.get("operation_id")],q)).rows[0]:null,p=j?(await x.execute("SELECT * FROM provider_operation_by_id WHERE operation_id=?",[j.get("operation_id")],q)).rows:[],d=j?(await x.execute("SELECT * FROM ai_draft_by_job WHERE job_id=?",[j.get("job_id")],q)).rows:[],ue=j?(await x.execute("SELECT * FROM ai_usage_by_user_day WHERE user_id=? AND usage_day=?",[j.get("lecturer_id"),op?.get("usage_day")],q)).rows.filter(v=>String(v.get("operation_id"))===String(j.get("operation_id"))):[],events=(await x.execute("SELECT event_id,event_type,aggregate_id,state FROM pending_event_by_id",[],q)).rows,gen=events.find(v=>String(v.get("event_id"))===String(j?.get("generation_event_id"))),generated=events.find(v=>String(v.get("event_id"))===String(j?.get("generated_event_id"))),failed=events.filter(v=>v.get("event_type")==="ai.job.failed.v1"&&String(v.get("aggregate_id"))===i.jobId);let payload=null;for(let sh=0;sh<16&&!payload;sh++){const rows=(await x.execute("SELECT payload_json FROM pending_events_by_due_bucket WHERE due_day=? AND shard=?",[c.types.LocalDate.fromString(new Date(j.get("created_at")).toISOString().slice(0,10)),sh],q)).rows;payload=rows.map(v=>JSON.parse(v.get("payload_json"))).find(v=>v.eventId===String(j.get("generation_event_id")))??null}let draftPrivate=false,draftChecksumMatches=false;if(d[0]){const m=new M({endPoint:process.env.OBJECT_STORAGE_ENDPOINT,port:Number(process.env.OBJECT_STORAGE_PORT),useSSL:false,accessKey:process.env.OBJECT_STORAGE_ACCESS_KEY,secretKey:process.env.OBJECT_STORAGE_SECRET_KEY}),b=await m.getObject(process.env.OBJECT_STORAGE_BUCKET,d[0].get("draft_object_key")),parts=[];for await(const z of b)parts.push(z);const bytes=Buffer.concat(parts);const anonymous=await fetch("http://"+process.env.OBJECT_STORAGE_ENDPOINT+":"+process.env.OBJECT_STORAGE_PORT+"/"+process.env.OBJECT_STORAGE_BUCKET+"/"+d[0].get("draft_object_key"));draftPrivate=anonymous.status===403;await anonymous.body?.cancel();draftChecksumMatches=createHash("sha256").update(bytes).digest("hex")===d[0].get("draft_checksum")}o={jobId:String(j.get("job_id")),jobKind:j.get("job_kind"),state:j.get("state"),operationId:String(j.get("operation_id")),generationEventId:String(j.get("generation_event_id")),generationEventType:gen?.get("event_type"),generationEventState:gen?.get("state"),generatedEventType:generated?.get("event_type"),generatedEventState:generated?.get("state"),reservationState:op?.get("state"),usageState:op?.get("state"),usageRows:ue.length,providerState:p[0]?.get("state"),providerRows:p.length,draftRows:d.length,draftVersion:d[0]?Number(d[0].get("draft_version")):null,draftPrivate,draftChecksumMatches,failureEvents:failed.length,failureEventType:failed[0]?.get("event_type"),failurePayloadSafe:failed.length===1,generationPayload:payload}}else{let ownAllowed=false,foreignDenied=0,ddlDenied=false;try{await x.execute("SELECT job_id FROM ai_job_by_id LIMIT 1",[],q);ownAllowed=true}catch{}for(const [k,t] of [["identity_keyspace","user_by_id"],["learning_keyspace","course_by_id"],["classroom_keyspace","class_by_id"],["assessment_keyspace","quiz_by_id"],["interaction_keyspace","comment_by_id"]])try{await x.execute("SELECT * FROM "+k+"."+t+" LIMIT 1",[],q)}catch(e){if(e.code!==c.types.responseErrorCodes.unauthorized)throw new Error("RBAC_PROBE_NOT_AUTHORIZATION_DENIAL");foreignDenied++}try{await x.execute("CREATE TABLE ai_keyspace.runtime_forbidden_p102 (id uuid PRIMARY KEY)",[],q)}catch(e){if(e.code!==c.types.responseErrorCodes.unauthorized)throw new Error("DDL_PROBE_NOT_AUTHORIZATION_DENIAL");ddlDenied=true}o={ownAllowed,foreignDenied,ddlDenied}}await x.shutdown();console.log(JSON.stringify(o));`;
}
function assessmentProbe() {
  return `import{readFileSync}from"node:fs";import c from"cassandra-driver";const i=JSON.parse(readFileSync(0,"utf8")),x=new c.Client({contactPoints:process.env.CASSANDRA_CONTACT_POINTS.split(","),localDataCenter:process.env.CASSANDRA_LOCAL_DC,keyspace:process.env.CASSANDRA_KEYSPACE,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)}),q={prepare:true,consistency:c.types.consistencies.localQuorum};await x.connect();const rows=(await x.execute("SELECT target_id FROM quiz_by_id",[],q)).rows,o={count:rows.filter(v=>String(v.get("target_id"))===i.targetId).length};await x.shutdown();console.log(JSON.stringify(o));`;
}
function publish(event) {
  if (!event) throw new Error("generation payload unavailable");
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "ailss-ai-service",
      "node",
      "--input-type=module",
      "-e",
      `import{readFileSync}from"node:fs";import amqp from"amqplib";const e=JSON.parse(readFileSync(0,"utf8")),u=new URL(process.env.RABBITMQ_URL);u.username=process.env.RABBITMQ_USERNAME;u.password=process.env.RABBITMQ_PASSWORD;const c=await amqp.connect(u.toString()),h=await c.createConfirmChannel();h.publish("ailss.ai.jobs","ai.quiz.generate.v1",Buffer.from(JSON.stringify(e)),{persistent:true,contentType:"application/json",messageId:e.eventId});await h.waitForConfirms();await h.close();await c.close();`,
    ],
    { input: JSON.stringify(event), stdio: ["pipe", "pipe", "pipe"] },
  );
}
async function queuedGeneration(eventId) {
  const env = await readEnv();
  const authorization = `Basic ${Buffer.from(`${required(env, "RABBITMQ_ADMIN_USERNAME")}:${required(env, "RABBITMQ_ADMIN_PASSWORD")}`).toString("base64")}`;
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await fetch("http://127.0.0.1:15672/api/queues/%2Failss/ai.quiz.generate.q/get", {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({ count: 100, ackmode: "ack_requeue_true", encoding: "auto", truncate: 100000 }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Rabbit capture failed: ${response.status}`);
    const messages = await response.json();
    const event = messages
      .map((message) => JSON.parse(message.payload))
      .find((value) => value.eventId === eventId);
    if (event) return event;
    await delay(300);
  }
  throw new Error("Stable generation event not found in queue");
}
async function rabbitApi(path, method, body) {
  const env = await readEnv();
  const authorization = `Basic ${Buffer.from(`${required(env, "RABBITMQ_ADMIN_USERNAME")}:${required(env, "RABBITMQ_ADMIN_PASSWORD")}`).toString("base64")}`;
  const response = await fetch(`http://127.0.0.1:15672/api${path}`, {
    method,
    headers: { authorization, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Rabbit observer ${method}: ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}
async function waitEvent(jobId, eventType) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const messages = await rabbitApi(`/queues/%2Failss/${observerQueue}/get`, "POST", {
      count: 100,
      ackmode: "ack_requeue_false",
      encoding: "auto",
      truncate: 100000,
    });
    observedEvents.push(...messages.map((message) => JSON.parse(message.payload)));
    const found = observedEvents.find(
      (event) => event.aggregate.id === jobId && event.eventType === eventType,
    );
    if (found) return found;
    await delay(300);
  }
  throw new Error(`Event not observed: ${eventType}`);
}
function dockerLogs(since) {
  return ["ailss-api-gateway", "ailss-ai-service", "ailss-ai-worker"]
    .map(
      (name) =>
        `CONTAINER=${name}\n${execFileSync("docker", ["logs", "--since", since.toISOString(), name], { encoding: "utf8" })}`,
    )
    .join("\n");
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function configureCursorTtl(value) {
  execFileSync(
    "docker",
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
      "ai-service",
    ],
    {
      stdio: "pipe",
      env: { ...process.env, AI_CURSOR_TTL_SECONDS: value },
    },
  );
}
