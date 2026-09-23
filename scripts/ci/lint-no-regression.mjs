import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { relative } from "node:path";

const baselinePath = new URL("../../lint-baseline.json", import.meta.url);
const eslint = spawnSync("pnpm", ["exec", "eslint", "apps", "packages", "--format", "json", "--no-warn-ignored"], {
  cwd: new URL("../../", import.meta.url),
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});
if (!eslint.stdout.trim()) throw new Error(`LINT_EXECUTION_FAILED: ${eslint.stderr}`);

const results = JSON.parse(eslint.stdout);
const issues = results.flatMap((result) => result.messages
  .filter((message) => message.severity > 0)
  .map((message) => ({
    file: relative(new URL("../../", import.meta.url).pathname, result.filePath),
    rule: message.ruleId ?? "parser",
    severity: message.severity === 2 ? "error" : "warning",
    line: message.line,
    column: message.column,
  })));
const signature = (issue) => `${issue.file}\u0000${issue.rule}\u0000${issue.severity}`;
const counts = (list) => list.reduce((map, issue) => map.set(signature(issue), (map.get(signature(issue)) ?? 0) + 1), new Map());

if (process.argv.includes("--update")) {
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  await writeFile(baselinePath, `${JSON.stringify({
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    baselineCommit: commit,
    scope: ["apps", "packages"],
    existingIssueCount: issues.length,
    issues,
  }, null, 2)}\n`);
  console.log(`Lint baseline updated with ${issues.length} production-source issues.`);
  process.exit(0);
}

const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const allowed = counts(baseline.issues);
const current = counts(issues);
const regressions = [...current].filter(([key, count]) => count > (allowed.get(key) ?? 0));
if (regressions.length > 0) {
  console.error(JSON.stringify({ status: "FAIL", baselineIssueCount: baseline.existingIssueCount, currentIssueCount: issues.length, regressions }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ status: "PASS", baselineIssueCount: baseline.existingIssueCount, currentIssueCount: issues.length, newIssues: 0 }));
