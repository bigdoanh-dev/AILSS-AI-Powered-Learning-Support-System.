import { createServer, type RequestListener } from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import {
  createUpstreamReadinessHandler,
  gatewayReadinessDependencies,
} from "../../apps/api-gateway/src/readiness.js";

const upstreamUrls = {
  IDENTITY_SERVICE_URL: "http://identity-service:8101",
  LEARNING_SERVICE_URL: "http://learning-service:8102",
  CLASSROOM_SERVICE_URL: "http://classroom-service:8103",
  ASSESSMENT_SERVICE_URL: "http://assessment-service:8104",
  INTERACTION_SERVICE_URL: "http://interaction-service:8105",
  AI_SERVICE_URL: "http://ai-service:8106",
  NOTIFICATION_SERVICE_URL: "http://notification-worker:8203",
};

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
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

describe("API Gateway readiness", () => {
  it("checks only the deployed Identity service in dev-core", () => {
    expect(gatewayReadinessDependencies("dev-core", upstreamUrls)).toEqual([
      { name: "identity", url: upstreamUrls.IDENTITY_SERVICE_URL },
    ]);
  });

  it.each(["dev-async", "research", "demo", "production", undefined])(
    "checks every routed upstream in profile %s",
    (profile) => {
      expect(gatewayReadinessDependencies(profile, upstreamUrls).map(({ name }) => name)).toEqual([
        "identity",
        "learning",
        "classroom",
        "assessment",
        "interaction",
        "ai",
        "notification",
      ]);
    },
  );

  it("reports UP only when every required upstream is ready", async () => {
    const identity = await listen((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ready: true }));
    });
    const learning = await listen((_request, response) => {
      response.statusCode = 503;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ready: false }));
    });
    const app = express();
    app.get(
      "/health/ready",
      createUpstreamReadinessHandler(
        [
          { name: "identity", url: identity },
          { name: "learning", url: learning },
        ],
        500,
      ),
    );
    const gateway = await listen(app);

    const response = await fetch(`${gateway}/health/ready`);
    const body = (await response.json()) as {
      readonly ready: boolean;
      readonly status: string;
      readonly dependencies: readonly { readonly name: string; readonly ready: boolean }[];
    };
    expect(response.status).toBe(503);
    expect(body.ready).toBe(false);
    expect(body.status).toBe("DEGRADED");
    expect(body.dependencies).toEqual([
      { name: "identity", ready: true },
      { name: "learning", ready: false },
    ]);
  });

  it("rejects a contradictory upstream body with ready false and status UP", async () => {
    const upstream = await listen((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ready: false, status: "UP" }));
    });
    const app = express();
    app.get("/health/ready", createUpstreamReadinessHandler([{ name: "identity", url: upstream }], 500));
    const gateway = await listen(app);

    const response = await fetch(`${gateway}/health/ready`);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ ready: false, status: "DEGRADED" });
  });

  it("bounds a hanging upstream check and returns degraded instead of hanging", async () => {
    const stalled = await listen((_request, _response) => undefined);
    const app = express();
    app.get("/health/ready", createUpstreamReadinessHandler([{ name: "identity", url: stalled }], 100));
    const gateway = await listen(app);

    const startedAt = Date.now();
    const response = await fetch(`${gateway}/health/ready`);
    const body = (await response.json()) as {
      readonly ready: boolean;
      readonly dependencies: readonly { readonly ready: boolean }[];
    };
    expect(response.status).toBe(503);
    expect(body.ready).toBe(false);
    expect(body.dependencies[0]?.ready).toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});
