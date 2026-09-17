import { z } from "zod";

export const INTEGRATION_TYPES = [
  "LTI_1_3",
  "OIDC_SSO",
  "WEBHOOK",
  "ONEROSTER_SIS",
  "SCORM_CLOUD",
] as const;

export type IntegrationType = (typeof INTEGRATION_TYPES)[number];

export const INTEGRATION_STATUSES = [
  "ACTIVE",
  "INACTIVE",
  "PENDING_VERIFICATION",
  "DEPRECATED",
] as const;

export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export const INTEGRATION_SCOPES = [
  "roster:read",
  "grades:write",
  "course:read",
  "analytics:export",
  "auth:sso",
] as const;

export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number];

export const integrationRegistrationSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().min(1),
  integrationType: z.enum(INTEGRATION_TYPES),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  status: z.enum(INTEGRATION_STATUSES).default("PENDING_VERIFICATION"),
  scopes: z.array(z.enum(INTEGRATION_SCOPES)).min(1),
  endpointUrl: z.string().url().optional(),
  clientId: z.string().min(1).max(256).optional(),
  keyId: z.string().min(1).max(256).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type IntegrationRegistration = z.infer<typeof integrationRegistrationSchema>;

/**
 * Validates that an integration has the required authorization scope and is currently ACTIVE.
 */
export function assertIntegrationScope(
  integration: IntegrationRegistration,
  requiredScope: IntegrationScope,
): void {
  if (integration.status !== "ACTIVE") {
    throw new Error(
      `Integration "${integration.name}" (${integration.id}) is not active (current status: ${integration.status})`,
    );
  }

  if (!integration.scopes.includes(requiredScope)) {
    throw new Error(
      `Integration "${integration.name}" lacks required scope "${requiredScope}"`,
    );
  }
}
