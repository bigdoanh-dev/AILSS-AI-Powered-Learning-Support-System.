import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readEnv, required } from "../dev/env.mjs";
import { synchronizeCassandraRoles } from "../dev/cassandra-roles.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const suffix = randomUUID().slice(0, 8);
const container = `ailss-rj-clean-cassandra-${suffix}`;
const volume = `ailss-rj-clean-cassandra-${suffix}`;
const env = await readEnv();
const run = (args, options = {}) => execFileSync("docker", args, { encoding: "utf8", ...options });
const cql = (text) =>
  run(["exec", "-i", container, "cqlsh", "-u", "cassandra", "-p", "cassandra"], { input: text });
const cleanup = () => {
  try {
    run(["rm", "-f", container]);
  } catch {
    /* exact disposable container may not exist */
  }
  try {
    run(["volume", "rm", volume]);
  } catch {
    /* exact disposable volume may not exist */
  }
};
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    cleanup();
    process.exit(128 + (signal === "SIGINT" ? 2 : 15));
  });

try {
  run(["volume", "create", volume]);
  run([
    "run",
    "-d",
    "--name",
    container,
    "--hostname",
    `cassandra-clean-${suffix}`,
    "--memory",
    "1792m",
    "-e",
    "CASSANDRA_CLUSTER_NAME=AILSSRevisionJClean",
    "-e",
    "CASSANDRA_DC=ailss_dc",
    "-e",
    "CASSANDRA_RACK=rack1",
    "-e",
    "CASSANDRA_ENDPOINT_SNITCH=GossipingPropertyFileSnitch",
    "-e",
    "AILSS_CASSANDRA_AUDIT=false",
    "-e",
    "AILSS_CASSANDRA_TLS=false",
    "-e",
    "MAX_HEAP_SIZE=768M",
    "-e",
    "HEAP_NEWSIZE=192M",
    "-v",
    `${volume}:/var/lib/cassandra`,
    "-v",
    `${join(root, "infrastructure/cassandra/configure-cassandra.py")}:/opt/ailss/configure-cassandra.py:ro`,
    "-v",
    `${join(root, "infrastructure/cassandra/configure-cassandra.sh")}:/opt/ailss/configure-cassandra.sh:ro`,
    "--entrypoint",
    "bash",
    required(env, "CASSANDRA_IMAGE"),
    "/opt/ailss/configure-cassandra.sh",
  ]);

  let ready = false;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      cql("SELECT release_version FROM system.local;");
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    const running = run(["inspect", "--format", "{{.State.Running}}", container]).trim();
    if (running !== "true") throw new Error(`CLEAN_CASSANDRA_EXITED\n${run(["logs", container])}`);
  }
  if (!ready) throw new Error("CLEAN_CASSANDRA_START_TIMEOUT");

  let roles = await readFile(join(root, "database/roles/roles.cql.template"), "utf8");
  for (const name of [
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
  ])
    roles = roles.replaceAll(`{{${name}}}`, required(env, name).replaceAll("'", "''"));
  await synchronizeCassandraRoles(roles, cql);

  const registry = JSON.parse(await readFile(join(root, "database/migration-registry.json"), "utf8"));
  const dir = join(root, "database/migrations/dev");
  const disk = (await readdir(dir)).filter((name) => name.endsWith(".cql")).sort();
  const expected = registry.migrations.map((entry) => entry.filename);
  if (disk.join("\n") !== expected.join("\n")) throw new Error("CLEAN_BOOTSTRAP_REGISTRY_DISK_MISMATCH");
  for (const [index, filename] of expected.entries()) {
    const text = await readFile(join(dir, filename), "utf8");
    const hash = createHash("sha256").update(text).digest("hex");
    if (hash !== registry.migrations[index].sha256Dev)
      throw new Error(`CLEAN_BOOTSTRAP_HASH_MISMATCH ${filename}`);
    cql(text);
  }

  // Exercise the new migrations against populated tables, then apply them
  // again. This runs only in the uniquely named disposable Cassandra container.
  const studentId = randomUUID();
  const entryId = randomUUID();
  const usageId = randomUUID();
  const sessionId = randomUUID();
  const lecturerId = randomUUID();
  const instructionId = randomUUID();
  const auditEventId = randomUUID();
  const cacheKey = `bootstrap-rerun-${suffix}`;
  cql(`
    INSERT INTO classroom_keyspace.student_schedule_by_day
      (student_id,schedule_day,start_at,entry_id,title)
      VALUES (${studentId},'2026-09-29','2026-09-29T12:00:00Z',${entryId},'rerun fixture');
    INSERT INTO ai_service.ai_token_usage
      (user_id,usage_day,timestamp,usage_id,session_id,provider,prompt_tokens,completion_tokens)
      VALUES (${studentId},'2026-09-29','2026-09-29T12:00:00Z',${usageId},${sessionId},'fixture',7,3);
    INSERT INTO ai_service.assistant_response_cache (cache_key,content)
      VALUES ('${cacheKey}','rerun answer') USING TTL 3600;
    INSERT INTO learning_keyspace.payout_instruction_by_month
      (payout_month,lecturer_id,instruction_id,amount_minor,currency,status,approved_by)
      VALUES ('2026-08',${lecturerId},${instructionId},9000,'VND','PENDING_TRANSFER',${studentId});
    INSERT INTO learning_keyspace.payout_audit_by_instruction
      (instruction_id,event_id,state,actor_id,occurred_at)
      VALUES (${instructionId},${auditEventId},'PENDING_TRANSFER',${studentId},'2026-09-29T12:00:00Z');
  `);
  for (const filename of expected.filter((name) => /^09[3-6]_/.test(name)))
    cql(await readFile(join(dir, filename), "utf8"));
  const populatedChecks = [
    [
      `SELECT JSON entry_id,title FROM classroom_keyspace.student_schedule_by_day WHERE student_id=${studentId} AND schedule_day='2026-09-29';`,
      entryId,
    ],
    [
      `SELECT JSON usage_id,prompt_tokens FROM ai_service.ai_token_usage WHERE user_id=${studentId} AND usage_day='2026-09-29';`,
      usageId,
    ],
    [
      `SELECT JSON content FROM ai_service.assistant_response_cache WHERE cache_key='${cacheKey}';`,
      "rerun answer",
    ],
    [
      `SELECT JSON instruction_id,approved_by FROM learning_keyspace.payout_instruction_by_month WHERE payout_month='2026-08' AND lecturer_id=${lecturerId};`,
      instructionId,
    ],
    [
      `SELECT JSON event_id FROM learning_keyspace.payout_audit_by_instruction WHERE instruction_id=${instructionId};`,
      auditEventId,
    ],
  ];
  for (const [query, marker] of populatedChecks)
    if (!cql(query).includes(marker)) throw new Error(`POPULATED_MIGRATION_RERUN_LOST_DATA ${marker}`);

  const keyspaces = cql("SELECT keyspace_name FROM system_schema.keyspaces;");
  for (const keyspace of registry.canonicalKeyspaces)
    if (!keyspaces.includes(keyspace)) throw new Error(`CLEAN_BOOTSTRAP_MISSING_KEYSPACE ${keyspace}`);
  const schemas = cql("SELECT schema_version FROM system.local;");
  const tables = cql("SELECT keyspace_name,table_name FROM system_schema.tables;");
  for (const table of ["mastery_ingestion_by_event", "mastery_evidence_by_student_course", "study_plans_v2"])
    if (!tables.includes(table)) throw new Error(`CLEAN_BOOTSTRAP_MISSING_TABLE ${table}`);
  console.log(
    JSON.stringify({
      stage: "revision-j-clean-cassandra-bootstrap",
      status: "PASS",
      migrations: expected.length,
      keyspaces: registry.canonicalKeyspaces.length,
      populatedRerun: true,
      schemaAgreement: schemas.includes("schema_version"),
    }),
  );
} finally {
  cleanup();
}
