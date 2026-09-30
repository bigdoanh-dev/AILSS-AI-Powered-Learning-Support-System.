import { z } from "zod";
import { canonicalEmailSchema } from "../shared/identity-input.js";

export const PASSWORD_RESET_TTL_SECONDS = 900;
export const PASSWORD_RESET_RESEND_SECONDS = 60;
export const PASSWORD_RESET_MAX_ATTEMPTS = 5;

export interface PasswordResetChallenge {
  readonly normalizedEmail: string;
  readonly userId: string;
  readonly otpHmac: string;
  readonly verifiedTokenHmac: string;
  readonly tokenVersion: number;
  readonly credentialVersion: number;
  readonly attempts: number;
  readonly issuedAt: Date;
  readonly sentAt: Date;
  readonly expiresAt: Date;
}

const requestCodeSchema = z.object({ email: canonicalEmailSchema }).strict();
const verifyCodeSchema = z
  .object({
    email: canonicalEmailSchema,
    code: z.string().regex(/^\d{6}$/u),
  })
  .strict();
const completeResetSchema = z
  .object({
    email: canonicalEmailSchema,
    resetToken: z.string().min(40).max(128),
    newPassword: z.string().min(12).max(128),
    confirmPassword: z.string().min(12).max(128),
  })
  .strict()
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

export interface PasswordResetRequestCode {
  readonly email: string;
}
export interface PasswordResetVerifyCode {
  readonly email: string;
  readonly code: string;
}
export interface PasswordResetComplete {
  readonly email: string;
  readonly resetToken: string;
  readonly newPassword: string;
  readonly confirmPassword: string;
}

export function parsePasswordResetRequestCode(value: unknown): PasswordResetRequestCode {
  return requestCodeSchema.parse(value);
}
export function parsePasswordResetVerifyCode(value: unknown): PasswordResetVerifyCode {
  return verifyCodeSchema.parse(value);
}
export function parsePasswordResetComplete(value: unknown): PasswordResetComplete {
  return completeResetSchema.parse(value);
}
