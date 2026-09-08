import { execFileSync } from "node:child_process";

const action = process.argv[2];
const requestedNode = process.argv.slice(3).find((value) => value !== "--") ?? "node3";
const node = requestedNode.startsWith("cassandra-") ? requestedNode : `cassandra-${requestedNode}`;
const allowed = new Set(["cassandra-node1", "cassandra-node2", "cassandra-node3"]);
if (!new Set(["start", "stop"]).has(action) || !allowed.has(node))
  throw new Error("Usage: cassandra-node.mjs <start|stop> <cassandra-node1|cassandra-node2|cassandra-node3>");

const inspect = (name) =>
  JSON.parse(execFileSync("docker", ["inspect", `ailss-${name}`], { encoding: "utf8" }))[0].State.Status;
for (const requiredNode of allowed) inspect(requiredNode);
const before = inspect(node);
execFileSync("docker", [action, `ailss-${node}`], { stdio: "inherit" });
console.log(
  JSON.stringify({
    stage: "research-node-control",
    status: "PASS",
    timestamp: new Date().toISOString(),
    action,
    node,
    before,
    after: inspect(node),
  }),
);
