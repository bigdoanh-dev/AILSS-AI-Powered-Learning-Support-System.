import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

if ((process.env.AILSS_PROFILE ?? "dev-async") !== "dev-async")
  throw new Error("The Phase 7 final acceptance requires AILSS_PROFILE=dev-async");

const phases = [
    "p7.1",
    "p7.2",
    "p7.3",
    "p7.4",
    "p7.5",
    "p7.6",
    "p7.7",
    "p7.8",
    "p7.9",
    "p7.10",
    "p7.11",
    "p7.12a",
    "p7.12b",
    "p7.13",
    "p7.14",
    "p7.15a",
    "p7.15b",
    "p7.16",
    "p7.17",
    "p7.18",
    "p7.19",
  ],
  runId = new Date().toISOString().replaceAll(":", "-").replace(".", "-"),
  evidenceDir = resolve("docs", "evidence", `phase-7-final-${runId}`),
  matrix = [];

mkdirSync(evidenceDir, { recursive: true });
for (const phase of phases) {
  const startedAt = Date.now(),
    result = spawnSync("pnpm", [`acceptance:${phase}`], {
      cwd: process.cwd(),
      env: { ...process.env, AILSS_PROFILE: "dev-async" },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
    status = result.status === 0 ? "PASS" : "FAIL";
  writeFileSync(resolve(evidenceDir, `${phase}.log`), `${result.stdout ?? ""}${result.stderr ?? ""}`, "utf8");
  matrix.push({ phase: phase.toUpperCase(), status, durationMs: Date.now() - startedAt });
  console.log(JSON.stringify(matrix.at(-1)));
  if (status === "FAIL") break;
}

const summary = {
  stage: "phase-7-final-acceptance",
  status: matrix.length === phases.length && matrix.every((row) => row.status === "PASS") ? "PASS" : "FAIL",
  runId,
  matrix,
  counts: { publicApis: 93, internalApis: 15, queryIds: 71, events: 22, redis: false },
  evidence: evidenceDir,
};
writeFileSync(resolve(evidenceDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary));
if (summary.status !== "PASS") process.exitCode = 1;
