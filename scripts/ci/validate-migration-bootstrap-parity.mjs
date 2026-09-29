import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const registry = JSON.parse(await readFile(new URL("database/migration-registry.json", root), "utf8"));
const inventory = JSON.parse(await readFile(new URL("database/migration-inventory.json", root), "utf8"));
const expected = registry.migrations.map((migration) => migration.filename);

if (registry.totalMigrations !== expected.length)
  throw new Error(
    `MIGRATION_REGISTRY_TOTAL_MISMATCH declared=${registry.totalMigrations} actual=${expected.length}`,
  );
if (inventory.summary.CANONICAL_LOGICAL_MIGRATIONS !== expected.length)
  throw new Error(
    `MIGRATION_INVENTORY_TOTAL_MISMATCH inventory=${inventory.summary.CANONICAL_LOGICAL_MIGRATIONS} registry=${expected.length}`,
  );

for (const profile of ["dev", "research"]) {
  const migrationDir = new URL(`database/migrations/${profile}/`, root);
  const actual = (await readdir(migrationDir)).filter((name) => name.endsWith(".cql")).sort();
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index]))
    throw new Error(
      `MIGRATION_FILE_PARITY_FAILED profile=${profile} expected=${expected.length} actual=${actual.length}`,
    );

  for (const [index, filename] of actual.entries()) {
    const digest = createHash("sha256")
      .update(await readFile(new URL(filename, migrationDir)))
      .digest("hex");
    const hashField = profile === "dev" ? "sha256Dev" : "sha256Research";
    if (digest !== registry.migrations[index][hashField])
      throw new Error(`MIGRATION_HASH_MISMATCH profile=${profile} file=${filename}`);
  }
}

const bootstrap = await readFile(new URL("scripts/dev/bootstrap-cassandra.mjs", root), "utf8");
if (!bootstrap.includes("registry.migrations.map")) throw new Error("BOOTSTRAP_NOT_REGISTRY_DRIVEN");

console.log(
  `Migration bootstrap parity verified: ${expected.length} registry-driven migrations in dev and research.`,
);
