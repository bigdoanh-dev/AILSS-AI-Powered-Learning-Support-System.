import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const root = process.cwd();
const roots = ["apps", "packages"];
const sourceFiles = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", "dist", "coverage", ".expo"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if ([".ts", ".tsx", ".js", ".mjs"].includes(extname(entry.name))) sourceFiles.push(resolve(path));
  }
}
for (const directory of roots) await walk(resolve(root, directory));

const known = new Set(sourceFiles);
const inbound = new Map(sourceFiles.map((file) => [file, 0]));
const markers = [];
for (const file of sourceFiles) {
  const body = await readFile(file, "utf8");
  for (const match of body.matchAll(/(?:from\s+|import\s*\(|require\s*\()\s*["']([^"']+)["']/gu)) {
    const specifier = match[1];
    if (!specifier?.startsWith(".")) continue;
    const base = resolve(file, "..", specifier.replace(/\.js$/u, ""));
    const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, join(base, "index.ts"), join(base, "index.tsx")];
    const target = candidates.find((candidate) => known.has(candidate));
    if (target) inbound.set(target, (inbound.get(target) ?? 0) + 1);
  }
  for (const match of body.matchAll(/\b(TODO|FIXME|HACK|XXX|MOCK|DEMO|fallback)\b/giu)) {
    const before = body.slice(0, match.index);
    markers.push({ file: relative(root, file), line: before.split("\n").length, marker: match[1].toUpperCase() });
  }
}

const entryPattern = /(?:^|\/)(?:server|index|worker|vite\.config|app\.config|metro\.config|eslint\.config)\.(?:ts|tsx|js|mjs)$/u;
const testPattern = /(?:\/tests?\/|\.test\.|\.spec\.)/u;
const frameworkOrExecutablePattern = /(?:\/apps\/mobile\/app\/|\/scripts\/|\/src\/main\.tsx$)/u;
const frameworkDiscovered = [...inbound.entries()]
  .filter(([file, count]) => count === 0 && frameworkOrExecutablePattern.test(file))
  .map(([file]) => relative(root, file))
  .sort();
const candidates = [...inbound.entries()]
  .filter(([file, count]) => count === 0 && !entryPattern.test(file) && !testPattern.test(file) && !frameworkOrExecutablePattern.test(file))
  .map(([file]) => relative(root, file))
  .sort();

const report = {
  generatedAt: new Date().toISOString(),
  sourceFiles: sourceFiles.length,
  unreferencedCandidates: candidates,
  frameworkDiscoveredOrExecutable: frameworkDiscovered,
  markerCount: markers.length,
  productionMarkers: markers.filter((item) => !testPattern.test(item.file)),
};
const corePattern = /^(?:apps\/web\/src\/student\/(?:StudyPlan|AiTutor)\.tsx|apps\/web\/server\/(?:student|session)\.mjs|apps\/api-gateway\/src\/(?:assistant|adaptive-learning)-proxy\.ts|apps\/learning-service\/src\/(?:adaptive|materials)\/|apps\/ai-service\/src\/assistant\/|apps\/assessment-service\/src\/(?:schedule-internal-router|service|repository)\.ts)/u;
report.coreMarkerClassifications = report.productionMarkers
  .filter((item) => corePattern.test(item.file))
  .map((item) => ({ ...item,
    classification: item.file.includes("ai-tutor-eval-") ? "TEST_ONLY"
      : item.file === "apps/web/server/session.mjs" && item.line >= 425 ? "OUTSIDE_CORE_DEFERRED"
        : "REACHABLE_RUNTIME_REVIEW_REQUIRED",
    rationale: item.file.includes("ai-tutor-eval-") ? "Offline evaluation harness; not imported by the production server."
      : item.file === "apps/web/server/session.mjs" && item.line >= 425 ? "Lecturer roster compatibility path; outside the selected Student Phase 40 core navigation."
        : "Marker is on the selected Phase 40 production call graph and requires review.",
  }));
report.coreRuntime = {
  scope: "Student login -> Mastery -> Study Plan -> AI Tutor -> material retrieval -> citation",
  unresolvedHighConfidenceFindings: report.coreMarkerClassifications.filter((item) => item.classification === "REACHABLE_RUNTIME_REVIEW_REQUIRED").length,
  status: report.coreMarkerClassifications.some((item) => item.classification === "REACHABLE_RUNTIME_REVIEW_REQUIRED") ? "OPEN" : "PASS",
};
await mkdir(resolve(root, "artifacts/runtime-audit"), { recursive: true });
await writeFile(resolve(root, "artifacts/runtime-audit/dead-code-audit.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
