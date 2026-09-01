import type { CryptoKey } from "jose";
import { z } from "zod";
import type { AppConfig } from "../../../packages/config/src/index.js";
import { loadPrivateKey, signServiceToken } from "../../../packages/security/src/index.js";

const uuidSchema = z.string().uuid();
const responseSchema = z
  .object({
    data: z
      .object({
        classId: z.string().uuid(),
        linkedCourseId: z.string().uuid().optional(),
        ownerLecturerId: z.string().uuid(),
        classKind: z.enum(["LIVE_COHORT", "PRIVATE", "INSTITUTIONAL"]),
        classState: z.enum(["ACTIVE", "CLOSED"]),
        scheduleState: z.enum(["DRAFT", "PUBLISHED"]),
        scheduleVersion: z.number().int().nonnegative(),
        sessionCount: z.number().int().nonnegative(),
      })
      .strict(),
    meta: z.object({ requestId: z.string().uuid(), timestamp: z.string().datetime() }).strict(),
  })
  .strict();

export type ClassroomOfferingContext = z.infer<typeof responseSchema>["data"];

export class ClassroomOfferingContextClientError extends Error {
  public constructor(
    public readonly code: "CLASSROOM_CONTEXT_REJECTED" | "CLASSROOM_CONTEXT_UNAVAILABLE",
    public readonly status?: number,
  ) {
    super(code);
    this.name = "ClassroomOfferingContextClientError";
  }
}

export interface ClassroomOfferingContextClientOptions {
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

/** Learning-owned client for INT-CLS-08. The 800 ms budget includes signing and response parsing. */
export class ClassroomOfferingContextClient {
  readonly #fetcher: typeof fetch;

  public constructor(private readonly options: ClassroomOfferingContextClientOptions) {
    this.#fetcher = options.fetcher ?? fetch;
  }

  public async get(classIdInput: string, correlationIdInput: string): Promise<ClassroomOfferingContext> {
    const startedAt = performance.now();
    const classId = uuidSchema.parse(classIdInput);
    const correlationId = uuidSchema.parse(correlationIdInput);
    const token = await signServiceToken(this.options.privateKey, {
      issuer: this.options.issuer,
      serviceId: "learning-service",
      audience: this.options.audience,
      purpose: this.options.purpose,
      kid: this.options.kid,
      ttlSeconds: this.options.tokenTtlSeconds,
    });
    const remainingMs = Math.floor((this.options.deadlineMs ?? 800) - (performance.now() - startedAt));
    if (remainingMs <= 0) throw unavailable();

    try {
      const response = await this.#fetcher(
        new URL(`/internal/v1/classes/${encodeURIComponent(classId)}/offering-context`, this.options.baseUrl),
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
          throw new ClassroomOfferingContextClientError("CLASSROOM_CONTEXT_REJECTED", response.status);
        }
        throw unavailable(response.status);
      }
      return responseSchema.parse(await response.json()).data;
    } catch (error) {
      if (error instanceof ClassroomOfferingContextClientError) throw error;
      throw unavailable();
    }
  }
}

export async function createClassroomOfferingContextClient(
  config: AppConfig,
): Promise<ClassroomOfferingContextClient> {
  if (!config.SERVICE_TOKEN_PRIVATE_KEY_PATH) {
    throw new Error("Learning classroom client requires a service-token private key");
  }
  return new ClassroomOfferingContextClient({
    baseUrl: config.CLASSROOM_SERVICE_URL,
    privateKey: await loadPrivateKey(config.SERVICE_TOKEN_PRIVATE_KEY_PATH),
    issuer: config.SERVICE_TOKEN_ISSUER,
    audience: "classroom-service",
    purpose: "classroom.offering-context.read",
    kid: config.SERVICE_TOKEN_KID,
    tokenTtlSeconds: config.SERVICE_TOKEN_TTL_SECONDS,
    deadlineMs: config.CLASSROOM_OFFERING_CONTEXT_DEADLINE_MS,
  });
}

function unavailable(status?: number): ClassroomOfferingContextClientError {
  return new ClassroomOfferingContextClientError("CLASSROOM_CONTEXT_UNAVAILABLE", status);
}
