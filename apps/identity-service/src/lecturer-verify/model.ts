import { createHmac } from "node:crypto";
import { z } from "zod";
import { identitySearchShard } from "../admin/model.js";

export { identitySearchShard };

export const LECTURER_VERIFY_IDEMPOTENCY_TTL_SECONDS = 86_400;

const verifyRequestSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
  })
  .strict();

export interface LecturerVerifyRequest {
  readonly currentPassword: string;
}

export interface LecturerVerifyMetadata {
  readonly schemaVersion: 1;
  readonly requestFingerprint: string;
  readonly actorId: string;
  readonly targetId: string;
  readonly displayName: string;
  readonly profileVersion: number;
  readonly shard: number;
  readonly oldUpdatedAt: string;
  readonly newUpdatedAt: string;
  readonly expectedTokenVersion: number;
  readonly nextTokenVersion: number;
  readonly previousSecurityOperationId: string | null;
  readonly auditEventId: string;
}

export function parseLecturerVerifyRequest(value: unknown): LecturerVerifyRequest {
  const parsed = verifyRequestSchema.parse(value);
  return { currentPassword: parsed.currentPassword };
}

export function lecturerVerifyScope(actorId: string, targetId: string): string {
  return `admin:${actorId}:target:${targetId}:IDN-12`;
}

export function lecturerVerifyFingerprint(
  secret: string,
  actorId: string,
  targetId: string,
  request: LecturerVerifyRequest,
): string {
  return createHmac("sha256", secret)
    .update(
      JSON.stringify({
        api: "IDN-12",
        method: "POST",
        path: `/api/v1/admin/lecturers/${targetId}/verify`,
        actorId,
        targetId,
        currentPassword: request.currentPassword,
      }),
      "utf8",
    )
    .digest("hex");
}

export function serializeLecturerVerifyMetadata(value: LecturerVerifyMetadata): string {
  return JSON.stringify(value);
}

export function parseLecturerVerifyMetadata(value: string): LecturerVerifyMetadata | undefined {
  try {
    return z
      .object({
        schemaVersion: z.literal(1),
        requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
        actorId: z.string().uuid(),
        targetId: z.string().uuid(),
        displayName: z.string().min(2).max(100),
        profileVersion: z.number().int().positive(),
        shard: z.number().int().min(0).max(15),
        oldUpdatedAt: z.string().datetime(),
        newUpdatedAt: z.string().datetime(),
        expectedTokenVersion: z.number().int().positive(),
        nextTokenVersion: z.number().int().positive(),
        previousSecurityOperationId: z.string().uuid().nullable(),
        auditEventId: z.string().uuid(),
      })
      .strict()
      .parse(JSON.parse(value));
  } catch {
    return undefined;
  }
}
