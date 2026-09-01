import type { CryptoKey } from "jose";
import { z } from "zod";
import type { AppConfig } from "../../../../packages/config/src/index.js";
import { loadPrivateKey, signServiceToken } from "../../../../packages/security/src/index.js";

export class CommerceClassroomError extends Error {
  public constructor(
    public readonly kind: "REJECTED" | "UNAVAILABLE",
    public readonly code: string,
    public readonly status?: number,
  ) {
    super(code);
  }
}
const reservation = z
  .object({
    reservationId: z.string().uuid(),
    state: z.enum(["HELD", "CONFIRMED", "RELEASED", "EXPIRED"]),
    expiresAt: z.string().datetime(),
    scheduleVersion: z.number().int(),
  })
  .passthrough();
const membership = z
  .object({
    membershipId: z.string().uuid(),
    classId: z.string().uuid(),
    studentId: z.string().uuid(),
    state: z.enum(["PENDING", "ACTIVE"]),
    source: z.enum(["JOIN_CODE", "PURCHASE"]),
    joinedAt: z.string().datetime(),
    version: z.number().int(),
  })
  .passthrough();

export class CommerceClassroomClient {
  public constructor(
    private readonly config: AppConfig,
    private readonly key: CryptoKey,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async reserve(
    input: { operationId: string; studentId: string; offeringId: string; classId: string },
    correlationId: string,
    actorContext?: string,
    fulfillment = false,
  ) {
    return reservation.parse(
      await this.call(
        "POST",
        "/internal/v1/schedule-reservations",
        fulfillment ? "classroom.schedule.reserve.fulfillment" : "classroom.schedule.reserve",
        correlationId,
        input,
        actorContext,
      ),
    );
  }
  async confirm(
    reservationId: string,
    input: { operationId: string; orderId: string; membershipId: string },
    correlationId: string,
  ) {
    return reservation.parse(
      await this.call(
        "POST",
        `/internal/v1/schedule-reservations/${encodeURIComponent(reservationId)}/confirm`,
        "classroom.schedule.confirm",
        correlationId,
        input,
      ),
    );
  }
  async release(
    reservationId: string,
    input: { operationId: string; reason: "PAYMENT_FAILED" | "CANCELLED" | "COMPENSATION" | "EXPIRED" },
    correlationId: string,
  ) {
    return reservation.parse(
      await this.call(
        "POST",
        `/internal/v1/schedule-reservations/${encodeURIComponent(reservationId)}/release`,
        "classroom.schedule.release",
        correlationId,
        input,
      ),
    );
  }
  async membership(
    classId: string,
    input: {
      action: "PREPARE" | "ACTIVATE";
      operationId: string;
      studentId: string;
      offeringId: string;
      enrollmentId: string;
      reservationId: string;
      orderId: string;
      membershipId: string;
    },
    correlationId: string,
  ) {
    return membership.parse(
      await this.call(
        "POST",
        `/internal/v1/classes/${encodeURIComponent(classId)}/memberships/activate`,
        "classroom.membership.activate",
        correlationId,
        input,
      ),
    );
  }
  private async call(
    method: string,
    path: string,
    purpose: string,
    correlationId: string,
    body?: object,
    actorContext?: string,
  ) {
    const token = await signServiceToken(this.key, {
      issuer: this.config.SERVICE_TOKEN_ISSUER,
      serviceId: "learning-service",
      audience: "classroom-service",
      purpose,
      kid: this.config.SERVICE_TOKEN_KID,
      ttlSeconds: this.config.SERVICE_TOKEN_TTL_SECONDS,
    });
    try {
      const response = await this.fetcher(new URL(path, this.config.CLASSROOM_SERVICE_URL), {
        method,
        headers: {
          authorization: `Service ${token}`,
          "content-type": "application/json",
          "x-correlation-id": correlationId,
          ...(actorContext ? { "x-actor-context": actorContext } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(800),
      });
      const raw = await response.json().catch(() => ({}));
      if (!response.ok) {
        const code = z.object({ error: z.object({ code: z.string() }) }).safeParse(raw);
        throw new CommerceClassroomError(
          response.status >= 500 ? "UNAVAILABLE" : "REJECTED",
          code.success ? code.data.error.code : "CLASSROOM_REJECTED",
          response.status,
        );
      }
      return z.object({ data: z.unknown() }).parse(raw).data;
    } catch (error) {
      if (error instanceof CommerceClassroomError) throw error;
      throw new CommerceClassroomError("UNAVAILABLE", "CLASSROOM_UNAVAILABLE");
    }
  }
}
export async function createCommerceClassroomClient(config: AppConfig) {
  if (!config.SERVICE_TOKEN_PRIVATE_KEY_PATH)
    throw new Error("Learning commerce requires a service-token private key");
  return new CommerceClassroomClient(config, await loadPrivateKey(config.SERVICE_TOKEN_PRIVATE_KEY_PATH));
}
