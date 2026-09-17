import { z } from "zod";

export const ONBOARDING_STAGES = [
  "CREATED",
  "IDENTITY_CONFIGURED",
  "INTEGRATIONS_CONFIGURED",
  "ADMIN_VERIFIED",
  "PILOT",
  "ACTIVE",
  "SUSPENDED",
] as const;

export type OnboardingStage = (typeof ONBOARDING_STAGES)[number];

export const tenantOnboardingRecordSchema = z.object({
  tenantId: z.string().min(1),
  institutionName: z.string().min(1).max(256),
  rootDomain: z.string().min(3).max(256),
  stage: z.enum(ONBOARDING_STAGES).default("CREATED"),
  primaryAdminEmail: z.string().email(),
  ssoConfigured: z.boolean().default(false),
  ltiConfigured: z.boolean().default(false),
  brandingConfigured: z.boolean().default(false),
  pilotUserCount: z.number().int().min(0).default(0),
  healthCheckPassed: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type TenantOnboardingRecord = z.infer<typeof tenantOnboardingRecordSchema>;

/**
 * Validates stage progression preconditions for institution onboarding.
 */
export function assertOnboardingTransition(
  record: TenantOnboardingRecord,
  nextStage: OnboardingStage,
): void {
  const stageOrder: Record<OnboardingStage, number> = {
    CREATED: 0,
    IDENTITY_CONFIGURED: 1,
    INTEGRATIONS_CONFIGURED: 2,
    ADMIN_VERIFIED: 3,
    PILOT: 4,
    ACTIVE: 5,
    SUSPENDED: 6,
  };

  if (nextStage === "SUSPENDED") {
    // Can be suspended from any state
    return;
  }

  if (stageOrder[nextStage] > stageOrder[record.stage] + 1) {
    throw new Error(
      `INVALID_STAGE_TRANSITION: Cannot transition directly from ${record.stage} to ${nextStage}. Must progress sequentially.`,
    );
  }

  // Preconditions for PILOT
  if (nextStage === "PILOT") {
    if (!record.ssoConfigured) {
      throw new Error("PRECONDITION_FAILED: SSO must be configured before entering PILOT stage");
    }
    if (record.pilotUserCount < 1) {
      throw new Error("PRECONDITION_FAILED: At least one pilot user required for PILOT stage");
    }
  }

  // Preconditions for ACTIVE
  if (nextStage === "ACTIVE") {
    if (!record.healthCheckPassed) {
      throw new Error("PRECONDITION_FAILED: Institutional health check must pass before activating tenant");
    }
  }
}
