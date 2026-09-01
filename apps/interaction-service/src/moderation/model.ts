import { z } from "zod";
import { body as normalize } from "../model.js";

export const createReportSchema = z
  .object({ targetType: z.enum(["COMMENT", "REVIEW"]), targetId: z.string().uuid(), reason: z.string() })
  .strict();
export const moderateSchema = z
  .object({ action: z.enum(["HIDE", "RESTORE", "DISMISS", "WARN"]), reason: z.string() })
  .strict();
export const reason = (value: string) => {
  const normalized = normalize(value.trim());
  if (Array.from(normalized).length > 1000) throw new Error("INVALID_REPORT_REASON");
  return normalized;
};
export type TargetType = "COMMENT" | "REVIEW";
export type ModerationAction = "HIDE" | "RESTORE" | "DISMISS" | "WARN";
export interface Report {
  reportId: string;
  reporterId: string;
  targetType: TargetType;
  targetId: string;
  reason: string;
  state: "OPEN" | "RESOLVED";
  decision: ModerationAction | null;
  moderatorId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  pendingOperationId?: string;
}
export const reportDto = (r: Report) => ({
  reportId: r.reportId,
  targetType: r.targetType,
  targetId: r.targetId,
  state: r.state,
  decision: r.decision,
  version: r.version,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
