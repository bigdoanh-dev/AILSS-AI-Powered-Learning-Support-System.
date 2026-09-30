import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";

const baselinePath = new URL("../../lint-baseline.json", import.meta.url);
const rootPath = fileURLToPath(new URL("../../", import.meta.url));
const eslint = spawnSync(
  "pnpm",
  ["exec", "eslint", "apps", "packages", "--format", "json", "--no-warn-ignored"],
  {
    cwd: rootPath,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  },
);
if (!eslint.stdout.trim()) throw new Error(`LINT_EXECUTION_FAILED: ${eslint.stderr}`);

const results = JSON.parse(eslint.stdout);
const issues = results.flatMap((result) =>
  result.messages
    .filter((message) => message.severity > 0)
    .map((message) => ({
      relativePath: relative(rootPath, result.filePath).replaceAll("\\", "/"),
      ruleId: message.ruleId ?? "parser",
      severity: message.severity === 2 ? "error" : "warning",
      line: message.line,
      column: message.column,
      messageFingerprint: createHash("sha256").update(message.message).digest("hex"),
    })),
);
const signature = (issue) =>
  `${issue.relativePath}\u0000${issue.ruleId}\u0000${issue.severity}\u0000${issue.messageFingerprint}`;
const counts = (list) =>
  list.reduce((map, issue) => map.set(signature(issue), (map.get(signature(issue)) ?? 0) + 1), new Map());

if (process.argv.includes("--update")) {
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  await writeFile(
    baselinePath,
    `${JSON.stringify(
      {
        schemaVersion: "1.0.0",
        generatedAt: new Date().toISOString(),
        baselineCommit: commit,
        scope: ["apps", "packages"],
        existingIssueCount: issues.length,
        issues,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Lint baseline updated with ${issues.length} production-source issues.`);
  process.exit(0);
}

const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const allowed = counts(baseline.issues);
const current = counts(issues);
const regressions = [...current].filter(([key, count]) => count > (allowed.get(key) ?? 0));
if (regressions.length > 0) {
  console.error(
    JSON.stringify(
      {
        status: "FAIL",
        baselineIssueCount: baseline.existingIssueCount,
        currentIssueCount: issues.length,
        regressions,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
console.log(
  JSON.stringify({
    status: "PASS",
    baselineIssueCount: baseline.existingIssueCount,
    currentIssueCount: issues.length,
    newIssues: 0,
  }),
);
