import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const profile = process.env.AILSS_PROFILE ?? "research";
const runId = process.env.AILSS_RUN_ID ?? new Date().toISOString().replaceAll(/[:.]/g, "-");
const dir = new URL(`../../docs/evidence/${runId}/`, import.meta.url);
await mkdir(dir, { recursive: true });
function safeDocker(args) {
  try {
    return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    return `FAILED:${error instanceof Error ? error.message.split("\n")[0] : "unknown"}`;
  }
}
const ps = safeDocker(["compose", "--env-file", ".env", "--profile", profile, "ps", "--format", "json"]);
await writeFile(new URL("compose-ps.jsonl", dir), ps);
if (profile === "research") {
  await writeFile(
    new URL("nodetool-status.txt", dir),
    safeDocker(["exec", "ailss-cassandra-node1", "nodetool", "status"]),
  );
  await writeFile(
    new URL("schema-versions.txt", dir),
    safeDocker(["exec", "ailss-cassandra-node1", "nodetool", "describecluster"]),
  );
}
const files = [
  "docker-compose.yml",
  "docker-compose.async.yml",
  "contracts/api-registry.json",
  "contracts/query-registry.json",
  "contracts/event-registry.json",
];
const checksums = {};
for (const file of files)
  checksums[file] = createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
await writeFile(
  new URL("artifact-checksums.json", dir),
  `${JSON.stringify({ runId, profile, checksums }, null, 2)}\n`,
);
console.log(JSON.stringify({ stage: "evidence", status: "PASS", runId, profile }));
