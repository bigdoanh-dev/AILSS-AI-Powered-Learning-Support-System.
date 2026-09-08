import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "../../../../packages/http/src/index.js";

const bounded = (min: number, max: number) =>
  z
    .string()
    .transform((v) => v.normalize("NFC").trim())
    .refine(
      (v) => Array.from(v).length >= min && Array.from(v).length <= max,
      `Must contain ${String(min)}–${String(max)} Unicode code points`,
    );
export const applicationBodySchema = z
  .object({
    professionalTitle: bounded(1, 120),
    institution: bounded(1, 160),
    teachingArea: bounded(1, 160),
    motivation: bounded(20, 2000),
  })
  .strict();
export const decisionSchema = z.object({ decision: z.enum(["APPROVE", "REJECT"]) }).strict();
export const publicDecisionSchema = decisionSchema
  .extend({ currentPassword: z.string().min(1).max(128) })
  .strict();
export const listSchema = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    shard: z.coerce.number().int().min(0).max(15),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(16).max(16384).optional(),
  })
  .strict();
export type ApplicationBody = z.infer<typeof applicationBodySchema>;
export type Decision = "APPROVE" | "REJECT";
export interface Application extends ApplicationBody {
  applicantId: string;
  applicationId: string;
  displayNameSnapshot: string;
  emailMaskedSnapshot: string;
  status: "SUBMITTED" | "APPROVED" | "REJECTED";
  submittedAt: string;
  decidedAt: string | null;
  reviewerId: string | null;
  decision: Decision | null;
  version: number;
  submissionOperationId: string;
  reviewOperationId: string | null;
}
export interface Command {
  operationId: string;
  applicationId: string;
  applicantId: string;
  actorId: string;
  correlationId: string;
  requestId: string;
  scope: string;
  key: string;
  fingerprint: string;
  createdAt: string;
  kind: "SUBMIT" | Decision;
  application: Application;
  expectedUser?: {
    tokenVersion: number;
    credentialVersion: number;
    securityOperationId: string | null;
    updatedAt: string;
    profileVersion: number;
  };
  result?: { applicationId: string; status: Application["status"]; submittedAt?: string; decidedAt?: string };
  error?: "APPLICATION_EXISTS" | "APPLICATION_DECISION_CONFLICT" | "APPLICATION_TARGET_INELIGIBLE";
}
export const shardOf = (id: string) => (createHash("sha256").update(id).digest()[0] ?? 0) % 16;
export const fingerprint = (body: unknown) => createHash("sha256").update(JSON.stringify(body)).digest("hex");
export const unavailable = () =>
  new AppError(
    "APPLICATION_UNAVAILABLE",
    503,
    "Application operation is recovering; retry with the same key",
    true,
  );
export const conflict = (code: string) =>
  new AppError(code, 409, "Application command conflicts with existing state");
export function publicApplication(a: Application, verified: boolean) {
  return {
    applicationId: a.applicationId,
    professionalTitle: a.professionalTitle,
    institution: a.institution,
    teachingArea: a.teachingArea,
    motivation: a.motivation,
    displayNameSnapshot: a.displayNameSnapshot,
    emailMaskedSnapshot: a.emailMaskedSnapshot,
    status: a.status,
    submittedAt: a.submittedAt,
    decidedAt: a.decidedAt,
    result:
      a.status === "SUBMITTED"
        ? "PENDING"
        : a.status === "REJECTED"
          ? "REJECTED"
          : verified
            ? "APPROVED_VERIFIED"
            : "APPROVED_AWAITING_VERIFICATION",
  };
}
