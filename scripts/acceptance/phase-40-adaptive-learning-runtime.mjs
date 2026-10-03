import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const gateway = new URL(process.env.AILSS_GATEWAY_URL || "http://127.0.0.1:8080");
if (!["127.0.0.1", "localhost"].includes(gateway.hostname)) throw new Error("LOCAL_ACCEPTANCE_ONLY");
const revision = (process.argv[2] ?? "L").toUpperCase();
if (revision !== "H" && revision !== "L")
  throw new Error("USAGE: phase-40-adaptive-learning-runtime.mjs [H|L]");
const revisionSlug = revision.toLowerCase();
const idempotencyPrefix = `revision-${revisionSlug}`;
const accounts = {
  student: {
    email: "student.demo@ailss.local",
    password: process.env.AILSS_DEMO_STUDENT_PASSWORD || "AilssDemo!2026",
  },
  lecturer: {
    email: "lecturer.demo@ailss.local",
    password: process.env.AILSS_DEMO_LECTURER_PASSWORD || "AilssLecturer!2026",
  },
  admin: {
    email: "admin.demo@ailss.local",
    password: process.env.AILSS_DEMO_ADMIN_PASSWORD || "AilssAdmin!2026",
  },
};
const evidenceDirectory = `artifacts/release-evidence/revision-${revisionSlug}`;
const journalPath = `${evidenceDirectory}/seed-journal.json`;
await mkdir(evidenceDirectory, { recursive: true });
let journal = {};
try {
  journal = JSON.parse(await readFile(journalPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const sessions = {
  student: await api(undefined, "/auth/login", "POST", accounts.student),
  lecturer: await api(undefined, "/auth/login", "POST", accounts.lecturer),
  admin: await api(undefined, "/auth/login", "POST", accounts.admin),
};
const student = await api("student", "/me");
const lecturer = await api("lecturer", "/me");
const admin = await api("admin", "/me");
if (
  student.role !== "STUDENT" ||
  lecturer.role !== "LECTURER" ||
  !lecturer.lecturerVerified ||
  admin.role !== "ADMIN"
)
  throw new Error("SEEDED_ACTORS_NOT_AUTHORIZED");

let course;
try {
  const demo = JSON.parse(await readFile("tmp/web-demo/latest.json", "utf8"));
  course = demo.courses.find((item) => item.title.includes("Cassandra"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (!course) {
  // The local demo journal is disposable. Resolve the canonical course and its lessons from
  // the authenticated Learning API so a cleaned workspace can still run this acceptance.
  const ownedCourses = await api("lecturer", "/me/owned-courses");
  const canonicalCourse = ownedCourses.find(
    (item) => item.slug === "demo-cassandra" && item.state === "PUBLISHED",
  );
  if (!canonicalCourse) throw new Error("CASSANDRA_DEMO_COURSE_REQUIRED");
  const lessons = await api("lecturer", `/courses/${canonicalCourse.courseId}/lessons`);
  const materialLesson = lessons.find((item) => item.title === "Bài tập và nội dung đọc");
  if (!materialLesson) throw new Error("CASSANDRA_DEMO_MATERIAL_LESSON_REQUIRED");
  course = {
    title: canonicalCourse.title,
    courseId: canonicalCourse.courseId,
    lessonIds: [
      ...lessons.filter((item) => item.lessonId !== materialLesson.lessonId).map((item) => item.lessonId),
      materialLesson.lessonId,
    ],
  };
}

const roleBoundaryFailures = [
  await expectApiFailure("lecturer", `/mastery/courses/${course.courseId}`, 403, "STUDENT_REQUIRED"),
  await expectApiFailure("admin", `/mastery/courses/${course.courseId}`, 403, "STUDENT_REQUIRED"),
  await expectApiFailure("student", `/courses/${course.courseId}/mastery-summary`, 403, "LECTURER_REQUIRED"),
  await expectApiFailure("admin", `/courses/${course.courseId}/mastery-summary`, 403, "LECTURER_REQUIRED"),
  await expectApiFailure("student", "/study-plan/generate", 409, "MASTERY_EVIDENCE_REQUIRED", {
    courseId: randomUUID(),
    availableHoursPerWeek: 7,
  }),
];

let quizId = journal.quizId;
if (quizId) {
  try {
    const existingQuiz = await api("lecturer", `/quizzes/${quizId}`);
    if (
      existingQuiz.state !== "PUBLISHED" ||
      !existingQuiz.closesAt ||
      Date.parse(existingQuiz.closesAt) <= Date.now()
    ) {
      quizId = undefined;
    }
  } catch {
    quizId = undefined;
  }
}
if (!quizId) {
  const opensAt = new Date(Date.now() - 60_000).toISOString();
  const closesAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const quiz = await api(
    "lecturer",
    "/quizzes",
    "POST",
    {
      title: `Revision ${revision} — Cassandra authoritative assessment`,
      targetType: "COURSE",
      targetId: course.courseId,
      opensAt,
      closesAt,
      durationSeconds: 600,
      attemptLimit: 5,
      questions: [
        {
          prompt: "Cassandra partition key groups related rows.",
          questionType: "TRUE_FALSE",
          correctAnswer: true,
          points: "10",
        },
      ],
    },
    `${idempotencyPrefix}-create-${randomUUID()}`,
  );
  quizId = quiz.quizId;
  await api(
    "lecturer",
    `/quizzes/${quizId}/publish`,
    "POST",
    {},
    `${idempotencyPrefix}-publish-${randomUUID()}`,
  );
  journal = {
    quizId,
    courseId: course.courseId,
    studentId: student.userId,
    textLessonId: course.lessonIds[1],
    opensAt,
    closesAt,
  };
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
}

const scheduled = await api("student", `/targets/COURSE/${course.courseId}/quizzes`);
const scheduledQuiz = scheduled.find((item) => item.quizId === quizId);
if (!scheduledQuiz?.closesAt || Date.parse(scheduledQuiz.closesAt) <= Date.now())
  throw new Error("FUTURE_QUIZ_NOT_VISIBLE");

let mastery = await api("student", `/mastery/courses/${course.courseId}`);
let quizMasteryObserved = mastery.some((item) => item.learningOutcomeId === `quiz:${quizId}`);
let plan;
try {
  plan = await api("student", `/study-plan/current?courseId=${course.courseId}`);
} catch {
  plan = undefined;
}
if (!quizMasteryObserved) {
  const attempt = await api(
    "student",
    `/quizzes/${quizId}/attempts`,
    "POST",
    {},
    `${idempotencyPrefix}-attempt-${randomUUID()}`,
  );
  const question = attempt.questions?.[0];
  if (!question?.questionId) throw new Error("QUIZ_QUESTION_NOT_VISIBLE");
  await api(
    "student",
    `/attempts/${attempt.attemptId}/submit`,
    "POST",
    {
      answers: [{ questionId: question.questionId, value: false }],
      clientSubmittedAt: new Date().toISOString(),
    },
    `${idempotencyPrefix}-submit-${randomUUID()}`,
  );
}

for (let index = 0; index < 60; index++) {
  mastery = await api("student", `/mastery/courses/${course.courseId}`);
  quizMasteryObserved = mastery.some((item) => item.learningOutcomeId === `quiz:${quizId}`);
  try {
    plan = await api("student", `/study-plan/current?courseId=${course.courseId}`);
  } catch {
    plan = undefined;
  }
  if (quizMasteryObserved && plan?.items?.length) break;
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!quizMasteryObserved || !plan?.items?.length) throw new Error("MASTERY_STUDY_PLAN_FEEDBACK_TIMEOUT");
plan = await api("student", "/study-plan/generate", "POST", {
  courseId: course.courseId,
  availableHoursPerWeek: 7,
});
const assessmentItem = plan.items.find(
  (item) => item.sourceType === "ASSESSMENT" && item.sourceId === quizId,
);
const requirementItem = plan.items.find(
  (item) => item.sourceType === "COURSE_REQUIREMENT" && item.lessonId === course.lessonIds[1],
);
if (!assessmentItem?.dueAt || !assessmentItem.sourceVersion || !requirementItem?.sourceVersion)
  throw new Error("AUTHORITATIVE_PLAN_INPUTS_MISSING");

const chat = await retry(
  () =>
    api("student", "/assistant/chat", "POST", {
      mode: "STUDY_BUDDY",
      courseId: course.courseId,
      message:
        "Giải thích phần tài liệu về khóa phân vùng Cassandra và cho biết mastery, kế hoạch học gì tiếp",
    }),
  3,
);
const materialTool = chat.toolInvocations?.find((item) => item.name === "search_course_materials");
const citation = chat.citations?.find(
  (item) => item.courseId === course.courseId && item.lessonId === course.lessonIds[1],
);
if (
  !materialTool ||
  !citation?.courseVersion ||
  !citation.lessonVersion ||
  !citation.sourceObjectId ||
  !citation.retrievalScore
)
  throw new Error("GROUNDED_CITATION_NOT_RETURNED");

const evidence = {
  generatedAt: new Date().toISOString(),
  source: "real-local-runtime",
  actors: { studentId: student.userId, lecturerId: lecturer.userId },
  course: { courseId: course.courseId, textLessonId: course.lessonIds[1], quizId },
  assertions: {
    activeEntitlement: true,
    futurePublishedAssessment: true,
    masteryEvidenceObserved: quizMasteryObserved,
    durableStudyPlanObserved: true,
    courseRequirementObserved: true,
    assessmentScheduleObserved: true,
    materialToolInvoked: true,
    groundedCitationObserved: true,
    studentTeacherAdminRoleBoundariesObserved: roleBoundaryFailures.slice(0, 4).every(Boolean),
    missingMasteryRejected: roleBoundaryFailures[4] === true,
  },
  provenance: {
    requirement: {
      sourceType: requirementItem.sourceType,
      sourceId: requirementItem.sourceId,
      sourceVersion: requirementItem.sourceVersion,
      lessonId: requirementItem.lessonId,
      learningOutcomeId: requirementItem.learningOutcomeId,
    },
    assessment: {
      sourceType: assessmentItem.sourceType,
      sourceId: assessmentItem.sourceId,
      sourceVersion: assessmentItem.sourceVersion,
      dueAt: assessmentItem.dueAt,
      learningOutcomeId: assessmentItem.learningOutcomeId,
      rationale: assessmentItem.rationale,
    },
    citation,
  },
};
await writeFile(`${evidenceDirectory}/positive-runtime.json`, `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(evidence.assertions)}\n`);

async function retry(operation, attempts) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
    }
  }
  throw lastError;
}

async function api(role, path, method = "GET", body, key) {
  const response = await fetch(new URL(`/api/v1${path}`, gateway), {
    method,
    headers: {
      accept: "application/json",
      ...(role ? { authorization: `Bearer ${sessions[role].accessToken}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(key ? { "idempotency-key": key } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(path === "/assistant/chat" ? 60_000 : 30_000),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(`${method} ${path}: ${response.status} ${value.error?.code ?? "UNKNOWN"}`);
  return value.data;
}

async function expectApiFailure(role, path, expectedStatus, expectedCode, body) {
  const response = await fetch(new URL(`/api/v1${path}`, gateway), {
    method: body ? "POST" : "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${sessions[role].accessToken}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  const value = await response.json();
  if (response.status !== expectedStatus || value.error?.code !== expectedCode)
    throw new Error(
      `${role} ${path}: expected ${expectedStatus} ${expectedCode}, got ${response.status} ${value.error?.code ?? "UNKNOWN"}`,
    );
  return true;
}
