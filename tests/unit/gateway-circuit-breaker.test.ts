import { createServer, type RequestListener } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CircuitBreaker,
  CircuitBreakerRegistry,
  createGatewayCircuitBreakers,
  gatewayCircuitBreakerMiddleware,
  installGatewayFetchInterceptor,
  resolveUpstreamService,
} from "../../apps/api-gateway/src/circuit-breaker.js";
import { AppError, errorMiddleware } from "../../packages/http/src/index.js";

const servers: Array<ReturnType<typeof createServer>> = [];

async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  return `http://127.0.0.1:${String(address.port)}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.closeAllConnections();
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe("API Gateway Circuit Breaker", () => {
  describe("Route classification", () => {
    it("maps all standard gateway routes to their respective upstreams", () => {
      expect(resolveUpstreamService("POST", "/api/v1/auth/login")).toBe("identity");
      expect(resolveUpstreamService("POST", "/api/v1/auth/register")).toBe("identity");
      expect(resolveUpstreamService("GET", "/api/v1/me")).toBe("identity");
      expect(resolveUpstreamService("PATCH", "/api/v1/me/avatar")).toBe("identity");
      expect(resolveUpstreamService("GET", "/api/v1/lecturers/abc-123")).toBe("identity");
      expect(resolveUpstreamService("GET", "/api/v1/admin/users")).toBe("identity");

      expect(resolveUpstreamService("GET", "/api/v1/courses")).toBe("learning");
      expect(resolveUpstreamService("GET", "/api/v1/courses/search")).toBe("learning");
      expect(resolveUpstreamService("GET", "/api/v1/me/courses")).toBe("learning");
      expect(resolveUpstreamService("GET", "/api/v1/me/owned-offerings")).toBe("learning");
      expect(resolveUpstreamService("POST", "/api/v1/payments/sepay/webhook")).toBe("learning");
      expect(resolveUpstreamService("GET", "/api/v1/admin/courses/c1")).toBe("learning");

      expect(resolveUpstreamService("GET", "/api/v1/classes")).toBe("classroom");
      expect(resolveUpstreamService("GET", "/api/v1/me/classes")).toBe("classroom");
      expect(resolveUpstreamService("GET", "/api/v1/class-sessions/s1")).toBe("classroom");

      expect(resolveUpstreamService("GET", "/api/v1/quizzes")).toBe("assessment");
      expect(resolveUpstreamService("GET", "/api/v1/attempts/a1")).toBe("assessment");
      expect(resolveUpstreamService("GET", "/api/v1/targets/lesson/l1/quizzes")).toBe("assessment");

      expect(resolveUpstreamService("GET", "/api/v1/resources/course/c1/comments")).toBe("interaction");
      expect(resolveUpstreamService("GET", "/api/v1/courses/c1/reviews")).toBe("interaction");
      expect(resolveUpstreamService("POST", "/api/v1/reports")).toBe("interaction");
      expect(resolveUpstreamService("GET", "/api/v1/admin/reports")).toBe("interaction");

      expect(resolveUpstreamService("POST", "/api/v1/ai/quiz-jobs")).toBe("ai");
      expect(resolveUpstreamService("POST", "/api/v1/assistant/chat")).toBe("ai");

      expect(resolveUpstreamService("GET", "/api/v1/notifications")).toBe("notification");
    });

    it("returns null for gateway-internal routes", () => {
      expect(resolveUpstreamService("GET", "/health/live")).toBeNull();
      expect(resolveUpstreamService("GET", "/health/ready")).toBeNull();
      expect(resolveUpstreamService("GET", "/metrics")).toBeNull();
      expect(resolveUpstreamService("GET", "/api/v1/admin/monitoring")).toBeNull();
      expect(resolveUpstreamService("GET", "/unknown/route")).toBeNull();
    });
  });

  describe("CircuitBreaker state machine & thresholds", () => {
    it("starts in CLOSED state with 0 failures", () => {
      const breaker = new CircuitBreaker("learning");
      expect(breaker.state).toBe("CLOSED");
      expect(breaker.getStats()).toEqual({
        total: 0,
        failures: 0,
        successes: 0,
        clientErrors: 0,
        failureRate: 0,
      });
      breaker.dispose();
    });

    it("trips to OPEN only when minimum volume and >=50% failure rate are met", () => {
      const warn = vi.fn();
      const breaker = new CircuitBreaker("learning", {
        failureThreshold: 0.5,
        volumeThreshold: 5,
        windowDurationMs: 10_000,
        logger: { warn },
      });

      // 2 failures, 2 successes (total 4 < volumeThreshold 5) -> stays CLOSED
      breaker.recordFailure();
      breaker.recordFailure();
      breaker.recordSuccess();
      breaker.recordSuccess();
      expect(breaker.state).toBe("CLOSED");
      expect(breaker.getStats().total).toBe(4);
      expect(breaker.getStats().failureRate).toBe(0.5);

      // 5th request is a failure: total = 5, failures = 3 (60% >= 50%) -> trips to OPEN
      breaker.recordFailure();
      expect(breaker.state).toBe("OPEN");
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          circuitBreaker: expect.objectContaining({
            service: "learning",
            fromState: "CLOSED",
            toState: "OPEN",
          }),
        }),
        expect.stringContaining("transitioned from CLOSED to OPEN"),
      );

      breaker.dispose();
    });

    it("immediately returns 503 and does not call action when OPEN", async () => {
      const breaker = new CircuitBreaker("identity", {
        volumeThreshold: 2,
        failureThreshold: 0.5,
        resetTimeoutMs: 10_000,
      });
      breaker.trip();

      const action = vi.fn().mockResolvedValue("data");
      await expect(breaker.execute(action)).rejects.toThrow(AppError);
      await expect(breaker.execute(action)).rejects.toMatchObject({
        code: "CIRCUIT_BREAKER_OPEN",
        status: 503,
        retryable: true,
      });
      expect(action).not.toHaveBeenCalled();

      breaker.dispose();
    });

    it("transitions from OPEN to HALF_OPEN after resetTimeout", () => {
      const warn = vi.fn();
      const baseTime = 1_000_000;
      const breaker = new CircuitBreaker("classroom", {
        resetTimeoutMs: 10_000,
        logger: { warn },
      });

      breaker.trip("Manual trip", baseTime);
      expect(breaker.getState(baseTime)).toBe("OPEN");

      // Before timeout -> still OPEN
      expect(breaker.getState(baseTime + 5_000)).toBe("OPEN");
      expect(breaker.getRemainingResetTimeMs(baseTime + 5_000)).toBe(5_000);

      // At or after timeout (10s) -> transitions to HALF_OPEN
      expect(breaker.getState(baseTime + 10_000)).toBe("HALF_OPEN");
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          circuitBreaker: expect.objectContaining({
            service: "classroom",
            fromState: "OPEN",
            toState: "HALF_OPEN",
          }),
        }),
        expect.stringContaining("transitioned from OPEN to HALF_OPEN"),
      );

      breaker.dispose();
    });

    it("recovers from HALF_OPEN to CLOSED on successful probe", () => {
      const warn = vi.fn();
      const breaker = new CircuitBreaker("assessment", {
        resetTimeoutMs: 100,
        logger: { warn },
      });

      breaker.trip();
      // Force into HALF_OPEN
      expect(breaker.getState(Date.now() + 200)).toBe("HALF_OPEN");

      // Successful probe
      breaker.recordSuccess();
      expect(breaker.state).toBe("CLOSED");
      expect(breaker.getStats().total).toBe(0); // Samples cleared on recovery
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          circuitBreaker: expect.objectContaining({
            fromState: "HALF_OPEN",
            toState: "CLOSED",
          }),
        }),
        expect.stringContaining("transitioned from HALF_OPEN to CLOSED"),
      );

      breaker.dispose();
    });

    it("trips back from HALF_OPEN to OPEN on failed probe", () => {
      const warn = vi.fn();
      const breaker = new CircuitBreaker("interaction", {
        resetTimeoutMs: 100,
        logger: { warn },
      });

      breaker.trip();
      expect(breaker.getState(Date.now() + 200)).toBe("HALF_OPEN");

      // Failed probe
      breaker.recordFailure();
      expect(breaker.state).toBe("OPEN");
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          circuitBreaker: expect.objectContaining({
            fromState: "HALF_OPEN",
            toState: "OPEN",
          }),
        }),
        expect.stringContaining("transitioned from HALF_OPEN to OPEN"),
      );

      breaker.dispose();
    });
  });

  describe("Client 4xx error exclusion", () => {
    it("does not count 4xx client errors as upstream failures", () => {
      const breaker = new CircuitBreaker("learning", {
        volumeThreshold: 5,
        failureThreshold: 0.5,
      });

      // 10 consecutive client errors (e.g. 404 Not Found, 400 Bad Request)
      for (let i = 0; i < 10; i += 1) {
        breaker.recordClientError();
      }

      const stats = breaker.getStats();
      expect(stats.total).toBe(10);
      expect(stats.failures).toBe(0);
      expect(stats.clientErrors).toBe(10);
      expect(stats.failureRate).toBe(0);
      expect(breaker.state).toBe("CLOSED");

      breaker.dispose();
    });

    it("recovers HALF_OPEN on 4xx response because upstream is reachable", () => {
      const breaker = new CircuitBreaker("ai", { resetTimeoutMs: 100 });
      breaker.trip();
      expect(breaker.getState(Date.now() + 200)).toBe("HALF_OPEN");

      // Upstream responded with 404 (valid HTTP response, service is healthy)
      breaker.recordClientError();
      expect(breaker.state).toBe("CLOSED");

      breaker.dispose();
    });
  });

  describe("Request timeout for hanging upstream requests", () => {
    it("aborts hanging request in execute() and marks it as failure", async () => {
      const breaker = new CircuitBreaker("notification", {
        timeoutMs: 50,
        volumeThreshold: 1,
        failureThreshold: 0.5,
      });

      await expect(
        breaker.execute(
          (signal) =>
            new Promise((resolve, reject) => {
              const timer = setTimeout(() => resolve("late"), 500);
              signal.addEventListener("abort", () => {
                clearTimeout(timer);
                reject(new Error("aborted"));
              });
            }),
        ),
      ).rejects.toThrow();

      expect(breaker.getStats().failures).toBe(1);
      breaker.dispose();
    });

    it("aborts hanging fetch() and converts to 503 GATEWAY_TIMEOUT", async () => {
      const stalledServer = await listen((_req, _res) => {
        // Deliberately stall and never respond
      });

      const breaker = new CircuitBreaker("learning", {
        timeoutMs: 50,
        volumeThreshold: 1,
        failureThreshold: 0.5,
      });

      await expect(breaker.fetch(stalledServer)).rejects.toMatchObject({
        code: "GATEWAY_TIMEOUT",
        status: 503,
      });

      expect(breaker.getStats().failures).toBe(1);
      breaker.dispose();
    });

    it("genuinely aborts in-flight upstream fetch on timeout (proven via upstream connection close)", async () => {
      let upstreamConnectionClosed = false;
      const stalledServer = await listen((req, res) => {
        req.on("close", () => {
          if (!res.writableEnded) {
            upstreamConnectionClosed = true;
          }
        });
      });

      const breaker = new CircuitBreaker("learning", {
        timeoutMs: 50,
      });

      await expect(breaker.fetch(stalledServer)).rejects.toMatchObject({
        code: "GATEWAY_TIMEOUT",
        status: 503,
      });

      // Allow event loop to process TCP socket close on the upstream server
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(upstreamConnectionClosed).toBe(true);

      breaker.dispose();
    });
  });

  describe("Sliding window expiration", () => {
    it("prunes failures older than windowDurationMs", () => {
      const breaker = new CircuitBreaker("learning", {
        windowDurationMs: 10_000,
        volumeThreshold: 5,
        failureThreshold: 0.5,
      });

      const t0 = 100_000;
      // 4 failures at t0
      breaker.recordFailure(t0);
      breaker.recordFailure(t0);
      breaker.recordFailure(t0);
      breaker.recordFailure(t0);

      expect(breaker.getStats(t0).failures).toBe(4);

      // Fast forward past window duration (11s later)
      const t1 = t0 + 11_000;
      expect(breaker.getStats(t1).failures).toBe(0);
      expect(breaker.getStats(t1).total).toBe(0);

      breaker.dispose();
    });
  });

  describe("Per-service isolation in CircuitBreakerRegistry", () => {
    it("keeps independent states for each upstream service", () => {
      const registry = createGatewayCircuitBreakers();

      // Trip identity
      registry.identity.trip();
      expect(registry.identity.state).toBe("OPEN");

      // Verify other services remain CLOSED
      expect(registry.learning.state).toBe("CLOSED");
      expect(registry.classroom.state).toBe("CLOSED");
      expect(registry.assessment.state).toBe("CLOSED");
      expect(registry.interaction.state).toBe("CLOSED");
      expect(registry.ai.state).toBe("CLOSED");
      expect(registry.notification.state).toBe("CLOSED");

      registry.disposeAll();
    });

    it("reads CIRCUIT_BREAKER_TIMEOUT_MS from environment", () => {
      process.env.CIRCUIT_BREAKER_TIMEOUT_MS = "7500";
      try {
        const breakers = createGatewayCircuitBreakers();
        expect(breakers.identity.timeoutMs).toBe(7500);
        expect(breakers.learning.timeoutMs).toBe(7500);
        breakers.disposeAll();
      } finally {
        delete process.env.CIRCUIT_BREAKER_TIMEOUT_MS;
      }
    });
  });

  describe("Express integration with gatewayCircuitBreakerMiddleware", () => {
    it("trips circuit on repeated 5xx upstream responses and returns immediate 503", async () => {
      let upstreamCalls = 0;
      let upstreamStatus = 500;

      const upstreamUrl = await listen((_req, res) => {
        upstreamCalls += 1;
        res.statusCode = upstreamStatus;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "internal error" }));
      });

      const registry = new CircuitBreakerRegistry({
        volumeThreshold: 5,
        failureThreshold: 0.5,
        resetTimeoutMs: 200,
        timeoutMs: 1_000,
      });

      const app = express();
      app.use(gatewayCircuitBreakerMiddleware(registry));

      // Proxy route to learning
      app.get("/api/v1/courses", async (_req, res, next) => {
        try {
          const upstream = await fetch(new URL("/api/v1/courses", upstreamUrl));
          res.status(upstream.status).send(await upstream.text());
        } catch (error) {
          next(error);
        }
      });

      const gatewayUrl = await listen(app);

      // Send 5 failing requests -> trips circuit breaker
      for (let i = 0; i < 5; i += 1) {
        const response = await fetch(`${gatewayUrl}/api/v1/courses`);
        expect(response.status).toBe(500);
      }
      expect(upstreamCalls).toBe(5);
      expect(registry.get("learning").state).toBe("OPEN");

      // 6th request: Circuit is OPEN -> immediate 503, upstream NOT called!
      const blockedResponse = await fetch(`${gatewayUrl}/api/v1/courses`);
      expect(blockedResponse.status).toBe(503);
      expect(blockedResponse.headers.get("retry-after")).toBeTruthy();
      const body = (await blockedResponse.json()) as { error: { code: string; retryable: boolean } };
      expect(body.error.code).toBe("CIRCUIT_BREAKER_OPEN");
      expect(body.error.retryable).toBe(true);
      expect(upstreamCalls).toBe(5); // Not incremented!

      // Upstream recovers
      upstreamStatus = 200;

      // Wait for resetTimeout (200ms) to trigger HALF_OPEN
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(registry.get("learning").state).toBe("HALF_OPEN");

      // Trial request in HALF_OPEN: tests upstream and recovers to CLOSED
      const probeResponse = await fetch(`${gatewayUrl}/api/v1/courses`);
      expect(probeResponse.status).toBe(200);
      expect(upstreamCalls).toBe(6);
      expect(registry.get("learning").state).toBe("CLOSED");

      // Subsequent requests succeed normally
      const nextResponse = await fetch(`${gatewayUrl}/api/v1/courses`);
      expect(nextResponse.status).toBe(200);
      expect(upstreamCalls).toBe(7);

      registry.disposeAll();
    });

    it("never trips circuit on 4xx responses even under high volume", async () => {
      let upstreamCalls = 0;

      const upstreamUrl = await listen((_req, res) => {
        upstreamCalls += 1;
        res.statusCode = 404;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: "not found" }));
      });

      const registry = new CircuitBreakerRegistry({
        volumeThreshold: 5,
        failureThreshold: 0.5,
        timeoutMs: 1_000,
      });

      const app = express();
      app.use(gatewayCircuitBreakerMiddleware(registry));

      app.get("/api/v1/courses/:id", async (req, res, next) => {
        try {
          const upstream = await fetch(new URL(req.url, upstreamUrl));
          res.status(upstream.status).send(await upstream.text());
        } catch (error) {
          next(error);
        }
      });

      const gatewayUrl = await listen(app);

      // 10 404 requests
      for (let i = 0; i < 10; i += 1) {
        const response = await fetch(`${gatewayUrl}/api/v1/courses/unknown-${String(i)}`);
        expect(response.status).toBe(404);
      }
      expect(upstreamCalls).toBe(10);
      expect(registry.get("learning").state).toBe("CLOSED");

      registry.disposeAll();
    });

    it("times out hanging requests and marks them as upstream failures", async () => {
      const stalledUrl = await listen((_req, _res) => {
        // Never finishes
      });

      const registry = new CircuitBreakerRegistry({
        timeoutMs: 50,
        volumeThreshold: 1,
        failureThreshold: 0.5,
      });

      const app = express();
      app.use(gatewayCircuitBreakerMiddleware(registry));

      app.get("/api/v1/courses", async (_req, res, next) => {
        try {
          const upstream = await fetch(stalledUrl, {
            signal: AbortSignal.timeout(300),
          });
          res.status(upstream.status).send(await upstream.text());
        } catch (error) {
          next(error);
        }
      });

      const gatewayUrl = await listen(app);

      const response = await fetch(`${gatewayUrl}/api/v1/courses`);
      expect(response.status).toBe(503);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe("GATEWAY_TIMEOUT");
      expect(registry.get("learning").getStats().failures).toBe(1);

      registry.disposeAll();
    });

    it("does not count local Gateway INTERNAL_ERROR as upstream failure", async () => {
      const registry = new CircuitBreakerRegistry({
        volumeThreshold: 2,
        failureThreshold: 0.5,
      });

      const app = express();
      app.use(gatewayCircuitBreakerMiddleware(registry));

      // Route that throws an unhandled local error inside Gateway code
      app.get("/api/v1/courses", (_req, _res, next) => {
        next(new Error("Local unhandled gateway error"));
      });
      app.use(errorMiddleware);

      const gatewayUrl = await listen(app);

      // Trigger 5 local Gateway 500 errors
      for (let i = 0; i < 5; i += 1) {
        const res = await fetch(`${gatewayUrl}/api/v1/courses`);
        expect(res.status).toBe(500);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe("INTERNAL_ERROR");
      }

      // Circuit must remain CLOSED because failures were local to Gateway, not upstream
      expect(registry.get("learning").state).toBe("CLOSED");
      expect(registry.get("learning").getStats().failures).toBe(0);

      registry.disposeAll();
    });

    it("intercepts outbound upstream fetch calls and genuinely aborts on timeout", async () => {
      let upstreamClosed = false;
      const upstreamUrl = await listen((req, res) => {
        req.on("close", () => {
          if (!res.writableEnded) upstreamClosed = true;
        });
      });

      const registry = new CircuitBreakerRegistry({
        timeoutMs: 50,
      });

      const uninstall = installGatewayFetchInterceptor(registry, {
        LEARNING_SERVICE_URL: upstreamUrl,
      });

      try {
        await expect(fetch(new URL("/api/v1/courses", upstreamUrl))).rejects.toMatchObject({
          code: "GATEWAY_TIMEOUT",
          status: 503,
        });

        await new Promise((resolve) => setTimeout(resolve, 80));
        expect(upstreamClosed).toBe(true);
        expect(registry.get("learning").getStats().failures).toBe(1);
      } finally {
        uninstall();
        registry.disposeAll();
      }
    });
  });

  describe("Full integration: route middleware + intercepted outbound fetch", () => {
    it("records both upstream calls when one gateway request fetches the same service twice", async () => {
      let upstreamHits = 0;
      const upstreamUrl = await listen((_req, res) => {
        upstreamHits += 1;
        res.writeHead(upstreamHits === 1 ? 200 : 500).end();
      });
      const registry = new CircuitBreakerRegistry({ timeoutMs: 1_000, volumeThreshold: 5 });
      const uninstall = installGatewayFetchInterceptor(registry, { LEARNING_SERVICE_URL: upstreamUrl });
      const app = express();
      app.use(gatewayCircuitBreakerMiddleware(registry));
      app.get("/api/v1/courses", async (_req, res, next) => {
        try {
          await fetch(new URL("/first", upstreamUrl));
          await fetch(new URL("/second", upstreamUrl));
          res.sendStatus(200);
        } catch (error) {
          next(error);
        }
      });
      app.use(errorMiddleware);
      const gatewayUrl = await listen(app);
      try {
        expect((await fetch(`${gatewayUrl}/api/v1/courses`)).status).toBe(200);
        expect(upstreamHits).toBe(2);
        expect(registry.get("learning").getStats()).toMatchObject({
          total: 2,
          successes: 1,
          failures: 1,
        });
      } finally {
        uninstall();
        registry.disposeAll();
      }
    });

    it("records exactly one sample per upstream call across middleware and intercepted fetch", async () => {
      let upstreamReceived = 0;
      const upstreamUrl = await listen((req, res) => {
        upstreamReceived += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ courses: [] }));
      });

      const registry = new CircuitBreakerRegistry({ timeoutMs: 1_000 });
      const uninstall = installGatewayFetchInterceptor(registry, {
        LEARNING_SERVICE_URL: upstreamUrl,
      });

      const app = express();
      app.use(gatewayCircuitBreakerMiddleware(registry));
      app.get("/api/v1/courses", async (req, res, next) => {
        try {
          const upstream = await fetch(new URL("/api/v1/courses", upstreamUrl));
          res.status(upstream.status).send(await upstream.text());
        } catch (error) {
          next(error);
        }
      });
      app.use(errorMiddleware);

      const gatewayUrl = await listen(app);

      try {
        // Send 1 request
        const res1 = await fetch(`${gatewayUrl}/api/v1/courses`);
        expect(res1.status).toBe(200);
        expect(upstreamReceived).toBe(1);

        // Breaker must record exactly 1 sample (not 2 from both middleware finish and fetch)
        const stats1 = registry.get("learning").getStats();
        expect(stats1.total).toBe(1);
        expect(stats1.failures).toBe(0);

        // Send 2 more requests
        await fetch(`${gatewayUrl}/api/v1/courses`);
        await fetch(`${gatewayUrl}/api/v1/courses`);
        expect(upstreamReceived).toBe(3);

        const stats2 = registry.get("learning").getStats();
        expect(stats2.total).toBe(3);
        expect(stats2.failures).toBe(0);
      } finally {
        uninstall();
        registry.disposeAll();
      }
    });

    it("executes complete CLOSED -> OPEN -> HALF_OPEN -> CLOSED cycle through middleware and intercepted fetch", async () => {
      let upstreamStatus = 500;
      let upstreamHits = 0;
      const upstreamUrl = await listen((req, res) => {
        upstreamHits += 1;
        res.writeHead(upstreamStatus, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: upstreamStatus }));
      });

      const registry = new CircuitBreakerRegistry({
        volumeThreshold: 2,
        failureThreshold: 0.5,
        resetTimeoutMs: 80,
      });
      const uninstall = installGatewayFetchInterceptor(registry, {
        LEARNING_SERVICE_URL: upstreamUrl,
      });

      const app = express();
      app.use(gatewayCircuitBreakerMiddleware(registry));
      app.get("/api/v1/courses", async (req, res, next) => {
        try {
          const upstream = await fetch(new URL("/api/v1/courses", upstreamUrl));
          res.status(upstream.status).send(await upstream.text());
        } catch (error) {
          next(error);
        }
      });
      app.use(errorMiddleware);

      const gatewayUrl = await listen(app);
      const breaker = registry.get("learning");

      try {
        // Step 1: Initial state is CLOSED
        expect(breaker.state).toBe("CLOSED");

        // Send 2 failing requests (500)
        const r1 = await fetch(`${gatewayUrl}/api/v1/courses`);
        expect(r1.status).toBe(500);
        const r2 = await fetch(`${gatewayUrl}/api/v1/courses`);
        expect(r2.status).toBe(500);

        // Exactly 2 samples recorded, both failures
        expect(breaker.getStats().total).toBe(2);
        expect(breaker.getStats().failures).toBe(2);

        // Step 2: Circuit must have tripped to OPEN
        expect(breaker.state).toBe("OPEN");

        // 3rd request: Gateway middleware must fast-fail with 503 without calling upstream
        const hitsBefore = upstreamHits;
        const r3 = await fetch(`${gatewayUrl}/api/v1/courses`);
        expect(r3.status).toBe(503);
        expect(r3.headers.get("retry-after")).toBeTruthy();
        const b3 = (await r3.json()) as { error: { code: string } };
        expect(b3.error.code).toBe("CIRCUIT_BREAKER_OPEN");
        expect(upstreamHits).toBe(hitsBefore); // Upstream was NOT called

        // Step 3: Wait for resetTimeout to transition to HALF_OPEN
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(breaker.state).toBe("HALF_OPEN");

        // Upstream recovers
        upstreamStatus = 200;

        // Step 4: Send trial probe through the gateway route
        // Middleware marks probe, intercepted fetch recognizes admitted probe, reaches upstream, succeeds
        const rProbe = await fetch(`${gatewayUrl}/api/v1/courses`);
        expect(rProbe.status).toBe(200);

        // Step 5: Circuit must have recovered to CLOSED!
        expect(breaker.state).toBe("CLOSED");
        expect(breaker.getStats().failures).toBe(0);

        // Subsequent normal request succeeds in CLOSED state
        const rNormal = await fetch(`${gatewayUrl}/api/v1/courses`);
        expect(rNormal.status).toBe(200);
        expect(breaker.state).toBe("CLOSED");
      } finally {
        uninstall();
        registry.disposeAll();
      }
    });

    it("authentically aborts hanging upstream fetch and returns 503 with single failure recorded", async () => {
      let upstreamClosed = false;
      const upstreamUrl = await listen((req, res) => {
        req.on("close", () => {
          if (!res.writableEnded) upstreamClosed = true;
        });
      });

      const registry = new CircuitBreakerRegistry({
        timeoutMs: 50,
      });
      const uninstall = installGatewayFetchInterceptor(registry, {
        LEARNING_SERVICE_URL: upstreamUrl,
      });

      const app = express();
      app.use(gatewayCircuitBreakerMiddleware(registry));
      app.get("/api/v1/courses", async (req, res, next) => {
        try {
          const upstream = await fetch(new URL("/api/v1/courses", upstreamUrl));
          res.status(upstream.status).send(await upstream.text());
        } catch (error) {
          next(error);
        }
      });
      app.use(errorMiddleware);

      const gatewayUrl = await listen(app);

      try {
        const response = await fetch(`${gatewayUrl}/api/v1/courses`);
        expect(response.status).toBe(503);
        const body = (await response.json()) as { error: { code: string } };
        expect(body.error.code).toBe("GATEWAY_TIMEOUT");

        await new Promise((resolve) => setTimeout(resolve, 80));
        expect(upstreamClosed).toBe(true);

        // Exactly one failure recorded (not duplicated between fetch and route finish)
        const stats = registry.get("learning").getStats();
        expect(stats.total).toBe(1);
        expect(stats.failures).toBe(1);
      } finally {
        uninstall();
        registry.disposeAll();
      }
    });
  });
});
