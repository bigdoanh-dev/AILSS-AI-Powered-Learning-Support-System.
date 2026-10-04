import type { RequestHandler } from "express";
import { z } from "zod";
import type { AppConfig } from "../../../packages/config/src/index.js";
import { AppError, currentRequestContext } from "../../../packages/http/src/index.js";
import { loadPublicKey, verifyAccessToken } from "../../../packages/security/src/index.js";
import { parseBearerAuthorization } from "./protected-identity-proxy.js";
import { operationsRange, operationsSnapshot } from "./admin-operations.js";

const vector = z.object({
  status: z.literal("success"),
  data: z.object({ result: z.array(z.object({ value: z.tuple([z.number(), z.string()]) })) }),
});
const targetSchema = z.object({
  status: z.literal("success"),
  data: z.object({
    activeTargets: z.array(
      z.object({
        labels: z.object({ job: z.string().optional(), instance: z.string().optional() }),
        health: z.string(),
        lastScrape: z.string(),
        lastError: z.string(),
      }),
    ),
  }),
});
const alertSchema = z.object({
  status: z.literal("success"),
  data: z.object({
    alerts: z.array(
      z.object({
        labels: z.record(z.string(), z.string()),
        annotations: z.record(z.string(), z.string()),
        state: z.string(),
        activeAt: z.string().optional(),
      }),
    ),
  }),
});
const historySchema = z.object({
  status: z.literal("success"),
  data: z.object({ result: z.array(z.object({ values: z.array(z.tuple([z.number(), z.string()])) })) }),
});
const rateQuery = 'sum(rate(ailss_http_requests_total{job=~"ailss-.*"}[5m]))';
const finite = (value: string | undefined) =>
  value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;

