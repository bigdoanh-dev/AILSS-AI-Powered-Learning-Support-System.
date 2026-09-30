import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";

const root = process.cwd();
const outputPath = "phase40-rc5-change-inventory.json";
const raw = execFileSync("git", ["status", "--porcelain=v1", "-uall", "-z"], { cwd: root });
const entries = raw.toString("utf8").split("\0").filter(Boolean);
const historicalEvidence = (path) =>
  /^(artifacts\/release-evidence\/|(?:api-|backup-|break-|d0-|deployment-|dns-|finops-|iam-|metric-|payment-|phase\d+|pilot-|production-|regional-|release\d+|sbom\.|test-discovery))/u.test(
    path,
  );
const generatedLocal = (path) =>
  path === "artifacts/release-evidence/rc5-test-discovery.json" ||
  path.startsWith("artifacts/release-evidence/revision-l/") ||
  path.startsWith("artifacts/runtime-audit/") ||
  path.startsWith("artifacts/load-evidence/");

function category(path) {
  if (generatedLocal(path)) return "LOCAL_PRETAG_EVIDENCE_EXCLUDED";
  if (path.startsWith("database/migrations/") || path.startsWith("database/migration-"))
    return "MIGRATION_REQUIRED";
  if (
    path.startsWith("tests/") ||
    path.startsWith("apps/web/tests/") ||
    path.endsWith(".test.mjs") ||
    path.includes("verify-phase40") ||
    path.includes("acceptance/") ||
    path.includes("run-rc5-canonical") ||
    path.includes("verify-clean-cassandra")
  )
    return "TEST_REQUIRED";
  if (path.startsWith("docs/") || path === "README.md" || path.endsWith("/README.md"))
    return "DOCUMENTATION_REQUIRED";
  if (
    historicalEvidence(path) ||
    path.startsWith("artifacts/") ||
    path.includes("manifest") ||
    path === "lint-baseline.json" ||
    path === "phase40-pilot-feature-scope.json" ||
    path === outputPath
  )
    return "RELEASE_EVIDENCE_REQUIRED";
  if (path.startsWith("scripts/ci/") || path === ".github/workflows/ci.yml") return "TEST_REQUIRED";
  return "RUNTIME_REQUIRED";
}

function origin(path) {
  const match = /PHASE_40_REVISION_([F-M])/iu.exec(path);
  if (match) return `Revision ${match[1].toUpperCase()}`;
  if (path.includes("revision-l") || path.includes("rc5")) return "Revision L/M";
  if (
    path.includes("081_") ||
    path.includes("082_") ||
    path.includes("federation") ||
    path.includes("finance") ||
    path.includes("commerce")
  )
    return "Phase 40, Revisions F–H";
  if (path.includes("083_") || path.includes("084_") || path.includes("adaptive") || path.includes("mastery"))
    return "Phase 40, Revisions I–K";
  if (historicalEvidence(path)) return "Historical phase evidence relocation";
  return "Phase 40 accumulated working tree; exact revision not proven";
}

function classify(status, path) {
  const classification = category(path);
  const deleted = status.includes("D");
  return {
    path,
    changeType:
      status === "??" ? "UNTRACKED" : deleted ? "DELETED" : status.includes("A") ? "ADDED" : "MODIFIED",
    originPhaseRevision: origin(path),
    runtimeImpact: ["RUNTIME_REQUIRED", "MIGRATION_REQUIRED"].includes(classification),
    intendedForRC5: classification !== "LOCAL_PRETAG_EVIDENCE_EXCLUDED",
    classification,
    reason:
      classification === "LOCAL_PRETAG_EVIDENCE_EXCLUDED"
        ? "Generated against the pre-tag local working tree; must be regenerated from clean RC5."
        : deleted && historicalEvidence(path)
          ? "Historical evidence is relocated to artifacts/release-evidence; preserve content and remove root duplicate."
          : `${classification} for accumulated Phase 40 release scope; see RC4-to-RC5 diff review.`,
  };
}

const files = entries.map((entry) => classify(entry.slice(0, 2), entry.slice(3)));
if (!files.some((item) => item.path === outputPath)) files.push(classify("??", outputPath));
files.sort((a, b) => a.path.localeCompare(b.path));
const summary = Object.fromEntries(
  [...new Set(files.map((item) => item.classification))]
    .sort()
    .map((name) => [name, files.filter((item) => item.classification === name).length]),
);
await writeFile(
  outputPath,
  `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), baseTag: "v6.2.0-rc.4", workingTreeOnly: true, files, summary }, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify({ files: files.length, summary })}\n`);
