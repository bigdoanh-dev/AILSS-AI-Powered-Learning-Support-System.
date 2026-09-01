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
for (const port of [8080, 9042, 5672, 15672, 9000, 9001])
  checks.push({ name: `port-${port}`, pass: await portFree(port), value: "must be free before startup" });
console.log(JSON.stringify({ profile, checks }, null, 2));
if (checks.some((check) => !check.pass)) process.exitCode = 1;
