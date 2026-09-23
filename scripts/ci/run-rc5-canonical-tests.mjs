import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const releaseLabel = process.argv.includes("--rc6") ? "rc6" : "rc5";
const temp = await mkdtemp(join(tmpdir(), "ailss-rc5-tests-"));
const groups = [];

try {
  const rootVitest = await vitestGroup("ROOT_VITEST", root, join(temp, "root.json"));
  const migrationSuites = rootVitest.suites.filter((suite) => suite.category === "MIGRATION");
  const regularRootSuites = rootVitest.suites.filter((suite) => suite.category !== "MIGRATION");
  groups.push(groupFromSuites("ROOT_VITEST", "vitest", regularRootSuites));
  groups.push(groupFromSuites("MIGRATION", "vitest", migrationSuites));
  groups.push(await vitestGroup("WEB_VITEST", join(root, "apps/web"), join(temp, "web.json")));
  groups.push(await nodeGroup());
  groups.push(await vitestGroup("MOBILE", join(root, "apps/mobile"), join(temp, "mobile.json")));
  groups.push(await commandGroup("BROWSER_E2E", "pnpm", ["--filter", "@ailss/web", "verify:phase40:revision-l"], "apps/web/scripts/verify-phase40-revision-l.mjs"));

  const suites = groups.flatMap((group) => group.suites);
  const paths = suites.map((suite) => suite.path);
  const duplicateSuites = paths.length - new Set(paths).size;
  const duplicatePaths = new Set(paths.filter((path, index) => paths.indexOf(path) !== index));
  const duplicateTests = suites
    .filter((suite) => duplicatePaths.has(suite.path))
    .reduce((total, suite) => total + (suite.testCount ?? 0), 0);
  const totals = groups.reduce((value, group) => ({
    tests: value.tests + group.total,
    passed: value.passed + group.passed,
    failed: value.failed + group.failed,
    skipped: value.skipped + group.skipped,
  }), { tests: 0, passed: 0, failed: 0, skipped: 0 });
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    terminology: { rootOnly: "ROOT_TESTS", aggregate: "CANONICAL_RC_TESTS" },
    source: "runner-discovery",
    groups: groups.map(({ suites: _suites, ...group }) => group),
    summary: {
      uniqueSuites: suites.length - duplicateSuites,
      uniqueTests: totals.tests - duplicateTests,
      passed: totals.passed,
      failed: totals.failed,
      skipped: totals.skipped,
      duplicateSuites,
      duplicateTests,
    },
    suites,
  };
  await mkdir(join(root, "artifacts/release-evidence"), { recursive: true });
  await writeFile(join(root, `artifacts/release-evidence/${releaseLabel}-test-discovery.json`), `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(output.summary)}\n`);
  if (totals.failed > 0) process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}

async function vitestGroup(name, cwd, outputFile) {
  await run("pnpm", ["exec", "vitest", "run", "--reporter=json", `--outputFile=${outputFile}`], cwd);
  const report = JSON.parse(await readFile(outputFile, "utf8"));
  const suites = await Promise.all(report.testResults.map(async (result) => suiteRecord(name, result.name, result.assertionResults)));
  return {
    name,
    runner: "vitest",
    suiteCount: suites.length,
    total: report.numTotalTests,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    skipped: report.numPendingTests + report.numTodoTests,
    suites,
  };
}

async function nodeGroup() {
  const files = ["session", "lecturer", "admin", "student-commerce", "local-library", "realtime"]
    .map((name) => `apps/web/server/${name}.test.mjs`);
  const output = await run("node", ["--test", "--test-reporter=tap", ...files], root, true);
  const value = (label) => Number(new RegExp(`^# ${label} (\\d+)$`, "mu").exec(output)?.[1] ?? 0);
  const tests = output.split("\n").flatMap((line) => {
    const match = /^ok \d+ - (.+)$/u.exec(line.trim());
    return match?.[1] ? [{ name: match[1], status: "passed" }] : [];
  });
  const suites = await Promise.all(files.map(async (path) => ({
    path, category: "WEB_NODE", sha256: sha256(await readFile(join(root, path))),
    tests: [], testCount: null,
  })));
  return { name: "WEB_NODE", runner: "node:test", suiteCount: files.length, total: value("tests"), passed: value("pass"), failed: value("fail"), skipped: value("skipped"), suites, discoveredTestNames: tests };
}

async function suiteRecord(group, absolutePath, assertions) {
  const path = relative(root, resolve(absolutePath));
  const category = group === "ROOT_VITEST" && /migration|cassandra-bootstrap/u.test(path) ? "MIGRATION" : group;
  return {
    path, category, sha256: sha256(await readFile(join(root, path))), testCount: assertions.length,
    tests: assertions.map((test) => ({ name: test.fullName, status: test.status })),
  };
}

function groupFromSuites(name, runner, suites) {
  const tests = suites.flatMap((suite) => suite.tests);
  return { name, runner, suiteCount: suites.length, total: tests.length,
    passed: tests.filter((test) => test.status === "passed").length,
    failed: tests.filter((test) => test.status === "failed").length,
    skipped: tests.filter((test) => !["passed", "failed"].includes(test.status)).length, suites };
}

async function commandGroup(name, command, args, path) {
  const output = await run(command, args, root, true);
  const resultLine = output.split("\n").findLast((line) => line.startsWith("{") && line.includes('"browserGoldenPath"'));
  if (!resultLine) throw new Error(`BROWSER_RESULT_MISSING\n${output}`);
  const result = JSON.parse(resultLine);
  const tests = Object.entries(result)
    .filter(([key]) => key !== "networkRequests")
    .map(([name, status]) => ({ name, status: status === "PASS" ? "passed" : "failed" }));
  if (!tests.length || tests.some((test) => test.status !== "passed")) throw new Error(`BROWSER_ASSERTION_FAILED\n${resultLine}`);
  return { name, runner: "playwright", suiteCount: 1, total: tests.length, passed: tests.length, failed: 0, skipped: 0,
    suites: [{ path, category: name, sha256: sha256(await readFile(join(root, path))), testCount: tests.length, tests }] };
}

function run(command, args, cwd, capture = false) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    let output = "";
    if (capture) {
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.stderr.on("data", (chunk) => { output += chunk; });
    }
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolveRun(output) : reject(new Error(`${command} exited ${String(code)}\n${output}`)));
  });
}

function sha256(content) { return createHash("sha256").update(content).digest("hex"); }
