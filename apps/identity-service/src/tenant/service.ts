import { randomUUID } from "node:crypto";
import { AppError } from "../../../../packages/http/src/index.js";
import type {
  InstitutionalSsoConfig,
  Organization,
  OrganizationMembership,
  OrganizationRole,
  TenantContext,
  TenantTier,
} from "./model.js";
import type { TenantRepository } from "./repository.js";

const ROLE_HIERARCHY: Record<OrganizationRole, number> = {
  INSTITUTION_ADMIN: 100,
  FACULTY_DEAN: 80,
  DEPARTMENT_HEAD: 60,
  LECTURER: 40,
  STUDENT: 20,
};

export class TenantService {
  readonly #repo: TenantRepository;
  readonly #now: () => Date;

  public constructor(repo: TenantRepository, now: () => Date = () => new Date()) {
    this.#repo = repo;
    this.#now = now;
  }

  public async createOrganization(input: {
    readonly name: string;
    readonly slug: string;
    readonly domain: string;
    readonly tier?: TenantTier;
    readonly parentTenantId?: string;
    readonly faculties?: readonly string[];
    readonly departments?: readonly string[];
    readonly maxSeats?: number;
  }): Promise<Organization> {
    const existing = await this.#repo.findOrganizationBySlug(input.slug);
    if (existing) {
      throw new AppError("ORGANIZATION_SLUG_EXISTS", 409, `Organization with slug ${input.slug} already exists`);
    }

    const existingDomain = await this.#repo.findOrganizationByDomain(input.domain.trim().toLowerCase());
    if (existingDomain && existingDomain.organizationId !== input.parentTenantId) {
      throw new AppError(
        "ORGANIZATION_DOMAIN_COLLISION",
        409,
        `Organization domain ${input.domain} is already registered to another institution`,
      );
    }

    let ancestorIds: string[] = [];
    if (input.parentTenantId) {
      const parent = await this.getOrganization(input.parentTenantId);
      ancestorIds = [...(parent.ancestorIds ?? []), parent.organizationId];
    }

    const org: Organization = {
      organizationId: randomUUID(),
      name: input.name.trim(),
      slug: input.slug.trim().toLowerCase(),
      domain: input.domain.trim().toLowerCase(),
      ...(input.tier !== undefined ? { tier: input.tier } : {}),
      ...(input.parentTenantId !== undefined ? { parentTenantId: input.parentTenantId } : {}),
      ancestorIds,
      status: "ACTIVE",
      createdAt: this.#now().toISOString(),
      settings: {
        faculties: input.faculties ?? [],
        departments: input.departments ?? [],
        maxSeats: input.maxSeats ?? 1000,
      },
    };

    await this.#repo.saveOrganization(org);
    return org;
  }

  public async getOrganization(organizationId: string): Promise<Organization> {
    const org = await this.#repo.findOrganizationById(organizationId);
    if (!org) {
      throw new AppError("ORGANIZATION_NOT_FOUND", 404, `Organization ${organizationId} not found`);
    }
    return org;
  }

  public async updateOrganizationStatus(
    organizationId: string,
    status: "ACTIVE" | "SUSPENDED" | "ARCHIVED",
  ): Promise<Organization> {
    const org = await this.getOrganization(organizationId);
    const updated: Organization = {
      ...org,
      status,
    };
    await this.#repo.saveOrganization(updated);
    return updated;
  }

  public async addMembership(input: {
    readonly userId: string;
    readonly organizationId: string;
    readonly role: OrganizationRole;
    readonly department?: string;
  }): Promise<OrganizationMembership> {
    await this.getOrganization(input.organizationId);

    const membership: OrganizationMembership = {
      userId: input.userId,
      organizationId: input.organizationId,
      role: input.role,
      ...(input.department !== undefined ? { department: input.department } : {}),
      status: "ACTIVE",
      joinedAt: this.#now().toISOString(),
    };

    await this.#repo.saveMembership(membership);
    return membership;
  }

