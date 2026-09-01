import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { access } from "node:fs/promises";

const action = process.argv[2] ?? "up";
const profile = process.argv[3] ?? process.env.AILSS_PROFILE ?? "dev-core";
const valid = new Set(["dev-core", "dev-async", "research", "demo"]);
const asyncProfile = profile !== "dev-core";
const composeFiles = [
  "-f",
  "docker-compose.yml",
  ...(asyncProfile ? ["-f", "docker-compose.async.yml"] : []),
];
const compose = (...args) =>
  execFileSync("docker", ["compose", "--env-file", ".env", ...composeFiles, "--profile", profile, ...args], {
    stdio: "inherit",
    env: { ...process.env, AILSS_PROFILE: profile },
  });
const composeAll = (...args) =>
  execFileSync(
    "docker",
    [
      "compose",
      "--env-file",
      ".env",
      "-f",
      "docker-compose.yml",
      "-f",
      "docker-compose.async.yml",
      "--profile",
      "*",
      ...args,
    ],
    { stdio: "inherit", env: { ...process.env, AILSS_PROFILE: profile } },
  );
const node = (script, ...args) =>
  execFileSync(process.execPath, [script, ...args], {
    stdio: "inherit",
    env: { ...process.env, AILSS_PROFILE: profile },
  });

async function ensureEnv() {
  try {
    await access(".env");
  } catch {
    node("scripts/dev/bootstrap-dev-env.mjs");
  }
}
async function waitFor(url, label, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "not attempted";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : "request failed";
    }
    await delay(2_000);
  }
  throw new Error(`${label} readiness timed out: ${last}`);
}
async function waitHealthy(service, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = execFileSync(
        "docker",
        [
          "inspect",
          "--format",
          "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
          `ailss-${service}`,
        ],
        { encoding: "utf8" },
      ).trim();
      if (value === "healthy" || value === "running") return;
    } catch {
      /* container may still be creating */
    }
    await delay(3_000);
  }
  throw new Error(`${service} did not become healthy; run docker compose logs ${service}`);
}
async function waitResearchCluster(expectedNodes, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  let last = "cluster status not available";
  while (Date.now() < deadline) {
    try {
      const status = execFileSync("docker", ["exec", "ailss-cassandra-node1", "nodetool", "status"], {
        encoding: "utf8",
      });
      const cluster = execFileSync(
        "docker",
        ["exec", "ailss-cassandra-node1", "nodetool", "describecluster"],
        { encoding: "utf8" },
      );
      const normalNodes = status.split("\n").filter((line) => /^UN\s/.test(line.trim())).length;
      const schemaVersions = [
        ...cluster.matchAll(/^\s*([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}):\s*\[/gim),
      ].map((match) => match[1]);
      if (normalNodes === expectedNodes && new Set(schemaVersions).size === 1) return;
      last = `${normalNodes}/${expectedNodes} nodes UN; ${new Set(schemaVersions).size} schema versions`;
    } catch (error) {
      last = error instanceof Error ? error.message : "nodetool failed";
    }
    await delay(5_000);
  }
  throw new Error(`research cluster readiness timed out: ${last}`);
}

if (action === "down") {
  await ensureEnv();
  composeAll("down", "--remove-orphans");
  process.exit(0);
}
if (action === "reset") {
  if (process.env.AILSS_CONFIRM_RESET !== "YES")
    throw new Error("Reset deletes AILSS Docker volumes. Re-run with AILSS_CONFIRM_RESET=YES");
  await ensureEnv();
  composeAll("down", "--volumes", "--remove-orphans");
  process.exit(0);
}
if (action !== "up" || !valid.has(profile))
  throw new Error("Usage: environment.mjs up <dev-core|dev-async|research|demo> | down | reset");

await ensureEnv();
node("scripts/dev/preflight.mjs", profile);
compose("config", "--quiet");
const cassandraServices =
  profile === "research" ? ["cassandra-node1", "cassandra-node2", "cassandra-node3"] : ["cassandra-dev"];
if (profile === "research") {
  for (const [index, service] of cassandraServices.entries()) {
    compose("up", "-d", "--no-deps", service);
    await waitHealthy(service);
    await waitResearchCluster(index + 1);
  }
} else {
  compose("up", "-d", "--no-deps", ...cassandraServices);
  await waitHealthy("cassandra-dev");
}
node("scripts/dev/bootstrap-cassandra.mjs");
if (asyncProfile) {
  compose("up", "-d", "--no-deps", "rabbitmq", "minio");
  await waitHealthy("rabbitmq");
  await waitFor("http://127.0.0.1:9000/minio/health/ready", "MinIO");
  node("scripts/dev/provision-rabbitmq.mjs");
  node("scripts/dev/verify-rabbitmq.mjs");
  node("scripts/dev/provision-minio.mjs");
}
compose("up", "-d", "--build");
await waitFor("http://127.0.0.1:8080/health/ready", "Gateway");
console.log(JSON.stringify({ stage: "environment-up", status: "PASS", profile }));
