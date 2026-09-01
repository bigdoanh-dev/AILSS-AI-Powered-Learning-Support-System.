import { createHmac } from "node:crypto";
import { z } from "zod";

export const PASSWORD_CHANGE_QUERY_IDS = [
  "Q-IDN-001",
  "Q-IDN-002",
  "Q-IDN-003",
  "Q-IDN-004",
  "Q-IDN-007",
] as const;
export const PASSWORD_IDEMPOTENCY_TTL_SECONDS = 86_400;

const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(12).max(128),
  })
  .strict();

const metadataSchema = z.object({
  schemaVersion: z.literal(1),
  requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  expectedTokenVersion: z.number().int().nonnegative(),
  nextTokenVersion: z.number().int().positive(),
  expectedCredentialVersion: z.number().int().positive(),
  nextCredentialVersion: z.number().int().positive(),
  updatedAt: z.string().datetime(),
});

export interface PasswordChangeRequest {
  readonly currentPassword: string;
  readonly newPassword: string;
}

export interface PasswordChangeMetadata {
  readonly schemaVersion: 1;
  readonly requestFingerprint: string;
  readonly expectedTokenVersion: number;
  readonly nextTokenVersion: number;
  readonly expectedCredentialVersion: number;
  readonly nextCredentialVersion: number;
  readonly updatedAt: string;
}

export interface PasswordCredential {
  readonly userId: string;
  readonly passwordHash: string;
  readonly credentialVersion: number;
  readonly securityOperationId: string | null;
  readonly status: string;
  readonly updatedAt: Date;
}

export interface PasswordChangeResult {
  readonly userId: string;
  readonly replayed: boolean;
}

export function parsePasswordChangeRequest(value: unknown): PasswordChangeRequest {
  return passwordChangeSchema.parse(value);
}

export function passwordChangeScope(userId: string): string {
  return `user:${userId}:IDN-07`;
}

export function passwordCommandFingerprint(
  key: string,
  userId: string,
  request: PasswordChangeRequest,
): string {
  return createHmac("sha256", key)
    .update("POST\n/api/v1/me/password\n", "utf8")
    .update(userId, "utf8")
    .update("\0", "utf8")
    .update(request.currentPassword, "utf8")
    .update("\0", "utf8")
    .update(request.newPassword, "utf8")
    .digest("hex");
}

export function serializePasswordMetadata(metadata: PasswordChangeMetadata): string {
  return JSON.stringify(metadata);
}

export function parsePasswordMetadata(value: string): PasswordChangeMetadata | undefined {
  try {
    return metadataSchema.parse(JSON.parse(value));
  } catch {
    return undefined;
  }
}

export function passwordRecordFingerprint(value: string): string {
  return parsePasswordMetadata(value)?.requestFingerprint ?? value;
}
