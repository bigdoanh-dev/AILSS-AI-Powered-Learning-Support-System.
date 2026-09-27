/**
 * Phase 25.5: TenantAwareScimRepository — persistent SCIM provisioning tests
 *
 * Verifies:
 * 1. SCIM users provisioned via TenantAwareScimRepository are synced to the
 *    authoritative TenantRepository as OrganizationMembership records
 * 2. Role mapping: SCIM roles → Organization roles (STUDENT/LECTURER/INSTITUTION_ADMIN)
 * 3. Group membership assignment is role-accurate
 * 4. Deactivated users are REVOKED in TenantRepository
 * 5. Tenant isolation: separate instances do not share state
 */

import { describe, it, expect } from "vitest";
import { TenantAwareScimRepository } from "../../apps/identity-service/src/scim/repository.js";
import { InMemoryTenantRepository } from "../../apps/identity-service/src/tenant/repository.js";

const SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";

function makeScimUser(overrides: {
  externalId: string;
  userName: string;
  email: string;
  roles?: Array<{ value: string }>;
  active?: boolean;
}) {
  return {
    schemas: [SCIM_USER_SCHEMA],
    externalId: overrides.externalId,
    userName: overrides.userName,
    emails: [{ value: overrides.email, type: "work" as const, primary: true }],
    active: overrides.active ?? true,
    roles: overrides.roles,
  };
}

describe("Phase 25.5: TenantAwareScimRepository — persistent provisioning", () => {
  it("syncs provisioned SCIM user to TenantRepository as ACTIVE membership", async () => {
    const tenantRepo = new InMemoryTenantRepository();
    const scimRepo = new TenantAwareScimRepository("tenant-pilot-polytech", tenantRepo);

    const user = await scimRepo.saveUser(
      makeScimUser({ externalId: "ext-001", userName: "nguyen@polytech.edu.vn", email: "nguyen@polytech.edu.vn" }),
    );

    const userId = user.id ?? "";
    expect(userId).toBeTruthy();

    const membership = await tenantRepo.findMembership(userId, "tenant-pilot-polytech");
    expect(membership).not.toBeNull();
    expect(membership?.status).toBe("ACTIVE");
    expect(membership?.role).toBe("STUDENT"); // default role when no roles provided
    expect(membership?.organizationId).toBe("tenant-pilot-polytech");
  });

  it("maps SCIM lecturer role to LECTURER in TenantRepository", async () => {
    const tenantRepo = new InMemoryTenantRepository();
    const scimRepo = new TenantAwareScimRepository("tenant-pilot-polytech", tenantRepo);

    const user = await scimRepo.saveUser(
      makeScimUser({
        externalId: "ext-002",
        userName: "tran.giang@polytech.edu.vn",
        email: "tran.giang@polytech.edu.vn",
        roles: [{ value: "LECTURER" }],
      }),
    );

    const userId = user.id ?? "";
    const membership = await tenantRepo.findMembership(userId, "tenant-pilot-polytech");
    expect(membership?.role).toBe("LECTURER");

    // Faculty group should contain this user
    const groups = await scimRepo.listGroups();
    const facultyGroup = groups.find((g) => g.id === "group-faculty");
    expect(facultyGroup?.members?.some((m) => m.value === userId)).toBe(true);
  });

  it("maps SCIM admin role to INSTITUTION_ADMIN in TenantRepository", async () => {
    const tenantRepo = new InMemoryTenantRepository();
    const scimRepo = new TenantAwareScimRepository("tenant-pilot-polytech", tenantRepo);

    const user = await scimRepo.saveUser(
      makeScimUser({
        externalId: "ext-003",
        userName: "admin@polytech.edu.vn",
        email: "admin@polytech.edu.vn",
        roles: [{ value: "INSTITUTION_ADMIN" }],
      }),
    );

    const userId = user.id ?? "";
    const membership = await tenantRepo.findMembership(userId, "tenant-pilot-polytech");
    expect(membership?.role).toBe("INSTITUTION_ADMIN");
  });

  it("marks deleted SCIM user as REVOKED in TenantRepository", async () => {
    const tenantRepo = new InMemoryTenantRepository();
    const scimRepo = new TenantAwareScimRepository("tenant-pilot-polytech", tenantRepo);

    const user = await scimRepo.saveUser(
      makeScimUser({ externalId: "ext-004", userName: "deleted@polytech.edu.vn", email: "deleted@polytech.edu.vn" }),
    );

    const userId = user.id ?? "";
    expect(userId).toBeTruthy();
    const deleted = await scimRepo.deleteUser(userId);
    expect(deleted).toBe(true);

    // Membership should be REVOKED
    const membership = await tenantRepo.findMembership(userId, "tenant-pilot-polytech");
    expect(membership?.status).toBe("REVOKED");

    // User no longer in SCIM store
    const found = await scimRepo.findUserById(userId);
    expect(found).toBeNull();
  });

  it("tenant isolation: two TenantAwareScimRepository instances do not share users", async () => {
    const tenantRepoA = new InMemoryTenantRepository();
    const tenantRepoB = new InMemoryTenantRepository();
    const scimRepoA = new TenantAwareScimRepository("tenant-a", tenantRepoA);
    const scimRepoB = new TenantAwareScimRepository("tenant-b", tenantRepoB);

    await scimRepoA.saveUser(
      makeScimUser({ externalId: "shared-ext", userName: "user@a.edu", email: "user@a.edu" }),
    );

    // Tenant B should not see Tenant A's user
    const foundInB = await scimRepoB.findUserByExternalId("shared-ext");
    expect(foundInB).toBeNull();

    // Tenant A's TenantRepo should have the membership; Tenant B's should not
    const { resources: aUsers } = await scimRepoA.listUsers();
    expect(aUsers).toHaveLength(1);

    const { resources: bUsers } = await scimRepoB.listUsers();
    expect(bUsers).toHaveLength(0);
  });
});
