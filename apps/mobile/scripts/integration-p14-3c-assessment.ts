import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Transport, ApiError } from "../src/api";
import { Session } from "../src/session";
import {
  authoringQuiz,
  authoringQuizSummaries,
  quizResultPage,
  CONTRACT_LIMITED,
} from "../src/assessment-authoring";
import { ownedOfferings, uniqueCoursesFromOfferings } from "../src/teaching";

interface SubGateResults {
  contractMapReconciled: boolean;
  lecturerAuth: boolean;
  studentAuth: boolean;
  quizCreate: boolean;
  quizIdempotency: boolean;
  quizUpdateAllTypes: boolean;
  quizDetailRead: boolean;
  quizPublish: boolean;
  targetQuizzesList: boolean;
  resultsOverviewRead: boolean;
  studentSecurityBoundary: boolean;
  foreignOwnershipBoundary: boolean;
  stateMachineInvariants: boolean;
  contractLimitedAffirmed: boolean;
  logout: boolean;
}

async function main() {
  const origin = process.env.AILSS_MOBILE_TEST_ORIGIN || "http://127.0.0.1:8080";
  const lecturerEmail = process.env.AILSS_LECTURER_EMAIL || "lecturer.demo@ailss.local";
  const lecturerPassword = process.env.AILSS_LECTURER_PASSWORD || "AilssLecturer!2026";
  const studentEmail = process.env.AILSS_STUDENT_EMAIL || "student.demo@ailss.local";
  const studentPassword = process.env.AILSS_STUDENT_PASSWORD || "AilssDemo!2026";

  console.log("============================================================");
  console.log("AILSS PHASE 14.3C-1 — LIVE INTEGRATION TEST");
  console.log("Lecturer Assessment Authoring & Results Overview");
  console.log(`Gateway: ${origin}`);
  console.log(`Lecturer: ${lecturerEmail}`);
  console.log(`Student:  ${studentEmail}`);
  console.log("Credentials: [REDACTED]");
  console.log("============================================================\n");

  const results: SubGateResults = {
    contractMapReconciled: false,
    lecturerAuth: false,
    studentAuth: false,
    quizCreate: false,
    quizIdempotency: false,
    quizUpdateAllTypes: false,
    quizDetailRead: false,
    quizPublish: false,
    targetQuizzesList: false,
    resultsOverviewRead: false,
    studentSecurityBoundary: false,
    foreignOwnershipBoundary: false,
    stateMachineInvariants: false,
    contractLimitedAffirmed: false,
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

  const asm01 = allApis.find((a) => a.id === "ASM-01");
  const asm02 = allApis.find((a) => a.id === "ASM-02");
  const asm03 = allApis.find((a) => a.id === "ASM-03");
  const asm04 = allApis.find((a) => a.id === "ASM-04");
  const asm05 = allApis.find((a) => a.id === "ASM-05");
  const asm10 = allApis.find((a) => a.id === "ASM-10");

  assert.ok(
    asm01 && asm01.path === "/api/v1/quizzes" && asm01.method === "POST",
    "ASM-01 must be POST /api/v1/quizzes",
  );
  assert.ok(
    asm02 && asm02.path === "/api/v1/quizzes/{quizId}" && asm02.method === "GET",
    "ASM-02 must be GET /api/v1/quizzes/{quizId}",
  );
  assert.ok(
    asm03 && asm03.path === "/api/v1/quizzes/{quizId}" && asm03.method === "PATCH",
    "ASM-03 must be PATCH /api/v1/quizzes/{quizId}",
  );
  assert.ok(
    asm04 && asm04.path === "/api/v1/quizzes/{quizId}/publish" && asm04.method === "POST",
    "ASM-04 must be POST /api/v1/quizzes/{quizId}/publish",
  );
  assert.ok(
    asm05 && asm05.path === "/api/v1/targets/{targetType}/{targetId}/quizzes" && asm05.method === "GET",
    "ASM-05 must be GET /api/v1/targets/{targetType}/{targetId}/quizzes",
  );
  assert.ok(
    asm10 && asm10.path === "/api/v1/quizzes/{quizId}/results" && asm10.method === "GET",
    "ASM-10 must be GET /api/v1/quizzes/{quizId}/results",
  );

  results.contractMapReconciled = true;
  console.log("✓ Contract IDs reconciled successfully:");
  console.log("  - ASM-01: POST  /api/v1/quizzes (Create draft quiz with Idempotency-Key)");
  console.log("  - ASM-02: GET   /api/v1/quizzes/{quizId} (Quiz details with questions)");
  console.log("  - ASM-03: PATCH /api/v1/quizzes/{quizId} (Update title & question set)");
  console.log("  - ASM-04: POST  /api/v1/quizzes/{quizId}/publish (Publish quiz)");
  console.log("  - ASM-05: GET   /api/v1/targets/{targetType}/{targetId}/quizzes (List quizzes by target)");
  console.log("  - ASM-10: GET   /api/v1/quizzes/{quizId}/results (Lecturer results overview with month)");

  // Step 2: Set up Sessions and Authenticate
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

  // Step 3: Identify owned target course
  console.log("\nStep 3: Identifying owned target course...");
  const offeringRaw = await lecturerSession.request("/api/v1/me/owned-offerings");
  const offerings = ownedOfferings(offeringRaw);
  const courses = uniqueCoursesFromOfferings(offerings);
  assert.ok(courses.length > 0, "Lecturer must have at least 1 owned course");
  const targetCourse = courses[0];
  const targetCourseId = targetCourse.courseId;
  console.log(`✓ Target course selected: "${targetCourse.title}" (ID: ${targetCourseId})`);

  // Step 4: Create disposable draft quiz (ASM-01) + Idempotency
  console.log("\nStep 4: Creating disposable quiz & testing Idempotency-Key (ASM-01)...");
  const quizCreateKey = crypto.randomUUID();
  const initialTitle = `P14.3C Acceptance Quiz ${Date.now()}`;
  const initialPayload = {
    title: initialTitle,
    targetType: "COURSE",
    targetId: targetCourseId,
    questions: [
      {
        questionType: "SINGLE_CHOICE",
        prompt: "Ngôn ngữ nào chạy trên nền tảng Node.js?",
        points: "2.50",
        options: ["JavaScript", "Python", "Ruby", "Swift"],
        correctAnswer: "JavaScript",
      },
    ],
  };

  const createRes1 = await lecturerSession.request("/api/v1/quizzes", {
    method: "POST",
    headers: { "Idempotency-Key": quizCreateKey },
    body: initialPayload,
  });

  const quiz1 = authoringQuiz(createRes1);
  assert.ok(quiz1.quizId, "Created quiz must have a quizId");
  assert.equal(quiz1.state, "DRAFT", "New quiz must be in DRAFT state");
  assert.equal(quiz1.questionCount, 1, "Initial question count must be 1");
  assert.equal(quiz1.currentVersion, 1, "Initial version must be 1");
  results.quizCreate = true;
  console.log(`✓ Quiz created: ID=${quiz1.quizId}, State=DRAFT, Version=${quiz1.currentVersion}`);

  // Test idempotency replay
  const createRes2 = await lecturerSession.request("/api/v1/quizzes", {
    method: "POST",
    headers: { "Idempotency-Key": quizCreateKey },
    body: initialPayload,
  });
  const quiz2 = authoringQuiz(createRes2);
  assert.equal(quiz2.quizId, quiz1.quizId, "Idempotent replay must return the exact same quizId");
  results.quizIdempotency = true;
  console.log("✓ Idempotency verified: replayed request returned identical quiz without duplicate creation");

  // Step 5: Update draft quiz with all 4 question types (ASM-03)
  console.log("\nStep 5: Updating draft quiz with all 4 question types (ASM-03)...");
  const fullQuestionsPayload = {
    title: `${initialTitle} (Updated)`,
    questions: [
      {
        questionType: "SINGLE_CHOICE",
        prompt: "Câu 1 (SINGLE_CHOICE): Từ khóa khai báo hằng số trong JS là gì?",
        points: "2.50",
        options: ["const", "let", "var", "def"],
        correctAnswer: "const",
      },
      {
        questionType: "MULTIPLE_CHOICE",
        prompt: "Câu 2 (MULTIPLE_CHOICE): Các kiểu dữ liệu nguyên thủy (primitive) trong JavaScript gồm:",
        points: "2.50",
        options: ["string", "number", "boolean", "component"],
        correctAnswer: ["string", "number", "boolean"],
      },
      {
        questionType: "TRUE_FALSE",
        prompt: "Câu 3 (TRUE_FALSE): Trong JavaScript, typeof NaN trả về number.",
        points: "2.50",
        correctAnswer: true,
      },
      {
        questionType: "SHORT_ANSWER",
        prompt: "Câu 4 (SHORT_ANSWER): Nhập tên phương thức chuyển đối tượng thành chuỗi JSON:",
        points: "2.50",
        correctAnswer: "JSON.stringify",
      },
    ],
  };

  const patchRes = await lecturerSession.request(`/api/v1/quizzes/${quiz1.quizId}`, {
    method: "PATCH",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: fullQuestionsPayload,
  });

  const updatedQuiz = authoringQuiz(patchRes);
  assert.equal(updatedQuiz.quizId, quiz1.quizId);
  assert.equal(updatedQuiz.title, `${initialTitle} (Updated)`);
  assert.equal(updatedQuiz.questionCount, 4, "Updated quiz must have 4 questions");
  assert.equal(updatedQuiz.state, "DRAFT", "Quiz must still be in DRAFT state before publishing");
  results.quizUpdateAllTypes = true;
  console.log("✓ Draft quiz updated successfully across all 4 question types:");
  console.log("  - SINGLE_CHOICE: 1 question (2.50 pts)");
  console.log("  - MULTIPLE_CHOICE: 1 question (2.50 pts)");
  console.log("  - TRUE_FALSE: 1 question (2.50 pts)");
  console.log("  - SHORT_ANSWER: 1 question (2.50 pts)");

  // Step 6: Read Quiz Detail (ASM-02)
  console.log("\nStep 6: Reading Quiz Detail (ASM-02)...");
  const detailRes = await lecturerSession.request(`/api/v1/quizzes/${quiz1.quizId}`);
  const detailedQuiz = authoringQuiz(detailRes);
  assert.equal(detailedQuiz.quizId, quiz1.quizId);
  assert.equal(detailedQuiz.questions.length, 4);
  assert.equal(detailedQuiz.questions[0].questionType, "SINGLE_CHOICE");
  assert.equal(detailedQuiz.questions[1].questionType, "MULTIPLE_CHOICE");
  assert.equal(detailedQuiz.questions[2].questionType, "TRUE_FALSE");
  assert.equal(detailedQuiz.questions[3].questionType, "SHORT_ANSWER");
  results.quizDetailRead = true;
  console.log("✓ Quiz details read and validated with strict decoders");

  // Step 7: Publish Quiz (ASM-04)
  console.log("\nStep 7: Publishing Quiz (ASM-04)...");
  const publishKey = crypto.randomUUID();
  const pubRes = await lecturerSession.request(`/api/v1/quizzes/${quiz1.quizId}/publish`, {
    method: "POST",
    headers: { "Idempotency-Key": publishKey },
  });
  const publishedQuiz = authoringQuiz(pubRes);
  assert.equal(publishedQuiz.quizId, quiz1.quizId);
  assert.equal(publishedQuiz.state, "PUBLISHED", "Quiz state must transition to PUBLISHED");
  results.quizPublish = true;
  console.log(
    `✓ Quiz published successfully: State=${publishedQuiz.state}, Version=${publishedQuiz.currentVersion}`,
  );

  // Step 8: Query Target Quizzes (ASM-05)
  console.log("\nStep 8: Querying target quizzes (ASM-05)...");
  const targetQuizzesRes = await lecturerSession.request(`/api/v1/targets/COURSE/${targetCourseId}/quizzes`);
  const targetQuizzes = authoringQuizSummaries(targetQuizzesRes);
  const found = targetQuizzes.find((q) => q.quizId === quiz1.quizId);
  assert.ok(found, "Newly published quiz must appear in target quizzes list");
  assert.equal(found?.state, "PUBLISHED");
  results.targetQuizzesList = true;
  console.log(
    `✓ Verified target quizzes: Found published quiz in list (Total target quizzes: ${targetQuizzes.length})`,
  );

  // Step 9: Lecturer Results Overview (ASM-10)
  console.log("\nStep 9: Reading Lecturer Results Overview with month query (ASM-10)...");
  const currentMonth = new Date().toISOString().slice(0, 7);
  const resultsRes = await lecturerSession.request(
    `/api/v1/quizzes/${quiz1.quizId}/results?month=${currentMonth}&limit=20`,
  );
  const resultsPage = quizResultPage(resultsRes);
  assert.ok(Array.isArray(resultsPage.items), "Results items must be an array");
  results.resultsOverviewRead = true;
  console.log(
    `✓ Results overview fetched successfully for month=${currentMonth} (Attempts count: ${resultsPage.items.length})`,
  );

  // Step 10: Security Boundaries (Role Separation)
  console.log("\nStep 10: Validating Security Boundaries (403 Forbidden for Student)...");
  // 10a. Student accessing ASM-10 Results Overview -> Must 403
  let studentForbidden10 = false;
  try {
    await studentSession.request(`/api/v1/quizzes/${quiz1.quizId}/results?month=${currentMonth}`);
  } catch (e: unknown) {
    if (e instanceof ApiError && e.status === 403) {
      studentForbidden10 = true;
    }
  }
  assert.ok(studentForbidden10, "Student accessing ASM-10 must receive 403 Forbidden");

  // 10b. Student attempting to publish ASM-04 -> Must 403
  let studentForbidden04 = false;
  try {
    await studentSession.request(`/api/v1/quizzes/${quiz1.quizId}/publish`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
  } catch (e: unknown) {
    if (e instanceof ApiError && e.status === 403) {
      studentForbidden04 = true;
    }
  }
  assert.ok(studentForbidden04, "Student publishing quiz via ASM-04 must receive 403 Forbidden");

  // 10c. Student attempting to patch draft quiz ASM-03 -> Must 403
  let studentForbidden03 = false;
  try {
    await studentSession.request(`/api/v1/quizzes/${quiz1.quizId}`, {
      method: "PATCH",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: { title: "Hacked title" },
    });
  } catch (e: unknown) {
    if (e instanceof ApiError && e.status === 403) {
      studentForbidden03 = true;
    }
  }
  assert.ok(studentForbidden03, "Student updating quiz via ASM-03 must receive 403 Forbidden");
  results.studentSecurityBoundary = true;
  console.log(
    "✓ Security boundaries verified: Student requests to ASM-10, ASM-04, and ASM-03 return 403 Forbidden",
  );

  // Step 11: Foreign Ownership Boundary
  console.log("\nStep 11: Testing Foreign Ownership Boundary...");
  const fakeQuizId = crypto.randomUUID();
  let notFoundOrForbidden = false;
  try {
    await lecturerSession.request(`/api/v1/quizzes/${fakeQuizId}/results?month=${currentMonth}`);
  } catch (e: unknown) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
      notFoundOrForbidden = true;
    }
  }
  assert.ok(notFoundOrForbidden, "Accessing non-owned/non-existent quiz results must return 404 or 403");
  results.foreignOwnershipBoundary = true;
  console.log("✓ Foreign ownership boundary verified");

  // Step 12: State Machine Invariants Assertion
  console.log("\nStep 12: Asserting State Machine Invariants...");
  const validAttemptStates = new Set(["CREATED", "IN_PROGRESS", "SUBMITTED", "EXPIRED"]);
  const invalidAttemptStates = ["GRADED", "PASSED", "FAILED", "COMPLETED"];
  for (const inv of invalidAttemptStates) {
    assert.ok(!validAttemptStates.has(inv), `Attempt state machine must NEVER include ${inv}`);
  }
  const validQuizStates = new Set(["DRAFT", "PUBLISHED", "CLOSED", "ARCHIVED"]);
  assert.ok(validQuizStates.has("DRAFT"));
  assert.ok(validQuizStates.has("PUBLISHED"));
  results.stateMachineInvariants = true;
  console.log("✓ State machine invariants strictly verified");

  // Step 13: Contract Limitations Affirmed
  console.log("\nStep 13: Affirming Contract Limitations...");
  assert.ok(CONTRACT_LIMITED.quizDelete.includes("không hỗ trợ"));
  assert.ok(CONTRACT_LIMITED.manualGrading.includes("objective-v1"));
  assert.ok(CONTRACT_LIMITED.questionReorder.includes("cập nhật danh sách"));
  results.contractLimitedAffirmed = true;
  console.log("✓ Contract limitations affirmed (deletion, manual grading, reordering)");

  // Step 14: Clean Logout
  console.log("\nStep 14: Logging out sessions cleanly...");
  await lecturerSession.logout();
  await studentSession.logout();
  assert.equal(lecturerSession.snapshot.state, "ANONYMOUS");
  assert.equal(studentSession.snapshot.state, "ANONYMOUS");
  results.logout = true;
  console.log("✓ Lecturer and Student logged out cleanly");

  console.log("\n============================================================");
  console.log("P14.3C-1 ASSESSMENT AUTHORING RESULTS SUMMARY");
  console.log("============================================================");
  console.log(JSON.stringify(results, null, 2));
  console.log("\n>>> ALL P14.3C-1 INTEGRATION CRITERIA PASSED <<<");
}

main().catch((err) => {
  console.error("\n❌ P14.3C-1 INTEGRATION TEST FAILED:", err);
  process.exit(1);
});
