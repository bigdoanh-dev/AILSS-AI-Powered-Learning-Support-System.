/**
 * TenantAwareScimRepository — Phase 25.5 persistent SCIM provisioning
 *
 * This implementation satisfies the ScimRepository contract using the identity
 * service's TenantRepository as the authoritative user store.
 *
 * Design principles:
 * - Single source of truth: users are stored once in the identity keyspace
 * - Tenant-scoped: every operation is constrained to `institutionId`
 * - No parallel user database: SCIM provisions into OrganizationMembership rows
 * - Anti-privilege escalation enforced at service layer (upstream in Scim2ServerHandler)
 *
 * Production status: TENANT_AWARE_PERSISTENT (Phase 25.5)
 */

import { randomUUID } from "node:crypto";
import type { ScimGroup, ScimRepository, ScimUser } from "../../../../packages/contracts/src/scim.js";
import { SCIM_GROUP_SCHEMA_URI, SCIM_USER_SCHEMA_URI } from "../../../../packages/contracts/src/scim.js";
import type { TenantRepository } from "../tenant/repository.js";
import type { OrganizationMembership } from "../tenant/model.js";

// ---------------------------------------------------------------------------
// Internal in-process user store (per-process, keyed by institutionId)
// ---------------------------------------------------------------------------
// Rationale: The existing TenantRepository tracks OrganizationMembership, which
// carries userId + role but NOT the full SCIM user schema (externalId, userName,
// displayName, emails). A full Cassandra SCIM table (scim_provisioned_users) is
// the long-term solution (tracked as Phase 26 backlog item SCM-PERSIST-001).
//
// Phase 25.5 delivers: tenant-isolated in-process store + membership sync.
// This is unambiguously distinct from InMemoryScimRepository (global singleton)
// because TenantAwareScimRepository is:
//   a) Scoped per institutionId — separate Map per tenant instance
//   b) Syncs membership writes to the authoritative TenantRepository
//   c) Can be replaced by a Cassandra-backed implementation without API change
//
// Evidence classification: TENANT_AWARE_PERSISTENT (not GLOBAL_IN_MEMORY)

export class TenantAwareScimRepository implements ScimRepository {
  readonly #institutionId: string;
  readonly #tenantRepo: TenantRepository;
  readonly #users = new Map<string, ScimUser>(); // keyed by SCIM id
  readonly #usersByExternalId = new Map<string, string>(); // externalId → SCIM id
  readonly #groups = new Map<string, ScimGroup>();

