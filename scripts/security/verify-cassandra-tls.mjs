import { readFile } from "node:fs/promises";
import cassandra from "cassandra-driver";
import { readEnv, required } from "../dev/env.mjs";

const env = await readEnv();
const ca = await readFile("infrastructure/tls/generated/ca/ca-cert.pem");
async function connect(sslOptions) {
  const client = new cassandra.Client({
    contactPoints: ["127.0.0.1"],
    localDataCenter: "ailss_dc",
    keyspace: "learning_keyspace",
    authProvider: new cassandra.auth.PlainTextAuthProvider(
      "svc_learning",
      required(env, "CASSANDRA_SVC_LEARNING_PASSWORD"),
    ),
    sslOptions,
  });
  try {
    await client.connect();
    await client.execute("SELECT course_id FROM course_by_id LIMIT 1", [], { prepare: true });
  } finally {
    await client.shutdown().catch(() => undefined);
  }
}
await connect({ ca: [ca], servername: "cassandra", rejectUnauthorized: true, minVersion: "TLSv1.2" });
let untrustedDenied = false;
try {
  await connect({
    ca: [Buffer.from("-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----")],
    servername: "cassandra",
    rejectUnauthorized: true,
  });
} catch {
  untrustedDenied = true;
}
let hostnameDenied = false;
try {
  await connect({ ca: [ca], servername: "wrong.ailss.local", rejectUnauthorized: true });
} catch {
  hostnameDenied = true;
}
if (!untrustedDenied || !hostnameDenied) throw new Error("TLS negative acceptance failed");
console.log(
  JSON.stringify({
    stage: "cassandra-tls",
    status: "PASS",
    trustedCa: true,
    untrustedCaDenied: true,
    wrongHostnameDenied: true,
  }),
);
