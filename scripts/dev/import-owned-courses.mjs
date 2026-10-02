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
const directory = new URL("../../tmp/owned-courses/", import.meta.url);
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

const library = JSON.parse(await readFile(new URL("../../tmp/local-library.json", import.meta.url), "utf8"));
const grouped = Map.groupBy(library.items, (item) => item.group.split("/")[0]);
const definitions = [
  {
    title: "Python: lập trình từ nền tảng",
    slug: "python-video-doanh",
    category: 1,
    items: [
      {
        id: "python-drive",
        title: "Video Python — bài giảng chính",
        group: "Python/Bắt đầu",
        externalVideo: "https://drive.google.com/file/d/1k7z2sQR1M4h9XJ_3DKy8LOQrMqlKjxbA/preview",
      },
    ],
  },
];
let index = 0;
for (const [title, items] of grouped)
  definitions.push({
    title,
    slug: "ielts-chuyen-sau-" + ++index,
    category: 4,
    items: items.sort((a, b) =>
      (a.group + "/" + a.title).localeCompare(b.group + "/" + b.title, "vi", { numeric: true }),
    ),
  });
const mapping = {};
async function saveMapping() {
  const file = new URL("../../tmp/course-media.json", import.meta.url);
  await writeFile(new URL("../../tmp/course-media.tmp", import.meta.url), JSON.stringify(mapping));
  await rename(new URL("../../tmp/course-media.tmp", import.meta.url), file);
}
for (const item of definitions) {
  const course = await command(item.slug + ":course", "lecturer", "/courses", {
    title: item.title,
    slug: item.slug,
    categoryId: `10000000-0000-4000-8000-${String(item.category).padStart(12, "0")}`,
    priceType: "FREE",
    price: "0",
    currency: "VND",
  });
  const sections = [...new Set(item.items.map((x) => x.group))];
  for (const [i, file] of item.items.entries()) {
    const sectionTitle = (file.group.split("/").slice(1).join(" · ") || item.title).slice(0, 160);
    const kind = file.contentType?.startsWith("video/")
      ? "Video"
      : file.contentType?.startsWith("audio/")
        ? "Bài nghe"
        : "Bài đọc và thực hành";
    const lesson = await command(
      item.slug + ":lesson:" + file.id,
      "lecturer",
      `/courses/${course.courseId}/lessons`,
      {
        title: (file.externalVideo ? file.title : kind + ": " + file.title).slice(0, 160),
        sectionTitle,
        position: { sectionOrder: sections.indexOf(file.group) + 1, lessonOrder: i + 1 },
        preview: false,
      },
    );
    mapping[lesson.lessonId] = {
      courseId: course.courseId,
      ...(file.externalVideo
        ? { externalVideo: file.externalVideo }
        : { fileId: file.id, contentType: file.contentType }),
    };
    await saveMapping();
  }
  await command(item.slug + ":review", "lecturer", `/courses/${course.courseId}/submit-review`);
  if (!journal.commands[item.slug + ":publish"]?.done) {
    await api(
      "admin",
      `/admin/courses/${course.courseId}/publish`,
      "POST",
      { currentPassword: accounts.admin.password },
      item.slug + "-publish-" + course.courseId,
    );
    journal.commands[item.slug + ":publish"] = { done: true };
    await save();
  }
  const offering = await command(
    item.slug + ":offering",
    "lecturer",
    `/courses/${course.courseId}/offerings`,
    { offeringType: "SELF_PACED", title: item.title, price: "0", currency: "VND" },
  );
  await command(item.slug + ":offering-publish", "lecturer", `/offerings/${offering.offeringId}/publish`);
  if (process.env.AILSS_DEMO_ENROLL_STUDENT === "true") {
    const order = await command(item.slug + ":order", "student", "/orders", {
      offeringId: offering.offeringId,
    });
    await command(item.slug + ":payment", "student", `/orders/${order.orderId}/simulate-payment`, {
      outcome: "SUCCESS",
    });
  }
  console.log(`Đã tạo khóa ${item.title}: ${item.items.length} bài giảng`);
}
console.log(
  "Đã chuyển video Python và toàn bộ bộ IELTS thành khóa học. Tệp nguồn vẫn nằm trên máy, không đưa vào Git.",
);
