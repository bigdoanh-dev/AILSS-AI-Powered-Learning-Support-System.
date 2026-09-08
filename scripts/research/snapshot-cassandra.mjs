import { execFileSync } from "node:child_process";

const profile = process.env.AILSS_PROFILE ?? "research";
if (profile !== "research") throw new Error("Snapshots require AILSS_PROFILE=research");
const tag = process.env.AILSS_SNAPSHOT_TAG ?? `phase6_${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
if (!/^phase6_[A-Za-z0-9_-]+$/.test(tag)) throw new Error("Unsafe snapshot tag");
for (const node of ["node1", "node2", "node3"])
  execFileSync("docker", ["exec", `ailss-cassandra-${node}`, "nodetool", "snapshot", "-t", tag], {
    stdio: "inherit",
  });
console.log(
  JSON.stringify({
    stage: "cassandra-snapshot",
    status: "PASS",
    tag,
    nodes: 3,
    note: "Copy SSTables outside Docker volumes",
  }),
);
