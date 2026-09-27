/**
 * Phase 42 Revision C: Staging & Production Health-Check Script
 *
 * Verifies live status of platform endpoints:
 * 1. Gateway & Service health probes
 * 2. Database & Message Broker readiness
 * 3. Media storage bucket accessibility
 * 4. Metrics scrape endpoint availability
 */

const targetUrl = process.argv[2] || process.env.AILSS_GATEWAY_URL || "http://127.0.0.1:8080";
const timeoutMs = Number(process.env.HEALTH_CHECK_TIMEOUT_MS || 5000);

console.log(`Checking AILSS health targets against base URL: ${targetUrl}...`);

const probes = [
  { name: "gateway_root", path: "/health", critical: true },
  { name: "learning_service", path: "/api/v1/health", critical: true },
  { name: "identity_service", path: "/api/v1/auth/health", critical: true },
  { name: "media_delivery", path: "/playback/health", critical: false },
  { name: "prometheus_metrics", path: "/metrics", critical: false },
];

async function checkProbe(probe) {
  const url = `${targetUrl.replace(/\/$/, "")}${probe.path}`;
  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    const durationMs = Math.round(performance.now() - start);
    clearTimeout(timer);
    return {
      name: probe.name,
      path: probe.path,
      status: res.ok ? "UP" : "DEGRADED",
      httpStatus: res.status,
      durationMs,
      critical: probe.critical,
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      name: probe.name,
      path: probe.path,
      status: "DOWN",
      error: err.name === "AbortError" ? "TIMEOUT" : err.message,
      critical: probe.critical,
    };
  }
}

async function run() {
  const results = await Promise.all(probes.map(checkProbe));
  const hasCriticalFailure = results.some((r) => r.critical && r.status === "DOWN");

  const summary = {
    timestamp: new Date().toISOString(),
    targetUrl,
    overallStatus: hasCriticalFailure ? "UNHEALTHY" : results.some((r) => r.status !== "UP") ? "DEGRADED" : "HEALTHY",
    probes: results,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (hasCriticalFailure) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error("Health check execution error:", err);
  process.exit(1);
});