export async function monitoringSnapshot(
  config: Pick<
    AppConfig,
    | "PROMETHEUS_SERVICE_URL"
    | "GRAFANA_SERVICE_URL"
    | "PROMETHEUS_PUBLIC_URL"
    | "GRAFANA_PUBLIC_URL"
    | "INTERNAL_HTTP_TIMEOUT_MS"
  >,
  fetcher: typeof fetch = fetch,
) {
  const promCandidates = [
    config.PROMETHEUS_SERVICE_URL,
    "http://prometheus:9090",
    "http://127.0.0.1:9090",
    "http://localhost:9090",
  ];
  const grafanaCandidates = [
    config.GRAFANA_SERVICE_URL,
    "http://grafana:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
  ];

  async function json(origins: string[], path: string) {
    const unique = [...new Set(origins)];
    let lastError: unknown;
    for (const origin of unique) {
      try {
        const response = await fetcher(new URL(path, origin), {
          signal: AbortSignal.timeout(Math.min(config.INTERNAL_HTTP_TIMEOUT_MS, 4000)),
          redirect: "error",
        });
        if (response.ok) return await response.json();
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("MONITORING_UPSTREAM_UNAVAILABLE");
  }

  const query = async (expression: string) => {
    const body = vector.parse(
      await json(
        promCandidates,
        `/api/v1/query?${new URLSearchParams({ query: expression, timeout: "3s" }).toString()}`,
      ),
    );
    return finite(body.data.result[0]?.value[1]);
  };
  const now = Math.floor(Date.now() / 1000);
  const results = await Promise.allSettled([
    json(promCandidates, "/api/v1/targets?state=active").then((raw) =>
      targetSchema.parse(raw).data.activeTargets.filter((target) => target.labels.job?.startsWith("ailss-")),
    ),
    json(grafanaCandidates, "/api/health").then((raw) => z.object({ database: z.literal("ok") }).parse(raw)),
    query(rateQuery),
    query(`sum(rate(ailss_http_requests_total{job=~"ailss-.*",status=~"5.."}[5m])) or (0 * ${rateQuery})`),
    query(
      'histogram_quantile(0.95, sum(rate(ailss_http_duration_seconds_bucket{job=~"ailss-.*"}[5m])) by (le))',
    ),
    json(promCandidates, "/api/v1/alerts").then((raw) =>
      alertSchema
        .parse(raw)
        .data.alerts.filter(
          (alert) => alert.labels.job?.startsWith("ailss-") || /^ailss/i.test(alert.labels.alertname ?? ""),
        ),
    ),
    json(
      promCandidates,
      `/api/v1/query_range?${new URLSearchParams({ query: rateQuery, start: String(now - 3600), end: String(now), step: "60", timeout: "3s" }).toString()}`,
    ).then((raw) => historySchema.parse(raw).data.result[0]?.values ?? []),
  ]);
  const [targets, grafana, requests, errors, latency, alerts, history] = results;
  const services =
    targets.status === "fulfilled"
      ? targets.value.map((target) => ({
          job: target.labels.job ?? "",
          instance: target.labels.instance ?? "",
          up: target.health === "up",
          lastScrape: target.lastScrape,
          error: target.lastError,
        }))
      : [];
  const requestRate = requests.status === "fulfilled" ? requests.value : null;
  const errorRate = errors.status === "fulfilled" ? errors.value : null;
  return {
    sampledAt: new Date().toISOString(),
    prometheus: { available: targets.status === "fulfilled", url: config.PROMETHEUS_PUBLIC_URL },
    grafana: {
      available: grafana.status === "fulfilled",
      url: new URL("/d/ailss-platform", config.GRAFANA_PUBLIC_URL).toString(),
    },
    metrics: {
      requestRate,
      errorPercent:
        requestRate !== null && requestRate > 0 && errorRate !== null
          ? (errorRate / requestRate) * 100
          : null,
      p95Ms: latency.status === "fulfilled" && latency.value !== null ? latency.value * 1000 : null,
    },
    services,
    alerts:
      alerts.status === "fulfilled"
        ? alerts.value.map((alert) => ({
            name: alert.labels.alertname ?? "Cảnh báo",
            severity: alert.labels.severity ?? "unknown",
            state: alert.state,
            summary: alert.annotations.summary ?? alert.annotations.description ?? "",
            activeAt: alert.activeAt ?? null,
          }))
        : null,
    history:
      history.status === "fulfilled"
        ? history.value.map(([time, value]) => ({
            time: new Date(time * 1000).toISOString(),
            requestRate: finite(value),
          }))
        : [],
  };
}

export async function monitoringHandler(config: AppConfig): Promise<RequestHandler> {
  if (!config.JWT_PUBLIC_KEY_PATH) throw new Error("Monitoring requires Identity public key");
  const key = await loadPublicKey(config.JWT_PUBLIC_KEY_PATH);
  return async (req, res, next) => {
    try {
      let actor;
      try {
        actor = await verifyAccessToken(parseBearerAuthorization(req), key, {
          issuer: config.JWT_ISSUER,
          audience: config.JWT_AUDIENCE,
          kid: config.JWT_KID,
          clockToleranceSeconds: config.JWT_CLOCK_SKEW_SECONDS,
        });
      } catch {
        throw new AppError("INVALID_ACCESS_TOKEN", 401, "Invalid access token");
      }
      if (!actor.roles.includes("ADMIN"))
        throw new AppError("ADMIN_REQUIRED", 403, "Admin authorization is required");
      const operations = req.path === "/api/v1/admin/dashboard/operations";
      const range = operations
        ? z
            .object({ range: operationsRange.default("30d") })
            .strict()
            .safeParse(req.query)
        : null;
      if ((operations && !range?.success) || (!operations && Object.keys(req.query).length))
        throw new AppError("INVALID_MONITORING_QUERY", 422, "Monitoring query parameters are not accepted");
      const context = currentRequestContext();
      res.setHeader("Cache-Control", "no-store");
      res.json({
        data:
          operations && range?.success
            ? await operationsSnapshot(config, range.data.range)
            : await monitoringSnapshot(config),
        meta: { requestId: context?.requestId, timestamp: new Date().toISOString() },
      });
    } catch (error) {
      next(error);
    }
  };
}
