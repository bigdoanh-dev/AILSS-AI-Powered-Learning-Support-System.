import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Transport, ApiError } from "../src/api";
import { Session } from "../src/session";
import { aiUsage, aiJobs, aiJob, aiDrafts, aiApprovalResult, isAiJobState } from "../src/ai-authoring";
import { authoringQuiz } from "../src/assessment-authoring";

interface AiSubGateResults {
  contractMapReconciled: boolean;
  lecturerAuth: boolean;
  studentAuth: boolean;
  aiUsageRead: boolean;
  aiJobsList: boolean;
  aiJobCreation: boolean;
  aiJobIdempotency: boolean;
  aiJobDetailRead: boolean;
  aiJobCancellation: boolean;
  aiDraftRetrieval: boolean;
  aiDraftApproval: boolean;
  assessmentQuizImportVerification: boolean;
  strictCompletedStateRejection: boolean;
  studentSecurityBoundary: boolean;
  logout: boolean;
}

async function main() {
  const origin = process.env.AILSS_MOBILE_TEST_ORIGIN || "http://127.0.0.1:8080";
  const lecturerEmail = process.env.AILSS_LECTURER_EMAIL || "lecturer.demo@ailss.local";
  const lecturerPassword = process.env.AILSS_LECTURER_PASSWORD || "AilssLecturer!2026";
  const studentEmail = process.env.AILSS_STUDENT_EMAIL || "student.demo@ailss.local";
  const studentPassword = process.env.AILSS_STUDENT_PASSWORD || "AilssDemo!2026";

  console.log("============================================================");
  console.log("AILSS PHASE 14.3C-2 — LIVE INTEGRATION TEST");
  console.log("Lecturer AI Quiz Generation Workflow & Approval");
  console.log(`Gateway: ${origin}`);
  console.log(`Lecturer: ${lecturerEmail}`);
  console.log(`Student:  ${studentEmail}`);
  console.log("Credentials: [REDACTED]");
  console.log("============================================================\n");

  const results: AiSubGateResults = {
    contractMapReconciled: false,
    lecturerAuth: false,
    studentAuth: false,
    aiUsageRead: false,
    aiJobsList: false,
    aiJobCreation: false,
    aiJobIdempotency: false,
    aiJobDetailRead: false,
    aiJobCancellation: false,
    aiDraftRetrieval: false,
    aiDraftApproval: false,
    assessmentQuizImportVerification: false,
    strictCompletedStateRejection: false,
    studentSecurityBoundary: false,
    logout: false,
  };

  // Step 1: Reconcile Contract IDs against contracts/api-registry.json and query-registry.json
  console.log("Step 1: Reconciling Contract IDs against api-registry.json & query-registry.json...");
  const registryPath = path.resolve(process.cwd(), "contracts/api-registry.json");
  const registryRaw = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const allApis: { id: string; method: string; path: string; summary: string; roles: string }[] = [
    ...(registryRaw.public || []),
    ...(registryRaw.internal || []),
  ];

  const ai01 = allApis.find((a) => a.id === "AI-01");
  const ai02 = allApis.find((a) => a.id === "AI-02");
  const ai03 = allApis.find((a) => a.id === "AI-03");
  const ai04 = allApis.find((a) => a.id === "AI-04");
  const ai05 = allApis.find((a) => a.id === "AI-05");
  const ai06 = allApis.find((a) => a.id === "AI-06");
  const ai10 = allApis.find((a) => a.id === "AI-10");

  assert.ok(
    ai01 && ai01.path === "/api/v1/ai/quiz-jobs" && ai01.method === "POST",
    "AI-01 must be POST /api/v1/ai/quiz-jobs",
  );
  assert.ok(
    ai02 && ai02.path === "/api/v1/ai/jobs/{jobId}" && ai02.method === "GET",
    "AI-02 must be GET /api/v1/ai/jobs/{jobId}",
  );
  assert.ok(
    ai03 && ai03.path === "/api/v1/ai/jobs" && ai03.method === "GET",
    "AI-03 must be GET /api/v1/ai/jobs",
  );
  assert.ok(
    ai04 && ai04.path === "/api/v1/ai/jobs/{jobId}/drafts" && ai04.method === "GET",
    "AI-04 must be GET /api/v1/ai/jobs/{jobId}/drafts",
  );
  assert.ok(
    ai05 && ai05.path === "/api/v1/ai/drafts/{draftId}/approve" && ai05.method === "POST",
    "AI-05 must be POST /api/v1/ai/drafts/{draftId}/approve",
  );
  assert.ok(
    ai06 && ai06.path === "/api/v1/ai/jobs/{jobId}/cancel" && ai06.method === "POST",
    "AI-06 must be POST /api/v1/ai/jobs/{jobId}/cancel",
  );
  assert.ok(
    ai10 && ai10.path === "/api/v1/ai/usage" && ai10.method === "GET",
    "AI-10 must be GET /api/v1/ai/usage",
  );

  results.contractMapReconciled = true;
  console.log("✓ Contract IDs reconciled successfully:");
  console.log("  - AI-01: POST /api/v1/ai/quiz-jobs (Create AI generation job)");
  console.log("  - AI-02: GET  /api/v1/ai/jobs/{jobId} (Job status polling, Q-AI-001)");
  console.log("  - AI-03: GET  /api/v1/ai/jobs (Job list with state & month, Q-AI-002)");
  console.log("  - AI-04: GET  /api/v1/ai/jobs/{jobId}/drafts (Draft retrieval, Q-AI-003)");
  console.log("  - AI-05: POST /api/v1/ai/drafts/{draftId}/approve (Approve & import to Assessment)");
  console.log("  - AI-06: POST /api/v1/ai/jobs/{jobId}/cancel (Cancel in-flight job)");
  console.log("  - AI-10: GET  /api/v1/ai/usage (Lecturer daily quota metrics)");

  // Step 2: Authenticate Lecturer & Student
  console.log("\nStep 2: Authenticating Lecturer and Student...");
  let lecturerSaved: string | null = null;
  const lecturerApi = new Transport(origin);
  const lecturerSession = new Session(lecturerApi, {
    read: async () => lecturerSaved,
    write: async (v) => {
      lecturerSaved = v;
    },
    clear: async () => {
      lecturerSaved = null;
    },
  });

  let studentSaved: string | null = null;
  const studentApi = new Transport(origin);
  const studentSession = new Session(studentApi, {
    read: async () => studentSaved,
    write: async (v) => {
      studentSaved = v;
    },
    clear: async () => {
      studentSaved = null;
    },
  });

  await lecturerSession.login(lecturerEmail, lecturerPassword);
  assert.equal(lecturerSession.snapshot.state, "AUTHENTICATED");
  assert.equal(lecturerSession.snapshot.user?.role, "LECTURER");
  results.lecturerAuth = true;
  console.log(`✓ Lecturer authenticated: UserID=${lecturerSession.snapshot.user?.userId}, Role=LECTURER`);

  await studentSession.login(studentEmail, studentPassword);
  assert.equal(studentSession.snapshot.state, "AUTHENTICATED");
  assert.equal(studentSession.snapshot.user?.role, "STUDENT");
  results.studentAuth = true;
  console.log(`✓ Student authenticated: UserID=${studentSession.snapshot.user?.userId}, Role=STUDENT`);

  // Step 3: Check AI Usage Quota (AI-10)
  console.log("\nStep 3: Checking Lecturer AI Usage Quota (AI-10)...");
  const usageRaw = await lecturerSession.request("/api/v1/ai/usage");
  const usage = aiUsage(usageRaw);
  assert.ok(usage.limit > 0, "Usage limit must be positive");
  assert.ok(usage.day && usage.day.length === 10, "Day string must be YYYY-MM-DD");
  results.aiUsageRead = true;
  console.log(
    `✓ AI Usage verified: Day=${usage.day}, Limit=${usage.limit}, Consumed=${usage.consumed}, Remaining=${usage.remaining}`,
  );

  // Step 4: Check Existing AI Jobs List (AI-03)
  console.log("\nStep 4: Fetching AI Jobs List (AI-03)...");
  const currentMonth = new Date().toISOString().slice(0, 7);
  const jobsRaw = await lecturerSession.request(`/api/v1/ai/jobs?state=AI_DRAFT&month=${currentMonth}`);
  const draftJobs = aiJobs(jobsRaw);
  assert.ok(Array.isArray(draftJobs), "Draft jobs must decode to array");
  results.aiJobsList = true;
  console.log(`✓ AI Jobs list fetched: Found ${draftJobs.length} job(s) in AI_DRAFT state`);

  // Step 5: Test AI Job Creation & Cancellation Lifecycle (AI-01, AI-02, AI-06)
  console.log("\nStep 5: Testing AI Job Creation (AI-01) & Cancellation (AI-06)...");
  const fixtureDocId = "22fd7a76-e7de-44b3-9622-9956d151b504";
  const courseTargetId = "1b044b95-2397-49b3-a566-f8d53f83d811";
  const createJobKey = crypto.randomUUID();
  const createJobPayload = {
    documentId: fixtureDocId,
    targetType: "COURSE",
    targetId: courseTargetId,
    questionCount: 4,
    questionTypes: ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"],
    difficulty: "MEDIUM",
  };

  const createRes1 = await lecturerSession.request("/api/v1/ai/quiz-jobs", {
    method: "POST",
    headers: { "Idempotency-Key": createJobKey },
    body: createJobPayload,
  });
  const queuedJob1 = aiJob(createRes1);
  assert.ok(queuedJob1.jobId, "Created job must have jobId");
  assert.ok(
    queuedJob1.state === "QUEUED" || queuedJob1.state === "PROCESSING",
    "Initial job state must be QUEUED or PROCESSING",
  );
  results.aiJobCreation = true;
  console.log(`✓ AI Job created: ID=${queuedJob1.jobId}, State=${queuedJob1.state}`);

  // Test idempotency replay
  const createRes2 = await lecturerSession.request("/api/v1/ai/quiz-jobs", {
    method: "POST",
    headers: { "Idempotency-Key": createJobKey },
    body: createJobPayload,
  });
  const queuedJob2 = aiJob(createRes2);
  assert.equal(queuedJob2.jobId, queuedJob1.jobId, "Idempotent replay must return identical jobId");
  results.aiJobIdempotency = true;
  console.log("✓ Idempotency verified: replayed job request returned identical jobId");

  // Read job details (AI-02)
  console.log("\nStep 6: Polling / Reading Job Status (AI-02)...");
  const jobDetailRaw = await lecturerSession.request(`/api/v1/ai/jobs/${queuedJob1.jobId}`);
  const readJob = aiJob(jobDetailRaw);
  assert.equal(readJob.jobId, queuedJob1.jobId);
  results.aiJobDetailRead = true;
  console.log(`✓ Job status verified: State=${readJob.state}, Version=${readJob.version}`);

  // Cancel in-flight job (AI-06)
  console.log("\nStep 7: Testing Job Cancellation (AI-06)...");
  const cancelKey = crypto.randomUUID();
  const cancelRes = await lecturerSession.request(`/api/v1/ai/jobs/${queuedJob1.jobId}/cancel`, {
    method: "POST",
    headers: { "Idempotency-Key": cancelKey },
  });
  const cancelledJob = aiJob(cancelRes);
  assert.equal(cancelledJob.jobId, queuedJob1.jobId);
  assert.equal(cancelledJob.state, "CANCELLED");
  results.aiJobCancellation = true;
  console.log(`✓ Job cancelled successfully: State=${cancelledJob.state}`);

  // Step 8: Retrieve and Approve AI Draft (AI-04, AI-05)
  console.log("\nStep 8: Testing Draft Retrieval (AI-04) and Lecturer Approval (AI-05)...");
  let targetJobId: string | null = draftJobs.length > 0 ? draftJobs[0].jobId : null;
  if (!targetJobId) {
    const approvedJobsRaw = await lecturerSession.request(
      `/api/v1/ai/jobs?state=APPROVED&month=${currentMonth}`,
    );
    const approvedJobs = aiJobs(approvedJobsRaw);
    if (approvedJobs.length > 0) {
      targetJobId = approvedJobs[0].jobId;
    }
  }
  assert.ok(targetJobId, "Expected at least one AI job (AI_DRAFT or APPROVED) for acceptance verification");
  console.log(`Target AI Job: ${targetJobId}`);

  const draftsRaw = await lecturerSession.request(`/api/v1/ai/jobs/${targetJobId}/drafts`);
  const drafts = aiDrafts(draftsRaw);
  assert.ok(drafts.length > 0, "Job must have draft content");
  const activeDraft = drafts[0];
  assert.ok(activeDraft.state === "AI_DRAFT" || activeDraft.state === "APPROVED");
  assert.ok(activeDraft.content.questions.length > 0, "Draft must contain questions");
  results.aiDraftRetrieval = true;
  console.log(
    `✓ Draft retrieved: DraftID=${activeDraft.draftId}, Version=${activeDraft.draftVersion}, Questions=${activeDraft.questionCount}`,
  );

  // Approve Draft with If-Match header (AI-05)
  console.log("\nStep 9: Approving Draft with optimistic concurrency If-Match (AI-05)...");
  const approveKey = crypto.randomUUID();
  const approveRes = await lecturerSession.request(`/api/v1/ai/drafts/${activeDraft.draftId}/approve`, {
    method: "POST",
    headers: {
      "Idempotency-Key": approveKey,
      "If-Match": '"v1"',
    },
    body: {
      reviewedDraft: activeDraft.content,
    },
  });

  const approval = aiApprovalResult(approveRes);
  assert.equal(approval.state, "APPROVED");
  assert.ok(approval.assessment.quizId, "Approval must create assessment quiz");
  assert.equal(approval.assessment.status, "DRAFT", "Imported quiz must be in DRAFT state in Assessment");
  results.aiDraftApproval = true;
  console.log(
    `✓ Draft approved successfully: State=${approval.state}, Assessment QuizId=${approval.assessment.quizId}, State=DRAFT`,
  );

  // Step 10: Verify imported Quiz in Assessment Service (ASM-02)
  console.log("\nStep 10: Verifying imported quiz in Assessment Service (ASM-02)...");
  const importedQuizRes = await lecturerSession.request(`/api/v1/quizzes/${approval.assessment.quizId}`);
  const importedQuiz = authoringQuiz(importedQuizRes);
  assert.equal(importedQuiz.quizId, approval.assessment.quizId);
  assert.equal(importedQuiz.state, "DRAFT");
  assert.equal(importedQuiz.questionCount, activeDraft.questionCount);
  results.assessmentQuizImportVerification = true;
  console.log(
    `✓ Verified imported quiz in Assessment service: QuestionCount=${importedQuiz.questionCount}, State=DRAFT`,
  );

  // Step 11: Strict COMPLETED State Rejection Invariant
  console.log("\nStep 11: Validating strict rejection of COMPLETED state for QUIZ_GENERATION...");
  assert.equal(isAiJobState("COMPLETED"), false, "isAiJobState(COMPLETED) must strictly return false");
  assert.equal(isAiJobState("AI_DRAFT"), true);
  assert.equal(isAiJobState("APPROVED"), true);
  assert.equal(isAiJobState("PROCESSING"), true);
  assert.equal(isAiJobState("QUEUED"), true);
  assert.equal(isAiJobState("VALIDATING"), true);
  assert.equal(isAiJobState("FAILED"), true);
  assert.equal(isAiJobState("CANCELLED"), true);

  // Assert decoder throws ApiError(invalid) on COMPLETED
  let rejectedCompleted = false;
  try {
    aiJob({
      jobId: crypto.randomUUID(),
      jobKind: "QUIZ_GENERATION",
      targetType: "COURSE",
      targetId: crypto.randomUUID(),
      documentId: crypto.randomUUID(),
      state: "COMPLETED", // ILLEGAL STATE
      version: 1,
    });
  } catch (e: unknown) {
    if (e instanceof ApiError && e.kind === "invalid") {
      rejectedCompleted = true;
    }
  }
  assert.ok(rejectedCompleted, "aiJob decoder must throw ApiError(invalid) when state is COMPLETED");
  results.strictCompletedStateRejection = true;
  console.log("✓ Strict state invariant verified: COMPLETED is unequivocally rejected for QUIZ_GENERATION");

  // Step 12: Security Boundaries (Role Separation)
  console.log("\nStep 12: Validating Security Boundaries (403 Forbidden for Student)...");
  // Student accessing AI-10 Usage -> 403
  let studentForbidden10 = false;
  try {
    await studentSession.request("/api/v1/ai/usage");
  } catch (e: unknown) {
    if (e instanceof ApiError && e.status === 403) {
      studentForbidden10 = true;
    }
  }
  assert.ok(studentForbidden10, "Student accessing AI-10 must receive 403 Forbidden");

  // Student creating AI job AI-01 -> 403
  let studentForbidden01 = false;
  try {
    await studentSession.request("/api/v1/ai/quiz-jobs", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: createJobPayload,
    });
  } catch (e: unknown) {
    if (e instanceof ApiError && e.status === 403) {
      studentForbidden01 = true;
    }
  }
  assert.ok(studentForbidden01, "Student creating AI job via AI-01 must receive 403 Forbidden");

  // Student approving draft AI-05 -> 403
  let studentForbidden05 = false;
  try {
    await studentSession.request(`/api/v1/ai/drafts/${activeDraft.draftId}/approve`, {
      method: "POST",
      headers: {
        "Idempotency-Key": crypto.randomUUID(),
        "If-Match": '"v1"',
      },
      body: { reviewedDraft: activeDraft.content },
    });
  } catch (e: unknown) {
    if (e instanceof ApiError && e.status === 403) {
      studentForbidden05 = true;
    }
  }
  assert.ok(studentForbidden05, "Student approving draft via AI-05 must receive 403 Forbidden");
  results.studentSecurityBoundary = true;
  console.log(
    "✓ Security boundaries verified: Student requests to AI-10, AI-01, and AI-05 return 403 Forbidden",
  );

  // Step 13: Clean Logout
  console.log("\nStep 13: Logging out sessions cleanly...");
  await lecturerSession.logout();
  await studentSession.logout();
  assert.equal(lecturerSession.snapshot.state, "ANONYMOUS");
  assert.equal(studentSession.snapshot.state, "ANONYMOUS");
  results.logout = true;
  console.log("✓ Lecturer and Student logged out cleanly");

  console.log("\n============================================================");
  console.log("P14.3C-2 AI QUIZ WORKFLOW RESULTS SUMMARY");
  console.log("============================================================");
  console.log(JSON.stringify(results, null, 2));
  console.log("\n>>> ALL P14.3C-2 INTEGRATION CRITERIA PASSED <<<");
}

main().catch((err) => {
  console.error("\n❌ P14.3C-2 INTEGRATION TEST FAILED:", err);
  process.exit(1);
});
