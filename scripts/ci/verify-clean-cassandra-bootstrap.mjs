import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readEnv, required } from "../dev/env.mjs";

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
  cql(roles);

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
      schemaAgreement: schemas.includes("schema_version"),
    }),
  );
} finally {
  cleanup();
}
