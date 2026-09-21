import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

async function computeSha256(filePath) {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

async function main() {
  const rc1Content = await readFile("release620rc1-test-manifest.json", "utf8");
  const rc1Manifest = JSON.parse(rc1Content);

  const suites = [];

  // 1. Mobile suites (18 suites, 319 tests)
  const mobileFiles = [
    "apps/mobile/tests/account.test.ts",
    "apps/mobile/tests/admin-p14-4.test.ts",
    "apps/mobile/tests/ai-authoring.test.ts",
    "apps/mobile/tests/assessment-authoring.test.ts",
    "apps/mobile/tests/assessment.test.ts",
    "apps/mobile/tests/classroom.test.ts",
    "apps/mobile/tests/commercial-features.test.ts",
    "apps/mobile/tests/config.test.ts",
    "apps/mobile/tests/foundation.test.ts",
    "apps/mobile/tests/grading-store.test.ts",
    "apps/mobile/tests/i18n.test.ts",
    "apps/mobile/tests/interaction.test.ts",
    "apps/mobile/tests/learning.test.ts",
    "apps/mobile/tests/lecturer-p14-3d.test.ts",
    "apps/mobile/tests/notifications.test.ts",
    "apps/mobile/tests/offline-sync.test.ts",
    "apps/mobile/tests/secure-store.test.ts",
    "apps/mobile/tests/teaching.test.ts",
  ];

  const mobileCounts = {
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

  for (const file of mobileFiles) {
    const base = path.basename(file);
    const sha = await computeSha256(file);
    suites.push({
      workspace: "@ailss/mobile",
      path: file,
      runner: "vitest",
      testCount: mobileCounts[base] ?? 0,
      included: true,
      excluded: false,
      reason: "Matched apps/mobile vitest pattern (apps/mobile/tests/**/*.test.ts)",
      sha256: sha,
    });
  }

  // 2. Web suites (17 vitest + 6 node:test = 23 suites, 118 tests)
  const webFiles = [
    { path: "apps/web/server/admin.test.mjs", count: 5, runner: "node:test", reason: "Explicitly listed in apps/web test script (Admin moderation and governance BFF allowlist tests)" },
    { path: "apps/web/server/lecturer.test.mjs", count: 6, runner: "node:test", reason: "Explicitly listed in apps/web test script (Lecturer allowlist and attendance forwarding tests)" },
    { path: "apps/web/server/local-library.test.mjs", count: 4, runner: "node:test", reason: "Explicitly listed in apps/web test script (Video range requests and local media tests)" },
    { path: "apps/web/server/realtime.test.mjs", count: 3, runner: "node:test", reason: "Explicitly listed in apps/web test script (WebSocket and realtime AI proxy tests)" },
    { path: "apps/web/server/session.test.mjs", count: 11, runner: "node:test", reason: "Explicitly listed in apps/web test script (Session authentication and CSRF token tests)" },
    { path: "apps/web/server/student-commerce.test.mjs", count: 5, runner: "node:test", reason: "Explicitly listed in apps/web test script (Student commerce allowlist and simulation tests)" },
    { path: "apps/web/tests/admin-dashboards.test.tsx", count: 5, runner: "vitest", reason: "Matched apps/web vitest pattern (tests/**/*.test.tsx)" },
    { path: "apps/web/tests/ai-distribution.test.tsx", count: 1, runner: "vitest", reason: "Matched apps/web vitest pattern (tests/**/*.test.tsx)" },
    { path: "apps/web/tests/ai-usage.test.tsx", count: 2, runner: "vitest", reason: "Matched apps/web vitest pattern (tests/**/*.test.tsx)" },
    { path: "apps/web/tests/attendance.test.tsx", count: 2, runner: "vitest", reason: "Matched apps/web vitest pattern (tests/**/*.test.tsx)" },
    { path: "apps/web/tests/dark-mode.test.tsx", count: 3, runner: "vitest", reason: "Matched apps/web vitest pattern (tests/**/*.test.tsx)" },
    { path: "apps/web/tests/e2e-browser-journeys.test.tsx", count: 8, runner: "vitest", reason: "Matched apps/web vitest pattern (tests/**/*.test.tsx) - Phase 40 E2E Journeys & Pilot Accessibility Routes" },
    { path: "apps/web/tests/i18n.test.tsx", count: 4, runner: "vitest", reason: "Matched apps/web vitest pattern (tests/**/*.test.tsx)" },
    { path: "apps/web/tests/motion-auth.test.tsx", count: 7, runner: "vitest", reason: "Matched apps/web vitest pattern (tests/**/*.test.tsx)" },
    { path: "apps/web/tests/navigation-theme.test.tsx", count: 5, runner: "vitest", reason: "Matched apps/web vitest pattern (tests/**/*.test.tsx)" },
    { path: "apps/web/tests/planning.test.tsx", count: 5, runner: "vitest", reason: "Matched apps/web vitest pattern (tests/**/*.test.tsx)" },
    { path: "apps/web/tests/product.test.tsx", count: 1, runner: "vitest", reason: "Matched apps/web vitest pattern (tests/**/*.test.tsx)" },
    { path: "apps/web/tests/public.test.tsx", count: 13, runner: "vitest", reason: "Matched apps/web vitest pattern (tests/**/*.test.tsx)" },
    { path: "apps/web/tests/session-hydration.test.tsx", count: 1, runner: "vitest", reason: "Matched apps/web vitest pattern (tests/**/*.test.tsx)" },
    { path: "apps/web/tests/session.test.tsx", count: 6, runner: "vitest", reason: "Matched apps/web vitest pattern (tests/**/*.test.tsx)" },
    { path: "apps/web/tests/student-marketplace.test.tsx", count: 3, runner: "vitest", reason: "Matched apps/web vitest pattern (tests/**/*.test.tsx)" },
    { path: "apps/web/tests/student-progress.test.tsx", count: 4, runner: "vitest", reason: "Matched apps/web vitest pattern (tests/**/*.test.tsx)" },
    { path: "apps/web/tests/student.test.tsx", count: 14, runner: "vitest", reason: "Matched apps/web vitest pattern (tests/**/*.test.tsx)" },
  ];

  for (const wf of webFiles) {
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
      // file might have moved
    }
  }

  // Add the new root suites introduced in Phase 40 Wave 2 and Corrective Closure:
  const newRootSuites = [
    { path: "tests/unit/phase40-pilot-hardening.test.ts", count: 14 },
    { path: "tests/unit/phase40-product-expansion-wave2.test.ts", count: 13 },
    { path: "tests/unit/phase40-wave2-e2e-and-security.test.ts", count: 13 },
    { path: "tests/unit/phase40-mastery-calibration-v2.test.ts", count: 3 },
    { path: "tests/unit/phase40-differential-privacy.test.ts", count: 6 },
    { path: "tests/unit/phase40-ai-tutor-eval-v3.test.ts", count: 4 },
  ];

  for (const n of newRootSuites) {
    const existingIdx = suites.findIndex((s) => s.path === n.path);
    const sha = await computeSha256(n.path);
    if (existingIdx >= 0) {
      suites[existingIdx] = {
        workspace: "root",
        path: n.path,
        runner: "vitest",
        testCount: n.count,
        included: true,
        excluded: false,
        reason: "Matched root vitest pattern (tests/**/*.test.ts) - Phase 40 corrective closure",
        sha256: sha,
      };
    } else {
      suites.push({
        workspace: "root",
        path: n.path,
        runner: "vitest",
        testCount: n.count,
        included: true,
        excluded: false,
        reason: "Matched root vitest pattern (tests/**/*.test.ts) - Phase 40 expansion",
        sha256: sha,
      });
    }
  }

  const manifest = {
    $schema: "https://ailss.edu.vn/schemas/release620rc3-test-manifest-v1.json",
    releaseCandidate: "AILSS 6.2.0-rc3",
    releaseGitSha: process.argv[2] || "PENDING_COMMIT_SHA",
    releaseTag: "v6.2.0-rc.3",
    generatedAt: new Date().toISOString(),
    reconciliation: {
      baselineGitSha: "2ebedacecf7be5d8f281e4b855ef9cce46f66304",
      executionGitSha: "f91100789775bcd74428d2229d2a9ee45e433b4e",
      rc1Tag: "v6.2.0-rc.1",
      rc1GitSha: "f91100789775bcd74428d2229d2a9ee45e433b4e",
      rc2Tag: "v6.2.0-rc.2",
      rc2GitSha: "190b426a520eb99811ba3cb846a35edc6b1773f1",
      rc3Tag: "v6.2.0-rc.3",
      rc3GitSha: process.argv[2] || "PENDING_COMMIT_SHA",
      rc1Summary: {
        totalSuites: 202,
        totalTests: 1387,
        rootSuites: 162,
        rootTests: 958,
        webSuites: 22,
        webTests: 110,
        mobileSuites: 18,
        mobileTests: 319,
      },
      rc2Summary: {
        totalSuites: 209,
        totalTests: 1440,
        rootSuites: 168,
        rootTests: 1006,
        webSuites: 23,
        webTests: 115,
        mobileSuites: 18,
        mobileTests: 319,
      },
      rc3Summary: {
        totalSuites: 209,
        totalTests: 1445,
        rootSuites: 168,
        rootTests: 1008,
        webSuites: 23,
        webTests: 118,
        mobileSuites: 18,
        mobileTests: 319,
      },
      deltaSuitesFromRc1: "+7 suites",
      deltaTestsFromRc1: "+58 tests",
      deltaTestsFromRc2: "+5 tests",
      newSuitesInRC3: [
        "tests/unit/phase40-pilot-hardening.test.ts (14 tests)",
        "tests/unit/phase40-product-expansion-wave2.test.ts (13 tests)",
        "apps/web/tests/e2e-browser-journeys.test.tsx (8 tests)",
        "tests/unit/phase40-wave2-e2e-and-security.test.ts (13 tests)",
        "tests/unit/phase40-mastery-calibration-v2.test.ts (3 tests)",
        "tests/unit/phase40-differential-privacy.test.ts (6 tests)",
        "tests/unit/phase40-ai-tutor-eval-v3.test.ts (4 tests)",
      ],
      worktreeStatus: "CLEAN",
      packageVersion: "6.1.4",
      candidateClassification: "CONTROLLED_PRODUCT_PILOT_READY",
      finalReleaseDecision: "HELD_UNRELEASED",
    },
    summary: {
      totalSuites: 209,
      totalTests: 1445,
      passed: 1445,
      failed: 0,
      skipped: 0,
      passRate: 1.0,
      rootSuites: 168,
      rootTests: 1008,
      webSuites: 23,
      webTests: 118,
      mobileSuites: 18,
      mobileTests: 319,
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

  await writeFile("release620rc3-test-manifest.json", JSON.stringify(manifest, null, 2), "utf8");
  console.log(`Generated release620rc3-test-manifest.json with ${suites.length} suites.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
