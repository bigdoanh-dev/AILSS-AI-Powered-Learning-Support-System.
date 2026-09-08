import { execFileSync } from "node:child_process";

const action = process.argv[2];
if (action !== "start" && action !== "stop") throw new Error("Usage: rabbitmq-node.mjs <start|stop>");

const inspect = () =>
  JSON.parse(execFileSync("docker", ["inspect", "ailss-rabbitmq"], { encoding: "utf8" }))[0].State.Status;
const before = inspect();
execFileSync("docker", [action, "ailss-rabbitmq"], { stdio: "inherit" });
console.log(
  JSON.stringify({
    stage: "research-rabbitmq-control",
    status: "PASS",
    timestamp: new Date().toISOString(),
    action,
    before,
    after: inspect(),
  }),
);
