/** Local development fixtures using the same authoring/commerce APIs as the website. */
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
const origin = new URL(process.env.AILSS_GATEWAY_URL || "http://127.0.0.1:8080");
if (
  !["127.0.0.1", "localhost"].includes(origin.hostname) ||
  origin.protocol !== "http:" ||
  (process.env.AILSS_PROFILE || "dev-async") !== "dev-async"
)
  throw Error("Demo seeding is available only on a local dev-async environment.");
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
  if (method !== "GET") await new Promise((r) => setTimeout(r, 1100));
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
  if (response.status === 429) {
    await new Promise((r) => setTimeout(r, 15000));
    return api(role, path, method, body, key);
  }
  if (!response.ok) throw Error(`${method} ${path}: ${response.status} ${value.error?.code || "UNKNOWN"}`);
  return value.data;
}
for (const [role, account] of Object.entries(accounts))
  sessions[role] = await api(role, "/auth/login", "POST", account);
const lecturer = await api("lecturer", "/me");
if (lecturer.role !== "LECTURER" || !lecturer.lecturerVerified)
  throw Error("Verify the demo lecturer in the administrator workspace before seeding.");
const directory = new URL("../../tmp/social-demo/", import.meta.url);
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

const courses = JSON.parse(
  await readFile(new URL("../../tmp/web-demo/latest.json", import.meta.url), "utf8"),
).courses;
const bodies = [
  "[Dữ liệu mẫu] Bài thực hành rõ ràng, tôi đã tự dựng được trang web đầu tiên. Mong có thêm phần bố cục trên điện thoại.",
  "[Dữ liệu mẫu] Ví dụ xử lý dữ liệu dễ làm theo. Bài tập giúp tôi hiểu rõ hơn cách dùng hàm.",
  "[Dữ liệu mẫu] Ví dụ SQL gắn với lớp học khá dễ hiểu, phần truy vấn có thể luyện lại nhiều lần.",
  "[Dữ liệu mẫu] Nội dung Cassandra cần học chậm nhưng các bước thực hành có ích.",
  "[Dữ liệu mẫu] Tôi thích phần kiểm chứng câu trả lời của AI trước khi sử dụng.",
  "[Dữ liệu mẫu] Bài học ngắn và có bài tập giúp tôi duy trì việc ôn tập.",
];
for (const [i, c] of courses.entries()) {
  await api(
    "student",
    `/lessons/${c.lessonIds[0]}/completion`,
    "PUT",
    { completed: true },
    "social-complete-" + c.lessonIds[0],
  );
  await command("review:" + c.courseId, "student", `/courses/${c.courseId}/reviews`, {
    rating: i % 3 === 0 ? 4 : 5,
    body: bodies[i],
  });
  await command("comment:" + c.courseId, "student", `/resources/COURSE/${c.courseId}/comments`, {
    body: "[Dữ liệu mẫu] Có thể trao đổi bài tập ngay tại đây. Tôi muốn thảo luận cách áp dụng nội dung vào dự án thực tế.",
  });
  console.log("Đã thêm đánh giá và bình luận: " + c.title);
}
const c = courses[1];
const group = await command("live:class", "lecturer", "/classes", {
  name: "JavaScript trực tuyến — nhóm khai giảng tháng 9",
  classKind: "LIVE_COHORT",
  linkedCourseId: c.courseId,
  maxMembers: 30,
});
const start = new Date(Date.parse(journal.createdAt) + 7 * 86400000);
start.setUTCHours(12, 0, 0, 0);
await command("live:session", "lecturer", `/classes/${group.classId}/sessions`, {
  title: "Thực hành tương tác JavaScript cùng giảng viên",
  startAt: start.toISOString(),
  endAt: new Date(+start + 90 * 60000).toISOString(),
  timezone: "Asia/Ho_Chi_Minh",
  mode: "ONLINE",
  meetingProvider: "Google Meet (lớp mẫu)",
  meetingUrl: "https://meet.google.com/ail-ssde-moo",
});
await command("live:schedule", "lecturer", `/classes/${group.classId}/schedule/publish`);
const offer = await command("live:offering", "lecturer", `/courses/${c.courseId}/offerings`, {
  offeringType: "LIVE_COHORT",
  classId: group.classId,
  title: "JavaScript cùng giảng viên — lớp mẫu 30 học viên",
  price: "499000",
  currency: "VND",
});
await command("live:publish", "lecturer", `/offerings/${offer.offeringId}/publish`);
console.log("Đã mở đợt học trực tuyến có lịch.");