  public async updateMembershipStatus(
    userId: string,
    organizationId: string,
    status: "ACTIVE" | "SUSPENDED" | "REVOKED",
  ): Promise<OrganizationMembership> {
    const existing = await this.#repo.findMembership(userId, organizationId);
    if (!existing) {
      throw new AppError(
        "MEMBERSHIP_NOT_FOUND",
        404,
        `Membership for user ${userId} in tenant ${organizationId} not found`,
      );
    }
    const updated: OrganizationMembership = {
      ...existing,
      status,
    };
    await this.#repo.saveMembership(updated);
    return updated;
  }

  public async listUserTenants(userId: string): Promise<readonly OrganizationMembership[]> {
    const memberships = await this.#repo.listMembershipsByUser(userId);
    return memberships.filter((m) => m.status === "ACTIVE");
  }

  public async verifyTenantAccess(
    userId: string,
    organizationId: string,
    requiredRole?: OrganizationRole,
  ): Promise<TenantContext> {
    const targetOrg = await this.getOrganization(organizationId);
    if (targetOrg.status === "ARCHIVED") {
      throw new AppError("TENANT_ARCHIVED", 403, `[TENANT_ARCHIVED] Tenant ${organizationId} is archived`);
    }
    if (targetOrg.status === "SUSPENDED") {
      throw new AppError("TENANT_SUSPENDED", 403, `[TENANT_SUSPENDED] Tenant ${organizationId} is suspended`);
    }

    // 1. Direct active membership check on target tenant
    const directMembership = await this.#repo.findMembership(userId, organizationId);
    if (directMembership) {
      if (directMembership.status === "SUSPENDED" || directMembership.status === "REVOKED") {
        throw new AppError(
          "TENANT_ACCESS_DENIED",
          403,
          `[TENANT_ACCESS_DENIED] Membership for user ${userId} in tenant ${organizationId} is ${directMembership.status}`,
        );
      }
      if (requiredRole) {
        const userLevel = ROLE_HIERARCHY[directMembership.role];
        const requiredLevel = ROLE_HIERARCHY[requiredRole];
        if (userLevel < requiredLevel) {
          throw new AppError(
            "TENANT_INSUFFICIENT_ROLE",
            403,
            `[TENANT_INSUFFICIENT_ROLE] User role ${directMembership.role} does not satisfy required role ${requiredRole}`,
          );
        }
      }
      return {
        organizationId,
        userId,
        role: directMembership.role,
        effectiveRole: directMembership.role,
        lineage: targetOrg.ancestorIds ?? [],
      };
    }

    // 2. Ancestor hierarchy check across the entire lineage
    const ancestors = targetOrg.ancestorIds ?? [];
    if (ancestors.length > 0) {
      for (const ancestorId of ancestors) {
        const ancestorMembership = await this.#repo.findMembership(userId, ancestorId);
        if (ancestorMembership && ancestorMembership.status === "ACTIVE") {
          // Rule: INSTITUTION_ADMIN can govern any child (FACULTY, DEPARTMENT).
          // Rule: FACULTY_DEAN can govern any child DEPARTMENT under their FACULTY.
          // Rule: DEPARTMENT_HEAD, LECTURER, STUDENT do not inherit downward across units.
          const canGovern =
            ancestorMembership.role === "INSTITUTION_ADMIN" ||
            (ancestorMembership.role === "FACULTY_DEAN" &&
              (targetOrg.tier === "DEPARTMENT" || !targetOrg.tier));

          if (canGovern) {
            if (requiredRole) {
              const userLevel = ROLE_HIERARCHY[ancestorMembership.role];
              const requiredLevel = ROLE_HIERARCHY[requiredRole];
              if (userLevel < requiredLevel) {
                throw new AppError(
                  "TENANT_INSUFFICIENT_ROLE",
                  403,
                  `[TENANT_INSUFFICIENT_ROLE] Inherited role ${ancestorMembership.role} does not satisfy required role ${requiredRole}`,
                );
              }
            }
            return {
              organizationId,
              userId,
              role: ancestorMembership.role,
              effectiveRole: ancestorMembership.role,
              lineage: ancestors,
            };
          }
        }
      }
    }

    throw new AppError(
      "TENANT_ACCESS_DENIED",
      403,
      `[TENANT_ACCESS_DENIED] User ${userId} does not have authorized access to tenant ${organizationId}`,
    );
  }

