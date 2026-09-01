import { createHash } from "node:crypto";
import { z } from "zod";
import { displayNameSchema } from "../shared/identity-input.js";

export const PROFILE_BUSINESS_QUERY_IDS = ["Q-IDN-001", "Q-IDN-005", "Q-IDN-006", "Q-IDN-007"] as const;
export const PROFILE_SECURITY_QUERY_IDS = ["Q-IDN-003"] as const;
export const PROFILE_IDEMPOTENCY_TTL_SECONDS = 86_400;

const profileUpdateSchema = z.object({ displayName: displayNameSchema }).strict();

export interface ProfileUpdateRequest {
  readonly displayName: string;
}

export interface ProfileUser {
  readonly userId: string;
  readonly emailMasked: string;
  readonly displayName: string;
  readonly role: string;
  readonly status: string;
  readonly lecturerVerified: boolean;
  readonly tokenVersion: number;
  readonly credentialVersion: number;
  readonly normalizedEmail: string;
  readonly securityOperationId: string | null;
  readonly profileVersion: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ProfileUpdateMetadataV1 {
  readonly schemaVersion: 1;
  readonly requestChecksum: string;
  readonly expectedVersion: number;
  readonly nextVersion: number;
  readonly updatedAt: string;
  readonly noOp: boolean;
}

export interface ProfileUpdateMetadataV2 {
  readonly schemaVersion: 2;
  readonly requestChecksum: string;
  readonly expectedVersion: number;
  readonly nextVersion: number;
  readonly updatedAt: string;
  readonly noOp: boolean;
  readonly projectionRequired: boolean;
}

export interface ProfileUpdateMetadataV3 extends Omit<ProfileUpdateMetadataV2, "schemaVersion"> {
  readonly schemaVersion: 3;
  readonly oldDisplayName: string;
  readonly oldUpdatedAt: string;
  readonly role: string;
  readonly status: string;
  readonly lecturerVerified: boolean;
  readonly shard: number;
}

export type ProfileUpdateMetadata =
  ProfileUpdateMetadataV1 | ProfileUpdateMetadataV2 | ProfileUpdateMetadataV3;

export interface ProfileUpdateResult {
  readonly userId: string;
  readonly profileVersion: number;
  readonly replayed: boolean;
  readonly noOp: boolean;
}

export function parseProfileUpdateRequest(value: unknown): ProfileUpdateRequest {
  return profileUpdateSchema.parse(value);
}

export function profileUpdateScope(userId: string): string {
  return `user:${userId}:IDN-06`;
}

export function profileUpdateFingerprint(userId: string, request: ProfileUpdateRequest): string {
  return createHash("sha256")
    .update(JSON.stringify({ api: "IDN-06", userId, displayName: request.displayName }), "utf8")
    .digest("hex");
}

export function serializeProfileUpdateMetadata(metadata: ProfileUpdateMetadata): string {
  return JSON.stringify(metadata);
}

export function parseProfileUpdateMetadata(value: string): ProfileUpdateMetadata | undefined {
  try {
    return z
      .discriminatedUnion("schemaVersion", [
        z.object({
          schemaVersion: z.literal(1),
          requestChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
          expectedVersion: z.number().int().positive(),
          nextVersion: z.number().int().positive(),
          updatedAt: z.string().datetime(),
          noOp: z.boolean(),
        }),
        z.object({
          schemaVersion: z.literal(2),
          requestChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
          expectedVersion: z.number().int().positive(),
          nextVersion: z.number().int().positive(),
          updatedAt: z.string().datetime(),
          noOp: z.boolean(),
          projectionRequired: z.boolean(),
        }),
        z.object({
          schemaVersion: z.literal(3),
          requestChecksum: z.string().regex(/^[a-f0-9]{64}$/u),
          expectedVersion: z.number().int().positive(),
          nextVersion: z.number().int().positive(),
          updatedAt: z.string().datetime(),
          noOp: z.boolean(),
          projectionRequired: z.boolean(),
          oldDisplayName: z.string().min(2).max(100),
          oldUpdatedAt: z.string().datetime(),
          role: z.string().min(1),
          status: z.string().min(1),
          lecturerVerified: z.boolean(),
          shard: z.number().int().min(0).max(15),
        }),
      ])
      .parse(JSON.parse(value));
  } catch {
    return undefined;
  }
}

export function idempotencyRequestChecksum(value: string): string {
  return parseProfileUpdateMetadata(value)?.requestChecksum ?? value;
}
