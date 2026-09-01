import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canonicalEmailSchema } from "../shared/identity-input.js";

export const IDENTITY_LOGIN_QUERY_IDS = ["Q-IDN-001", "Q-IDN-002", "Q-IDN-003"] as const;
export const SESSION_INITIAL_STATE = "ACTIVE" as const;
export const SESSION_REVOKED_STATE = "REVOKED" as const;

const loginRequestSchema = z
  .object({
    email: canonicalEmailSchema,
    password: z.string().min(1).max(128),
  })
  .strict();

export interface LoginRequest {
  readonly email: string;
  readonly password: string;
}

export interface LoginCommand extends LoginRequest {
  readonly requestId: string;
  readonly correlationId: string;
}

export interface LoginCredential {
  readonly userId: string;
  readonly passwordHash: string;
  readonly credentialVersion: number;
  readonly securityOperationId: string | null;
  readonly status: string;
}

export interface CanonicalLoginUser {
  readonly userId: string;
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

export interface LoginSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly tokenFamilyId: string;
  readonly refreshFingerprint: string;
  readonly generation: number;
  readonly state: string;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly version: number;
  readonly authVersion: number | null;
  readonly createdAt: Date;
}

export interface LoginResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessExpiresAt: Date;
  readonly refreshExpiresAt: Date;
  readonly session: LoginSession;
  readonly user: CanonicalLoginUser;
}

export function parseLoginRequest(value: unknown): LoginRequest {
  return loginRequestSchema.parse(value);
}

export function newLoginIdentifiers(): { sessionId: string; tokenFamilyId: string } {
  return { sessionId: randomUUID(), tokenFamilyId: randomUUID() };
}
