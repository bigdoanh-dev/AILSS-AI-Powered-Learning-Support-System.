import { createServer } from "node:http";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sanitizeIdentityHeaders } from "../../packages/http/src/index.js";
import { InProcessRateLimiter } from "../../packages/http/src/rate-limiter.js";
import { parseBearerAuthorization } from "../../apps/api-gateway/src/logout-proxy.js";
import { parseServiceAuthorization } from "../../apps/identity-service/src/public-profile/router.js";

const app = express();
app.use(sanitizeIdentityHeaders());
app.get("/limited", new InProcessRateLimiter().middleware(2), (_request, response) =>
  response.sendStatus(204),
);
app.get("/", (_request, response) => response.sendStatus(204));
const server = createServer(app);
let url = "";
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server failed");
  url = `http://127.0.0.1:${String(address.port)}`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});
describe("gateway trust boundary", () => {
  it("rejects forged identity headers", async () => {
    const response = await fetch(url, { headers: { "x-user-id": crypto.randomUUID() } });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNTRUSTED_IDENTITY_HEADER");
  });

  it.each([
    "x-user-role",
    "x-session-id",
    "x-service-identity",
    "x-actor-context",
    "x-classroom-actor-context",
  ])("rejects forged %s", async (header) => {
    const response = await fetch(url, { headers: { [header]: "forged" } });
    expect(response.status).toBe(400);
  });

  it("accepts exactly one well-formed Bearer value and rejects malformed variants", () => {
    const compact = `${"a".repeat(20)}.${"b".repeat(20)}.${"c".repeat(20)}`;
    expect(parseBearerAuthorization({ rawHeaders: ["Authorization", `Bearer ${compact}`] })).toBe(compact);
    for (const rawHeaders of [
      [],
      ["Authorization", "Basic abc"],
      ["Authorization", "Bearer"],
      ["Authorization", "Bearer malformed"],
      ["Authorization", `Bearer ${compact}`, "Authorization", `Bearer ${compact}`],
      ["Authorization", `Bearer ${"a".repeat(4_097)}`],
    ]) {
      expect(() => parseBearerAuthorization({ rawHeaders })).toThrowError(/Invalid access token/u);
    }
  });

  it("returns a safe 429 envelope after the configured rate limit", async () => {
    expect((await fetch(`${url}/limited`)).status).toBe(204);
    expect((await fetch(`${url}/limited`)).status).toBe(204);
    const response = await fetch(`${url}/limited`);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeTruthy();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "RATE_LIMITED", retryable: true },
    });
  });

  it("keeps attacker-selected paths in one client budget within a hard memory bound", () => {
    const limiter = new InProcessRateLimiter(3);
    const middleware = limiter.middleware(1);
    const statuses: number[] = [];
    const response = {
      setHeader: () => response,
      status: vi.fn((status: number) => {
        statuses.push(status);
        return response;
      }),
      json: () => response,
    };
    for (let index = 0; index < 100; index += 1) {
      middleware(
        { ip: "127.0.0.1", method: "GET", path: `/attacker-${String(index)}` } as never,
        response as never,
        () => {},
      );
    }
    expect(limiter.bucketCount).toBe(1);
    expect(statuses).toHaveLength(99);
    expect(statuses.every((status) => status === 429)).toBe(true);
  });

  it("does not evict an active throttled client when bucket capacity is exhausted", () => {
    const limiter = new InProcessRateLimiter(1);
    const middleware = limiter.middleware(1);
    const statuses: number[] = [];
    const response = {
      setHeader: () => response,
      status: (status: number) => {
        statuses.push(status);
        return response;
      },
      json: () => response,
    };
    const request = (ip: string, path: string) =>
      middleware({ ip, method: "GET", path } as never, response as never, () => {});

    request("192.0.2.1", "/target");
    request("192.0.2.1", "/target");
    request("198.51.100.1", "/churn");
    request("192.0.2.1", "/target");

    expect(limiter.bucketCount).toBe(1);
    expect(statuses).toEqual([429, 429]);
  });

  it("accepts only one exact Service compact JWS and rejects Bearer/duplicates/oversize", () => {
    const compact = `${"a".repeat(20)}.${"b".repeat(20)}.${"c".repeat(20)}`;
    expect(parseServiceAuthorization({ rawHeaders: ["Authorization", `Service ${compact}`] })).toBe(compact);
    for (const rawHeaders of [
      [],
      ["Authorization", `Bearer ${compact}`],
      ["Authorization", "Service malformed"],
      ["Authorization", `Service ${compact}`, "Authorization", `Service ${compact}`],
      ["Authorization", `Service ${"a".repeat(4_097)}`],
    ]) {
      expect(() => parseServiceAuthorization({ rawHeaders })).toThrow();
    }
  });
});
