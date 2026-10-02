import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Only the eight catalog fixtures belonging to the local demo student are eligible.
const fixtureSlugs = new Set([
  "demo-web-html-css",
  "demo-javascript",
  "demo-sql",
  "demo-cassandra",
  "demo-ai-study",
  "demo-study-skills",
  "instructor-demo-0",
  "instructor-demo-1",
]);
const origin = new URL(process.env.AILSS_GATEWAY_URL || "http://127.0.0.1:8080");
if (
  !["localhost", "127.0.0.1"].includes(origin.hostname) ||
  origin.protocol !== "http:" ||
  (process.env.AILSS_PROFILE || "dev-async") !== "dev-async"
)
  throw Error("Reset is restricted to local dev-async demo fixtures.");
if (process.argv.slice(2).some((arg) => arg !== "--apply")) throw Error("Use --apply or no arguments.");
const apply = process.argv.includes("--apply");
let token;
async function api(path, body) {
  const response = await fetch(new URL("/api/v1" + path, origin), {
    method: body ? "POST" : "GET",
    headers: {
      ...(token ? { authorization: "Bearer " + token } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok) throw Error(`Local API failed: ${response.status} ${result.error?.code}`);
  return result.data;
}
token = (
  await api("/auth/login", {
    email: "student.demo@ailss.local",
    password: process.env.AILSS_DEMO_STUDENT_PASSWORD || "AilssDemo!2026",
  })
).accessToken;
const me = await api("/me");
if (me.role !== "STUDENT" || !me.userId) throw Error("Demo student required.");
const owned = await api("/me/courses");
const courses = [];
for (const item of owned) {
  const course = await api(`/courses/${item.courseId}`);
  if (!fixtureSlugs.has(course.slug)) continue;
  const offerings = await api(`/courses/${item.courseId}/offerings`);
  courses.push({
    ...item,
    offeringIds: offerings.filter((o) => o.offeringType === "SELF_PACED").map((o) => o.offeringId),
  });
}

function database(input) {
  // Credentials stay inside the running local Learning container.
  return JSON.parse(
    execFileSync("docker", ["exec", "-i", "ailss-learning-service", "node", "--input-type=module", "-"], {
      input: `(${resetDatabase.toString()})(${JSON.stringify(input)});`,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 4 * 1024 * 1024,
    }),
  );
}
const input = { studentId: me.userId, courses };
const plan = database(input);
console.log(JSON.stringify({ apply, courses: courses.map((c) => c.title), rows: plan.length }));
if (apply && plan.length) {
  const directory = new URL("../../tmp/demo-access-reset/", import.meta.url);
  await mkdir(directory, { recursive: true });
  const backup = new URL(new Date().toISOString().replaceAll(":", "-") + ".json", directory);
  await writeFile(backup, JSON.stringify(plan, null, 2), { mode: 0o600, flag: "wx" });
  database({ ...input, apply: true, expected: plan });
  console.log("Removed demo course access. Backup: " + fileURLToPath(backup));
}

async function resetDatabase(input) {
  const { createRequire } = await import("node:module");
  const { createHash } = await import("node:crypto");
  const cassandra = createRequire("/app/package.json")("cassandra-driver");
  if (process.env.AILSS_PROFILE !== "dev-async" || process.env.CASSANDRA_KEYSPACE !== "learning_keyspace")
    throw Error("Local Learning dev-async container required.");
  const db = new cassandra.Client({
    contactPoints: process.env.CASSANDRA_CONTACT_POINTS.split(",").map((host) => host.split(":")[0]),
    localDataCenter: process.env.CASSANDRA_LOCAL_DC || "ailss_dc",
    keyspace: "learning_keyspace",
    credentials: { username: process.env.CASSANDRA_USERNAME, password: process.env.CASSANDRA_PASSWORD },
  });
  const uuid = (value) => cassandra.types.Uuid.fromString(value);
  const student = uuid(input.studentId);
  const options = { prepare: true, consistency: cassandra.types.consistencies.localQuorum };
  const read = async (table, where, params) =>
    (await db.execute(`SELECT JSON * FROM ${table} WHERE ${where}`, params, options)).rows.map((row) =>
      JSON.parse(row["[json]"]),
    );
  const plan = [];
  const add = (table, rows, keys) => {
    for (const row of rows) plan.push({ table, row, keys });
  };
  try {
    for (const course of input.courses) {
      const courseId = uuid(course.courseId);
      const entitlement = await read("entitlement_by_student_course", "student_id=? AND course_id=?", [
        student,
        courseId,
      ]);
      if (entitlement.length !== 1 || entitlement[0].state !== "ACTIVE")
        throw Error("Demo access changed; retry.");
      const offeringIds = new Set([...course.offeringIds, entitlement[0].source_offering_id]);
      let verifiedSource = false;
      for (const id of offeringIds) {
        const enrollment = await read("enrollment_by_student_offering", "student_id=? AND offering_id=?", [
          student,
          uuid(id),
        ]);
        for (const row of enrollment) {
          if (row.course_id !== course.courseId || row.offering_type !== "SELF_PACED" || !row.order_id)
            throw Error("Reset only supports simulated SELF_PACED demo purchases.");
          const orders = await read("order_by_id", "order_id=?", [uuid(row.order_id)]);
          const order = orders[0];
          const sepay = await read("sepay_payment_by_order", "order_id=?", [uuid(row.order_id)]);
          if (
            !order ||
            order.student_id !== input.studentId ||
            order.course_id !== course.courseId ||
            order.state !== "ENTITLED" ||
            !order.request_key?.startsWith("demo-") ||
            sepay.length
          )
            throw Error("Refusing to reset non-demo or real payment access.");
          if (
            row.enrollment_id === entitlement[0].source_enrollment_id &&
            id === entitlement[0].source_offering_id
          )
            verifiedSource = true;
        }
        add("enrollment_by_student_offering", enrollment, ["student_id", "offering_id"]);
      }
      if (!verifiedSource) throw Error("Demo entitlement source could not be verified.");
      const legacy = await read("enrollment_by_student_course", "student_id=? AND course_id=?", [
        student,
        courseId,
      ]);
      if (legacy.length) throw Error("Legacy enrollment requires separate review.");
      add("entitlement_by_student_course", entitlement, ["student_id", "course_id"]);
      const month = course.enrolledAt.slice(0, 7) + "-01";
      const projection = await read(
        "courses_by_student_bucket",
        "student_id=? AND state='ACTIVE' AND year_month=?",
        [student, cassandra.types.LocalDate.fromString(month)],
      );
      add(
        "courses_by_student_bucket",
        projection.filter((r) => r.course_id === course.courseId),
        ["student_id", "state", "year_month", "enrolled_at", "course_id"],
      );
      const shard = createHash("sha256").update(input.studentId).digest()[0] % 16;
      const roster = await read("students_by_course_bucket", "course_id=? AND state='ACTIVE' AND shard=?", [
        courseId,
        shard,
      ]);
      add(
        "students_by_course_bucket",
        roster.filter((r) => r.student_id === input.studentId),
        ["course_id", "state", "shard", "enrolled_at", "student_id"],
      );
    }
    if (input.apply) {
      if (JSON.stringify(plan) !== JSON.stringify(input.expected))
        throw Error("Demo access changed after backup; retry.");
      // Remove authority first. Existing historical demo orders remain for audit.
      plan.sort(
        (a, b) =>
          Number(b.table === "entitlement_by_student_course") -
          Number(a.table === "entitlement_by_student_course"),
      );
      for (const { table, row, keys } of plan)
        await db.execute(
          `DELETE FROM ${table} WHERE ${keys.map((key) => key + "=?").join(" AND ")}`,
          keys.map((key) =>
            key.endsWith("_id")
              ? uuid(row[key])
              : key === "year_month"
                ? cassandra.types.LocalDate.fromString(row[key])
                : key === "enrolled_at"
                  ? new Date(row[key])
                  : row[key],
          ),
          options,
        );
    }
    console.log(JSON.stringify(plan));
  } finally {
    await db.shutdown();
  }
}
