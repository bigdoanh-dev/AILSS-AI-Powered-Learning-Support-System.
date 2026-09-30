import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { format } from "prettier";
import { disposition } from "./rc-candidate-policy.mjs";

const outputIndex = process.argv.indexOf("--output");
if (outputIndex < 0 || !process.argv[outputIndex + 1]) {
  throw new Error("Usage: node scripts/ci/freeze-rc-candidate.mjs --output <file>");
}
const output = process.argv[outputIndex + 1];
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trimEnd();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const candidatePaths = git("ls-files", "--cached", "--others", "--exclude-standard")
  .split("\n")
  .filter(Boolean)
  .filter((path) => disposition(path) === "INCLUDE")
  .filter((path) => path !== "AILSS_P13_2A_RELEASE_CANDIDATE_MANIFEST.md")
  .sort();

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index]);
      }
    }),
  );
  return results;
}

const entries = await mapLimit(candidatePaths, 32, async (path) => {
  try {
    const s = await stat(path);
    if (!s.isFile()) return null;
    return `${sha256(await readFile(path))}  ${path}`;
  } catch (error) {
    if (error?.code === "ENOENT") return `DELETED  ${path}`;
    throw error;
  }
});

const manifest = entries.filter(Boolean);

const dirty = git("status", "--porcelain=v1", "--untracked-files=all")
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const status = line.slice(0, 2);
    const rawPath = line.slice(3);
    const path = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) : rawPath;
    return { status, path, disposition: disposition(path, { dirty: true }) };
  })
  .filter(({ path }) => !path.startsWith("evidence/p13-2a/rc-candidate/"));

const unknownDirty = dirty.filter(({ disposition: value }) => value === "EXCLUDE_UNRELATED");
const body = {
  stage: "p13.2a-rc-candidate-freeze",
  status: unknownDirty.length ? "BLOCKED_UNKNOWN_DIRTY_PATHS" : "READY_FOR_COMMIT_AUTHORIZATION",
  immutableCommitCreated: false,
  head: git("rev-parse", "HEAD"),
  branch: git("branch", "--show-current"),
  proposedVersion: "6.0.0",
  toolchain: { node: "24.20.0", pnpm: "11.19.0" },
  contentFileCount: manifest.length,
  aggregateSha256: sha256(`${manifest.join("\n")}\n`),
  manifest,
  dirtyPathDisposition: dirty,
  unknownDirtyPaths: unknownDirty,
  selfExcludedFiles: ["AILSS_P13_2A_RELEASE_CANDIDATE_MANIFEST.md"],
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, await format(JSON.stringify(body), { parser: "json" }));
process.stdout.write(
  `${JSON.stringify({ stage: body.stage, status: body.status, contentFileCount: body.contentFileCount, aggregateSha256: body.aggregateSha256, dirtyPaths: dirty.length })}\n`,
);
if (unknownDirty.length) process.exitCode = 1;
