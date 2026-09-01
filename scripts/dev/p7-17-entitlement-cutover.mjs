import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readEnv } from "./env.mjs";

await readEnv();
const profile = process.env.AILSS_PROFILE ?? "dev-async";
const service = profile === "research" ? "cassandra-node1" : "cassandra-dev";
const runId = process.env.AILSS_RUN_ID ?? new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDir = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
const checkpointUrl = new URL("p7.17-entitlement-cutover-checkpoint.json", evidenceDir);
const resultUrl = new URL("p7.17-entitlement-cutover.json", evidenceDir);
const entitlementNamespace = "e5ad9ea6-2c52-5aad-91b4-76bb293c2878";
const offeringNamespace = "f36a5ca4-5f16-5dae-8c7d-b8bf0f02d814";
await mkdir(evidenceDir, { recursive: true });

const cql = (text) =>
  execFileSync(
    "docker",
    [
      "compose",
      "--env-file",
      ".env",
      "exec",
      "-T",
      service,
      "bash",
      "-euc",
      'ailss_cql_file=$(mktemp); trap \'rm -f "$ailss_cql_file"\' EXIT; tee "$ailss_cql_file" >/dev/null; cqlsh -u "$1" -p "$2" -f "$ailss_cql_file"',
      "ailss-p7-17-cutover",
      "cassandra",
      "cassandra",
    ],
    { encoding: "utf8", input: text, stdio: ["pipe", "pipe", "pipe"] },
  );

let checkpoint = { token: null, scanned: 0, eligible: 0, inserted: 0, noOp: 0 };
if (process.env.P7_17_BACKFILL_RESUME === "true") {
  try {
    checkpoint = { ...checkpoint, ...JSON.parse(await readFile(checkpointUrl, "utf8")) };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
const checksum = createHash("sha256");
for (;;) {
  const restriction =
    checkpoint.token === null ? "" : ` WHERE token(student_id,course_id) > ${checkpoint.token}`;
  const page = jsonRows(
    cql(
      `SELECT JSON token(student_id,course_id) AS token_value,student_id,course_id,enrollment_id,state,enrolled_at FROM learning_keyspace.enrollment_by_student_course${restriction} LIMIT 100;`,
    ),
  );
  if (page.length === 0) break;
  for (const row of page) {
    checkpoint.scanned += 1;
    checkpoint.token = String(row.token_value);
    if (!["ACTIVE", "ENTITLED", "ENROLLED"].includes(String(row.state))) continue;
    checkpoint.eligible += 1;
    const studentId = String(row.student_id);
    const courseId = String(row.course_id);
    const enrollmentId = String(row.enrollment_id);
    const grantedAt = String(row.enrolled_at);
    const entitlementId = uuidV5(entitlementNamespace, `${studentId}:${courseId}`);
    const offeringId = uuidV5(offeringNamespace, courseId);
    const existing = jsonRows(
      cql(
        `SELECT JSON entitlement_id,state,source_offering_id,source_enrollment_id,granted_at,version FROM learning_keyspace.entitlement_by_student_course WHERE student_id=${studentId} AND course_id=${courseId};`,
      ),
    )[0];
    if (existing) {
      if (
        String(existing.entitlement_id) !== entitlementId ||
        existing.state !== "ACTIVE" ||
        Number(existing.version) < 1
      )
        throw new Error(`P7.17 divergent entitlement ${studentId}/${courseId}`);
      checkpoint.noOp += 1;
    } else {
      cql(
        `INSERT INTO learning_keyspace.entitlement_by_student_course (student_id,course_id,entitlement_id,state,source_offering_id,source_enrollment_id,granted_at,version,updated_at) VALUES (${studentId},${courseId},${entitlementId},'ACTIVE',${offeringId},${enrollmentId},'${escapeCql(grantedAt)}',1,'${escapeCql(grantedAt)}') IF NOT EXISTS;`,
      );
      checkpoint.inserted += 1;
    }
    checksum.update(`${studentId}:${courseId}:${entitlementId}:ACTIVE\n`);
  }
  await writeFile(checkpointUrl, JSON.stringify(checkpoint, null, 2) + "\n");
  if (page.length < 100) break;
}
const result = {
  phase: "P7.17",
  stage: "entitlement-cutover",
  status: "PASS",
  profile,
  ...checkpoint,
  checksum: checksum.digest("hex"),
  pageSize: 100,
  runtimeFallback: "canonical-first-legacy-compatible",
};
await writeFile(resultUrl, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));

function jsonRows(output) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
}
function escapeCql(value) {
  return value.replaceAll("'", "''");
}
function uuidV5(namespace, name) {
  const namespaceBytes = Buffer.from(namespace.replaceAll("-", ""), "hex");
  const digest = createHash("sha1").update(namespaceBytes).update(name, "utf8").digest().subarray(0, 16);
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const hex = digest.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
