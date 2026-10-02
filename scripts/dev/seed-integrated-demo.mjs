/** Local demo records, persisted through the normal authenticated application APIs. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { demoAnswers, pythonQuiz } from "./linked-demo-plan.mjs";

const origin = new URL(process.env.AILSS_GATEWAY_URL || "http://127.0.0.1:8080");
if (
  !["localhost", "127.0.0.1"].includes(origin.hostname) ||
  origin.protocol !== "http:" ||
  (process.env.AILSS_PROFILE || "dev-async") !== "dev-async"
)
  throw Error("Only local dev-async is allowed");
const verify = process.argv.includes("--verify");
if (process.argv.slice(2).some((arg) => arg !== "--verify"))
  throw Error("Usage: seed-integrated-demo.mjs [--verify]");
const accounts = {
  student: ["student.demo@ailss.local", process.env.AILSS_DEMO_STUDENT_PASSWORD || "AilssDemo!2026"],
  nam: ["nam.hoang.student@ailss.local", process.env.AILSS_DEMO_AUX_STUDENT_PASSWORD || "StudentPass!2026"],
  lecturer: ["lecturer.demo@ailss.local", process.env.AILSS_DEMO_LECTURER_PASSWORD || "AilssLecturer!2026"],
  python: [
    "an.python.demo@ailss.local",
    process.env.AILSS_DEMO_SECOND_LECTURER_PASSWORD || "AilssLecturer!2026",
  ],
  admin: ["admin.demo@ailss.local", process.env.AILSS_DEMO_ADMIN_PASSWORD || "AilssAdmin!2026"],
};
const actors = {};
async function api(role, path, method = "GET", body, key, includeMeta = false) {
  for (let retry = 0; retry < 5; retry++) {
    const response = await fetch(new URL("/api/v1" + path, origin), {
      method,
      headers: {
        accept: "application/json",
        ...(actors[role]?.token ? { authorization: "Bearer " + actors[role].token } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(method !== "GET" ? { "idempotency-key": key || randomUUID() } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
    if (response.status === 429 && retry < 4) {
      await delay(Math.max(1500, Math.min(10000, Number(response.headers.get("retry-after") || 2) * 1000)));
      continue;
    }
    const value = await response.json();
    if (!response.ok) throw Error(`${method} ${path}: ${response.status} ${value.error?.code}`);
    return includeMeta ? value : value.data;
  }
}
const list = (value) => {
  const items = Array.isArray(value) ? value : (value?.items ?? value?.classes ?? value?.lessons);
  if (!Array.isArray(items)) throw Error("Invalid list");
  return items;
};
for (const [role, [email, password]] of Object.entries(accounts)) {
  actors[role] = { token: (await api(role, "/auth/login", "POST", { email, password })).accessToken };
  actors[role].me = await api(role, "/me");
  assert.equal(
    actors[role].me.role,
    ["lecturer", "python"].includes(role) ? "LECTURER" : role === "admin" ? "ADMIN" : "STUDENT",
  );
}
const directory = new URL("../../tmp/integrated-demo/", import.meta.url);
await mkdir(directory, { recursive: true });
const file = new URL(actors.student.me.userId + ".json", directory);
let journal;
try {
  journal = JSON.parse(await readFile(file, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  if (verify) throw Error("Seed fixtures before verification");
  journal = {
    actors: Object.fromEntries(Object.entries(actors).map(([role, value]) => [role, value.me.userId])),
    createdAt: new Date().toISOString(),
    commands: {},
    results: [],
  };
}
assert.deepEqual(
  journal.actors,
  Object.fromEntries(Object.entries(actors).map(([role, value]) => [role, value.me.userId])),
);
async function save() {
  const temp = new URL(actors.student.me.userId + ".tmp", directory);
  await writeFile(temp, JSON.stringify(journal, null, 2));
  await rename(temp, file);
}
async function command(label, role, path, body = {}, method = "POST") {
  const existing = journal.commands[label];
  if (existing?.done) return existing.data;
  if (verify) throw Error("Missing demo step: " + label);
  const record = existing ?? { key: "integrated-demo-" + randomUUID(), path, method };
  assert.equal(record.path, path);
  journal.commands[label] = record;
  await save();
  await delay(300);
  const data = await api(role, path, method, body, record.key);
  // Identifiers only: no credentials, join codes, signed URLs or mail codes.
  record.data = Object.fromEntries(
    ["quizId", "attemptId", "commentId", "reviewId", "reportId", "orderId"]
      .filter((key) => data?.[key])
      .map((key) => [key, data[key]]),
  );
  record.done = true;
  await save();
  return data;
}

const webQuestions = [
  {
    prompt: "Thẻ nào chứa phần nội dung chính của trang?",
    questionType: "SINGLE_CHOICE",
    options: ["main", "meta", "head"],
    correctAnswer: "main",
    points: "2.5",
  },
  {
    prompt: "Flexbox giúp sắp xếp các phần tử trong một hàng hoặc cột.",
    questionType: "TRUE_FALSE",
    correctAnswer: true,
    points: "2.5",
  },
  {
    prompt: "Thuộc tính nào thay đổi màu chữ?",
    questionType: "SINGLE_CHOICE",
    options: ["color", "margin", "width"],
    correctAnswer: "color",
    points: "2.5",
  },
  {
    prompt: "Nút có nhãn rõ ràng giúp người dùng hiểu thao tác.",
    questionType: "TRUE_FALSE",
    correctAnswer: true,
    points: "2.5",
  },
];
const cassandraQuestions = [
  {
    prompt: "Partition key quyết định nút lưu dữ liệu trong Cassandra.",
    questionType: "TRUE_FALSE",
    correctAnswer: true,
    points: "2.5",
  },
  {
    prompt: "Truy vấn nào phù hợp với bảng phân vùng theo class_id?",
    questionType: "SINGLE_CHOICE",
    options: ["WHERE class_id = ?", "Quét toàn bộ bảng", "JOIN ba bảng"],
    correctAnswer: "WHERE class_id = ?",
    points: "2.5",
  },
  {
    prompt: "Replication factor là số bản sao dữ liệu.",
    questionType: "TRUE_FALSE",
    correctAnswer: true,
    points: "2.5",
  },
  {
    prompt: "Clustering column dùng để làm gì?",
    questionType: "SINGLE_CHOICE",
    options: ["Sắp xếp dữ liệu trong phân vùng", "Lưu mật khẩu", "Chọn địa chỉ email"],
    correctAnswer: "Sắp xếp dữ liệu trong phân vùng",
    points: "2.5",
  },
];
const plans = [
  {
    owner: "lecturer",
    slug: "demo-web-html-css",
    topics: ["HTML ngữ nghĩa", "CSS và bố cục", "Thiết kế dễ sử dụng"],
    questions: webQuestions,
  },
  {
    owner: "lecturer",
    slug: "demo-cassandra",
    topics: ["Khóa phân vùng", "Nhân bản dữ liệu", "Thiết kế truy vấn"],
    questions: cassandraQuestions,
  },
  {
    owner: "python",
    slug: "instructor-demo-1",
    topics: ["Biến và kiểu dữ liệu", "Danh sách", "Vòng lặp", "Hàm", "Ôn tập Python"],
    questions: pythonQuiz.questions,
  },
];
let submissionCount = 0;
for (const plan of plans) {
  const matches = list(await api(plan.owner, "/me/owned-courses")).filter(
    (course) => course.slug === plan.slug && course.state === "PUBLISHED",
  );
  assert.equal(matches.length, 1, "Expected published demo course " + plan.slug);
  const course = matches[0];
  assert.equal(course.priceType, "FREE");
  assert.equal(Number(course.price), 0);
  for (const role of ["student", "nam"]) {
    if (
      !list(await api(role, "/me/courses")).some(
        (item) => item.courseId === course.courseId && item.state === "ACTIVE",
      )
    )
      await command(`${plan.slug}:${role}:enroll`, role, `/courses/${course.courseId}/enrollments`);
    assert.ok(list(await api(role, "/me/courses")).some((item) => item.courseId === course.courseId));
  }
  const lessons = list(await api(plan.owner, `/courses/${course.courseId}/lessons`)).filter(
    (item) => item.state === "READY",
  );
  for (const [index, lesson] of lessons.entries()) {
    for (const role of ["student", "nam"]) {
      // Demo completion is an explicit seeded action. It is not a generated score.
      if (role === "nam" && index > 0) continue;
      await command(
        `${plan.slug}:${role}:${lesson.lessonId}:complete`,
        role,
        `/lessons/${lesson.lessonId}/completion`,
        { completed: true },
        "PUT",
      );
    }
  }
  const existingQuizzes = list(await api(plan.owner, `/targets/COURSE/${course.courseId}/quizzes`));
  for (const [index, topic] of plan.topics.entries()) {
    const title = `[Demo] ${topic}`;
    const matches = existingQuizzes.filter((item) => item.title === title);
    assert.ok(matches.length <= 1, "Duplicate demo quiz");
    let quiz = matches[0];
    if (!quiz)
      quiz = await command(`${plan.slug}:${index}:quiz`, plan.owner, "/quizzes", {
        title,
        targetType: "COURSE",
        targetId: course.courseId,
        questions: plan.questions,
        durationSeconds: 900,
        attemptLimit: 3,
      });
    let detail = await api(plan.owner, `/quizzes/${quiz.quizId}`);
    if (detail.state === "DRAFT") {
      await command(`${plan.slug}:${index}:publish`, plan.owner, `/quizzes/${quiz.quizId}/publish`);
      detail = await api(plan.owner, `/quizzes/${quiz.quizId}`);
    }
    assert.equal(detail.ownerId, actors[plan.owner].me.userId);
    assert.equal(detail.targetId, course.courseId);
    for (const [studentIndex, role] of ["student", "nam"].entries()) {
      const label = `${plan.slug}:${index}:${role}`;
      let result;
      if (journal.commands[label + ":submit"]?.done)
        result = await api(role, `/attempts/${journal.commands[label + ":start"].data.attemptId}/result`);
      else {
        const attempt = await command(label + ":start", role, `/quizzes/${quiz.quizId}/attempts`);
        const answers = demoAnswers(detail.questions).map((answer, questionIndex) => {
          const wrongCount = (index + studentIndex) % 4;
          if (questionIndex >= wrongCount) return answer;
          const question = detail.questions[questionIndex];
          return question.questionType === "TRUE_FALSE"
            ? { questionId: question.questionId, value: !question.correctAnswer }
            : {
                questionId: question.questionId,
                selectedOptionId: question.options.find((option) => option !== question.correctAnswer),
              };
        });
        await command(label + ":submit", role, `/attempts/${attempt.attemptId}/submit`, {
          answers,
          clientSubmittedAt: new Date().toISOString(),
        });
        result = await api(role, `/attempts/${attempt.attemptId}/result`);
      }
      const month = result.submittedAt.slice(0, 7);
      const rows = list(await api(plan.owner, `/quizzes/${quiz.quizId}/results?month=${month}&limit=100`));
      const row = rows.find((item) => item.attemptId === result.attemptId);
      assert.ok(row);
      assert.equal(row.studentId, actors[role].me.userId);
      assert.equal(row.score, result.score);
      assert.equal(row.maxScore, result.maxScore);
      if (!row.teacherFeedback)
        await command(label + ":feedback", plan.owner, `/quizzes/${quiz.quizId}/grades/${result.attemptId}`, {
          score: row.score,
          expectedResultVersion: row.resultVersion,
          feedback: `[Demo] Backend chấm ${row.score}/${row.maxScore}. Xem lại nội dung ${topic.toLowerCase()} và các câu trả lời chưa đúng.`,
        });
      journal.results = journal.results.filter((item) => item.label !== label);
      journal.results.push({
        label,
        studentId: actors[role].me.userId,
        courseId: course.courseId,
        quizId: quiz.quizId,
        attemptId: result.attemptId,
        score: result.score,
        maxScore: result.maxScore,
      });
      submissionCount++;
    }
  }
  for (let retry = 0; retry < 30; retry++) {
    const summary = await api(plan.owner, `/courses/${course.courseId}/mastery-summary`);
    const expected = journal.results
      .filter((item) => item.courseId === course.courseId)
      .map((item) => "quiz:" + item.quizId);
    if (
      expected.every((id) =>
        summary.records.some((record) => record.conceptId === id && record.evidenceCount > 0),
      )
    )
      break;
    if (retry === 29) throw Error("Mastery consumer has not processed demo submissions");
    await delay(1000);
  }
  const members = list(await api(plan.owner, `/courses/${course.courseId}/roster`));
  for (const role of ["student", "nam"])
    assert.ok(members.some((item) => item.studentId === actors[role].me.userId && item.state === "ACTIVE"));
}

const web = list(await api("lecturer", "/me/owned-courses")).find(
  (item) => item.slug === "demo-web-html-css",
);
await command("web:student:comment", "student", `/resources/COURSE/${web.courseId}/comments`, {
  body: "[Demo] Em đã làm bài HTML và CSS. Thầy hướng dẫn cách chọn thẻ ngữ nghĩa cho phần nội dung chính được không?",
});
await command("web:lecturer:comment", "lecturer", `/resources/COURSE/${web.courseId}/comments`, {
  body: "[Demo] Em xem lại bài HTML ngữ nghĩa: main chứa nội dung chính, còn header và nav có vai trò riêng. Kết quả bài kiểm tra đã có phản hồi của giảng viên.",
});
const existingReview = list(await api("student", `/courses/${web.courseId}/reviews?limit=100`)).find(
  (item) => item.authorId === actors.student.me.userId,
);
if (existingReview && !journal.commands["web:student:review"]?.done) {
  journal.commands["web:student:review"] = { done: true, data: { reviewId: existingReview.reviewId } };
  if (!verify) await save();
}
await command("web:student:review", "student", `/courses/${web.courseId}/reviews`, {
  rating: 4,
  body: "[Demo] Đã học hai bài và làm các bài kiểm tra HTML/CSS. Học liệu rõ ràng; cần luyện thêm phần bố cục.",
});
const comments = list(await api("student", `/resources/COURSE/${web.courseId}/comments?limit=50`));
assert.ok(comments.some((item) => item.commentId === journal.commands["web:student:comment"].data.commentId));
await command("web:moderation:report", "nam", "/reports", {
  targetType: "COMMENT",
  targetId: journal.commands["web:student:comment"].data.commentId,
  reason:
    "[Demo] Phiếu thực hành kiểm duyệt; nội dung học tập hợp lệ, quản trị viên có thể chọn bỏ qua báo cáo.",
});
const reports = [];
let cursor;
const cursors = new Set();
do {
  const page = await api(
    "admin",
    "/admin/reports?" + new URLSearchParams({ limit: "100", ...(cursor ? { cursor } : {}) }),
    "GET",
    undefined,
    undefined,
    true,
  );
  reports.push(...list(page.data));
  cursor = page.meta?.page?.nextCursor;
  if (cursor) {
    assert.ok(!cursors.has(cursor));
    cursors.add(cursor);
    assert.ok(cursors.size < 100);
  }
} while (cursor);
assert.ok(reports.some((item) => item.reportId === journal.commands["web:moderation:report"].data.reportId));
const monitor = await api("admin", "/admin/monitoring");
assert.equal(monitor.prometheus.available, true);
assert.equal(monitor.grafana.available, true);
if (!verify) await save();
console.log(
  JSON.stringify({
    verified: true,
    courses: plans.length,
    lecturers: 2,
    students: 2,
    submittedResults: submissionCount,
    monitoringConnected: true,
  }),
);
