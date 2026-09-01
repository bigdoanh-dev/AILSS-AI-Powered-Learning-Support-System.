import { z } from "zod";
import type { CanonicalLoginUser, LoginSession } from "../login/model.js";

export const IDENTITY_REFRESH_QUERY_IDS = ["Q-IDN-001", "Q-IDN-003"] as const;

const refreshRequestSchema = z
  .object({
    sessionId: z.string().uuid(),
    refreshToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/u, "Expected a 256-bit base64url refresh token"),
  })
  .strict();

export interface RefreshRequest {
  readonly sessionId: string;
  readonly refreshToken: string;
}

export interface RefreshCommand extends RefreshRequest {
  readonly requestId: string;
  readonly correlationId: string;
}

export interface RefreshResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly accessExpiresAt: Date;
  readonly session: LoginSession;
  readonly user: CanonicalLoginUser;
}

export function parseRefreshRequest(value: unknown): RefreshRequest {
  return refreshRequestSchema.parse(value);
}
