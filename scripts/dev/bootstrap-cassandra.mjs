import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { readEnv, required } from "./env.mjs";
import { synchronizeCassandraRoles } from "./cassandra-roles.mjs";

const env = await readEnv();
const profile = process.env.AILSS_PROFILE ?? "dev-core";
const service = profile === "research" ? "cassandra-node1" : "cassandra-dev";
const migrationProfile = profile === "research" ? "research" : "dev";
const cql = (text, user = "cassandra", password = "cassandra") =>
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
      "ailss-cql",
      user,
      password,
    ],
    { encoding: "utf8", input: text, stdio: ["pipe", "pipe", "pipe"] },
  );

const dcOutput = cql("SELECT data_center, release_version FROM system.local;");
if (!dcOutput.includes("ailss_dc"))
  throw new Error(`Cassandra DC mismatch; expected ailss_dc. Output: ${dcOutput}`);

// Some additive migrations grant table permissions. Roles must therefore exist before
// the migration loop on a brand-new volume; CREATE ROLE IF NOT EXISTS keeps reruns safe.
let roles = await readFile(new URL("../../database/roles/roles.cql.template", import.meta.url), "utf8");
const roleSecrets = [
  "CASSANDRA_ADMIN_PASSWORD",
  "CASSANDRA_MIGRATOR_PASSWORD",
  "CASSANDRA_SVC_IDENTITY_PASSWORD",
  "CASSANDRA_SVC_LEARNING_PASSWORD",
  "CASSANDRA_SVC_CLASSROOM_PASSWORD",
  "CASSANDRA_SVC_ASSESSMENT_PASSWORD",
  "CASSANDRA_SVC_INTERACTION_PASSWORD",
  "CASSANDRA_SVC_AI_PASSWORD",
  "CASSANDRA_SVC_NOTIFICATION_PASSWORD",
  "CASSANDRA_SVC_AUDIT_PASSWORD",
];
for (const name of roleSecrets)
  roles = roles.replaceAll(`{{${name}}}`, required(env, name).replaceAll("'", "''"));
await synchronizeCassandraRoles(roles, cql);

const migrationDir = new URL(`../../database/migrations/${migrationProfile}/`, import.meta.url);
const registry = JSON.parse(
  await readFile(new URL("../../database/migration-registry.json", import.meta.url), "utf8"),
);
const inventory = JSON.parse(
  await readFile(new URL("../../database/migration-inventory.json", import.meta.url), "utf8"),
);
const files = registry.migrations.map((entry) => entry.filename);
const diskFiles = (await readdir(migrationDir)).filter((name) => name.endsWith(".cql")).sort();
if (
  files.length !== inventory.summary.CANONICAL_LOGICAL_MIGRATIONS ||
  files.length !== diskFiles.length ||
  files.some((name, index) => name !== diskFiles[index])
) {
  throw new Error(
    `MIGRATION_BOOTSTRAP_PARITY_FAILED registry=${files.length} inventory=${inventory.summary.CANONICAL_LOGICAL_MIGRATIONS} disk=${diskFiles.length}`,
  );
}
const checksums = [];
// A fresh bootstrap has no schedule tables before 033. On an existing target,
// changing a compaction strategy needs an operator review of data and capacity.
const scheduleTables = ["student_schedule_by_day", "schedule_reservations_by_expiry_bucket"];
const scheduleTableOptions = scheduleTables.map((table) =>
  cql(
    `SELECT compaction FROM system_schema.tables WHERE keyspace_name = 'classroom_keyspace' AND table_name = '${table}';`,
  ),
);
const needsCompactionChange = scheduleTableOptions.some(
  (output) =>
    output.includes("1 row") &&
    !(
      output.includes("TimeWindowCompactionStrategy") &&
      output.includes("compaction_window_unit") &&
      output.includes("DAYS") &&
      output.includes("compaction_window_size") &&
      output.includes("'1'")
    ),
);
if (needsCompactionChange && process.env.AILSS_APPROVE_093_COMPACTION !== "true") {
  throw new Error(
    "MIGRATION_093_PRECHECK_REQUIRED: existing schedule tables require a reviewed target snapshot and AILSS_APPROVE_093_COMPACTION=true",
  );
}
for (const [index, file] of files.entries()) {
  const text = await readFile(new URL(file, migrationDir), "utf8");
  const digest = createHash("sha256").update(text).digest("hex");
  const expected =
    registry.migrations[index][migrationProfile === "research" ? "sha256Research" : "sha256Dev"];
  if (digest !== expected) throw new Error(`MIGRATION_HASH_MISMATCH ${file}`);
  cql(text);
  checksums.push({ file, sha256: digest });
}

