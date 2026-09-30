import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const roots = ["apps", "packages", "scripts", "config", "database/migrations"];
const skipDirectories = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "tmp",
  "temp",
  ".expo",
  ".cxx",
  ".gradle",
  ".kotlin",
  "Pods",
  "DerivedData",
  "test-results",
  "playwright-report",
  ".git",
]);
const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
const tracked = new Set(git(["ls-files", "-z"]).split("\0").filter(Boolean));
const found = new Set();

async function walk(path) {
  for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
    const candidate = `${path}/${entry.name}`;
    if (entry.isDirectory()) {
      if (
        skipDirectories.has(entry.name) ||
        candidate === "apps/mobile/ios" ||
        candidate === "apps/mobile/android"
      )
        continue;
      await walk(candidate);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      if (
        entry.name.startsWith(".env") ||
        /\.(?:pem|key|p12|p8|jks|crt|cer|mobileprovision)$/iu.test(entry.name)
      )
        continue;
      found.add(candidate);
    }
  }
}
for (const path of roots) await walk(path);

const source = [...found].sort().map((path) => {
  const gitTracked = tracked.has(path);
  let ignoreRule = null;
  if (!gitTracked) {
    const result = spawnSync("git", ["check-ignore", "-v", "--", path], { cwd: root, encoding: "utf8" });
    ignoreRule = result.status === 0 ? result.stdout.trim().split("\t")[0] : null;
  }
  const runtimeReachable =
    /^(?:apps\/(?:[^/]+\/src\/|mobile\/app\/|web\/server\/|web\/public\/)|packages\/[^/]+\/src\/|config\/|database\/migrations\/)/u.test(
      path,
    ) && !/(?:\/tests?\/|\/__mocks__\/|\.test\.|\.spec\.)/u.test(path);
  return {
    path,
    gitTracked,
    ignored: Boolean(ignoreRule),
    ignoreRule,
    runtimeReachable,
    expectedInRelease: runtimeReachable || gitTracked,
  };
});
const missing = source.filter((item) => item.runtimeReachable && !item.gitTracked);
const audit = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceRoots: roots,
  sourceFileCount: source.length,
  trackedCount: source.filter((item) => item.gitTracked).length,
  ignoredRuntimeSourceCount: missing.filter((item) => item.ignored).length,
  untrackedRuntimeSourceCount: missing.length,
  status: missing.length ? "FAIL" : "PASS",
  files: source,
};
const outputDir = join(root, "artifacts/release-evidence");
await mkdir(outputDir, { recursive: true });
await writeFile(join(outputDir, "release-source-tracking-audit.json"), `${JSON.stringify(audit, null, 2)}\n`);

const manifestPaths = [...tracked]
  .filter(
    (path) =>
      /^(?:apps|packages|scripts|config|database\/migrations|contracts|ops|infrastructure)\//u.test(path) ||
      /^(?:Dockerfile|docker-compose(?:\.[^.]+)?\.yml|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig(?:\.[^.]+)?\.json)$/u.test(
        path,
      ),
  )
  .sort();
const files = manifestPaths.map((path) => ({
  path,
  sha256: createHash("sha256")
    .update(execFileSync("git", ["show", `:${path}`], { cwd: root, maxBuffer: 32 * 1024 * 1024 }))
    .digest("hex"),
  category: path.startsWith("database/migrations/")
    ? "MIGRATION"
    : path.startsWith("apps/")
      ? "APPLICATION"
      : path.startsWith("packages/") || path.startsWith("contracts/")
        ? "LIBRARY_CONTRACT"
        : path.startsWith("scripts/")
          ? "RELEASE_TOOLING"
          : "CONFIG_INFRASTRUCTURE",
}));
const sha = git(["rev-parse", "HEAD"]).trim();
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  releaseGitSha: sha,
  source: "GIT_INDEX_BLOBS",
  fileCount: files.length,
  files,
};
await writeFile(
  join(outputDir, "release-source-content-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    status: audit.status,
    sourceFiles: source.length,
    ignoredRuntimeSource: audit.ignoredRuntimeSourceCount,
    untrackedRuntimeSource: missing.length,
    manifestFiles: files.length,
  }),
);
if (missing.length) process.exitCode = 1;
