import { readdir } from "node:fs/promises";
import { exists, filePath, generated, openssl } from "./lib.mjs";

const caCert = new URL("ca/ca-cert.pem", generated);
if (!(await exists(caCert))) throw new Error("Development CA certificate is missing");
const nodesDir = new URL("cassandra/", generated);
const nodes = (await readdir(nodesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
if (nodes.length !== 3)
  throw new Error(`Expected 3 Cassandra certificate directories, found ${nodes.length}`);
for (const node of nodes) {
  const cert = new URL(`${node}/server-cert.pem`, nodesDir);
  await openssl(["verify", "-CAfile", filePath(caCert), filePath(cert)]);
  await openssl(["x509", "-in", filePath(cert), "-noout", "-checkhost", `cassandra-${node}`]);
}
await openssl(["x509", "-checkend", "86400", "-noout", "-in", filePath(caCert)]);
console.log(
  JSON.stringify({
    stage: "certificate-verification",
    status: "PASS",
    cassandraNodes: nodes.length,
    hostnameVerification: true,
  }),
);
