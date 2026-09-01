import { z } from "zod";

const requestSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    action: z.enum(["COURSE_PUBLISH", "COURSE_ARCHIVE", "INTERACTION_REPORT_MODERATE"]),
    resourceType: z.enum(["COURSE", "REPORT"]),
    resourceId: z.string().uuid(),
  })
  .strict();
export type AdminStepUpRequest = z.infer<typeof requestSchema>;
export const parseAdminStepUpRequest = (value: unknown): AdminStepUpRequest => requestSchema.parse(value);
