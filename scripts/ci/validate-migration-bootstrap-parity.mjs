import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const registry = JSON.parse(await readFile(new URL("database/migration-registry.json", root), "utf8"));
const inventory = JSON.parse(await readFile(new URL("database/migration-inventory.json", root), "utf8"));
const expected = registry.migrations.map((migration) => migration.filename);
const bodyByProfile = { dev: new Map(), research: new Map() };
const tokenize = (body) =>
  (body.replace(/--[^\n]*/g, "").match(/'(?:''|[^'])*'|"(?:""|[^"])*"|[\w]+|[^\s]/g) ?? []).join(" ");
const logicalBody = (filename, body) => {
  let normalized = body;
  if (filename === "001_keyspaces.cql" || filename === "094_ai_token_usage.cql")
    normalized = normalized.replace(/'ailss_dc'\s*:\s*[13]/g, "'ailss_dc':RF");
  if (filename === "033_classroom_student_schedule.cql")
    normalized = normalized.replace(/\s+(?:AND|WITH)\s+compaction\s*=\s*\{[^}]+\}/gi, "");
  return tokenize(normalized);
};

if (registry.totalMigrations !== expected.length)
  throw new Error(
    `MIGRATION_REGISTRY_TOTAL_MISMATCH declared=${registry.totalMigrations} actual=${expected.length}`,
  );
if (inventory.summary.CANONICAL_LOGICAL_MIGRATIONS !== expected.length)
  throw new Error(
    `MIGRATION_INVENTORY_TOTAL_MISMATCH inventory=${inventory.summary.CANONICAL_LOGICAL_MIGRATIONS} registry=${expected.length}`,
  );
if (
  new Set(expected).size !== expected.length ||
  new Set(registry.migrations.map((entry) => entry.id)).size !== expected.length
)
  throw new Error("MIGRATION_REGISTRY_DUPLICATE");
for (const [index, migration] of registry.migrations.entries()) {
  if (!/^\d{3}_.+\.cql$/.test(migration.filename) || migration.id !== migration.filename.slice(0, 3))
    throw new Error(`MIGRATION_ID_MISMATCH ${migration.filename}`);
  if (
    index &&
    (Number(migration.id) <= Number(registry.migrations[index - 1].id) ||
      migration.predecessor !== registry.migrations[index - 1].id)
  )
    throw new Error(`MIGRATION_ORDER_MISMATCH ${migration.filename}`);
}

for (const profile of ["dev", "research"]) {
  const migrationDir = new URL(`database/migrations/${profile}/`, root);
  const actual = (await readdir(migrationDir)).filter((name) => name.endsWith(".cql")).sort();
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index]))
    throw new Error(
      `MIGRATION_FILE_PARITY_FAILED profile=${profile} expected=${expected.length} actual=${actual.length}`,
    );

  for (const [index, filename] of actual.entries()) {
    const body = await readFile(new URL(filename, migrationDir), "utf8");
    bodyByProfile[profile].set(filename, body);
    const digest = createHash("sha256").update(body).digest("hex");
    const hashField = profile === "dev" ? "sha256Dev" : "sha256Research";
    if (digest !== registry.migrations[index][hashField])
      throw new Error(`MIGRATION_HASH_MISMATCH profile=${profile} file=${filename}`);
  }
}

const differing = [];
for (const filename of expected) {
  const dev = bodyByProfile.dev.get(filename);
  const research = bodyByProfile.research.get(filename);
  if (dev !== research) differing.push(filename);
  if (logicalBody(filename, dev) !== logicalBody(filename, research))
    throw new Error(`MIGRATION_LOGICAL_SCHEMA_DRIFT ${filename}`);
  for (const [profile, body] of [
    ["dev", dev],
    ["research", research],
  ]) {
    const statements = body
      .replace(/--[^\n]*/g, "")
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean);
    for (const statement of statements) {
      if (
        /^CREATE\s+(?:TABLE|KEYSPACE|TYPE|INDEX)\b/i.test(statement) &&
        !/^CREATE\s+(?:TABLE|KEYSPACE|TYPE|INDEX)\s+IF\s+NOT\s+EXISTS\b/i.test(statement)
      )
        throw new Error(`MIGRATION_CREATE_NOT_IDEMPOTENT ${profile}/${filename}`);
      if (
        /^ALTER\s+TABLE\b/i.test(statement) &&
        /\bADD\b/i.test(statement) &&
        !/\bADD\s+IF\s+NOT\s+EXISTS\b/i.test(statement)
      )
        throw new Error(`MIGRATION_ADD_NOT_IDEMPOTENT ${profile}/${filename}`);
    }
  }
}
const knownDivergences = Object.keys(inventory.driftAnalysis).sort();
if (JSON.stringify(differing) !== JSON.stringify(knownDivergences))
  throw new Error(`MIGRATION_DIVERGENCE_INVENTORY_MISMATCH ${differing.join(",")}`);
