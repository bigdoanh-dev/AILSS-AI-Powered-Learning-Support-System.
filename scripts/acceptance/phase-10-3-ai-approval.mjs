import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { readEnv } from "../dev/env.mjs";

if ((process.env.AILSS_PROFILE ?? "dev-async") !== "dev-async")
  throw new Error("P10.3 acceptance requires dev-async");
const temporary = await mkdtemp(join(tmpdir(), "ailss-p103-")),
  handoffPath = join(temporary, "handoff.json");
let assessmentFaultEnabled = false;
try {
  await promisify(execFile)("node", ["scripts/acceptance/phase-10-2-ai-quiz.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, P103_HANDOFF_PATH: handoffPath },
    maxBuffer: 10 * 1024 * 1024,
  });
  const handoff = JSON.parse(await readFile(handoffPath, "utf8")),
    happy = await draft(handoff.lecturerToken, handoff.jobs.happy),
    approvalKey = randomUUID(),
    first = await approve(handoff.lecturerToken, happy.draftId, approvalKey, happy.content);
  expect(first, 200, "AI-05 happy approval");
  assertApproval(first.json.data, happy.draftId);
  const replay = await approve(handoff.lecturerToken, happy.draftId, approvalKey, happy.content);
  expect(replay, 200, "AI-05 historical replay");
  if (!replay.json.meta.replayed || JSON.stringify(replay.json.data) !== JSON.stringify(first.json.data))
    throw new Error("AI-05 replay changed historical result");
  const changed = structuredClone(happy.content);
  changed.title += " changed";
  expect(
    await approve(handoff.lecturerToken, happy.draftId, approvalKey, changed),
    409,
    "AI-05 conflicting replay",
  );
  expect(
    await approve(handoff.otherToken, happy.draftId, randomUUID(), happy.content),
    404,
    "AI-05 foreign concealment",
  );

  const stale = await draft(handoff.lecturerToken, handoff.jobs.race);
  expect(
    await approve(handoff.lecturerToken, stale.draftId, randomUUID(), stale.content, '"v2"'),
    409,
    "AI-05 stale If-Match",
  );
  const invalid = structuredClone(stale.content);
  invalid.questions[0].points = "0";
  expect(
    await approve(handoff.lecturerToken, stale.draftId, randomUUID(), invalid),
    422,
    "AI-05 invalid reviewed draft",
  );
  const left = structuredClone(stale.content),
    right = structuredClone(stale.content);
  right.title += " competing";
  const race = await Promise.all([
    approve(handoff.lecturerToken, stale.draftId, randomUUID(), left),
    approve(handoff.lecturerToken, stale.draftId, randomUUID(), right),
  ]);
  if (
    race.filter((result) => result.status === 200).length !== 1 ||
    race.filter((result) => result.status === 409).length !== 1
  )
    throw new Error(
      `Concurrent approval did not produce one winner: ${race.map((result) => result.status).join(",")}`,
    );

  const outage = await draft(handoff.lecturerToken, handoff.jobs.outage),
    outageKey = randomUUID();
  docker("stop", "ailss-assessment-service");
  try {
    expect(
      await approve(handoff.lecturerToken, outage.draftId, outageKey, outage.content),
      503,
      "Assessment outage",
    );
  } finally {
    docker("start", "ailss-assessment-service");
    await ready("ailss-assessment-service", 8104);
  }
  const recovered = await approve(handoff.lecturerToken, outage.draftId, outageKey, outage.content);
  expect(recovered, 200, "Assessment outage recovery");
  assertApproval(recovered.json.data, outage.draftId);

  const lost = await draft(handoff.lecturerToken, handoff.jobs.lostResponse),
    lostKey = randomUUID();
  await configureAssessmentFault(lost.draftId);
  assessmentFaultEnabled = true;
  expect(
    await approve(handoff.lecturerToken, lost.draftId, lostKey, lost.content),
    503,
    "post-commit response loss",
  );
  await new Promise((resolve) => setTimeout(resolve, 750));
  const beforeRetry = lostResponseProof(lost.draftId);
  assertLostResponseBeforeRetry(beforeRetry, lost);
  const lostRecovered = await approve(handoff.lecturerToken, lost.draftId, lostKey, lost.content);
  expect(lostRecovered, 200, "post-commit response recovery");
  assertApproval(lostRecovered.json.data, lost.draftId);
  const afterRetry = lostResponseProof(lost.draftId);
  assertLostResponseAfterRetry(beforeRetry, afterRetry, lost);
  await configureAssessmentFault();
  assessmentFaultEnabled = false;

  const proof = probe([happy.draftId, stale.draftId, outage.draftId, lost.draftId]);
  if (
    proof.ai.approvals !== 4 ||
    proof.assessment.imports !== 4 ||
    proof.assessment.distinctQuizzes !== 4 ||
    proof.assessment.nonDraft !== 0
  )
    throw new Error(`Canonical import proof failed ${JSON.stringify(proof)}`);
  console.log(
    JSON.stringify({
      stage: "phase-10.3-human-approval-assessment-import",
      status: "PASS",
      happyPath: true,
      publicReplay: true,
      conflict: true,
      staleVersion: true,
      invalidObjective: true,
      concurrentWinner: true,
      dependencyRecovery: true,
      lostResponseRecovery: {
        mode: "IDEMPOTENT_LOST_RESPONSE_RECOVERY",
        importOperationId: beforeRetry.importOperationId,
        quizIdBeforeRetry: beforeRetry.quizId,
        quizIdAfterRetry: afterRetry.quizId,
        logicalImportsBeforeRetry: beforeRetry.imports,
        logicalImportsAfterRetry: afterRetry.imports,
      },
      canonicalProof: proof,
      inventory: { publicApis: 98, internalApis: 15, queryIds: 74, events: 22, services: 6, redis: false },
    }),
  );
} finally {
  if (assessmentFaultEnabled) await configureAssessmentFault();
  await rm(temporary, { recursive: true, force: true });
}

