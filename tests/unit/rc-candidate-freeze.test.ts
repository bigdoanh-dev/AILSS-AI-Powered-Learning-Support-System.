import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { disposition } from "../../scripts/ci/rc-candidate-policy.mjs";

describe("RC candidate freeze", () => {
  it("produces a deterministic manifest and excludes evidence and secrets", () => {
    const directory = mkdtempSync(join(tmpdir(), "ailss-rc-freeze-"));
    const first = join(directory, "first.json");
    const second = join(directory, "second.json");
    for (const output of [first, second]) {
      const run = spawnSync(process.execPath, ["scripts/ci/freeze-rc-candidate.mjs", "--output", output], {
        encoding: "utf8",
      });
      // A dirty developer worktree is a valid BLOCKED result. The release script
      // still exits non-zero; this unit test validates its deterministic artifact.
      expect([0, 1]).toContain(run.status);
      expect(run.error).toBeUndefined();
    }
    const a = JSON.parse(readFileSync(first, "utf8")) as {
      aggregateSha256: string;
      manifest: string[];
      immutableCommitCreated: boolean;
    };
    const b = JSON.parse(readFileSync(second, "utf8")) as typeof a;
    expect(a.aggregateSha256).toBe(b.aggregateSha256);
    expect(a.manifest).toEqual(b.manifest);
    expect(a.immutableCommitCreated).toBe(false);
    expect(a.manifest.some((line) => line.includes("evidence/"))).toBe(false);
    expect(a.manifest.some((line) => /(?:^|\/)\.env$/.test(line))).toBe(false);
  }, 15000);


  it("blocks unknown dirty paths while allowing reviewed source roots", () => {
    expect(disposition("apps/web/src/App.tsx", { dirty: true })).toBe("INCLUDE");
    expect(disposition("stray-release-candidate.txt", { dirty: true })).toBe("EXCLUDE_UNRELATED");
  });
});
