import { z } from "zod";
import { stepUpActionSchema, stepUpResourceTypeSchema } from "../../../../packages/security/src/index.js";

const requestSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    action: stepUpActionSchema,
    resourceType: stepUpResourceTypeSchema,
    resourceId: z.string().uuid(),
  })
  .strict()
  .refine(
    (value) =>
      value.resourceType ===
      (value.action.startsWith("LECTURER_APPLICATION_")
        ? "LECTURER_APPLICATION"
        : value.action === "INTERACTION_REPORT_MODERATE"
          ? "REPORT"
          : value.action === "ADMIN_USER_STATUS_CHANGE" || value.action === "ADMIN_LECTURER_VERIFY"
            ? "USER"
            : "COURSE"),
    "Action/resource mismatch",
  );
export type AdminStepUpRequest = z.infer<typeof requestSchema>;
export const parseAdminStepUpRequest = (value: unknown): AdminStepUpRequest => requestSchema.parse(value);
