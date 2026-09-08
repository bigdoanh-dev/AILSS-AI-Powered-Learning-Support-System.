import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { statfs } from "node:fs/promises";
import os from "node:os";

const profile = process.argv[2] ?? process.env.AILSS_PROFILE ?? "dev-core";
const checks = [];
function command(name, args) {
  try {
    const value = execFileSync(name, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    checks.push({ name: `${name} ${args.join(" ")}`, pass: true, value });
  } catch (error) {
    checks.push({
      name: `${name} ${args.join(" ")}`,
      pass: false,
      value: error instanceof Error ? error.message : "failed",
    });
  }
}
command("docker", ["--version"]);
command("docker", ["compose", "version"]);
command("docker", ["info", "--format", "{{.ServerVersion}}"]);
const memoryGiB = os.totalmem() / 1024 ** 3;
checks.push({
  name: "host-memory",
  pass: profile !== "research" || memoryGiB >= 14,
  value: `${memoryGiB.toFixed(1)} GiB`,
});
const disk = await statfs(".");
const freeRatio = disk.bavail / disk.blocks;
checks.push({ name: "disk-free", pass: freeRatio >= 0.15, value: `${(freeRatio * 100).toFixed(1)}%` });
async function portFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}
function dockerPortOwners(port) {
  try {
    return execFileSync("docker", ["ps", "--filter", `publish=${port}`, "--format", "{{.Names}}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .trim()
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}
const expectedPortOwners = new Map([
  [8080, new Set(["ailss-api-gateway"])],
  [9042, new Set(["ailss-cassandra-dev", "ailss-cassandra-node1"])],
  [5672, new Set(["ailss-rabbitmq"])],
  [15672, new Set(["ailss-rabbitmq"])],
  [9000, new Set(["ailss-minio"])],
  [9001, new Set(["ailss-minio"])],
]);
for (const [port, expectedOwners] of expectedPortOwners) {
  const free = await portFree(port);
  const owners = free ? [] : dockerPortOwners(port);
  const ownedByAilss = owners.length > 0 && owners.every((owner) => expectedOwners.has(owner));
  checks.push({
    name: `port-${port}`,
    pass: free || ownedByAilss,
    value: free
      ? "free"
      : ownedByAilss
        ? `already published by ${owners.join(", ")}`
        : owners.length
          ? `occupied by unexpected container: ${owners.join(", ")}`
          : "occupied by a non-Docker process",
  });
}
console.log(JSON.stringify({ profile, checks }, null, 2));
if (checks.some((check) => !check.pass)) process.exitCode = 1;
