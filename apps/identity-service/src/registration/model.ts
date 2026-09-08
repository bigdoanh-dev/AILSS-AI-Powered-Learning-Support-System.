import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { canonicalEmailSchema, displayNameSchema } from "../shared/identity-input.js";

export const IDENTITY_REGISTRATION_QUERY_IDS = ["Q-IDN-001", "Q-IDN-002", "Q-IDN-005", "Q-IDN-007"] as const;
export const REGISTRATION_SCOPE = "anonymous:IDN-01";

const registrationRequestSchema = z
  .object({
    email: canonicalEmailSchema,
    password: z.string().min(12).max(128),
    displayName: displayNameSchema,
    role: z.enum(["STUDENT", "LECTURER"]).optional(),
  })
  .strict();

export interface RegistrationRequest {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly role?: "STUDENT" | "LECTURER" | undefined;
}

export interface RegistrationCommand extends RegistrationRequest {
  readonly idempotencyKey: string;
  readonly requestId: string;
  readonly correlationId: string;
}

export interface RegisteredAccount {
  readonly userId: string;
  readonly displayName: string;
  readonly role: "STUDENT" | "LECTURER";
  readonly status: "ACTIVE";
  readonly lecturerVerified: false;
  readonly profileVersion: number;
  readonly createdAt: string;
}

export interface RegistrationResult {
  readonly account: RegisteredAccount;
  readonly replayed: boolean;
  readonly eventId: string;
}

export function parseRegistrationRequest(value: unknown): RegistrationRequest {
  return registrationRequestSchema.parse(value);
}

export function validateIdempotencyKey(value: string | undefined): string {
  if (!value) throw new Error("IDEMPOTENCY_KEY_REQUIRED");
  if (value.length > 200 || !/^[\x21-\x7e]+$/u.test(value)) throw new Error("IDEMPOTENCY_KEY_INVALID");
  return value;
}

export function registrationFingerprint(request: RegistrationRequest): string {
  const passwordContribution = createHash("sha256").update(request.password, "utf8").digest("hex");
  return createHash("sha256")
    .update(
      JSON.stringify({
        api: "IDN-01",
        email: request.email,
        displayName: request.displayName,
        role: request.role ?? "STUDENT",
        passwordContribution,
      }),
      "utf8",
    )
    .digest("hex");
}

export function idempotencyKeyHash(value: string): number {
  const byte = createHash("sha256").update(value, "utf8").digest()[0] ?? 0;
  return byte > 127 ? byte - 256 : byte;
}

export function maskEmail(normalizedEmail: string): string {
  const separator = normalizedEmail.lastIndexOf("@");
  const local = normalizedEmail.slice(0, separator);
  const domain = normalizedEmail.slice(separator + 1);
  return `${local.slice(0, 1)}***@${domain}`;
}

export function derivedEventId(operationId: string, purpose: string): string {
  const bytes = createHash("sha256").update(`${purpose}:${operationId}`, "utf8").digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function newRegistrationIds(): { operationId: string; userId: string } {
  return { operationId: randomUUID(), userId: randomUUID() };
}
