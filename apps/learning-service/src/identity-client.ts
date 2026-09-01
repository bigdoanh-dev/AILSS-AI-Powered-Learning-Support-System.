import type { CryptoKey } from "jose";
import { z } from "zod";
import type { AppConfig } from "../../../packages/config/src/index.js";
import { loadPrivateKey, signServiceToken } from "../../../packages/security/src/index.js";

const uuidSchema = z.string().uuid();
const responseSchema = z
  .object({
    data: z
      .object({
        userId: z.string().uuid(),
        displayName: z.string().min(1),
        avatarRef: z.null(),
        resourceVersion: z.number().int().nonnegative(),
      })
      .strict(),
    meta: z.object({ requestId: z.string().uuid(), timestamp: z.string().datetime() }).strict(),
  })
  .strict();

export type IdentityPublicProfile = z.infer<typeof responseSchema>["data"];

export class IdentityPublicProfileClientError extends Error {
  public constructor(
    public readonly code: "IDENTITY_PROFILE_REJECTED" | "IDENTITY_PROFILE_UNAVAILABLE",
    public readonly status?: number,
  ) {
    super(code);
    this.name = "IdentityPublicProfileClientError";
  }
}

export interface IdentityPublicProfileClientOptions {
  readonly baseUrl: string;
  readonly privateKey: CryptoKey;
  readonly issuer: string;
  readonly audience: string;
  readonly purpose: string;
  readonly kid: string;
  readonly tokenTtlSeconds: number;
  readonly deadlineMs?: number;
  readonly fetcher?: typeof fetch;
}

/** Learning-owned client for INT-IDN-01. The 500 ms budget includes signing and response parsing. */
export class IdentityPublicProfileClient {
  readonly #fetcher: typeof fetch;

  public constructor(private readonly options: IdentityPublicProfileClientOptions) {
    this.#fetcher = options.fetcher ?? fetch;
  }

  public async get(userIdInput: string, correlationIdInput: string): Promise<IdentityPublicProfile> {
    const startedAt = performance.now();
    const userId = uuidSchema.parse(userIdInput);
    const correlationId = uuidSchema.parse(correlationIdInput);
    const token = await signServiceToken(this.options.privateKey, {
      issuer: this.options.issuer,
      serviceId: "learning-service",
      audience: this.options.audience,
      purpose: this.options.purpose,
      kid: this.options.kid,
      ttlSeconds: this.options.tokenTtlSeconds,
    });
    const remainingMs = Math.floor((this.options.deadlineMs ?? 500) - (performance.now() - startedAt));
    if (remainingMs <= 0) throw unavailable();

    try {
      const response = await this.#fetcher(
        new URL(`/internal/v1/users/${encodeURIComponent(userId)}/public-profile`, this.options.baseUrl),
        {
          headers: {
            authorization: `Service ${token}`,
            "x-correlation-id": correlationId,
          },
          signal: AbortSignal.timeout(remainingMs),
        },
      );
      if (!response.ok) {
        if ([400, 401, 403, 404].includes(response.status)) {
          throw new IdentityPublicProfileClientError("IDENTITY_PROFILE_REJECTED", response.status);
        }
        throw unavailable(response.status);
      }
      return responseSchema.parse(await response.json()).data;
    } catch (error) {
      if (error instanceof IdentityPublicProfileClientError) throw error;
      throw unavailable();
    }
  }
}

export async function createIdentityPublicProfileClient(
  config: AppConfig,
): Promise<IdentityPublicProfileClient> {
  if (!config.SERVICE_TOKEN_PRIVATE_KEY_PATH) {
    throw new Error("Learning identity client requires a service-token private key");
  }
  return new IdentityPublicProfileClient({
    baseUrl: config.IDENTITY_SERVICE_URL,
    privateKey: await loadPrivateKey(config.SERVICE_TOKEN_PRIVATE_KEY_PATH),
    issuer: config.SERVICE_TOKEN_ISSUER,
    audience: config.SERVICE_TOKEN_AUDIENCE,
    purpose: config.SERVICE_TOKEN_PURPOSE,
    kid: config.SERVICE_TOKEN_KID,
    tokenTtlSeconds: config.SERVICE_TOKEN_TTL_SECONDS,
    deadlineMs: config.IDENTITY_PUBLIC_PROFILE_DEADLINE_MS,
  });
}

function unavailable(status?: number): IdentityPublicProfileClientError {
  return new IdentityPublicProfileClientError("IDENTITY_PROFILE_UNAVAILABLE", status);
}
