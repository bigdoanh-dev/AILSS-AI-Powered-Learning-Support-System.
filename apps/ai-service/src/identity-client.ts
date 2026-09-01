import type { CryptoKey } from "jose";
import { z } from "zod";
import { signServiceToken } from "../../../packages/security/src/index.js";

const response = z.object({ data: z.object({ userId: z.string().uuid() }).passthrough() }).passthrough();
export class AiIdentityClient {
  constructor(private readonly input: { baseUrl: string; key: CryptoKey; kid: string; deadlineMs: number }) {}
  async eligible(userId: string, correlationId: string): Promise<void> {
    const token = await signServiceToken(this.input.key, {
      issuer: "ailss-internal",
      serviceId: "ai-service",
      audience: "identity-service",
      purpose: "identity.public-profile.read",
      kid: this.input.kid,
      ttlSeconds: 60,
    });
    try {
      const result = await fetch(
        new URL(`/internal/v1/users/${encodeURIComponent(userId)}/public-profile`, this.input.baseUrl),
        {
          headers: { authorization: `Service ${token}`, "x-correlation-id": correlationId },
          signal: AbortSignal.timeout(this.input.deadlineMs),
        },
      );
      if (!result.ok) throw new Error(result.status < 500 ? "REJECTED" : "UNAVAILABLE");
      if (response.parse(await result.json()).data.userId !== userId) throw new Error("REJECTED");
    } catch (error) {
      if (error instanceof Error && error.message === "REJECTED") throw error;
      throw new Error("UNAVAILABLE");
    }
  }
}
