import type { ActorContext } from "../../../../packages/security/src/index.js";

export const IDENTITY_LOGOUT_QUERY_IDS = ["Q-IDN-003"] as const;

export interface LogoutCommand extends ActorContext {
  readonly requestId: string;
}

export interface LogoutResult {
  readonly outcome: "revoked" | "idempotent" | "expired";
}