async function draft(token, jobId) {
  let response;
  for (let attempt = 0; attempt < 120; attempt++) {
    response = await http("GET", `/api/v1/ai/jobs/${jobId}/drafts`, { bearer: token });
    if (response.status !== 503) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!response) throw new Error("AI-04 draft read was not attempted");
  expect(response, 200, "AI-04 draft read");
  const value = response.json.data.find((candidate) => candidate.draftVersion === 1);
  if (!value) throw new Error("Generated v1 draft missing");
  return value;
}
function approve(token, draftId, key, reviewedDraft, ifMatch = '"v1"') {
  return http("POST", `/api/v1/ai/drafts/${draftId}/approve`, {
    bearer: token,
    key,
    ifMatch,
    body: { reviewedDraft },
  });
}
function assertApproval(value, draftId) {
  if (
    value.draftId !== draftId ||
    value.state !== "APPROVED" ||
    value.approvedDraftVersion !== 2 ||
    value.assessment?.quizVersion !== 1 ||
    value.assessment?.status !== "DRAFT"
  )
    throw new Error(`Invalid approval response ${JSON.stringify(value)}`);
}
async function http(method, path, input = {}) {
  const env = await readEnv(),
    headers = {
      ...(input.bearer ? { authorization: `Bearer ${input.bearer}` } : {}),
      ...(input.key ? { "idempotency-key": input.key } : {}),
      ...(input.ifMatch ? { "if-match": input.ifMatch } : {}),
      ...(input.body ? { "content-type": "application/json" } : {}),
    };
  const response = await fetch(new URL(path, env.API_GATEWAY_URL ?? "http://127.0.0.1:8080"), {
    method,
    headers,
    ...(input.body ? { body: JSON.stringify(input.body) } : {}),
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { text };
  }
  return { status: response.status, json };
}
function expect(result, status, label) {
  if (result.status !== status)
    throw new Error(`${label}: expected ${status}, got ${result.status} ${JSON.stringify(result.json)}`);
}
function docker(...args) {
  execFileSync("docker", args, { stdio: "ignore" });
}
async function ready(container, port) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      execFileSync(
        "docker",
        [
          "exec",
          container,
          "node",
          "-e",
          `fetch('http://127.0.0.1:${String(port)}/health/ready').then(r=>{if(!r.ok)process.exit(1)})`,
        ],
        { stdio: "ignore" },
      );
      return;
    } catch {
      // Service may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Service not ready: ${container}:${String(port)}`);
}
function probe(draftIds) {
  const expected = new Set(draftIds),
    approvals = readRows("ailss-ai-service", "ai_keyspace", "ai_approval_by_draft").filter((row) =>
      expected.has(String(row.draft_id)),
    ),
    imports = readRows("ailss-assessment-service", "assessment_keyspace", "ai_draft_import_by_id").filter(
      (row) => expected.has(String(row.draft_id)),
    );
  return {
    ai: { approvals: approvals.filter((row) => row.state === "COMPLETE").length },
    assessment: {
      imports: imports.length,
      distinctQuizzes: new Set(imports.map((row) => String(row.quiz_id))).size,
      nonDraft: imports.filter((row) => row.status !== "DRAFT").length,
    },
  };
}

function readRows(container, keyspace, table) {
  const script = `import c from"cassandra-driver";const [k,t]=process.argv.slice(1),x=new c.Client({contactPoints:["cassandra"],localDataCenter:process.env.CASSANDRA_LOCAL_DATACENTER??"ailss_dc",keyspace:k,authProvider:new c.auth.PlainTextAuthProvider(process.env.CASSANDRA_USERNAME,process.env.CASSANDRA_PASSWORD)});await x.connect();const r=await x.execute("SELECT * FROM "+t,[],{prepare:true,consistency:c.types.consistencies.localQuorum});await x.shutdown();console.log(JSON.stringify(r.rows));`;
  return JSON.parse(
    execFileSync(
      "docker",
      ["exec", container, "node", "--input-type=module", "-e", script, keyspace, table],
      { encoding: "utf8" },
    ).trim(),
  );
}

