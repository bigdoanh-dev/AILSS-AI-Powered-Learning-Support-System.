import { ensureDir, exists, filePath, generated, openssl, protect } from "./lib.mjs";

const identities = [
  "identity/user-jwt",
  "services/gateway",
  "services/identity",
  "services/learning",
  "services/classroom",
  "services/assessment",
  "services/interaction",
  "services/ai",
  "services/ai-worker",
  "services/document-worker",
  "services/notification-worker",
  "services/audit-worker",
  "services/reconciliation-worker",
];
for (const identity of identities) {
  const slash = identity.lastIndexOf("/");
  const dir = new URL(`${identity.slice(0, slash + 1)}`, generated);
  const name = identity.slice(slash + 1);
  await ensureDir(dir);
  const privateKey = new URL(`${name}-private.pem`, dir);
  const publicKey = new URL(`${name}-public.pem`, dir);
  if (!(await exists(privateKey))) {
    await openssl(["genpkey", "-algorithm", "ED25519", "-out", filePath(privateKey)]);
    await protect(privateKey);
  }
  await openssl(["pkey", "-in", filePath(privateKey), "-pubout", "-out", filePath(publicKey)]);
}
console.log(
  JSON.stringify({
    stage: "service-signing-keys",
    status: "PASS",
    identities: identities.length,
    algorithm: "Ed25519",
  }),
);
