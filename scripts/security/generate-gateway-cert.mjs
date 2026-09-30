import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureDir, exists, filePath, generated, openssl, protect } from "./lib.mjs";

const caKey = new URL("ca/ca-key.pem", generated);
const caCert = new URL("ca/ca-cert.pem", generated);
const dir = new URL("gateway/", generated);
const key = new URL("gateway-key.pem", dir);
const cert = new URL("gateway-cert.pem", dir);
if (!(await exists(caKey)) || !(await exists(caCert))) throw new Error("Generate the development CA first");
await ensureDir(dir);
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
const temp = await mkdtemp(path.join(os.tmpdir(), "ailss-gateway-"));
try {
  const csr = path.join(temp, "gateway.csr");
  const ext = path.join(temp, "gateway.ext");
  await writeFile(
    ext,
    "basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:api-gateway,DNS:localhost,IP:127.0.0.1\n",
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
    "/C=VN/O=AILSS Development/CN=api-gateway",
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
} finally {
  await rm(temp, { recursive: true, force: true });
}
await openssl(["verify", "-CAfile", filePath(caCert), filePath(cert)]);
await openssl(["x509", "-in", filePath(cert), "-noout", "-checkhost", "localhost"]);
console.log(
  JSON.stringify({
    stage: "gateway-certificate",
    status: "PASS",
    hostnameVerification: true,
    validityDays: 365,
  }),
);
