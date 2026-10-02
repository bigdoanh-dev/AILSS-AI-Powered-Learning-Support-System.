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
const directory = new URL("../../tmp/instructor-demo/", import.meta.url);
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

const media = {};
for (const [i, item] of [
  {
    email: "linh.english.demo@ailss.local",
    name: "Mai Linh (giảng viên mẫu)",
    title: "Python: tư duy lập trình và luyện tập",
    category: 1,
    video: "https://www.youtube-nocookie.com/embed/rfscVS0vtbw",
  },
  {
    email: "an.python.demo@ailss.local",
    name: "Minh An (giảng viên mẫu)",
    title: "Python thực hành cho người mới bắt đầu",
    category: 1,
    video: "https://www.youtube-nocookie.com/embed/rfscVS0vtbw",
  },
].entries()) {
  const role = "teacher" + i,
    password = "AilssLecturer!2026";
  try {
    await api(
      role,
      "/auth/register",
      "POST",
      { email: item.email, password, displayName: item.name, role: "LECTURER" },
      "demo-register-" + i,
    );
  } catch (e) {
    if (!e.message.includes("409")) throw e;
  }
  sessions[role] = await api(role, "/auth/login", "POST", { email: item.email, password });
  let p = await api(role, "/me");
  if (!p.lecturerVerified)
    await api(
      "admin",
      `/admin/lecturers/${p.userId}/verify`,
      "POST",
      { currentPassword: accounts.admin.password },
      "verify-demo-" + p.userId,
    );
  const c = await command(role + ":course", role, "/courses", {
    title: item.title,
    slug: "instructor-demo-" + i,
    categoryId: `10000000-0000-4000-8000-${String(item.category).padStart(12, "0")}`,
    priceType: i === 0 ? "PAID" : "FREE",
    price: i === 0 ? "199000" : "0",
    currency: "VND",
  });
  const l = await command(role + ":lesson", role, `/courses/${c.courseId}/lessons`, {
    title: "Bài giảng nhập môn",
    sectionTitle: "Bắt đầu",
    position: { sectionOrder: 1, lessonOrder: 1 },
    preview: false,
  });
  media[l.lessonId] = { courseId: c.courseId, externalVideo: item.video };
  await command(role + ":submit", role, `/courses/${c.courseId}/submit-review`);
  if (!journal.commands[role + ":published"]?.done) {
    await api(
      "admin",
      `/admin/courses/${c.courseId}/publish`,
      "POST",
      { currentPassword: accounts.admin.password },
      "publish-" + c.courseId,
    );
    journal.commands[role + ":published"] = { done: true };
    await save();
  }
  const o = await command(role + ":offering", role, `/courses/${c.courseId}/offerings`, {
    offeringType: "SELF_PACED",
    title: item.title,
    price: i === 0 ? "199000" : "0",
    currency: "VND",
  });
  await command(role + ":offer-publish", role, `/offerings/${o.offeringId}/publish`);
  if (process.env.AILSS_DEMO_ENROLL_STUDENT === "true") {
    const order = await command(role + ":order", "student", "/orders", { offeringId: o.offeringId });
    await command(role + ":pay", "student", `/orders/${order.orderId}/simulate-payment`, {
      outcome: "SUCCESS",
    });
    for (let n = 0; n < 30; n++) {
      if ((await api("student", `/orders/${order.orderId}`)).state === "ENTITLED") break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    await api(
      "student",
      `/lessons/${l.lessonId}/completion`,
      "PUT",
      { completed: true },
      "complete-" + l.lessonId,
    );
    await command(role + ":review", "student", `/courses/${c.courseId}/reviews`, {
      rating: 5,
      body: "[Dữ liệu mẫu] Lộ trình rõ ràng, phù hợp để bắt đầu và tự thực hành. Đây là phản hồi minh họa giao diện.",
    });
  }
  console.log("Đã tạo giảng viên và khóa học: " + item.name);
}
await writeFile(new URL("../../tmp/instructor-media.json", import.meta.url), JSON.stringify(media));
