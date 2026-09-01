import { ensureDir, exists, filePath, generated, openssl, protect } from "./lib.mjs";

const dir = new URL("ca/", generated);
const key = new URL("ca-key.pem", dir);
const cert = new URL("ca-cert.pem", dir);
await ensureDir(dir);
if (!(await exists(key))) {
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
if (!(await exists(cert))) {
  await openssl([
    "req",
    "-x509",
    "-new",
    "-sha256",
    "-key",
    filePath(key),
    "-out",
    filePath(cert),
    "-days",
    "30",
    "-subj",
    "/C=VN/O=AILSS Development/CN=AILSS Development Root CA",
  ]);
}
console.log(
  JSON.stringify({
    stage: "dev-ca",
    status: "PASS",
    path: "infrastructure/tls/generated/ca/ca-cert.pem",
    validityDays: 30,
  }),
);
