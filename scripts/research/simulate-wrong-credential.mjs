import { execFileSync } from "node:child_process";

const tlsEnabled =
  execFileSync(
    "docker",
    ["inspect", "--format", "{{range .Config.Env}}{{println .}}{{end}}", "ailss-cassandra-node1"],
    { encoding: "utf8" },
  ).match(/^AILSS_CASSANDRA_TLS=true$/m) !== null;
let denied = false;
try {
  execFileSync(
    "docker",
    [
      "exec",
      "ailss-cassandra-node1",
      "cqlsh",
      ...(tlsEnabled ? ["--ssl"] : []),
      "-u",
      "svc_learning",
      "-p",
      "intentionally-invalid-research-password",
      "-e",
      "SELECT now() FROM system.local",
    ],
    { stdio: "ignore" },
  );
} catch {
  denied = true;
}
if (!denied) throw new Error("Wrong Cassandra credential was unexpectedly accepted");
console.log(
  JSON.stringify({
    stage: "research-wrong-credential",
    status: "PASS",
    timestamp: new Date().toISOString(),
    denied: true,
    tlsEnabled,
  }),
);
