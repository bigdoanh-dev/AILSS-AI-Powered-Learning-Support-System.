import { performance } from "node:perf_hooks";
import type { RequestHandler } from "express";
import type { createMetrics } from "./index.js";

/** Record completed application requests, without raw URLs or probe traffic. */
export function httpMetricsMiddleware(
  metrics: Pick<ReturnType<typeof createMetrics>, "httpRequests" | "httpDuration">,
): RequestHandler {
  return (request, response, next) => {
    if (request.path === "/metrics" || request.path.startsWith("/health/")) {
      next();
      return;
    }
    const startedAt = performance.now();
    response.once("finish", () => {
      // Matched route templates keep account IDs and arbitrary query/path values out of labels.
      const matchedRoute: unknown = request.route;
      const routePath =
        matchedRoute && typeof matchedRoute === "object" && "path" in matchedRoute
          ? matchedRoute.path
          : undefined;
      const route = typeof routePath === "string" && !request.baseUrl ? routePath : "unmatched-or-mounted";
      const method = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(request.method)
        ? request.method
        : "OTHER";
      metrics.httpRequests.inc({ route, method, status: String(response.statusCode) });
      metrics.httpDuration.observe({ route, method }, (performance.now() - startedAt) / 1000);
    });
    next();
  };
}
