import type { CryptoKey } from "jose";
import type { AppConfig } from "../../../packages/config/src/index.js";
import { signServiceToken } from "../../../packages/security/src/index.js";
import type { ResourceType } from "./model.js";
export class EligibilityClient {
  constructor(
    private config: AppConfig,
    private key: CryptoKey,
  ) {}
  async check(
    type: ResourceType,
    id: string,
    write: boolean,
    actor: string | undefined,
    correlationId: string,
  ) {
    const learning = type === "COURSE",
      url = new URL(
        learning
          ? `/internal/v1/courses/${id}/interaction-eligibility`
          : `/internal/v1/classes/${id}/interaction-eligibility`,
        learning ? this.config.LEARNING_SERVICE_URL : this.config.CLASSROOM_SERVICE_URL,
      );
    url.searchParams.set(
      "intent",
      learning ? (write ? "COMMENT_WRITE" : "COMMENT_READ_PUBLIC") : write ? "COMMENT_WRITE" : "COMMENT_READ",
    );
    const token = await signServiceToken(this.key, {
      issuer: this.config.SERVICE_TOKEN_ISSUER,
      serviceId: "interaction-service",
      audience: learning ? "learning-service" : "classroom-service",
      purpose: learning
        ? "learning.course.interaction-eligibility.read"
        : "classroom.interaction-eligibility.read",
      kid: this.config.INTERACTION_SERVICE_TOKEN_KID,
      ttlSeconds: 30,
    });
    const r = await fetch(url, {
      headers: {
        authorization: `Service ${token}`,
        "x-correlation-id": correlationId,
        ...(actor ? { "x-actor-context": actor } : {}),
      },
      signal: AbortSignal.timeout(800),
    });
    if (r.status === 404) return false;
    if (!r.ok) throw new Error("ELIGIBILITY_UNAVAILABLE");
    return ((await r.json()) as { eligible: boolean }).eligible;
  }
  async review(id: string, write: boolean, actor: string | undefined, correlationId: string) {
    const url = new URL(
      `/internal/v1/courses/${id}/interaction-eligibility`,
      this.config.LEARNING_SERVICE_URL,
    );
    url.searchParams.set("intent", write ? "REVIEW_CREATE" : "REVIEW_READ_PUBLIC");
    const token = await signServiceToken(this.key, {
      issuer: this.config.SERVICE_TOKEN_ISSUER,
      serviceId: "interaction-service",
      audience: "learning-service",
      purpose: "learning.course.interaction-eligibility.read",
      kid: this.config.INTERACTION_SERVICE_TOKEN_KID,
      ttlSeconds: 30,
    });
    const response = await fetch(url, {
      headers: {
        authorization: `Service ${token}`,
        "x-correlation-id": correlationId,
        ...(actor ? { "x-actor-context": actor } : {}),
      },
      signal: AbortSignal.timeout(800),
    });
    if (response.status === 404) return false;
    if (!response.ok) throw new Error("ELIGIBILITY_UNAVAILABLE");
    return ((await response.json()) as { eligible: boolean }).eligible;
  }
}