  public async configureInstitutionalSso(input: {
    readonly organizationId: string;
    readonly providerType: "OIDC" | "SAML";
    readonly issuerUrl: string;
    readonly clientId: string;
    readonly secretReference?: string;
    readonly encryptedSecret?: string;
    readonly keyId?: string;
    readonly allowedDomains: readonly string[];
  }): Promise<InstitutionalSsoConfig> {
    await this.getOrganization(input.organizationId);

    if (input.providerType === "SAML") {
      throw new AppError(
        "SAML_CONFIGURATION_REQUIRES_FEDERATION_API",
        422,
        "Configure SAML through the federation configuration store; login uses the metadata, AuthnRequest, and ACS endpoints.",
      );
    }

    const config: InstitutionalSsoConfig = {
      organizationId: input.organizationId,
      providerType: input.providerType,
      issuerUrl: input.issuerUrl,
      clientId: input.clientId,
      ...(input.secretReference !== undefined ? { secretReference: input.secretReference } : {}),
      ...(input.encryptedSecret !== undefined ? { encryptedSecret: input.encryptedSecret } : {}),
      ...(input.keyId !== undefined ? { keyId: input.keyId } : {}),
      allowedDomains: input.allowedDomains.map((d) => d.toLowerCase()),
      createdAt: this.#now().toISOString(),
    };

    await this.#repo.saveSsoConfig(config);
    return config;
  }

  public async rotateSsoSecret(input: {
    readonly organizationId: string;
    readonly newSecretReference: string;
    readonly newKeyId: string;
  }): Promise<InstitutionalSsoConfig> {
    const existing = await this.#repo.findSsoConfig(input.organizationId);
    if (!existing) {
      throw new AppError("SSO_NOT_CONFIGURED", 404, `SSO not configured for ${input.organizationId}`);
    }

    const rotated: InstitutionalSsoConfig = {
      ...existing,
      ...(existing.keyId !== undefined ? { previousKeyId: existing.keyId } : {}),
      keyId: input.newKeyId,
      secretReference: input.newSecretReference,
      rotatedAt: this.#now().toISOString(),
    };

    await this.#repo.saveSsoConfig(rotated);
    return rotated;
  }

  public async processInstitutionalSsoCallback(
    organizationId: string,
    claims: {
      readonly email: string;
      readonly sub: string;
      readonly name?: string;
    },
  ): Promise<{
    readonly organizationId: string;
    readonly userId: string;
    readonly role: OrganizationRole;
    readonly email: string;
  }> {
    const ssoConfig = await this.#repo.findSsoConfig(organizationId);
    if (!ssoConfig) {
      throw new AppError("SSO_NOT_CONFIGURED", 400, `Institutional SSO not configured for ${organizationId}`);
    }

    if (ssoConfig.providerType === "SAML") {
      throw new AppError(
        "LEGACY_SAML_CALLBACK_REJECTED",
        400,
        "SAML assertions must be submitted to the signed ACS endpoint and cannot use the legacy pre-validated claims callback.",
      );
    }

    const emailDomain = claims.email.split("@")[1]?.toLowerCase() ?? "";
    const isDomainAllowed = ssoConfig.allowedDomains.some(
      (d) => d === emailDomain || emailDomain.endsWith(`.${d}`),
    );

    if (!isDomainAllowed) {
      throw new AppError(
        "SSO_DOMAIN_UNAUTHORIZED",
        403,
        `[SSO_DOMAIN_UNAUTHORIZED] Email domain ${emailDomain} is not authorized for institutional SSO in this organization`,
      );
    }

    // Deterministic userId derived from org and sub or synthetic UUID for linking
    const userId = randomUUID();
    let membership = await this.#repo.findMembership(userId, organizationId);
    if (!membership) {
      membership = await this.addMembership({
        userId,
        organizationId,
        role: "STUDENT",
        department: "General",
      });
    }

    return {
      organizationId,
      userId,
      role: membership.role,
      email: claims.email,
    };
  }
}
