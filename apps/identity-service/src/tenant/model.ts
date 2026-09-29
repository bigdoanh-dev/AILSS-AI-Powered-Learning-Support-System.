export type OrganizationRole =
  "INSTITUTION_ADMIN" | "FACULTY_DEAN" | "DEPARTMENT_HEAD" | "LECTURER" | "STUDENT";

export type TenantTier = "PLATFORM" | "ORGANIZATION" | "FACULTY" | "DEPARTMENT";
export type OrganizationStatus = "ACTIVE" | "SUSPENDED" | "ARCHIVED";
export type MembershipStatus = "ACTIVE" | "SUSPENDED" | "REVOKED";

export interface OrganizationSettings {
  readonly faculties?: readonly string[];
  readonly departments?: readonly string[];
  readonly maxSeats?: number;
  readonly ipAllowlist?: readonly string[];
}

export interface Organization {
  readonly organizationId: string;
  readonly slug: string;
  readonly name: string;
  readonly domain: string;
  readonly tier?: TenantTier;
  readonly parentTenantId?: string;
  readonly ancestorIds?: readonly string[];
  readonly status: OrganizationStatus;
  readonly createdAt: string;
  readonly settings: OrganizationSettings;
}

export interface OrganizationMembership {
  readonly userId: string;
  readonly organizationId: string;
  readonly role: OrganizationRole;
  readonly department?: string;
  readonly status: MembershipStatus;
  readonly joinedAt: string;
}

export interface InstitutionalSsoConfig {
  readonly organizationId: string;
  readonly providerType: "OIDC" | "SAML";
  readonly issuerUrl: string;
  readonly clientId: string;
  readonly encryptedSecret?: string;
  readonly secretReference?: string;
  readonly allowedDomains: readonly string[];
  readonly createdAt: string;
  readonly keyId?: string;
  readonly previousKeyId?: string;
  readonly rotatedAt?: string;
}

export interface TenantContext {
  readonly organizationId: string;
  readonly userId: string;
  readonly role: OrganizationRole;
  readonly effectiveRole?: OrganizationRole;
  readonly lineage?: readonly string[];
}
