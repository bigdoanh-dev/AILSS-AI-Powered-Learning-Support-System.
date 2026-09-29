import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const gateway = new URL(process.env.AILSS_GATEWAY_URL || "http://127.0.0.1:8080");
if (!["127.0.0.1", "localhost"].includes(gateway.hostname)) throw new Error("LOCAL_ACCEPTANCE_ONLY");
const accounts = {
  student: {
    email: "student.demo@ailss.local",
    password: process.env.AILSS_DEMO_STUDENT_PASSWORD || "AilssDemo!2026",
  },
  lecturer: {
    email: "lecturer.demo@ailss.local",
    password: process.env.AILSS_DEMO_LECTURER_PASSWORD || "AilssLecturer!2026",
  },
};
const demo = JSON.parse(await readFile("tmp/web-demo/latest.json", "utf8"));
const course = demo.courses.find((item) => item.title.includes("Cassandra"));
if (!course) throw new Error("CASSANDRA_DEMO_COURSE_REQUIRED");
const evidenceDirectory = "artifacts/release-evidence/revision-l";
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
};
const student = await api("student", "/me");
const lecturer = await api("lecturer", "/me");
if (student.role !== "STUDENT" || lecturer.role !== "LECTURER" || !lecturer.lecturerVerified)
  throw new Error("SEEDED_ACTORS_NOT_AUTHORIZED");

let quizId = journal.quizId;
if (quizId) {
  try {
    await api("lecturer", `/quizzes/${quizId}`);
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
      title: "Revision L — Cassandra authoritative assessment",
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
    `revision-l-create-${randomUUID()}`,
  );
  quizId = quiz.quizId;
  await api("lecturer", `/quizzes/${quizId}/publish`, "POST", {}, `revision-l-publish-${randomUUID()}`);
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
let plan;
try {
  plan = await api("student", `/study-plan/current?courseId=${course.courseId}`);
} catch {
  plan = undefined;
}
if (!mastery.length || !plan?.items?.length) {
  const attempt = await api(
    "student",
    `/quizzes/${quizId}/attempts`,
    "POST",
    {},
    `revision-l-attempt-${randomUUID()}`,
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
    `revision-l-submit-${randomUUID()}`,
  );
}

for (let index = 0; index < 60; index++) {
  mastery = await api("student", `/mastery/courses/${course.courseId}`);
  try {
    plan = await api("student", `/study-plan/current?courseId=${course.courseId}`);
  } catch {
    plan = undefined;
  }
  if (mastery.length && plan?.items?.length) break;
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!mastery?.length || !plan?.items?.length) throw new Error("MASTERY_STUDY_PLAN_FEEDBACK_TIMEOUT");
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
    masteryEvidenceObserved: true,
    durableStudyPlanObserved: true,
    courseRequirementObserved: true,
    assessmentScheduleObserved: true,
    materialToolInvoked: true,
    groundedCitationObserved: true,
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