function lostResponseProof(draftId) {
  const approvals = readRows("ailss-ai-service", "ai_keyspace", "ai_approval_by_draft").filter(
      (row) => String(row.draft_id) === draftId,
    ),
    imports = readRows("ailss-assessment-service", "assessment_keyspace", "ai_draft_import_by_id").filter(
      (row) => String(row.draft_id) === draftId,
    ),
    quizId = imports[0] ? String(imports[0].quiz_id) : undefined,
    quizzes = readRows("ailss-assessment-service", "assessment_keyspace", "quiz_by_id").filter(
      (row) => String(row.quiz_id) === quizId,
    ),
    questions = readRows(
      "ailss-assessment-service",
      "assessment_keyspace",
      "questions_by_quiz_version",
    ).filter((row) => String(row.quiz_id) === quizId),
    projections = readRows(
      "ailss-assessment-service",
      "assessment_keyspace",
      "quizzes_by_target_state_v2",
    ).filter((row) => String(row.quiz_id) === quizId),
    draftJobs = readRows("ailss-ai-service", "ai_keyspace", "ai_job_by_draft").filter(
      (row) => String(row.draft_id) === draftId,
    ),
    jobId = draftJobs[0] ? String(draftJobs[0].job_id) : undefined,
    jobs = readRows("ailss-ai-service", "ai_keyspace", "ai_job_by_id").filter(
      (row) => String(row.job_id) === jobId,
    );
  return {
    imports: imports.length,
    importOperationId: imports[0] ? String(imports[0].import_operation_id) : undefined,
    importState: imports[0]?.command_state,
    quizId,
    quizzes: quizzes.length,
    quizVersion: quizzes[0] ? Number(quizzes[0].current_version) : undefined,
    assessmentState: quizzes[0]?.state,
    questionRows: questions.length,
    questionVersions: [...new Set(questions.map((row) => Number(row.quiz_version)))],
    projections: projections.length,
    approvals: approvals.length,
    approvedSnapshotV2:
      typeof approvals[0]?.approved_object_key === "string" &&
      approvals[0].approved_object_key.endsWith("/2.json") &&
      typeof approvals[0]?.approved_draft_checksum === "string",
    approvalState: approvals[0]?.state,
    linkedQuizId: approvals[0]?.assessment_quiz_id ? String(approvals[0].assessment_quiz_id) : undefined,
    jobState: jobs[0]?.state,
  };
}

function assertLostResponseBeforeRetry(proof, draft) {
  if (
    proof.imports !== 1 ||
    proof.importState !== "COMPLETE" ||
    proof.quizzes !== 1 ||
    proof.quizVersion !== 1 ||
    proof.assessmentState !== "DRAFT" ||
    proof.questionRows !== draft.content.questions.length ||
    JSON.stringify(proof.questionVersions) !== "[1]" ||
    proof.projections !== 1 ||
    proof.approvals !== 1 ||
    !proof.approvedSnapshotV2 ||
    proof.approvalState !== "SNAPSHOT_STORED" ||
    proof.linkedQuizId !== undefined ||
    proof.jobState !== "AI_DRAFT"
  )
    throw new Error(`Lost-response pre-retry proof failed ${JSON.stringify(proof)}`);
}

function assertLostResponseAfterRetry(before, after, draft) {
  if (
    after.imports !== 1 ||
    after.importOperationId !== before.importOperationId ||
    after.quizId !== before.quizId ||
    after.quizzes !== 1 ||
    after.quizVersion !== 1 ||
    after.assessmentState !== "DRAFT" ||
    after.questionRows !== draft.content.questions.length ||
    JSON.stringify(after.questionVersions) !== "[1]" ||
    after.projections !== 1 ||
    after.approvals !== 1 ||
    !after.approvedSnapshotV2 ||
    after.approvalState !== "COMPLETE" ||
    after.linkedQuizId !== before.quizId ||
    after.jobState !== "APPROVED"
  )
    throw new Error(`Lost-response post-retry proof failed ${JSON.stringify({ before, after })}`);
}

async function configureAssessmentFault(draftId) {
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
      "--force-recreate",
      "assessment-service",
    ],
    {
      stdio: "ignore",
      env: {
        ...process.env,
        NODE_ENV: draftId ? "test" : "development",
        ASSESSMENT_ACCEPTANCE_DELAY_AFTER_IMPORT_DRAFT_ID: draftId ?? "",
      },
    },
  );
  await ready("ailss-assessment-service", 8104);
}