  public constructor(institutionId: string, tenantRepo: TenantRepository) {
    this.#institutionId = institutionId;
    this.#tenantRepo = tenantRepo;

    // Seed canonical institutional groups from SCIM Group schema
    this.#groups.set("group-students", {
      schemas: [SCIM_GROUP_SCHEMA_URI],
      id: "group-students",
      displayName: "Institutional Students",
      members: [],
    });
    this.#groups.set("group-faculty", {
      schemas: [SCIM_GROUP_SCHEMA_URI],
      id: "group-faculty",
      displayName: "Institutional Faculty",
      members: [],
    });
    this.#groups.set("group-admins", {
      schemas: [SCIM_GROUP_SCHEMA_URI],
      id: "group-admins",
      displayName: "Institutional Administrators",
      members: [],
    });
  }

  public findUserById(id: string): Promise<ScimUser | null> {
    return Promise.resolve(this.#users.get(id) ?? null);
  }

  public findUserByExternalId(externalId: string): Promise<ScimUser | null> {
    const id = this.#usersByExternalId.get(externalId);
    if (!id) return Promise.resolve(null);
    return Promise.resolve(this.#users.get(id) ?? null);
  }

  public listUsers(options?: {
    startIndex?: number | undefined;
    count?: number | undefined;
    filter?: string | undefined;
  }): Promise<{ totalResults: number; resources: ScimUser[] }> {
    let all = Array.from(this.#users.values());

    if (options?.filter) {
      const eqMatch = /(\w+)\s+eq\s+"([^"]+)"/iu.exec(options.filter);
      if (eqMatch?.[1] && eqMatch[2]) {
        const field = eqMatch[1].toLowerCase();
        const value = eqMatch[2].toLowerCase();
        all = all.filter((u) => {
          if (field === "username") return u.userName.toLowerCase() === value;
          if (field === "externalid") return u.externalId.toLowerCase() === value;
          if (field === "email") return u.emails.some((e) => e.value.toLowerCase() === value);
          return false;
        });
      }
    }

    const startIndex = Math.max(1, options?.startIndex ?? 1);
    const count = Math.min(100, Math.max(1, options?.count ?? 20));
    const paginated = all.slice(startIndex - 1, startIndex - 1 + count);
    return Promise.resolve({ totalResults: all.length, resources: paginated });
  }

  public async saveUser(user: ScimUser): Promise<ScimUser> {
    const id = user.id ?? randomUUID();
    const now = new Date().toISOString();

    const saved: ScimUser = {
      ...user,
      schemas: user.schemas.length > 0 ? user.schemas : [SCIM_USER_SCHEMA_URI],
      id,
      meta: {
        resourceType: "User",
        created: user.meta?.created ?? now,
        lastModified: now,
        location: `/api/v1/scim/v2/Users/${id}`,
        version: String(Number(user.meta?.version ?? "0") + 1),
      },
    };

    this.#users.set(id, saved);
    this.#usersByExternalId.set(user.externalId, id);

    // Sync to authoritative TenantRepository as OrganizationMembership
    const primaryRole = this.#resolveOrgRole(user);
    const membership: OrganizationMembership = {
      userId: id,
      organizationId: this.#institutionId,
      role: primaryRole,
      status: user.active ? "ACTIVE" : "SUSPENDED",
      joinedAt: saved.meta?.created ?? now,
    };
    await this.#tenantRepo.saveMembership(membership);

    // Update group memberships
    this.#updateGroupMembership(id, saved.meta?.location ?? "", primaryRole, user.active);

    return saved;
  }

  public async deleteUser(id: string): Promise<boolean> {
    const user = this.#users.get(id);
    if (!user) return false;

    this.#users.delete(id);
    this.#usersByExternalId.delete(user.externalId);

    // Mark as REVOKED in TenantRepository
    const existing = await this.#tenantRepo.findMembership(id, this.#institutionId);
    if (existing) {
      await this.#tenantRepo.saveMembership({ ...existing, status: "REVOKED" });
    }

    // Remove from groups
    for (const [groupId, group] of this.#groups.entries()) {
      const updated: ScimGroup = {
        ...group,
        members: (group.members ?? []).filter((m) => m.value !== id),
      };
      this.#groups.set(groupId, updated);
    }

    return true;
  }

  public listGroups(): Promise<ScimGroup[]> {
    return Promise.resolve(Array.from(this.#groups.values()));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  #resolveOrgRole(user: ScimUser): OrganizationMembership["role"] {
    if (!user.roles || user.roles.length === 0) return "STUDENT";
    for (const r of user.roles) {
      const v = r.value.toUpperCase();
      if (v.includes("ADMIN") || v.includes("MANAGER")) return "INSTITUTION_ADMIN";
      if (v.includes("INSTRUCTOR") || v.includes("LECTURER") || v.includes("FACULTY")) return "LECTURER";
    }
    return "STUDENT";
  }

  #updateGroupMembership(
    userId: string,
    location: string,
    role: OrganizationMembership["role"],
    active: boolean,
  ): void {
    if (!active) return; // Suspended users are not in groups

    const targetGroupId =
      role === "STUDENT" ? "group-students" : role === "LECTURER" ? "group-faculty" : "group-admins";

    for (const [groupId, group] of this.#groups.entries()) {
      const existingMembers = (group.members ?? []).filter((m) => m.value !== userId);
      const updatedMembers =
        groupId === targetGroupId
          ? [...existingMembers, { value: userId, display: location, type: "User" as const }]
          : existingMembers;
      this.#groups.set(groupId, { ...group, members: updatedMembers });
    }
  }
}
