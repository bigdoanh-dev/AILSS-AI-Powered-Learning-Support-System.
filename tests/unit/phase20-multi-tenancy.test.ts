import { describe, expect, it } from "vitest";
import { AppError } from "../../packages/http/src/index.js";
import { InMemoryTenantRepository } from "../../apps/identity-service/src/tenant/repository.js";
import { TenantService } from "../../apps/identity-service/src/tenant/service.js";

describe("Phase 20B & 20C: Institutional Multi-Tenancy & SSO", () => {
  it("creates and retrieves organizations with slug collision prevention", async () => {
    const repo = new InMemoryTenantRepository();
    const service = new TenantService(repo);

    const org = await service.createOrganization({
      name: "Đại học Bách Khoa TP.HCM",
      slug: "hcmut",
      domain: "hcmut.edu.vn",
      faculties: ["Khoa Khoa học & Kỹ thuật Máy tính", "Khoa Điện - Điện tử"],
      departments: ["Bộ môn Hệ thống Thông tin", "Bộ môn Khoa học Máy tính"],
      maxSeats: 5000,
    });

    expect(org.organizationId).toBeDefined();
    expect(org.slug).toBe("hcmut");
    expect(org.status).toBe("ACTIVE");
    expect(org.settings.faculties).toHaveLength(2);

    const fetched = await service.getOrganization(org.organizationId);
    expect(fetched.name).toBe("Đại học Bách Khoa TP.HCM");

    // Slug collision should throw 409
    await expect(
      service.createOrganization({
        name: "Trùng Slug",
        slug: "HCMUT",
        domain: "another.edu.vn",
      }),
    ).rejects.toThrowError(AppError);
  });

  it("enforces horizontal tenant isolation and hierarchical RBAC guard", async () => {
    const repo = new InMemoryTenantRepository();
    const service = new TenantService(repo);

    const orgA = await service.createOrganization({
      name: "Đại học A",
      slug: "org-a",
      domain: "orga.edu.vn",
    });

    const orgB = await service.createOrganization({
      name: "Đại học B",
      slug: "org-b",
      domain: "orgb.edu.vn",
    });

    const studentId = "student-123";
    const adminId = "admin-456";

    await service.addMembership({
      userId: studentId,
      organizationId: orgA.organizationId,
      role: "STUDENT",
      department: "Computer Science",
    });

    await service.addMembership({
      userId: adminId,
      organizationId: orgA.organizationId,
      role: "INSTITUTION_ADMIN",
    });

    // 1. Student in Org A can access Org A
    const accessA = await service.verifyTenantAccess(studentId, orgA.organizationId);
    expect(accessA.role).toBe("STUDENT");

    // 2. Student in Org A CANNOT access Org B (Horizontal isolation guard)
    await expect(service.verifyTenantAccess(studentId, orgB.organizationId)).rejects.toThrowError(
      /TENANT_ACCESS_DENIED/,
    );

    // 3. Student in Org A cannot perform LECTURER or ADMIN actions
    await expect(service.verifyTenantAccess(studentId, orgA.organizationId, "LECTURER")).rejects.toThrowError(
      /TENANT_INSUFFICIENT_ROLE/,
    );

    // 4. Admin in Org A can perform STUDENT, LECTURER, and ADMIN actions
    const adminAccess = await service.verifyTenantAccess(adminId, orgA.organizationId, "LECTURER");
    expect(adminAccess.role).toBe("INSTITUTION_ADMIN");
  });

  it("validates institutional SSO configuration and domain authorization", async () => {
    const repo = new InMemoryTenantRepository();
    const service = new TenantService(repo);

    const org = await service.createOrganization({
      name: "Đại học Công nghệ",
      slug: "uet",
      domain: "uet.vnu.edu.vn",
    });

    await service.configureInstitutionalSso({
      organizationId: org.organizationId,
      providerType: "OIDC",
      issuerUrl: "https://auth.uet.vnu.edu.vn",
      clientId: "ailss-uet-client",
      encryptedSecret: "vault:enc:secret123",
      allowedDomains: ["uet.vnu.edu.vn", "vnu.edu.vn"],
    });

    // Valid institutional domain
    const loginResult = await service.processInstitutionalSsoCallback(org.organizationId, {
      email: "nam.nguyen@uet.vnu.edu.vn",
      sub: "uet-user-9988",
      name: "Nam Nguyen",
    });

    expect(loginResult.organizationId).toBe(org.organizationId);
    expect(loginResult.email).toBe("nam.nguyen@uet.vnu.edu.vn");
    expect(loginResult.role).toBe("STUDENT");

    // Unauthorized domain rejected
    await expect(
      service.processInstitutionalSsoCallback(org.organizationId, {
        email: "hacker@gmail.com",
        sub: "gmail-sub-123",
      }),
    ).rejects.toThrowError(/SSO_DOMAIN_UNAUTHORIZED/);
  });
});
