import type { CryptoKey } from "jose";
import { z } from "zod";
import type { AppConfig } from "../../../packages/config/src/index.js";
import { loadPrivateKey, signServiceToken } from "../../../packages/security/src/index.js";

export class ClassroomDependencyError extends Error {
  public constructor(public readonly code: "REJECTED" | "UNAVAILABLE") {
    super(code);
  }
}
export class ClassroomClients {
  public constructor(
    private readonly config: AppConfig,
    private readonly key: CryptoKey,
  ) {}
  public async lecturer(userId: string, correlationId: string) {
    return this.get(
      new URL(`/internal/v1/users/${userId}/public-profile`, this.config.IDENTITY_SERVICE_URL),
      userId,
      correlationId,
      "identity-service",
      this.config.SERVICE_TOKEN_PURPOSE,
      this.config.INTERNAL_HTTP_TIMEOUT_MS,
    );
  }
  public async student(userId: string, correlationId: string) {
    const value = await this.get(
      new URL(`/internal/v1/users/${userId}/classroom-profile`, this.config.IDENTITY_SERVICE_URL),
      userId,
      correlationId,
      "identity-service",
      this.config.SERVICE_TOKEN_PURPOSE,
      this.config.INTERNAL_HTTP_TIMEOUT_MS,
    );
    return z
      .object({
        userId: z.string().uuid(),
        displayName: z.string(),
        emailMasked: z.string(),
        createdAt: z.string().datetime(),
      })
      .parse(value);
  }
  public async course(courseId: string, correlationId: string) {
    const value = await this.get(
      new URL(`/internal/v1/courses/${courseId}/class-link-eligibility`, this.config.LEARNING_SERVICE_URL),
      courseId,
      correlationId,
      "learning-service",
      "learning.course.class-link.read",
      this.config.INTERNAL_HTTP_TIMEOUT_MS,
    );
    return z
      .object({
        courseId: z.string().uuid(),
        ownerLecturerId: z.string().uuid(),
        state: z.literal("PUBLISHED"),
        recordVersion: z.number().int().positive(),
      })
      .parse(value);
  }
  private async get(
    url: URL,
    id: string,
    correlationId: string,
    audience: string,
    purpose: string,
    deadline: number,
  ) {
    void id;
    const token = await signServiceToken(this.key, {
      issuer: this.config.SERVICE_TOKEN_ISSUER,
      serviceId: "classroom-service",
      audience,
      purpose,
      kid: this.config.CLASSROOM_SERVICE_TOKEN_KID,
      ttlSeconds: 60,
    });
    try {
      const response = await fetch(url, {
        headers: { authorization: `Service ${token}`, "x-correlation-id": correlationId },
        signal: AbortSignal.timeout(deadline),
      });
      if ([400, 401, 403, 404, 409].includes(response.status)) throw new ClassroomDependencyError("REJECTED");
      if (!response.ok) throw new ClassroomDependencyError("UNAVAILABLE");
      const body = z.object({ data: z.record(z.string(), z.unknown()) }).parse(await response.json());
      return body.data;
    } catch (error) {
      if (error instanceof ClassroomDependencyError) throw error;
      throw new ClassroomDependencyError("UNAVAILABLE");
    }
  }
}
export async function createClassroomClients(config: AppConfig) {
  if (!config.SERVICE_TOKEN_PRIVATE_KEY_PATH) throw new Error("Classroom clients require private key");
  return new ClassroomClients(config, await loadPrivateKey(config.SERVICE_TOKEN_PRIVATE_KEY_PATH));
}
