import { execFileSync } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const containers = [
  "ailss-api-gateway",
  "ailss-identity-service",
  "ailss-learning-service",
  "ailss-assessment-service",
  "ailss-interaction-service",
  "ailss-notification-worker",
];
const results = [];
for (const container of containers) {
  const raw = execFileSync("docker", ["logs", "--since", "45m", container], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const leaks =
    /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|p123-[a-z-]+[a-f0-9-]{36}@example\.test|Web-P123!|"correctAnswer"\s*:/g;
  const matches = raw.match(leaks) || [];
  assert.equal(matches.length, 0, container + " sensitive log matches");
  results.push({ container, lines: raw.split("\n").length, sensitiveMatches: 0 });
}
const adapter = await readFile("apps/web/server/session.mjs", "utf8");
assert(!/console\.(log|debug|info)/.test(adapter));
await mkdir("docs/evidence/p12.3-security", { recursive: true });
await writeFile(
  "docs/evidence/p12.3-security/report.json",
  JSON.stringify(
    {
      status: "PASS",
      scope:
        "bounded 45-minute local container stdout scan; adapter has no request logging; fixture browser storage/DOM and real adapter payload assertions are separate",
      results,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ status: "PASS", containers: results.length }));
