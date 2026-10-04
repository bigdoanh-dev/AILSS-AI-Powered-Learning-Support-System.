import { describe, expect, it } from "vitest";
import { operationsRange, operationsSnapshot } from "../../apps/api-gateway/src/admin-operations.js";

const config = {
  PROMETHEUS_SERVICE_URL: "http://prometheus.test:9090",
  LEARNING_SERVICE_URL: "http://learning.test:8102",
  INTERNAL_HTTP_TIMEOUT_MS: 1000,
};
const now = Date.parse("2026-10-04T01:00:00Z");
describe("admin operations telemetry", () => {
  it("reads real counters, range history, service metrics and dependency failures", async () => {
    const requests: URL[] = [];
    const fetcher = (async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      requests.push(url);
      if (url.pathname === "/health/ready")
        return Response.json(
          {
            dependencies: [
              { name: "cassandra", ready: true },
              { name: "rabbitmq", ready: false },
            ],
          },
          { status: 503 },
        );
      if (url.pathname === "/api/v1/query_range")
        return Response.json({
          status: "success",
          data: {
            result: [
              {
                metric: {},
                values: [
                  [now / 1000, "12"],
                  [now / 1000 + 1, "NaN"],
                ],
              },
            ],
          },
        });
      return Response.json({
        status: "success",
        data: { result: [{ metric: { job: "ailss-api-gateway" }, value: [now / 1000, "24"] }] },
      });
    }) as typeof fetch;
    const result = await operationsSnapshot(config, "365d", fetcher, now);
    expect(result.range).toBe("365d");
    expect(result.metrics.aiRequests).toBe(24);
    expect(result.metrics.storageBytes).toBe(24);
    expect(result.serviceMetrics["ailss-api-gateway"]?.p95Ms).toBe(24);
    expect(result.dependencies).toEqual([
      { name: "cassandra", ready: true },
      { name: "rabbitmq", ready: false },
    ]);
    expect(result.trends.registrations).toEqual([
      { time: new Date(now).toISOString(), value: 12 },
      { time: new Date(now + 1000).toISOString(), value: null },
    ]);
    for (const url of requests.filter((item) => item.pathname === "/api/v1/query_range")) {
      expect(url.searchParams.get("step")).toBe("604800");
      expect(Number(url.searchParams.get("end")) - Number(url.searchParams.get("start"))).toBe(365 * 86400);
    }
    expect(requests.some((url) => url.searchParams.get("query")?.includes("[28800s]"))).toBe(true);
    expect(requests.every((url) => ["prometheus.test", "learning.test"].includes(url.hostname))).toBe(true);
  });
  it("preserves unknown values rather than fabricating zero during an outage", async () => {
    const result = await operationsSnapshot(
      config,
      "7d",
      async () => {
        throw Error("offline");
      },
      now,
    );
    expect(Object.values(result.metrics).every((value) => value === null)).toBe(true);
    expect(result.trends).toEqual({ registrations: [], aiRequests: [] });
    expect(result.dependencies).toEqual([]);
    expect(result.serviceMetrics).toEqual({});
  });
  it("keeps independent sources usable and rejects non-finite samples", async () => {
    const fetcher = (async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.pathname === "/health/ready")
        return Response.json({ dependencies: [{ name: "cassandra", ready: true }] });
      if (url.pathname === "/api/v1/query_range") return Response.json({ unexpected: true });
      return Response.json({ status: "success", data: { result: [{ metric: {}, value: [1, "NaN"] }] } });
    }) as typeof fetch;
    const result = await operationsSnapshot(config, "30d", fetcher, now);
    expect(result.metrics.aiLatencyMs).toBeNull();
    expect(result.trends.aiRequests).toEqual([]);
    expect(result.dependencies[0]?.ready).toBe(true);
  });
  it("only supports bounded preset ranges", () => {
    for (const range of ["7d", "30d", "90d", "365d"])
      expect(operationsRange.safeParse(range).success).toBe(true);
    for (const range of ["all", "9999d", "1h", "30d]) or vector(1)"])
      expect(operationsRange.safeParse(range).success).toBe(false);
  });
});
