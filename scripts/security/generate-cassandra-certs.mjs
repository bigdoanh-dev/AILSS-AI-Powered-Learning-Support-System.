import { mkdtemp, rm, writeFile, copyFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureDir, exists, filePath, generated, openssl, protect } from "./lib.mjs";

const caKey = new URL("ca/ca-key.pem", generated);
const caCert = new URL("ca/ca-cert.pem", generated);
if (!(await exists(caKey)) || !(await exists(caCert))) throw new Error("Generate the development CA first");

for (const [node, dns] of [
  ["node1", "cassandra-node1"],
  ["node2", "cassandra-node2"],
  ["node3", "cassandra-node3"],
]) {
  const dir = new URL(`cassandra/${node}/`, generated);
  await ensureDir(dir);
  const key = new URL("server-key.pem", dir);
  const cert = new URL("server-cert.pem", dir);
  if (process.env.AILSS_ROTATE_TLS_KEYS === "true" || !(await exists(key))) {
    await openssl([
      "genpkey",
      "-algorithm",
      "EC",
      "-pkeyopt",
      "ec_paramgen_curve:P-256",
      "-out",
      filePath(key),
    ]);
    await protect(key);
  }
  const temp = await mkdtemp(path.join(os.tmpdir(), `ailss-${node}-`));
  try {
    const csr = path.join(temp, "server.csr");
    const ext = path.join(temp, "server.ext");
    await writeFile(
      ext,
      `basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth,clientAuth\nsubjectAltName=DNS:${dns},DNS:cassandra,DNS:localhost,IP:127.0.0.1\n`,
    );
    await openssl([
      "req",
      "-new",
      "-sha256",
      "-key",
      filePath(key),
      "-out",
      csr,
      "-subj",
      `/C=VN/O=AILSS Development/CN=${dns}`,
    ]);
    await openssl([
      "x509",
      "-req",
      "-sha256",
      "-in",
      csr,
      "-CA",
      filePath(caCert),
      "-CAkey",
      filePath(caKey),
      "-CAcreateserial",
      "-out",
      filePath(cert),
      "-days",
      "365",
      "-extfile",
      ext,
    ]);
    const keyPem = await readFile(key, "utf8");
    const certificatePem = await readFile(cert, "utf8");
    const caPem = await readFile(caCert, "utf8");
    const keyStore = new URL("server-keystore.pem", dir);
    await writeFile(keyStore, `${keyPem.trim()}\n${certificatePem.trim()}\n${caPem.trim()}\n`, {
      mode: 0o600,
    });
    await protect(keyStore);
    await copyFile(caCert, new URL("ca-cert.pem", dir));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
console.log(JSON.stringify({ stage: "cassandra-certificates", status: "PASS", nodes: 3, validityDays: 365 }));