const runId = process.env.AILSS_RUN_ID ?? new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDir = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(evidenceDir, { recursive: true });

// P7.14 controlled legacy migration. Only this migrator enumerates Q-LRN-001; runtime never scans it.
const offeringNamespace = "f36a5ca4-5f16-5dae-8c7d-b8bf0f02d814";
let offeringBackfillInserted = 0;
let offeringBackfillNoop = 0;
let offeringBackfillScanned = 0;
let offeringBackfillToken = null;
let offeringBackfillOldest = null;
let offeringBackfillNewest = null;
const offeringBackfillChecksum = createHash("sha256");
if (process.env.P7_14_BACKFILL_RESUME === "true") {
  try {
    const checkpoint = JSON.parse(
      await readFile(new URL("p7.14-backfill-checkpoint.json", evidenceDir), "utf8"),
    );
    offeringBackfillToken = typeof checkpoint.token === "string" ? checkpoint.token : null;
    offeringBackfillScanned = Number(checkpoint.scanned ?? 0);
    offeringBackfillInserted = Number(checkpoint.inserted ?? 0);
    offeringBackfillNoop = Number(checkpoint.noOp ?? 0);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
for (;;) {
  const restriction =
    offeringBackfillToken === null ? "" : ` WHERE token(course_id) > ${offeringBackfillToken}`;
  const output = cql(
    `SELECT JSON token(course_id) AS token_value,course_id,owner_lecturer_id,title,slug,state,price,currency,published_at,updated_at FROM learning_keyspace.course_by_id${restriction} LIMIT 100;`,
  );
  const page = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
  if (page.length === 0) break;
  const eligible = page.filter((row) => row.state === "PUBLISHED");
  const legacySlugs = eligible
    .filter((row) => row.published_at === null)
    .map((row) => `'${escapeCql(String(row.slug))}'`);
  const lookupByCourse = new Map();
  if (legacySlugs.length > 0) {
    const lookupOutput = cql(
      `SELECT JSON normalized_slug,course_id,state,updated_at FROM learning_keyspace.course_by_slug WHERE normalized_slug IN (${legacySlugs.join(",")});`,
    );
    for (const lookup of jsonRows(lookupOutput)) lookupByCourse.set(String(lookup.course_id), lookup);
  }
  const offeringIds = eligible.map((row) => uuidV5(offeringNamespace, String(row.course_id)));
  const existingById = new Map();
  if (offeringIds.length > 0) {
    const existingOutput = cql(
      `SELECT JSON offering_id,course_id,owner_lecturer_id,offering_type,class_id,title,state,price,currency,record_version,published_at FROM learning_keyspace.offering_by_id WHERE offering_id IN (${offeringIds.join(",")});`,
    );
    for (const existing of jsonRows(existingOutput)) existingById.set(String(existing.offering_id), existing);
  }
  const offeringStatements = [];
  for (const row of page) {
    offeringBackfillScanned += 1;
    offeringBackfillToken = String(row.token_value);
    if (row.state !== "PUBLISHED") continue;
    const courseId = String(row.course_id),
      offeringId = uuidV5(offeringNamespace, courseId);
    const owner = String(row.owner_lecturer_id),
      title = String(row.title),
      price = String(row.price),
      currency = String(row.currency);
    let publishedAt = row.published_at === null ? null : String(row.published_at);
    if (publishedAt === null) {
      const lookup = lookupByCourse.get(courseId);
      publishedAt =
        lookup && String(lookup.course_id) === courseId && lookup.state === "PUBLISHED" && lookup.updated_at
          ? String(lookup.updated_at)
          : String(row.updated_at);
    }
    offeringBackfillOldest =
      offeringBackfillOldest === null || publishedAt < offeringBackfillOldest
        ? publishedAt
        : offeringBackfillOldest;
    offeringBackfillNewest =
      offeringBackfillNewest === null || publishedAt > offeringBackfillNewest
        ? publishedAt
        : offeringBackfillNewest;
    const existing = existingById.get(offeringId);
    if (existing) {
      if (
        String(existing.course_id) !== courseId ||
        String(existing.owner_lecturer_id) !== owner ||
        existing.offering_type !== "SELF_PACED" ||
        existing.class_id !== null ||
        existing.state !== "PUBLISHED" ||
        String(existing.title) !== title ||
        String(existing.price) !== price ||
        String(existing.currency) !== currency ||
        Number(existing.record_version) !== 1 ||
        Date.parse(String(existing.published_at)) !== Date.parse(publishedAt)
      )
        throw new Error(`P7.14 divergent deterministic offering ${offeringId}`);
      offeringBackfillNoop += 1;
    } else {
      offeringStatements.push(
        `INSERT INTO learning_keyspace.offering_by_id (offering_id,course_id,owner_lecturer_id,offering_type,class_id,title,state,price,currency,record_version,created_at,updated_at,published_at) VALUES (${offeringId},${courseId},${owner},'SELF_PACED',null,'${escapeCql(title)}','PUBLISHED',${price},'${escapeCql(currency)}',1,'${escapeCql(publishedAt)}','${escapeCql(publishedAt)}','${escapeCql(publishedAt)}') IF NOT EXISTS;`,
      );
      offeringBackfillInserted += 1;
    }
    const ym = publishedAt.slice(0, 7) + "-01",
      shard = (createHash("sha256").update(offeringId).digest()[0] ?? 0) % 8;
    offeringStatements.push(
      `INSERT INTO learning_keyspace.offerings_by_course (course_id,updated_at,offering_id,owner_lecturer_id,offering_type,class_id,title,state,price,currency,offering_version) VALUES (${courseId},'${escapeCql(publishedAt)}',${offeringId},${owner},'SELF_PACED',null,'${escapeCql(title)}','PUBLISHED',${price},'${escapeCql(currency)}',1); INSERT INTO learning_keyspace.offerings_by_lecturer (lecturer_id,updated_at,offering_id,course_id,offering_type,class_id,title,state,offering_version) VALUES (${owner},'${escapeCql(publishedAt)}',${offeringId},${courseId},'SELF_PACED',null,'${escapeCql(title)}','PUBLISHED',1); INSERT INTO learning_keyspace.public_offerings_by_type_bucket (offering_type,year_month,shard,published_at,offering_id,course_id,class_id,title,price,currency,offering_version) VALUES ('SELF_PACED','${ym}',${shard},'${escapeCql(publishedAt)}',${offeringId},${courseId},null,'${escapeCql(title)}',${price},'${escapeCql(currency)}',1);`,
    );
    offeringBackfillChecksum.update(`${courseId}:${offeringId}:${publishedAt}\n`);
  }
  if (offeringStatements.length > 0) cql(offeringStatements.join("\n"));
  await writeFile(
    new URL("p7.14-backfill-checkpoint.json", evidenceDir),
    JSON.stringify(
      {
        token: offeringBackfillToken,
        scanned: offeringBackfillScanned,
        inserted: offeringBackfillInserted,
        noOp: offeringBackfillNoop,
      },
      null,
      2,
    ) + "\n",
  );
  if (page.length < 100) break;
}
if (offeringBackfillOldest && offeringBackfillNewest)
  cql(
    `INSERT INTO learning_keyspace.offering_catalog_bounds_by_type (offering_type,newest_year_month,oldest_year_month,updated_at) VALUES ('SELF_PACED','${offeringBackfillNewest.slice(0, 7)}-01','${offeringBackfillOldest.slice(0, 7)}-01',toTimestamp(now()));`,
  );

// P7.15A controlled compatibility backfill. Runtime Classroom code never enumerates these tables.
const classroomBackfill = {
  classes: { scanned: 0, updated: 0, noOp: 0, finalToken: null, checksum: createHash("sha256") },
  memberships: { scanned: 0, updated: 0, noOp: 0, finalToken: null, checksum: createHash("sha256") },
};
if (process.env.P7_15A_BACKFILL_RESUME === "true") {
  try {
    const checkpoint = JSON.parse(
      await readFile(new URL("p7.15a-backfill-checkpoint.json", evidenceDir), "utf8"),
    );
    for (const name of ["classes", "memberships"])
      if (checkpoint[name]) {
        classroomBackfill[name].scanned = Number(checkpoint[name].scanned ?? 0);
        classroomBackfill[name].updated = Number(checkpoint[name].updated ?? 0);
        classroomBackfill[name].noOp = Number(checkpoint[name].noOp ?? 0);
        classroomBackfill[name].finalToken = checkpoint[name].finalToken ?? null;
      }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
for (;;) {
  const state = classroomBackfill.classes;
  const restriction = state.finalToken === null ? "" : ` WHERE token(class_id) > ${state.finalToken}`;
  const page = jsonRows(
    cql(
      `SELECT JSON token(class_id) AS token_value,class_id,class_kind,schedule_state,schedule_version,max_members FROM classroom_keyspace.class_by_id${restriction} LIMIT 100;`,
    ),
  );
  if (page.length === 0) break;
  const statements = [];
  for (const row of page) {
    state.scanned += 1;
    state.finalToken = String(row.token_value);
    const classId = String(row.class_id);
    if (row.class_kind === null) {
      statements.push(
        `UPDATE classroom_keyspace.class_by_id SET class_kind='PRIVATE',schedule_state='DRAFT',schedule_version=1,max_members=10000 WHERE class_id=${classId} IF class_kind=null;`,
      );
      state.updated += 1;
      state.checksum.update(`${classId}:PRIVATE:DRAFT:1:10000\n`);
    } else if (
      row.class_kind === "PRIVATE" &&
      row.schedule_state === "DRAFT" &&
      Number(row.schedule_version) === 1 &&
      Number(row.max_members) === 10000
    ) {
      state.noOp += 1;
      state.checksum.update(`${classId}:PRIVATE:DRAFT:1:10000\n`);
    }
  }
  if (statements.length > 0) cql(statements.join("\n"));
  await writeClassroomCheckpoint();
  if (page.length < 100) break;
}
for (;;) {
  const state = classroomBackfill.memberships;
  const restriction =
    state.finalToken === null ? "" : ` WHERE token(class_id,student_id) > ${state.finalToken}`;
  const page = jsonRows(
    cql(
      `SELECT JSON token(class_id,student_id) AS token_value,class_id,student_id,source FROM classroom_keyspace.membership_by_class_student${restriction} LIMIT 100;`,
    ),
  );
  if (page.length === 0) break;
  const statements = [];
  for (const row of page) {
    state.scanned += 1;
    state.finalToken = String(row.token_value);
    const classId = String(row.class_id),
      studentId = String(row.student_id);
    if (row.source === null) {
      statements.push(
        `UPDATE classroom_keyspace.membership_by_class_student SET source='JOIN_CODE' WHERE class_id=${classId} AND student_id=${studentId} IF source=null;`,
      );
      state.updated += 1;
      state.checksum.update(`${classId}:${studentId}:JOIN_CODE\n`);
    } else if (row.source === "JOIN_CODE") {
      state.noOp += 1;
      state.checksum.update(`${classId}:${studentId}:JOIN_CODE\n`);
    }
  }
  if (statements.length > 0) cql(statements.join("\n"));
  await writeClassroomCheckpoint();
  if (page.length < 100) break;
}

async function writeClassroomCheckpoint() {
  await writeFile(
    new URL("p7.15a-backfill-checkpoint.json", evidenceDir),
    JSON.stringify(
      Object.fromEntries(
        Object.entries(classroomBackfill).map(([name, value]) => [
          name,
          {
            scanned: value.scanned,
            updated: value.updated,
            noOp: value.noOp,
            finalToken: value.finalToken,
          },
        ]),
      ),
      null,
      2,
    ) + "\n",
  );
}

// P7.6 controlled backfill: a migration-time scan is permitted; runtime services never scan credentials.
const credentialRows = cql(
  "SELECT JSON normalized_email,user_id,credential_version FROM identity_keyspace.credential_by_email;",
);
let identitySecurityBackfillCount = 0;
const identitySecurityBackfillStatements = [];
for (const line of credentialRows.split("\n")) {
  const candidate = line.trim();
  if (!candidate.startsWith("{")) continue;
  const row = JSON.parse(candidate);
  const normalizedEmail = String(row.normalized_email).replaceAll("'", "''");
  const userId = String(row.user_id);
  const credentialVersion = Number(row.credential_version);
  if (!/^[0-9a-f-]{36}$/iu.test(userId) || !Number.isSafeInteger(credentialVersion)) {
    throw new Error("P7.6 identity security backfill encountered an invalid credential row");
  }
  identitySecurityBackfillStatements.push(
    `UPDATE identity_keyspace.user_by_id SET normalized_email='${normalizedEmail}',credential_version=${credentialVersion} WHERE user_id=${userId} IF EXISTS;`,
  );
  identitySecurityBackfillCount += 1;
}
if (identitySecurityBackfillStatements.length > 0) {
  cql(identitySecurityBackfillStatements.join("\n"));
}

// P7.7 controlled backfill: only migration/bootstrap may scan canonical Identity rows.
// INSERT IF NOT EXISTS preserves any already-managed public bio/avatar fields and never overwrites a newer row.
const identityRows = cql(
  "SELECT JSON user_id,display_name,role,status,lecturer_verified,profile_version,updated_at FROM identity_keyspace.user_by_id;",
);
let lecturerProjectionBackfillCount = 0;
const lecturerProjectionBackfillStatements = [];
for (const line of identityRows.split("\n")) {
  const candidate = line.trim();
  if (!candidate.startsWith("{")) continue;
  const row = JSON.parse(candidate);
  if (row.role !== "LECTURER" || row.status !== "ACTIVE" || row.lecturer_verified !== true) continue;
  const userId = String(row.user_id);
  const displayName = String(row.display_name ?? "");
  const profileVersion = Number(row.profile_version);
  const updatedAt = String(row.updated_at ?? "");
  if (
    !/^[0-9a-f-]{36}$/iu.test(userId) ||
    displayName.length < 1 ||
    !Number.isSafeInteger(profileVersion) ||
    profileVersion < 1 ||
    Number.isNaN(Date.parse(updatedAt))
  ) {
    throw new Error("P7.7 lecturer projection backfill encountered an invalid canonical row");
  }
  lecturerProjectionBackfillStatements.push(
    `INSERT INTO identity_keyspace.public_lecturer_by_id (lecturer_id,display_name,verified,profile_version,updated_at) VALUES (${userId},'${displayName.replaceAll("'", "''")}',true,${profileVersion},'${updatedAt.replaceAll("'", "''")}') IF NOT EXISTS;`,
  );
  lecturerProjectionBackfillCount += 1;
}
if (lecturerProjectionBackfillStatements.length > 0) {
  cql(lecturerProjectionBackfillStatements.join("\n"));
}

// P7.8 controlled Q-IDN-005 backfill. Runtime never scans Q-IDN-001.
let adminSearchProjectionBackfillCount = 0;
const adminSearchProjectionBackfillStatements = [];
for (const line of identityRows.split("\n")) {
  const candidate = line.trim();
  if (!candidate.startsWith("{")) continue;
  const row = JSON.parse(candidate);
  const userId = String(row.user_id);
  const displayName = String(row.display_name ?? "");
  const role = String(row.role ?? "");
  const status = String(row.status ?? "");
  const lecturerVerified = row.lecturer_verified === true;
  const profileVersion = Number(row.profile_version);
  const updatedAt = String(row.updated_at ?? "");
  if (
    !/^[0-9a-f-]{36}$/iu.test(userId) ||
    !["STUDENT", "LECTURER", "ADMIN"].includes(role) ||
    !["ACTIVE", "SUSPENDED"].includes(status) ||
    displayName.length < 1 ||
    !Number.isSafeInteger(profileVersion) ||
    profileVersion < 1 ||
    Number.isNaN(Date.parse(updatedAt))
  ) {
    throw new Error("P7.8 Admin search projection backfill encountered an invalid canonical row");
  }
  const shard = (createHash("sha256").update(userId, "utf8").digest()[0] ?? 0) % 16;
  adminSearchProjectionBackfillStatements.push(
    `INSERT INTO identity_keyspace.users_by_role_status_bucket (role,status,shard,updated_at,user_id,display_name,lecturer_verified,profile_version) VALUES ('${role}','${status}',${shard},'${updatedAt.replaceAll("'", "''")}',${userId},'${displayName.replaceAll("'", "''")}',${lecturerVerified ? "true" : "false"},${profileVersion}) IF NOT EXISTS;`,
  );
  adminSearchProjectionBackfillCount += 1;
}
if (adminSearchProjectionBackfillStatements.length > 0) {
  cql(adminSearchProjectionBackfillStatements.join("\n"));
}

cql(await readFile(new URL("../../database/grants/grants.cql", import.meta.url), "utf8"));

await writeFile(
  new URL("cassandra-bootstrap.json", evidenceDir),
  JSON.stringify(
    {
      runId,
      profile,
      dc: "ailss_dc",
      versionOutput: dcOutput.trim(),
      checksums,
      identitySecurityBackfillCount,
      lecturerProjectionBackfillCount,
      adminSearchProjectionBackfillCount,
      offeringBackfill: {
        namespace: offeringNamespace,
        scanned: offeringBackfillScanned,
        inserted: offeringBackfillInserted,
        noOp: offeringBackfillNoop,
        finalToken: offeringBackfillToken,
        checksum: offeringBackfillChecksum.digest("hex"),
        pageSize: 100,
      },
      classroomCompatibilityBackfill: Object.fromEntries(
        Object.entries(classroomBackfill).map(([name, value]) => [
          name,
          {
            scanned: value.scanned,
            updated: value.updated,
            noOp: value.noOp,
            finalToken: value.finalToken,
            checksum: value.checksum.digest("hex"),
            pageSize: 100,
          },
        ]),
      ),
      legacySessionAuthVersionPolicy: "FAIL_CLOSED",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    stage: "cassandra-bootstrap",
    status: "PASS",
    service,
    migrations: files.length,
    identitySecurityBackfillCount,
    lecturerProjectionBackfillCount,
    adminSearchProjectionBackfillCount,
    offeringBackfillInserted,
    offeringBackfillNoop,
    classroomClassBackfillUpdated: classroomBackfill.classes.updated,
    classroomMembershipBackfillUpdated: classroomBackfill.memberships.updated,
    runId,
  }),
);

function escapeCql(value) {
  return value.replaceAll("'", "''");
}
function jsonRows(output) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
}
function uuidV5(namespace, name) {
  const namespaceBytes = Buffer.from(namespace.replaceAll("-", ""), "hex");
  const digest = createHash("sha1").update(namespaceBytes).update(name, "utf8").digest().subarray(0, 16);
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const hex = digest.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
