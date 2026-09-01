import { execFileSync } from "node:child_process";

const profile = process.env.AILSS_PROFILE ?? "dev-core";
const services =
  profile === "dev-core"
    ? [
        { name: "gateway", port: 8080, container: "api-gateway", edge: true },
        { name: "identity", port: 8101, container: "identity-service" },
      ]
    : profile === "dev-async"
      ? [
          { name: "gateway", port: 8080, container: "api-gateway", edge: true },
          { name: "identity", port: 8101, container: "identity-service" },
          { name: "learning", port: 8102, container: "learning-service" },
          { name: "ai", port: 8106, container: "ai-service" },
          { name: "ai-worker", port: 8201, container: "ai-worker" },
          { name: "document-worker", port: 8202, container: "document-worker" },
          { name: "notification-worker", port: 8203, container: "notification-worker" },
          { name: "audit-worker", port: 8204, container: "audit-worker" },
          { name: "reconciliation-worker", port: 8205, container: "reconciliation-worker" },
        ]
      : [
          { name: "gateway", port: 8080, container: "api-gateway", edge: true },
          { name: "identity", port: 8101, container: "identity-service" },
          { name: "learning", port: 8102, container: "learning-service" },
          { name: "classroom", port: 8103, container: "classroom-service" },
          { name: "assessment", port: 8104, container: "assessment-service" },
          { name: "interaction", port: 8105, container: "interaction-service" },
          { name: "ai", port: 8106, container: "ai-service" },
          { name: "ai-worker", port: 8201, container: "ai-worker" },
          { name: "document-worker", port: 8202, container: "document-worker" },
          { name: "notification-worker", port: 8203, container: "notification-worker" },
          { name: "audit-worker", port: 8204, container: "audit-worker" },
          { name: "reconciliation-worker", port: 8205, container: "reconciliation-worker" },
        ];
const correlationId = crypto.randomUUID();
async function request(service, endpoint) {
  if (service.edge) {
    const response = await fetch(`http://127.0.0.1:${service.port}/health/${endpoint}`, {
      headers: { "x-correlation-id": correlationId, connection: "close" },
    });
    return {
      ok: response.ok,
      status: response.status,
      correlationId: response.headers.get("x-correlation-id"),
      body: await response.text(),
    };
  }

  const url = `http://127.0.0.1:${service.port}/health/${endpoint}`;
  const script = `
    const response = await fetch(${JSON.stringify(url)}, {
      headers: { "x-correlation-id": ${JSON.stringify(correlationId)}, connection: "close" }
    });
    console.log(JSON.stringify({
      ok: response.ok,
      status: response.status,
      correlationId: response.headers.get("x-correlation-id"),
      body: await response.text()
    }));
  `;
  return JSON.parse(
    execFileSync(
      "docker",
      ["exec", `ailss-${service.container}`, "node", "--input-type=module", "-e", script],
      { encoding: "utf8" },
    ),
  );
}

for (const service of services) {
  for (const endpoint of ["live", "ready"]) {
    const response = await request(service, endpoint);
    if (!response.ok)
      throw new Error(`${service.name} ${endpoint} failed: HTTP ${response.status} ${response.body}`);
    if (response.correlationId !== correlationId)
      throw new Error(`${service.name} did not propagate correlation ID`);
  }
}
const forged = await fetch("http://127.0.0.1:8080/health/live", {
  headers: { "x-user-id": crypto.randomUUID(), connection: "close" },
});
if (forged.status !== 400) throw new Error(`Gateway accepted forged X-User-ID: HTTP ${forged.status}`);
execFileSync(process.execPath, ["scripts/security/verify-cassandra-rbac.mjs"], {
  stdio: "inherit",
  env: { ...process.env, AILSS_PROFILE: profile },
});
if (profile !== "dev-core") {
  execFileSync(process.execPath, ["scripts/security/verify-rabbitmq-acl.mjs"], { stdio: "inherit" });
  execFileSync(process.execPath, ["scripts/dev/verify-minio.mjs"], { stdio: "inherit" });
}
console.log(
  JSON.stringify({
    stage: "smoke",
    status: "PASS",
    profile,
    services: services.length,
    correlationPropagation: true,
    forgedIdentityRejected: true,
  }),
);
