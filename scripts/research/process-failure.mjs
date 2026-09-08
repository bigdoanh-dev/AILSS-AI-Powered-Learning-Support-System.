import { execFileSync } from "node:child_process";

const action = process.argv[2];
const role = process.argv[3];
const targets = { publisher: "ailss-ai-service", consumer: "ailss-ai-worker" };
const target = targets[role];
if ((action !== "kill" && action !== "start") || !target)
  throw new Error("Usage: process-failure.mjs <kill|start> <publisher|consumer>");

const inspect = () =>
  JSON.parse(execFileSync("docker", ["inspect", target], { encoding: "utf8" }))[0].State.Status;
const before = inspect();
execFileSync("docker", [action, target], { stdio: "inherit" });
console.log(
  JSON.stringify({
    stage: "research-process-failure",
    status: "PASS",
    timestamp: new Date().toISOString(),
    action,
    role,
    target,
    before,
    after: inspect(),
  }),
);
