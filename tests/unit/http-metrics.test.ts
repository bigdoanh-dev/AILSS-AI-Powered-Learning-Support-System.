import { createServer, type Server } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMetrics } from "../../packages/observability/src/index.js";
import { httpMetricsMiddleware } from "../../packages/observability/src/http.js";

describe("HTTP metrics used by local monitoring", () => {
  const metrics = createMetrics("http-metrics-test");
  let server: Server;
  let origin: string;
  beforeAll(async () => {
    const app = express();
    app.use(httpMetricsMiddleware(metrics));
    app.get("/courses/:courseId", (_request, response) => response.json({ ok: true }));
    app.post("/failure", (_request, response) => response.status(503).end());
    app.get("/health/ready", (_request, response) => response.json({ ready: true }));
    app.get("/metrics", (_request, response) => response.end());
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test listener");
    origin = `http://127.0.0.1:${String(address.port)}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    metrics.registry.clear();
  });
  it("counts traffic and latency using the route template, without IDs or query values", async () => {
    await fetch(`${origin}/courses/private-course-1?email=private@example.test`);
    await fetch(`${origin}/courses/private-course-2`);
    const requests = await metrics.httpRequests.get();
    expect(requests.values).toEqual([
      { value: 2, labels: { route: "/courses/:courseId", method: "GET", status: "200" } },
    ]);
    const duration = await metrics.httpDuration.get();
    expect(
      duration.values.find((value) => value.metricName === "ailss_http_duration_seconds_count")?.value,
    ).toBe(2);
    expect(JSON.stringify(requests)).not.toContain("private");
  });
  it("records the final error status and bounds unmatched labels", async () => {
    await fetch(`${origin}/failure`, { method: "POST" });
    await fetch(`${origin}/private-unknown-1`);
    await fetch(`${origin}/private-unknown-2`);
    const requests = await metrics.httpRequests.get();
    expect(requests.values).toContainEqual({
      value: 1,
      labels: { route: "/failure", method: "POST", status: "503" },
    });
    expect(requests.values).toContainEqual({
      value: 2,
      labels: { route: "unmatched-or-mounted", method: "GET", status: "404" },
    });
  });
  it("does not inflate application traffic with health checks and Prometheus scrapes", async () => {
    const before = await metrics.httpRequests.get();
    await fetch(`${origin}/health/ready`);
    await fetch(`${origin}/metrics`);
    expect(await metrics.httpRequests.get()).toEqual(before);
  });
});
