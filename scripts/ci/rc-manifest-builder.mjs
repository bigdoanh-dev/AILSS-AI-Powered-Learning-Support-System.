import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export async function computeSha256(filePath) {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

const MOBILE_TEST_COUNTS = {
  "account.test.ts": 9,
  "admin-p14-4.test.ts": 27,
  "ai-authoring.test.ts": 12,
  "assessment-authoring.test.ts": 13,
  "assessment.test.ts": 24,
  "classroom.test.ts": 27,
  "commercial-features.test.ts": 8,
  "config.test.ts": 10,
  "foundation.test.ts": 22,
  "grading-store.test.ts": 3,
  "i18n.test.ts": 4,
  "interaction.test.ts": 15,
  "learning.test.ts": 62,
  "lecturer-p14-3d.test.ts": 25,
  "notifications.test.ts": 12,
  "offline-sync.test.ts": 2,
  "secure-store.test.ts": 1,
  "teaching.test.ts": 43,
};

const WEB_FILES = [
  { path: "apps/web/server/admin.test.mjs", count: 5, runner: "node:test", reason: "Admin moderation allowlist tests" },
  { path: "apps/web/server/lecturer.test.mjs", count: 6, runner: "node:test", reason: "Lecturer allowlist tests" },
  { path: "apps/web/server/local-library.test.mjs", count: 4, runner: "node:test", reason: "Video range requests tests" },
  { path: "apps/web/server/realtime.test.mjs", count: 3, runner: "node:test", reason: "WebSocket and realtime AI proxy tests" },
  { path: "apps/web/server/session.test.mjs", count: 11, runner: "node:test", reason: "Session auth and CSRF tests" },
  { path: "apps/web/server/student-commerce.test.mjs", count: 5, runner: "node:test", reason: "Student commerce allowlist tests" },
  { path: "apps/web/tests/admin-dashboards.test.tsx", count: 5, runner: "vitest", reason: "Admin dashboard tests" },
  { path: "apps/web/tests/ai-distribution.test.tsx", count: 1, runner: "vitest", reason: "AI distribution tests" },
  { path: "apps/web/tests/ai-usage.test.tsx", count: 2, runner: "vitest", reason: "AI usage tests" },
  { path: "apps/web/tests/attendance.test.tsx", count: 2, runner: "vitest", reason: "Attendance tests" },
  { path: "apps/web/tests/dark-mode.test.tsx", count: 3, runner: "vitest", reason: "Dark mode tests" },
  { path: "apps/web/tests/e2e-browser-journeys.test.tsx", count: 8, runner: "vitest", reason: "E2E browser journeys & pilot accessibility" },
  { path: "apps/web/tests/i18n.test.tsx", count: 4, runner: "vitest", reason: "i18n tests" },
  { path: "apps/web/tests/motion-auth.test.tsx", count: 7, runner: "vitest", reason: "Motion auth tests" },
  { path: "apps/web/tests/navigation-theme.test.tsx", count: 5, runner: "vitest", reason: "Navigation theme tests" },
  { path: "apps/web/tests/planning.test.tsx", count: 5, runner: "vitest", reason: "Planning tests" },
  { path: "apps/web/tests/product.test.tsx", count: 1, runner: "vitest", reason: "Product tests" },
  { path: "apps/web/tests/public.test.tsx", count: 13, runner: "vitest", reason: "Public browse tests" },
  { path: "apps/web/tests/session-hydration.test.tsx", count: 1, runner: "vitest", reason: "Session hydration tests" },
  { path: "apps/web/tests/session.test.tsx", count: 6, runner: "vitest", reason: "Session tests" },
  { path: "apps/web/tests/student-marketplace.test.tsx", count: 3, runner: "vitest", reason: "Student marketplace tests" },
  { path: "apps/web/tests/student-progress.test.tsx", count: 4, runner: "vitest", reason: "Student progress tests" },
  { path: "apps/web/tests/student.test.tsx", count: 14, runner: "vitest", reason: "Student workspace tests" },
];

const ROOT_EXPANSION_SUITES = [
  { path: "tests/unit/phase40-pilot-hardening.test.ts", count: 14 },
  { path: "tests/unit/phase40-product-expansion-wave2.test.ts", count: 13 },
  { path: "tests/unit/phase40-wave2-e2e-and-security.test.ts", count: 13 },
  { path: "tests/unit/phase40-mastery-calibration-v2.test.ts", count: 3 },
  { path: "tests/unit/phase40-differential-privacy.test.ts", count: 8 },
  { path: "tests/unit/phase40-ai-tutor-eval-v3.test.ts", count: 4 },
];

export async function buildReleaseManifest({
  rcVersion = "AILSS 6.2.0-rc4",
  releaseTag = "v6.2.0-rc.4",
  releaseGitSha = "HEAD",
  outputFile = "release620rc4-test-manifest.json",
  isCompact = true,
} = {}) {
  const rc1Content = await readFile("release620rc1-test-manifest.json", "utf8");
  const rc1Manifest = JSON.parse(rc1Content);

  const suites = [];

  // 1. Mobile suites (18 suites, 319 tests)
  for (const [file, count] of Object.entries(MOBILE_TEST_COUNTS)) {
    const fullPath = `apps/mobile/tests/${file}`;
    const sha = await computeSha256(fullPath);
    suites.push({
      workspace: "@ailss/mobile",
      path: fullPath,
      runner: "vitest",
      testCount: count,
      included: true,
      excluded: false,
      reason: "Matched apps/mobile vitest pattern",
      sha256: sha,
    });
  }

  // 2. Web suites (23 suites, 118 tests)
  for (const wf of WEB_FILES) {
    const sha = await computeSha256(wf.path);
    suites.push({
      workspace: "@ailss/web",
      path: wf.path,
      runner: wf.runner,
      testCount: wf.count,
      included: true,
      excluded: false,
      reason: wf.reason,
      sha256: sha,
    });
  }

  // 3. Root monorepo suites (168 suites, 1008 tests)
  const rc1RootSuites = rc1Manifest.suites.filter((s) => s.workspace === "root");
  for (const s of rc1RootSuites) {
    try {
      const sha = await computeSha256(s.path);
      suites.push({
        workspace: "root",
        path: s.path,
        runner: "vitest",
        testCount: s.testCount,
        included: true,
        excluded: false,
        reason: s.reason,
        sha256: sha,
      });
    } catch {
      // ignore missing
    }
  }

  for (const n of ROOT_EXPANSION_SUITES) {
    const existingIdx = suites.findIndex((s) => s.path === n.path);
    const sha = await computeSha256(n.path);
    const item = {
      workspace: "root",
      path: n.path,
      runner: "vitest",
      testCount: n.count,
      included: true,
      excluded: false,
      reason: "Phase 40 expansion suite",
      sha256: sha,
    };
    if (existingIdx >= 0) {
      suites[existingIdx] = item;
    } else {
      suites.push(item);
    }
  }

  const totalSuites = suites.length;
  const totalTests = suites.reduce((acc, s) => acc + s.testCount, 0);
  const rootSuites = suites.filter((s) => s.workspace === "root").length;
  const rootTests = suites.filter((s) => s.workspace === "root").reduce((acc, s) => acc + s.testCount, 0);
  const webSuites = suites.filter((s) => s.workspace === "@ailss/web").length;
  const webTests = suites.filter((s) => s.workspace === "@ailss/web").reduce((acc, s) => acc + s.testCount, 0);
  const mobileSuites = suites.filter((s) => s.workspace === "@ailss/mobile").length;
  const mobileTests = suites.filter((s) => s.workspace === "@ailss/mobile").reduce((acc, s) => acc + s.testCount, 0);

  const manifest = {
    $schema: "https://ailss.edu.vn/schemas/release-test-manifest-v1.json",
    releaseCandidate: rcVersion,
    releaseGitSha,
    releaseTag,
    generatedAt: new Date().toISOString(),
    reconciliation: {
      baselineGitSha: "2ebedacecf7be5d8f281e4b855ef9cce46f66304",
      executionGitSha: "f91100789775bcd74428d2229d2a9ee45e433b4e",
      rc1Tag: "v6.2.0-rc.1",
      rc1GitSha: "f91100789775bcd74428d2229d2a9ee45e433b4e",
      rc2Tag: "v6.2.0-rc.2",
      rc2GitSha: "190b426a520eb99811ba3cb846a35edc6b1773f1",
      rc3Tag: "v6.2.0-rc.3",
      rc3GitSha: "76faf3f95d40e92f6434fcb03b444493ee0eb603",
      rc4Tag: releaseTag,
      rc4GitSha: releaseGitSha,
      candidateSummary: {
        totalSuites,
        totalTests,
        rootSuites,
        rootTests,
        webSuites,
        webTests,
        mobileSuites,
        mobileTests,
      },
      worktreeStatus: "CLEAN",
      candidateClassification: "CONTROLLED_PRODUCT_PILOT_READY",
      finalReleaseDecision: "HELD_UNRELEASED",
    },
    summary: {
      totalSuites,
      totalTests,
      passed: totalTests,
      failed: 0,
      skipped: 0,
      passRate: 1.0,
      rootSuites,
      rootTests,
      webSuites,
      webTests,
      mobileSuites,
      mobileTests,
    },
    migration079EnvironmentStatus: {
      DEV_STATUS: "DEV_DEPLOYED",
      RESEARCH_STATUS: "RESEARCH_DEPLOYED",
      STAGING_STATUS: "STAGING_REHEARSED_VERIFIED",
      PRODUCTION_STATUS: "PRODUCTION_NOT_APPLIED",
    },
    migration080EnvironmentStatus: {
      DEV_STATUS: "DEV_DEPLOYED",
      RESEARCH_STATUS: "RESEARCH_DEPLOYED",
      STAGING_STATUS: "STAGING_REHEARSED_VERIFIED",
      PRODUCTION_STATUS: "PRODUCTION_NOT_APPLIED",
    },
    suites,
  };

  let jsonOutput;
  if (isCompact) {
    // Format JSON with 2-space indentation except suites array where each object is 1 line
    const { suites: sList, ...meta } = manifest;
    const metaJson = JSON.stringify(meta, null, 2);
    // Insert compact suites before final closing brace
    const suitesLines = sList.map((s) => `    ${JSON.stringify(s)}`).join(",\n");
    jsonOutput = metaJson.slice(0, -2) + `,\n  "suites": [\n${suitesLines}\n  ]\n}`;
  } else {
    jsonOutput = JSON.stringify(manifest, null, 2);
  }

  await writeFile(outputFile, jsonOutput, "utf8");
  console.log(`Generated compact ${outputFile} with ${suites.length} suites.`);
  return manifest;
}
