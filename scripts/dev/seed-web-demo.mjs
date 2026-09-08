/** Local development fixtures using the same authoring/commerce APIs as the website. */
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { Client } from "minio";
import { readEnv, required } from "./env.mjs";
const origin = new URL(process.env.AILSS_GATEWAY_URL || "http://127.0.0.1:8080");
if (
  !["127.0.0.1", "localhost"].includes(origin.hostname) ||
  origin.protocol !== "http:" ||
  (process.env.AILSS_PROFILE || "dev-async") !== "dev-async"
)
  throw Error("Demo seeding is available only on a local dev-async environment.");
const env = await readEnv();
if (!["127.0.0.1", "localhost"].includes(env.OBJECT_STORAGE_ENDPOINT || "127.0.0.1"))
  throw Error("Demo storage must be local.");
const storage = new Client({
  endPoint: env.OBJECT_STORAGE_ENDPOINT || "127.0.0.1",
  port: Number(env.OBJECT_STORAGE_PORT || 9000),
  useSSL: env.OBJECT_STORAGE_USE_SSL === "true",
  accessKey: required(env, "OBJECT_STORAGE_ACCESS_KEY"),
  secretKey: required(env, "OBJECT_STORAGE_SECRET_KEY"),
});
const bucket = env.OBJECT_STORAGE_BUCKET || "ailss-documents";
const source = new URL("./demo/", import.meta.url);
const courses = JSON.parse(await readFile(new URL("courses.json", source), "utf8"));
// Require all assets before making any database changes.
for (const course of courses)
  for (const ext of ["pdf", "txt"]) await readFile(new URL(`assets/${course.slug}.${ext}`, source));
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
const sessions = {};
async function api(role, path, method = "GET", body, key) {
  const response = await fetch(new URL("/api/v1" + path, origin), {
    method,
    headers: {
      accept: "application/json",
      ...(sessions[role] ? { authorization: "Bearer " + sessions[role].accessToken } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(key ? { "idempotency-key": key } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const value = await response.json();
  if (!response.ok) throw Error(`${method} ${path}: ${response.status} ${value.error?.code || "UNKNOWN"}`);
  return value.data;
}
for (const [role, account] of Object.entries(accounts))
  sessions[role] = await api(role, "/auth/login", "POST", account);
const lecturer = await api("lecturer", "/me");
if (lecturer.role !== "LECTURER" || !lecturer.lecturerVerified)
  throw Error("Verify the demo lecturer in the administrator workspace before seeding.");
const directory = new URL("../../tmp/web-demo/", import.meta.url);
await mkdir(directory, { recursive: true });
const journalFile = new URL(lecturer.userId + ".json", directory);
let journal = { commands: {}, createdAt: new Date().toISOString() };
try {
  journal = JSON.parse(await readFile(journalFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
async function save() {
  const temp = new URL(lecturer.userId + ".tmp", directory);
  await writeFile(temp, JSON.stringify(journal, null, 2));
  await rename(temp, journalFile);
}
async function command(label, role, path, body = {}) {
  let record = journal.commands[label];
  if (record?.done) return record.data;
  if (!record) {
    record = { key: "demo-" + randomUUID(), body };
    journal.commands[label] = record;
    await save();
  }
  const result = await api(role, path, "POST", record.body, record.key);
  // Never persist passwords, credentials or signed storage links in the journal.
  record.done = true;
  record.data = result;
  delete record.body;
  await save();
  return result;
}
const result = [];
for (const item of courses) {
  const course = await command(item.slug + ":course", "lecturer", "/courses", {
    title: item.title,
    slug: item.slug,
    categoryId: `10000000-0000-4000-8000-${String(item.category).padStart(12, "0")}`,
    priceType: item.category === 1 && item.slug.endsWith("javascript") ? "PAID" : "FREE",
    price: item.category === 1 && item.slug.endsWith("javascript") ? "299000" : "0",
    currency: "VND",
  });
  const lessonIds = [];
  for (const [index, ext] of ["pdf", "txt"].entries()) {
    const contentType = { pdf: "application/pdf", webm: "video/webm", txt: "text/plain" }[ext];
    const bytes = await readFile(new URL(`assets/${item.slug}.${ext}`, source));
    const digest = createHash("sha256").update(bytes).digest("hex");
    const objectKey = `learning/lessons/demo/${course.courseId}/${ext}-${digest.slice(0, 16)}`;
    await storage.putObject(bucket, objectKey, bytes, bytes.length, {
      "Content-Type": contentType,
      "x-amz-meta-sha256": digest,
    });
    const lesson = await command(
      item.slug + ":lesson:" + ext,
      "lecturer",
      `/courses/${course.courseId}/lessons`,
      {
        title: {
          pdf: "Bài giảng và hướng dẫn thực hành",
          webm: "Video tóm tắt kiến thức",
          txt: "Bài tập và nội dung đọc",
        }[ext],
        sectionTitle: "Bắt đầu và thực hành",
        position: { sectionOrder: 1, lessonOrder: index + 1 },
        preview: index === 0,
        contentRef: { objectKey, size: bytes.length, contentType, sha256: digest },
      },
    );
    lessonIds.push(lesson.lessonId);
  }
  await command(item.slug + ":review", "lecturer", `/courses/${course.courseId}/submit-review`);
  // Reauthentication is sent only at execution time, never stored in the journal.
  const pubKey = item.slug + ":publish";
  if (!journal.commands[pubKey]?.done) {
    await api(
      "admin",
      `/admin/courses/${course.courseId}/publish`,
      "POST",
      { currentPassword: accounts.admin.password },
      pubKey + "-" + course.courseId,
    );
    journal.commands[pubKey] = { done: true };
    await save();
  }
  const offering = await command(
    item.slug + ":offering",
    "lecturer",
    `/courses/${course.courseId}/offerings`,
    {
      offeringType: "SELF_PACED",
      title: "Học liệu thực hành: " + item.title,
      price: course.price || "0",
      currency: "VND",
    },
  );
  await command(item.slug + ":offering-publish", "lecturer", `/offerings/${offering.offeringId}/publish`);
  const order = await command(item.slug + ":order", "student", "/orders", {
    offeringId: offering.offeringId,
  });
  await command(item.slug + ":payment", "student", `/orders/${order.orderId}/simulate-payment`, {
    outcome: "SUCCESS",
  });
  let state;
  for (let attempt = 0; attempt < 60; attempt++) {
    state = await api("student", `/orders/${order.orderId}`);
    if (state.state === "ENTITLED") break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (state.state !== "ENTITLED")
    throw Error(`Demo enrollment has not completed: ${state.state}. Check the learning worker and rerun.`);
  const quiz = await command(item.slug + ":quiz", "lecturer", "/quizzes", {
    title: "Ôn tập: " + item.title,
    targetType: "COURSE",
    targetId: course.courseId,
    durationSeconds: 600,
    attemptLimit: 5,
    questions: [
      {
        prompt: item.question,
        questionType: "SINGLE_CHOICE",
        options: item.options,
        correctAnswer: item.answer,
        points: "5",
      },
      {
        prompt: "Cần thực hành và kiểm chứng kết quả để đánh giá mức độ hiểu bài.",
        questionType: "TRUE_FALSE",
        correctAnswer: true,
        points: "5",
      },
    ],
  });
  await command(item.slug + ":quiz-publish", "lecturer", `/quizzes/${quiz.quizId}/publish`);
  if (result.length < 2) {
    const group = await command(item.slug + ":class", "lecturer", "/classes", {
      name: "Nhóm thực hành " + (item.category === 1 ? "web" : "dữ liệu") + " " + (result.length + 1),
      classKind: "PRIVATE",
      linkedCourseId: course.courseId,
      maxMembers: 30,
    });
    // Schedule is fixed in the journal so reruns reuse the original request.
    const start = new Date(Date.parse(journal.createdAt) + (result.length + 2) * 86400000);
    start.setUTCHours(7, 0, 0, 0);
    await command(item.slug + ":session", "lecturer", `/classes/${group.classId}/sessions`, {
      title: "Thực hành và giải đáp",
      startAt: start.toISOString(),
      endAt: new Date(+start + 3600000).toISOString(),
      timezone: "Asia/Ho_Chi_Minh",
      mode: "OFFLINE",
      location: "Phòng học minh họa AILSS",
    });
    await command(item.slug + ":schedule", "lecturer", `/classes/${group.classId}/schedule/publish`);
    await command(item.slug + ":join", "student", "/classes/join", { code: group.joinCode });
    await command(item.slug + ":announcement", "lecturer", `/classes/${group.classId}/announcements`, {
      title: "Chuẩn bị cho buổi thực hành",
      body: "Đọc tài liệu bài giảng, xem video tóm tắt và chuẩn bị câu hỏi trước buổi học. Đây là lớp minh họa để trải nghiệm AILSS.",
    });
  }
  result.push({ title: item.title, courseId: course.courseId, lessonIds, quizId: quiz.quizId });
  console.log("Đã chuẩn bị: " + item.title);
}
await writeFile(new URL("latest.json", directory), JSON.stringify({ courses: result }, null, 2));
console.log(
  "Hoàn tất 6 khóa học, 12 bài học, 6 bài kiểm tra và 2 lớp thực hành. Đăng nhập bằng tài khoản demo để xem.",
);
