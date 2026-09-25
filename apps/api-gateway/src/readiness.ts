import type { RequestHandler } from "express";

export interface ReadinessDependency {
  readonly name: string;
  readonly url: string;
}

export interface GatewayUpstreamUrls {
  readonly IDENTITY_SERVICE_URL: string;
  readonly LEARNING_SERVICE_URL: string;
  readonly CLASSROOM_SERVICE_URL: string;
  readonly ASSESSMENT_SERVICE_URL: string;
  readonly INTERACTION_SERVICE_URL: string;
  readonly AI_SERVICE_URL: string;
  readonly NOTIFICATION_SERVICE_URL: string;
}

export function gatewayReadinessDependencies(
  profile: string | undefined,
  urls: GatewayUpstreamUrls,
): readonly ReadinessDependency[] {
  const identity = { name: "identity", url: urls.IDENTITY_SERVICE_URL };
  if (profile === "dev-core") return [identity];
  return [
    identity,
    { name: "learning", url: urls.LEARNING_SERVICE_URL },
    { name: "classroom", url: urls.CLASSROOM_SERVICE_URL },
    { name: "assessment", url: urls.ASSESSMENT_SERVICE_URL },
    { name: "interaction", url: urls.INTERACTION_SERVICE_URL },
    { name: "ai", url: urls.AI_SERVICE_URL },
    { name: "notification", url: urls.NOTIFICATION_SERVICE_URL },
  ];
}

export function createUpstreamReadinessHandler(
  dependencies: readonly ReadinessDependency[],
  timeoutMs: number,
  fetchUpstream: typeof fetch = fetch,
): RequestHandler {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError("Gateway readiness timeout must be a positive integer");
  }

  return async (_request, response) => {
    const checks = await Promise.all(
      dependencies.map(async ({ name, url }) => {
        try {
          const readyUrl = new URL("/health/ready", url);
          const upstream = await fetchUpstream(readyUrl, {
            method: "GET",
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (!upstream.ok) return { name, ready: false };
          const body = (await upstream.json()) as { readonly ready?: unknown };
          return { name, ready: body.ready === true };
        } catch {
          return { name, ready: false };
        }
      }),
    );
    const ready = checks.every((dependency) => dependency.ready);
    response.status(ready ? 200 : 503).json({
      service: "api-gateway",
      status: ready ? "UP" : "DEGRADED",
      ready,
      dependencies: checks,
      checkedAt: new Date().toISOString(),
    });
  };
}
