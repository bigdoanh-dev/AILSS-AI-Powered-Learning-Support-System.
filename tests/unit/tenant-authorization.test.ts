import { describe, expect, it } from "vitest";
import { InMemoryTenantRepository } from "../../apps/identity-service/src/tenant/repository.js";
import { TenantService } from "../../apps/identity-service/src/tenant/service.js";

describe("Phase 21.3: Tenant Authorization V2 & Lineage Traversal", () => {
  async function setup4TierHierarchy() {
    const repo = new InMemoryTenantRepository();
    const service = new TenantService(repo);

    // Organization A
    const orgA = await service.createOrganization({
      name: "Đại học Quốc gia A",
      slug: "vnu-a",
      domain: "vnua.edu.vn",
      tier: "ORGANIZATION",
    });

    // Faculty A1 under Org A
    const facA1 = await service.createOrganization({
      name: "Trường CNTT",
      slug: "vnu-fit",
      domain: "fit.vnua.edu.vn",
      tier: "FACULTY",
      parentTenantId: orgA.organizationId,
    });

    // Faculty A2 under Org A
    const facA2 = await service.createOrganization({
      name: "Trường Kinh tế",
      slug: "vnu-econ",
      domain: "econ.vnua.edu.vn",
      tier: "FACULTY",
      parentTenantId: orgA.organizationId,
    });

    // Department A1.1 under Faculty A1
    const deptA11 = await service.createOrganization({
      name: "Bộ môn Hệ thống Thông tin",
      slug: "vnu-fit-is",
      domain: "is.fit.vnua.edu.vn",
      tier: "DEPARTMENT",
      parentTenantId: facA1.organizationId,
    });

    // Department A1.2 under Faculty A1
    const deptA12 = await service.createOrganization({
      name: "Bộ môn Kỹ thuật Phần mềm",
      slug: "vnu-fit-se",
      domain: "se.fit.vnua.edu.vn",
      tier: "DEPARTMENT",
      parentTenantId: facA1.organizationId,
    });

    // Organization B (isolated)
    const orgB = await service.createOrganization({
      name: "Đại học Quốc tế B",
      slug: "intl-b",
      domain: "intlb.edu.vn",
      tier: "ORGANIZATION",
    });

    return { repo, service, orgA, facA1, facA2, deptA11, deptA12, orgB };
  }

  it("verifies ancestor lineage records correctly in hierarchy", async () => {
    const { deptA11, facA1, orgA } = await setup4TierHierarchy();

    expect(deptA11.parentTenantId).toBe(facA1.organizationId);
    expect(deptA11.ancestorIds).toEqual([orgA.organizationId, facA1.organizationId]);
  });

  it("Case 1: Org Admin can govern descendant Department", async () => {
    const { service, orgA, deptA11 } = await setup4TierHierarchy();
    const adminId = "user-org-admin";

    await service.addMembership({
      userId: adminId,
      organizationId: orgA.organizationId,
      role: "INSTITUTION_ADMIN",
    });

    const access = await service.verifyTenantAccess(adminId, deptA11.organizationId, "STUDENT");
    expect(access.role).toBe("INSTITUTION_ADMIN");
    expect(access.effectiveRole).toBe("INSTITUTION_ADMIN");
    expect(access.lineage).toContain(orgA.organizationId);
  });

  it("Case 2: Org A Admin CANNOT access Org B (Deny foreign organization)", async () => {
    const { service, orgA, orgB } = await setup4TierHierarchy();
    const adminId = "user-org-admin";

    await service.addMembership({
      userId: adminId,
      organizationId: orgA.organizationId,
      role: "INSTITUTION_ADMIN",
    });

    await expect(service.verifyTenantAccess(adminId, orgB.organizationId)).rejects.toThrow(
      /TENANT_ACCESS_DENIED/,
    );
  });

  it("Case 3: Faculty Dean can govern descendant Department under that Faculty", async () => {
    const { service, facA1, deptA11 } = await setup4TierHierarchy();
    const deanId = "user-dean";

    await service.addMembership({
      userId: deanId,
      organizationId: facA1.organizationId,
      role: "FACULTY_DEAN",
    });

    const access = await service.verifyTenantAccess(deanId, deptA11.organizationId, "DEPARTMENT_HEAD");
    expect(access.role).toBe("FACULTY_DEAN");
    expect(access.effectiveRole).toBe("FACULTY_DEAN");
  });

  it("Case 4: Faculty Dean CANNOT access sibling Faculty (Deny)", async () => {
    const { service, facA1, facA2 } = await setup4TierHierarchy();
    const deanId = "user-dean";

    await service.addMembership({
      userId: deanId,
      organizationId: facA1.organizationId,
      role: "FACULTY_DEAN",
    });

    await expect(service.verifyTenantAccess(deanId, facA2.organizationId)).rejects.toThrow(
      /TENANT_ACCESS_DENIED/,
    );
  });

  it("Case 5: Department Head CANNOT access sibling Department (Deny)", async () => {
    const { service, deptA11, deptA12 } = await setup4TierHierarchy();
    const deptHeadId = "user-dept-head";

    await service.addMembership({
      userId: deptHeadId,
      organizationId: deptA11.organizationId,
      role: "DEPARTMENT_HEAD",
    });

    await expect(service.verifyTenantAccess(deptHeadId, deptA12.organizationId)).rejects.toThrow(
      /TENANT_ACCESS_DENIED/,
    );
  });

  it("Case 6: Lecturer CANNOT access foreign Faculty (Deny)", async () => {
    const { service, facA1, facA2 } = await setup4TierHierarchy();
    const lecturerId = "user-lecturer";

    await service.addMembership({
      userId: lecturerId,
      organizationId: facA1.organizationId,
      role: "LECTURER",
    });

    await expect(service.verifyTenantAccess(lecturerId, facA2.organizationId)).rejects.toThrow(
      /TENANT_ACCESS_DENIED/,
    );
  });

  it("Case 7: Student CANNOT access foreign tenant (Deny)", async () => {
    const { service, deptA11, deptA12 } = await setup4TierHierarchy();
    const studentId = "user-student";

    await service.addMembership({
      userId: studentId,
      organizationId: deptA11.organizationId,
      role: "STUDENT",
    });

    await expect(service.verifyTenantAccess(studentId, deptA12.organizationId)).rejects.toThrow(
      /TENANT_ACCESS_DENIED/,
    );
  });

  it("Case 8: Suspended or Revoked membership is Denied", async () => {
    const { service, deptA11 } = await setup4TierHierarchy();
    const studentId = "user-student-suspended";

    await service.addMembership({
      userId: studentId,
      organizationId: deptA11.organizationId,
      role: "STUDENT",
    });

    await service.updateMembershipStatus(studentId, deptA11.organizationId, "SUSPENDED");
    await expect(service.verifyTenantAccess(studentId, deptA11.organizationId)).rejects.toThrow(
      /TENANT_ACCESS_DENIED/,
    );

    await service.updateMembershipStatus(studentId, deptA11.organizationId, "REVOKED");
    await expect(service.verifyTenantAccess(studentId, deptA11.organizationId)).rejects.toThrow(
      /TENANT_ACCESS_DENIED/,
    );
  });

  it("Case 9: Archived or Suspended tenant rejects access with specific errors", async () => {
    const { service, deptA11 } = await setup4TierHierarchy();
    const adminId = "user-admin";

    await service.addMembership({
      userId: adminId,
      organizationId: deptA11.organizationId,
      role: "INSTITUTION_ADMIN",
    });

    await service.updateOrganizationStatus(deptA11.organizationId, "SUSPENDED");
    await expect(service.verifyTenantAccess(adminId, deptA11.organizationId)).rejects.toThrow(
      /TENANT_SUSPENDED/,
    );

    await service.updateOrganizationStatus(deptA11.organizationId, "ARCHIVED");
    await expect(service.verifyTenantAccess(adminId, deptA11.organizationId)).rejects.toThrow(
      /TENANT_ARCHIVED/,
    );
  });

  it("Case 10: Multi-membership querying and SSO secret rotation with secretReference", async () => {
    const { service, orgA, facA1 } = await setup4TierHierarchy();
    const userId = "multi-user-1";

    // User is Dean in facA1 and Student in orgA
    await service.addMembership({
      userId,
      organizationId: orgA.organizationId,
      role: "STUDENT",
    });
    await service.addMembership({
      userId,
      organizationId: facA1.organizationId,
      role: "FACULTY_DEAN",
    });

    const userTenants = await service.listUserTenants(userId);
    expect(userTenants).toHaveLength(2);
    expect(userTenants.map((m) => m.organizationId)).toContain(orgA.organizationId);
    expect(userTenants.map((m) => m.organizationId)).toContain(facA1.organizationId);

    // SSO Configuration with secretReference
    const sso = await service.configureInstitutionalSso({
      organizationId: orgA.organizationId,
      providerType: "OIDC",
      issuerUrl: "https://auth.vnua.edu.vn",
      clientId: "client-vnua",
      secretReference: "vault://tenants/vnua/oidc-client-secret",
      keyId: "key-v1",
      allowedDomains: ["vnua.edu.vn"],
    });

    expect(sso.secretReference).toBe("vault://tenants/vnua/oidc-client-secret");
    expect(sso.keyId).toBe("key-v1");

    // Secret rotation
    const rotated = await service.rotateSsoSecret({
      organizationId: orgA.organizationId,
      newSecretReference: "vault://tenants/vnua/oidc-client-secret-v2",
      newKeyId: "key-v2",
    });
    expect(rotated.secretReference).toBe("vault://tenants/vnua/oidc-client-secret-v2");
    expect(rotated.keyId).toBe("key-v2");
    expect(rotated.previousKeyId).toBe("key-v1");
    expect(rotated.rotatedAt).toBeDefined();
  });
});
