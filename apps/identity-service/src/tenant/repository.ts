import type { InstitutionalSsoConfig, Organization, OrganizationMembership } from "./model.js";

export interface TenantRepository {
  saveOrganization(org: Organization): Promise<void>;
  findOrganizationById(id: string): Promise<Organization | null>;
  findOrganizationBySlug(slug: string): Promise<Organization | null>;
  findOrganizationByDomain(domain: string): Promise<Organization | null>;
  saveMembership(membership: OrganizationMembership): Promise<void>;
  findMembership(userId: string, orgId: string): Promise<OrganizationMembership | null>;
  listMembershipsByUser(userId: string): Promise<readonly OrganizationMembership[]>;
  listMembersByOrg(orgId: string, role?: string): Promise<readonly OrganizationMembership[]>;
  saveSsoConfig(config: InstitutionalSsoConfig): Promise<void>;
  findSsoConfig(orgId: string): Promise<InstitutionalSsoConfig | null>;
}

export class InMemoryTenantRepository implements TenantRepository {
  readonly #orgs = new Map<string, Organization>();
  readonly #orgsBySlug = new Map<string, Organization>();
  readonly #orgsByDomain = new Map<string, Organization>();
  readonly #memberships = new Map<string, OrganizationMembership>(); // key: `${userId}:${orgId}`
  readonly #ssoConfigs = new Map<string, InstitutionalSsoConfig>();

  public saveOrganization(org: Organization): Promise<void> {
    this.#orgs.set(org.organizationId, org);
    this.#orgsBySlug.set(org.slug.toLowerCase(), org);
    this.#orgsByDomain.set(org.domain.toLowerCase(), org);
    return Promise.resolve();
  }

  public findOrganizationById(id: string): Promise<Organization | null> {
    return Promise.resolve(this.#orgs.get(id) ?? null);
  }

  public findOrganizationBySlug(slug: string): Promise<Organization | null> {
    return Promise.resolve(this.#orgsBySlug.get(slug.toLowerCase()) ?? null);
  }

  public findOrganizationByDomain(domain: string): Promise<Organization | null> {
    return Promise.resolve(this.#orgsByDomain.get(domain.toLowerCase()) ?? null);
  }

  public saveMembership(membership: OrganizationMembership): Promise<void> {
    const key = `${membership.userId}:${membership.organizationId}`;
    this.#memberships.set(key, membership);
    return Promise.resolve();
  }

  public findMembership(userId: string, orgId: string): Promise<OrganizationMembership | null> {
    return Promise.resolve(this.#memberships.get(`${userId}:${orgId}`) ?? null);
  }

  public listMembershipsByUser(userId: string): Promise<readonly OrganizationMembership[]> {
    const results: OrganizationMembership[] = [];
    for (const m of this.#memberships.values()) {
      if (m.userId === userId) {
        results.push(m);
      }
    }
    return Promise.resolve(results);
  }

  public listMembersByOrg(orgId: string, role?: string): Promise<readonly OrganizationMembership[]> {
    const results: OrganizationMembership[] = [];
    for (const m of this.#memberships.values()) {
      if (m.organizationId === orgId && (!role || m.role === role)) {
        results.push(m);
      }
    }
    return Promise.resolve(results);
  }

  public saveSsoConfig(config: InstitutionalSsoConfig): Promise<void> {
    this.#ssoConfigs.set(config.organizationId, config);
    return Promise.resolve();
  }

  public findSsoConfig(orgId: string): Promise<InstitutionalSsoConfig | null> {
    return Promise.resolve(this.#ssoConfigs.get(orgId) ?? null);
  }
}
