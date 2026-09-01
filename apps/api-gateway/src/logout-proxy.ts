import type { RequestHandler } from "express";
import type { AppConfig } from "../../../packages/config/src/index.js";
import type { createMetrics } from "../../../packages/observability/src/index.js";
import { protectedIdentityProxyFactory } from "./protected-identity-proxy.js";

export { parseBearerAuthorization } from "./protected-identity-proxy.js";

export async function logoutProxy(
  config: AppConfig,
  metrics: ReturnType<typeof createMetrics>,
): Promise<RequestHandler> {
  const factory = await protectedIdentityProxyFactory(config);
  return factory.handler({
    method: "POST",
    path: "/api/v1/auth/logout",
    purpose: config.ACTOR_CONTEXT_PURPOSE,
    onInvalidBearer: () => metrics.identityLogouts.inc({ outcome: "invalid_bearer" }),
  });
}
