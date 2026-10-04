import { z } from "zod";
import type { AppConfig } from "../../../packages/config/src/index.js";

export const operationsRange = z.enum(["7d", "30d", "90d", "365d"]);
type Config = Pick<AppConfig, "PROMETHEUS_SERVICE_URL" | "INTERNAL_HTTP_TIMEOUT_MS" | "LEARNING_SERVICE_URL">;
const sample = z.tuple([z.number(), z.string()]);
const vector = z.object({
  status: z.literal("success"),
  data: z.object({ result: z.array(z.object({ metric: z.record(z.string(), z.string()), value: sample })) }),
});
const matrix = z.object({
  status: z.literal("success"),
  data: z.object({
    result: z.array(z.object({ metric: z.record(z.string(), z.string()), values: z.array(sample) })),
  }),
});
const finite = (value: string | undefined) =>
  value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
const aiRoutes = "/api/v1/(assistant/chat|ai/quiz-jobs)";
const aiRequests = `ailss_http_requests_total{job="ailss-api-gateway",method="POST",route=~"${aiRoutes}"}`;

export async function operationsSnapshot(
  config: Config,
  range: z.infer<typeof operationsRange>,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
) {
  const days = Number(range.slice(0, -1));
  const end = Math.floor(now / 1000);
  const start = end - days * 86400;
  const secondsSinceVietnamMidnight = String(
    Math.max(1, end - Math.floor((now + 7 * 3600000) / 86400000) * 86400 + 7 * 3600),
  );
  const timeout = Math.min(config.INTERNAL_HTTP_TIMEOUT_MS, 4000);
  async function json(url: URL, readiness = false) {
    const response = await fetcher(url, { signal: AbortSignal.timeout(timeout), redirect: "error" });
    // A readiness 503 still contains the authoritative per-dependency state.
    if (!response.ok && !(readiness && response.status === 503))
      throw Error("OPERATIONS_UPSTREAM_UNAVAILABLE");
    return response.json();
  }
  async function query(expression: string) {
    const url = new URL("/api/v1/query", config.PROMETHEUS_SERVICE_URL);
    url.search = new URLSearchParams({ query: expression, timeout: "3s" }).toString();
    return vector.parse(await json(url)).data.result;
  }
  async function scalar(expression: string) {
    try {
      return finite((await query(expression))[0]?.value[1]);
    } catch {
      return null;
    }
  }
  async function series(expression: string) {
    try {
      const url = new URL("/api/v1/query_range", config.PROMETHEUS_SERVICE_URL);
      url.search = new URLSearchParams({
        query: expression,
        start: String(start),
        end: String(end),
        step: String(days > 90 ? 7 * 86400 : 86400),
        timeout: "3s",
      }).toString();
      return (
        matrix.parse(await json(url)).data.result[0]?.values.map(([time, value]) => ({
          time: new Date(time * 1000).toISOString(),
          value: finite(value),
        })) ?? []
      );
    } catch {
      return [];
    }
  }
  const metricQueries = {
    aiRequests: `sum(increase(${aiRequests}[${range}]))`,
    aiRequestsToday: `sum(increase(${aiRequests}[${secondsSinceVietnamMidnight}s]))`,
    aiFailed: `sum(increase(ailss_http_requests_total{job="ailss-api-gateway",method="POST",route=~"${aiRoutes}",status=~"5.."}[${range}]))`,
    aiLatencyMs: `sum(rate(ailss_http_duration_seconds_sum{job="ailss-api-gateway",method="POST",route=~"${aiRoutes}"}[5m])) / sum(rate(ailss_http_duration_seconds_count{job="ailss-api-gateway",method="POST",route=~"${aiRoutes}"}[5m])) * 1000`,
    failedJobs: `sum(increase(ailss_ai_generation_total{job="ailss-ai-worker",outcome!="success"}[${range}]))`,
    storageBytes: "max(ailss_media_original_bytes_current) + max(ailss_media_derived_bytes_current)",
    requestVolume: `sum(increase(ailss_http_requests_total{job="ailss-api-gateway"}[${range}]))`,
    queueDepth: "sum(ailss_media_processing_queue_depth)",
    assistantRequests: `sum(increase(ailss_http_requests_total{job="ailss-api-gateway",method="POST",route="/api/v1/assistant/chat"}[${range}]))`,
    quizRequests: `sum(increase(ailss_http_requests_total{job="ailss-api-gateway",method="POST",route="/api/v1/ai/quiz-jobs"}[${range}]))`,
  };
  const trendQueries = {
    registrations:
      'sum(increase(ailss_identity_registrations_total{job="ailss-identity",outcome="success"}[1d]))',
    aiRequests: `sum(increase(${aiRequests}[1d]))`,
  };
  const serviceQueries = {
    uptimeSeconds: 'time() - process_start_time_seconds{job=~"ailss-.*"}',
    requestRate: 'sum by(job)(rate(ailss_http_requests_total{job=~"ailss-.*"}[5m]))',
    errorPercent:
      'sum by(job)(rate(ailss_http_requests_total{job=~"ailss-.*",status=~"5.."}[5m])) / sum by(job)(rate(ailss_http_requests_total{job=~"ailss-.*"}[5m])) * 100',
    p95Ms:
      'histogram_quantile(0.95, sum by(job,le)(rate(ailss_http_duration_seconds_bucket{job=~"ailss-.*"}[5m]))) * 1000',
  };
  const [metrics, trends, perService, dependencies] = await Promise.all([
    Promise.all(
      Object.entries(metricQueries).map(
        async ([key, expression]) => [key, await scalar(expression)] as const,
      ),
    ),
    Promise.all(
      Object.entries(trendQueries).map(async ([key, expression]) => [key, await series(expression)] as const),
    ),
    Promise.all(
      Object.entries(serviceQueries).map(async ([key, expression]) => {
        try {
          return [key, await query(expression)] as const;
        } catch {
          return [key, []] as const;
        }
      }),
    ),
    json(new URL("/health/ready", config.LEARNING_SERVICE_URL), true)
      .then(
        (raw) =>
          z.object({ dependencies: z.array(z.object({ name: z.string(), ready: z.boolean() })) }).parse(raw)
            .dependencies,
      )
      .catch(() => []),
  ]);
  const serviceMetrics: Record<string, Record<string, number | null>> = {};
  for (const [key, rows] of perService)
    for (const row of rows) {
      const job = row.metric.job;
      if (!job) continue;
      (serviceMetrics[job] ??= {})[key] = finite(row.value[1]);
    }
  return {
    sampledAt: new Date(now).toISOString(),
    range,
    metrics: Object.fromEntries(metrics),
    trends: Object.fromEntries(trends),
    serviceMetrics,
    dependencies,
    // No unique-user, token, cost or academic-risk aggregation exists yet.
    coverageNote:
      "Lịch sử theo thời gian lưu trữ của Prometheus; số đếm vận hành là ước tính từ counter, không phải tổng người dùng duy nhất.",
  };
}
