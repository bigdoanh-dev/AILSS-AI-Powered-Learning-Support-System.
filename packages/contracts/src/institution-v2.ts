import { z } from "zod";

// ============================================================================
// 39.A22: Institution Onboarding Wizard
// ============================================================================
export const OnboardingWizardStepEnum = z.enum([
  "PROFILE",
  "DOMAINS",
  "ORGANIZATION_HIERARCHY",
  "IDENTITY_PROVIDER",
  "SCIM_PROVISIONING",
  "ONEROSTER_SYNC",
  "LTI_DEPLOYMENT",
  "EMAIL_SERVICES",
  "AI_POLICY",
  "FEATURE_FLAGS",
  "BRANDING",
  "DATA_RETENTION",
]);
export type OnboardingWizardStep = z.infer<typeof OnboardingWizardStepEnum>;

export const OnboardingLifecycleStateEnum = z.enum([
  "DRAFT",
  "VALIDATING",
  "VALIDATED",
  "ACTIVATED",
  "SUSPENDED",
]);
export type OnboardingLifecycleState = z.infer<typeof OnboardingLifecycleStateEnum>;

export interface InstitutionOnboardingPayload {
  tenantId: string;
  name: string;
  code: string;
  primaryDomain: string;
  allowedDomains: string[];
  contactEmail: string;
  timezone: string;
  identityConfig: {
    protocol: "OIDC" | "SAML";
    discoveryUrl?: string | undefined;
    clientId?: string | undefined;
  };
  scimEnabled: boolean;
  oneRosterEnabled: boolean;
  ltiEnabled: boolean;
  aiPolicy: {
    enabled: boolean;
    provider: "INTERNAL_GATEWAY" | "EXTERNAL_RESTRICTED";
    allowedPedagogicalModes: string[];
    allowStudentDirectChat: boolean;
    requireTeacherReviewForAiQuestions: boolean;
  };
  featureFlags: Record<string, boolean>;
}

// ============================================================================
// 39.A23: Connection Test Center
// ============================================================================
export const TestableIntegrationTypeEnum = z.enum([
  "OIDC",
  "SAML",
  "SCIM",
  "ONEROSTER",
  "LTI",
  "EMAIL",
  "AI_PROVIDER",
]);
export type TestableIntegrationType = z.infer<typeof TestableIntegrationTypeEnum>;

export const ConnectionStatusEnum = z.enum([
  "CONNECTED",
  "DEGRADED",
  "FAILED",
  "NOT_CONFIGURED",
]);
export type ConnectionStatus = z.infer<typeof ConnectionStatusEnum>;

export interface IntegrationConnectionTestResult {
  integration: TestableIntegrationType;
  status: ConnectionStatus;
  latencyMs?: number | undefined;
  lastTestedAt: string;
  details: string; // Sanitized status message (NO raw credentials or tokens!)
}

// ============================================================================
// 39.A24: Institution Configuration Versioning
// ============================================================================
export interface InstitutionConfigVersion {
  configVersion: number;
  tenantId: string;
  configSnapshot: Record<string, unknown>;
  changedBy: string;
  changedAt: string;
  changeReason: string;
  previousVersion?: number | undefined;
  isCurrent: boolean;
}

// ============================================================================
// 39.A26 & 39.A27: Organization Hierarchy V2 & Delegated Admin
// ============================================================================
export const OrgNodeTypeEnum = z.enum([
  "INSTITUTION",
  "CAMPUS",
  "FACULTY",
  "DEPARTMENT",
  "PROGRAM",
  "COHORT",
  "CLASS",
]);
export type OrgNodeType = z.infer<typeof OrgNodeTypeEnum>;

export interface OrgHierarchyNode {
  nodeId: string;
  tenantId: string;
  type: OrgNodeType;
  name: string;
  code: string;
  parentId?: string | undefined;
  ancestorNodeIds: string[]; // hierarchical path for fast subtree checks
}

export const DelegatedRoleEnum = z.enum([
  "INSTITUTION_ADMIN",
  "FACULTY_ADMIN",
  "DEPARTMENT_ADMIN",
  "PROGRAM_MANAGER",
  "INSTRUCTOR",
]);
export type DelegatedRole = z.infer<typeof DelegatedRoleEnum>;

export interface DelegatedAdminAssignment {
  assignmentId: string;
  userId: string;
  tenantId: string;
  scopeNodeId: string; // subtree root
  role: DelegatedRole;
  grantedAt: string;
  grantedBy: string;
}

// ============================================================================
// 39.A28: Tenant Health Dashboard
// ============================================================================
export interface TenantHealthOverview {
  tenantId: string;
  activeUsers24h: number;
  ssoHealth: ConnectionStatus;
  scimSyncHealth: ConnectionStatus;
  oneRosterSyncHealth: ConnectionStatus;
  ltiHealth: ConnectionStatus;
  aiUsageToday: {
    totalRequests: number;
    tokensConsumed: number;
    safetyBlockedCount: number;
  };
  openInterventionsCount: number;
  overallStatus: "HEALTHY" | "DEGRADED" | "ACTION_REQUIRED";
}
