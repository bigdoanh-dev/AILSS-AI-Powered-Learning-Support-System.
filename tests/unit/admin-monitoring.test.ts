import { describe, expect, it } from "vitest";
import { monitoringSnapshot } from "../../apps/api-gateway/src/monitoring.js";

const config = {
  PROMETHEUS_SERVICE_URL: "http://prometheus.test:9090",
  GRAFANA_SERVICE_URL: "http://grafana.test:3000",
  PROMETHEUS_PUBLIC_URL: "https://metrics.example.test",
  GRAFANA_PUBLIC_URL: "https://grafana.example.test",
  INTERNAL_HTTP_TIMEOUT_MS: 1000,
};
describe("admin monitoring data", () => {
  it("reads platform targets, metrics, alerts and the provisioned Grafana dashboard", async () => {
    const fetcher = (async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      const value =
        url.pathname === "/api/health"
          ? { database: "ok" }
          : url.pathname === "/api/v1/targets"
            ? {
                status: "success",
                data: {
                  activeTargets: [
                    {
                      labels: { job: "ailss-api-gateway", instance: "api-gateway:8080" },
                      health: "up",
                      lastScrape: new Date().toISOString(),
                      lastError: "",
                    },
                    {
                      labels: { job: "unrelated" },
                      health: "up",
                      lastScrape: new Date().toISOString(),
                      lastError: "",
                    },
                  ],
                },
              }
            : url.pathname === "/api/v1/alerts"
              ? {
                  status: "success",
                  data: {
                    alerts: [
                      {
                        labels: { alertname: "AilssServiceDown", severity: "page" },
                        annotations: { summary: "Service down" },
                        state: "firing",
                      },
                    ],
                  },
                }
              : url.pathname === "/api/v1/query_range"
                ? {
                    status: "success",
                    data: {
                      result: [
                        {
                          values: [
                            [1, "10"],
                            [2, "NaN"],
                          ],
                        },
                      ],
                    },
                  }
                : {
                    status: "success",
                    data: {
                      result: [
                        {
                          value: [
                            1,
                            url.searchParams.get("query")?.includes("histogram_quantile")
                              ? "0.12"
                              : url.searchParams.get("query")?.includes('status=~"5.."')
                                ? "1"
                                : "10",
                          ],
                        },
                      ],
                    },
                  };
      return Response.json(value);
    }) as typeof fetch;
    const data = await monitoringSnapshot(config, fetcher);
    expect(data.prometheus.available).toBe(true);
    expect(data.grafana).toEqual({ available: true, url: "https://grafana.example.test/d/ailss-platform" });
    expect(data.services).toHaveLength(1);
    expect(data.metrics).toEqual({ requestRate: 10, errorPercent: 10, p95Ms: 120 });
    expect(data.alerts?.[0]?.name).toBe("AilssServiceDown");
    expect(data.history[1]?.requestRate).toBeNull();
  });
  it("reports unavailable collectors without inventing zero metrics", async () => {
    const data = await monitoringSnapshot(config, (async () => {
      throw new Error("offline");
    }) as typeof fetch);
    expect(data.prometheus.available).toBe(false);
    expect(data.grafana.available).toBe(false);
    expect(data.metrics).toEqual({ requestRate: null, errorPercent: null, p95Ms: null });
    expect(data.alerts).toBeNull();
  });
});