const counts = {
  IDENTICAL_PAIRS: expected.length - differing.length,
  ENVIRONMENT_SPECIFIC_PAIRS: 0,
  SEMANTIC_EQUIVALENT_PAIRS: 0,
  RECONCILED_TABLE_OPTION_PAIRS: 0,
};
for (const filename of differing) {
  const classification = inventory.driftAnalysis[filename].classification;
  const field =
    classification === "RECONCILED_TABLE_OPTION_DRIFT"
      ? "RECONCILED_TABLE_OPTION_PAIRS"
      : `${classification}_PAIRS`;
  if (!(field in counts)) throw new Error(`MIGRATION_UNKNOWN_DRIFT_CLASS ${filename}`);
  counts[field] += 1;
}
for (const [field, actual] of Object.entries(counts))
  if (inventory.summary[field] !== actual) throw new Error(`MIGRATION_INVENTORY_COUNT_MISMATCH ${field}`);
if (
  inventory.summary.DEV_FILES !== expected.length ||
  inventory.summary.RESEARCH_FILES !== expected.length ||
  inventory.summary.TOTAL_CQL_FILES !== expected.length * 2 ||
  inventory.summary.PAIRED_FILES !== expected.length ||
  inventory.summary.INVALID_DRIFT !== 0 ||
  inventory.highestMigrationFile !== expected.at(-1) ||
  inventory.highestMigrationIndex !== registry.migrations.at(-1).id
)
  throw new Error("MIGRATION_INVENTORY_SUMMARY_MISMATCH");
if (
  !bodyByProfile.dev.get("033_classroom_student_schedule.cql").includes("TimeWindowCompactionStrategy") ||
  bodyByProfile.research.get("033_classroom_student_schedule.cql").includes("TimeWindowCompactionStrategy") ||
  bodyByProfile.dev.get("093_classroom_schedule_compaction_parity.cql") !==
    bodyByProfile.research.get("093_classroom_schedule_compaction_parity.cql")
)
  throw new Error("MIGRATION_033_RECONCILIATION_MISMATCH");

for (const profile of ["dev", "research"]) {
  const body = bodyByProfile[profile].get("094_ai_token_usage.cql");
  const factor = profile === "dev" ? 1 : 3;
  if (
    !body.includes(`'ailss_dc':${factor}`) ||
    !body.includes("CREATE KEYSPACE IF NOT EXISTS ai_service") ||
    !body.includes("CREATE TABLE IF NOT EXISTS ai_service.ai_token_usage")
  )
    throw new Error(`MIGRATION_094_AI_SERVICE_SCHEMA_MISMATCH ${profile}`);
}
const grants = await readFile(new URL("database/grants/grants.cql", root), "utf8");
if (
  !grants.includes("GRANT SELECT ON KEYSPACE ai_service TO svc_ai;") ||
  !grants.includes("GRANT MODIFY ON KEYSPACE ai_service TO svc_ai;")
)
  throw new Error("MIGRATION_094_AI_SERVICE_GRANTS_MISSING");

const bootstrap = await readFile(new URL("scripts/dev/bootstrap-cassandra.mjs", root), "utf8");
if (!bootstrap.includes("registry.migrations.map")) throw new Error("BOOTSTRAP_NOT_REGISTRY_DRIVEN");

console.log(
  `Migration bootstrap parity verified: ${expected.length} registry-driven migrations in dev and research.`,
);
