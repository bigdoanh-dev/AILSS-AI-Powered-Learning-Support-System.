import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = new Map([
  [
    "app/admin/stats/index.tsx",
    { "@typescript-eslint/no-unused-vars": 3, "@typescript-eslint/no-explicit-any": 2 },
  ],
  ["app/teaching/classes/index.tsx", { "@typescript-eslint/no-unused-vars": 3 }],
  ["app/teaching/courses/[courseId]/reviews.tsx", { "@typescript-eslint/no-unused-vars": 2 }],
  ["app/teaching/index.tsx", { "@typescript-eslint/no-unused-vars": 1 }],
  ["app/teaching/reports/index.tsx", { "@typescript-eslint/no-unused-vars": 1 }],
  ["app/teaching/schedule.tsx", { "@typescript-eslint/no-unused-vars": 1 }],
  ["src/AuthFeedback.tsx", { "@typescript-eslint/no-unused-vars": 3 }],
  ["src/learning.ts", { "@typescript-eslint/no-explicit-any": 1 }],
  ["src/motion.tsx", { "no-useless-escape": 1 }],
  ["tests/i18n.test.ts", { "@typescript-eslint/no-unused-vars": 1 }],
]);

const result = spawnSync("pnpm", ["exec", "eslint", ".", "--format", "json"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
if (result.error) throw result.error;
let reports;
try {
  reports = JSON.parse(result.stdout);
} catch {
  process.stderr.write(result.stderr || result.stdout || "ESLint produced no JSON output\n");
  process.exit(2);
}

const violations = [];
for (const report of reports) {
  const relative = path.relative(root, report.filePath).split(path.sep).join("/");
  const actual = new Map();
  for (const diagnostic of report.messages) {
    if (diagnostic.severity !== 2 || !diagnostic.ruleId) continue;
    actual.set(diagnostic.ruleId, (actual.get(diagnostic.ruleId) ?? 0) + 1);
  }
  const allowed = baseline.get(relative) ?? {};
  for (const [rule, count] of actual) {
    const maximum = allowed[rule] ?? 0;
    if (count > maximum) violations.push(`${relative}:${rule} baseline=${maximum} actual=${count}`);
  }
}

const actualTotal = reports.reduce((sum, report) => sum + report.errorCount, 0);
const resultSummary = {
  status: violations.length ? "FAIL" : "PASS",
  baselineErrors: [...baseline.values()].reduce(
    (sum, rules) => sum + Object.values(rules).reduce((a, b) => a + b, 0),
    0,
  ),
  actualErrors: actualTotal,
  newIssues: violations,
};
process.stdout.write(`${JSON.stringify(resultSummary)}\n`);
if (violations.length || (result.status !== 0 && actualTotal === 0)) process.exit(1);
