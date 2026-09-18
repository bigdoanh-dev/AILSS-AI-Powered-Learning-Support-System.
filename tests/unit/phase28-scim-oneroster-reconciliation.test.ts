import { describe, it, expect } from "vitest";
import {
  ScimDriftReconciliationEngine,
  type ScimUser,
  type ProvisionedAccount,
} from "../../packages/contracts/src/scim.js";
import {
  OneRosterReconciliationEngine,
  type OneRosterUserInput,
  type OneRosterClassInput,
  type OneRosterEnrollmentInput,
} from "../../packages/contracts/src/oneroster.js";

describe("Phase 28.6 & 28.7: SCIM & OneRoster Operational Drift Reconciliation", () => {
  describe("Phase 28.6: SCIM Operational Drift Reconciliation Engine", () => {
    const sampleIdpUsers: ScimUser[] = [
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        externalId: "ext-polytech-001",
        userName: "john.doe@polytech.edu.vn",
        emails: [{ value: "john.doe@polytech.edu.vn", type: "work", primary: true }],
        active: true,
        roles: [{ value: "STUDENT", primary: true }],
      },
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        externalId: "ext-polytech-002",
        userName: "jane.smith@polytech.edu.vn",
        emails: [{ value: "jane.smith@polytech.edu.vn", type: "work", primary: true }],
        active: false, // Inactive in IdP (deactivated student)
        roles: [{ value: "STUDENT", primary: true }],
      },
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        externalId: "ext-polytech-003",
        userName: "prof.alan@polytech.edu.vn",
        emails: [{ value: "prof.alan@polytech.edu.vn", type: "work", primary: true }],
        active: true,
        roles: [{ value: "INSTITUTION_ADMIN", primary: true }], // Admin privilege in IdP
      },
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        externalId: "ext-polytech-004", // Missing in AILSS
        userName: "new.student@polytech.edu.vn",
        emails: [{ value: "new.student@polytech.edu.vn", type: "work", primary: true }],
        active: true,
        roles: [{ value: "STUDENT", primary: true }],
      },
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        externalId: "ext-polytech-001", // Duplicate externalId in feed
        userName: "john.doe.dup@polytech.edu.vn",
        emails: [{ value: "john.doe.dup@polytech.edu.vn", type: "work", primary: true }],
        active: true,
        roles: [{ value: "STUDENT", primary: true }],
      },
    ];

    const sampleAilssAccounts: ProvisionedAccount[] = [
      {
        userId: "usr-001",
        externalId: "ext-polytech-001",
        email: "john.doe@polytech.edu.vn",
        fullName: "John Doe",
        role: "STUDENT",
        active: true,
        institutionId: "tenant-pilot-polytech",
        provisionedAt: new Date("2026-09-01"),
        lastSyncedAt: new Date("2026-09-10"),
      },
      {
        userId: "usr-002",
        externalId: "ext-polytech-002",
        email: "jane.smith@polytech.edu.vn",
        fullName: "Jane Smith",
        role: "STUDENT",
        active: true, // Still active in AILSS -> Status mismatch!
        institutionId: "tenant-pilot-polytech",
        provisionedAt: new Date("2026-09-01"),
        lastSyncedAt: new Date("2026-09-10"),
      },
      {
        userId: "usr-003",
        externalId: "ext-polytech-003",
        email: "prof.alan@polytech.edu.vn",
        fullName: "Prof Alan",
        role: "LECTURER", // LECTURER in AILSS vs INSTITUTION_ADMIN in IdP -> Privilege mismatch!
        active: true,
        institutionId: "tenant-pilot-polytech",
        provisionedAt: new Date("2026-09-01"),
        lastSyncedAt: new Date("2026-09-10"),
      },
      {
        userId: "usr-999",
        externalId: "ext-polytech-orphan", // In AILSS but removed from IdP!
        email: "orphan@polytech.edu.vn",
        fullName: "Orphan Account",
        role: "STUDENT",
        active: true,
        institutionId: "tenant-pilot-polytech",
        provisionedAt: new Date("2026-08-15"),
        lastSyncedAt: new Date("2026-08-20"),
      },
    ];

    it("runs in REPORT_ONLY mode without mutating or auto-applying fixes", () => {
      const report = ScimDriftReconciliationEngine.reconcile({
        tenantId: "tenant-pilot-polytech",
        mode: "REPORT_ONLY",
        idpUsers: sampleIdpUsers,
        ailssAccounts: sampleAilssAccounts,
      });

      expect(report.mode).toBe("REPORT_ONLY");
      expect(report.totalDrifts).toBeGreaterThan(0);
      expect(report.safeFixesApplied).toBe(0); // None applied in REPORT_ONLY

      // Check specific drifts detected
      const duplicateExt = report.drifts.find((d) => d.driftType === "DUPLICATE_EXTERNAL_ID");
      expect(duplicateExt).toBeDefined();

      const idpMissingInAilss = report.drifts.find((d) => d.driftType === "IDP_USER_EXISTS_AILSS_MISSING");
      expect(idpMissingInAilss).toBeDefined();
      expect(idpMissingInAilss?.externalId).toBe("ext-polytech-004");

      const statusMismatch = report.drifts.find((d) => d.driftType === "STATUS_MISMATCH");
      expect(statusMismatch).toBeDefined();
      expect(statusMismatch?.externalId).toBe("ext-polytech-002");

      const roleMismatch = report.drifts.find((d) => d.driftType === "ROLE_MISMATCH");
      expect(roleMismatch).toBeDefined();
      expect(roleMismatch?.externalId).toBe("ext-polytech-003");

      const orphan = report.drifts.find((d) => d.driftType === "AILSS_USER_EXISTS_IDP_MISSING");
      expect(orphan).toBeDefined();
      expect(orphan?.externalId).toBe("ext-polytech-orphan");
    });

    it("in APPLY_SAFE_FIXES mode, auto-applies safe fixes but gates privilege escalation for manual review", () => {
      const report = ScimDriftReconciliationEngine.reconcile({
        tenantId: "tenant-pilot-polytech",
        mode: "APPLY_SAFE_FIXES",
        idpUsers: sampleIdpUsers,
        ailssAccounts: sampleAilssAccounts,
      });

      expect(report.mode).toBe("APPLY_SAFE_FIXES");

      // Safe deactivation applied
      const statusMismatch = report.drifts.find((d) => d.driftType === "STATUS_MISMATCH");
      expect(statusMismatch?.actionTaken).toBe("SAFE_FIX_APPLIED");

      // Missing user provisioning applied
      const missingUser = report.drifts.find((d) => d.driftType === "IDP_USER_EXISTS_AILSS_MISSING");
      expect(missingUser?.actionTaken).toBe("SAFE_FIX_APPLIED");

      // Privilege escalation NEVER auto-fixed
      const roleMismatch = report.drifts.find((d) => d.driftType === "ROLE_MISMATCH");
      expect(roleMismatch?.actionTaken).toBe("REQUIRES_MANUAL_POLICY_REVIEW");

      // Orphan account deactivation requires review
      const orphan = report.drifts.find((d) => d.driftType === "AILSS_USER_EXISTS_IDP_MISSING");
      expect(orphan?.actionTaken).toBe("REQUIRES_MANUAL_POLICY_REVIEW");
    });
  });

  describe("Phase 28.7: SIS / OneRoster Reconciliation Engine", () => {
    const sisUsers: OneRosterUserInput[] = [
      {
        sourcedId: "sis-u1",
        username: "student1",
        givenName: "Student",
        familyName: "One",
        role: "student",
        email: "student1@polytech.edu.vn",
        enabledUser: true,
        status: "active",
      },
      {
        sourcedId: "sis-u2",
        username: "student2",
        givenName: "Student",
        familyName: "Two",
        role: "student",
        email: "student2@polytech.edu.vn",
        enabledUser: false, // Deactivated in SIS
        status: "tobedeleted",
      },
      {
        sourcedId: "sis-u3",
        username: "teacher1",
        givenName: "Prof",
        familyName: "One",
        role: "teacher", // Teacher in SIS
        email: "teacher1@polytech.edu.vn",
        enabledUser: true,
        status: "active",
      },
      {
        sourcedId: "sis-u1", // Duplicate
        username: "student1_dup",
        givenName: "Student",
        familyName: "Dup",
        role: "student",
        email: "student1_dup@polytech.edu.vn",
        enabledUser: true,
        status: "active",
      },
    ];

    const sisClasses: OneRosterClassInput[] = [
      {
        sourcedId: "sis-cls-active",
        title: "CS101 Active",
        classCode: "CS101",
        courseSourcedId: "crs-cs101",
        termSourcedIds: ["term-2026-1"],
        status: "active",
      },
      {
        sourcedId: "sis-cls-stale",
        title: "CS102 Stale",
        classCode: "CS102",
        courseSourcedId: "crs-cs102",
        termSourcedIds: ["term-2026-1"],
        status: "tobedeleted", // Stale in SIS
      },
    ];

    const sisEnrollments: OneRosterEnrollmentInput[] = [
      {
        sourcedId: "enr-valid-1",
        userSourcedId: "sis-u1",
        classSourcedId: "sis-cls-active",
        role: "student",
        status: "active",
      },
      {
        sourcedId: "enr-orphan-class",
        userSourcedId: "sis-u1",
        classSourcedId: "sis-cls-nonexistent", // Orphan class
        role: "student",
        status: "active",
      },
      {
        sourcedId: "enr-orphan-user",
        userSourcedId: "sis-u-nonexistent", // Orphan user
        classSourcedId: "sis-cls-active",
        role: "student",
        status: "active",
      },
    ];

    const ailssUsers = [
      { sourcedId: "sis-u1", role: "STUDENT", active: true },
      { sourcedId: "sis-u2", role: "STUDENT", active: true }, // Still active in AILSS
      { sourcedId: "sis-u3", role: "STUDENT", active: true }, // Still student in AILSS (lecturer role change)
    ];

    const ailssClasses = [
      { sourcedId: "sis-cls-active", active: true },
      { sourcedId: "sis-cls-stale", active: true }, // Still active in AILSS
    ];

    const ailssEnrollments = [
      { sourcedId: "enr-valid-1", userSourcedId: "sis-u1", classSourcedId: "sis-cls-active" },
    ];

    it("accurately detects orphan enrollments, deactivated students, role changes, and stale classes", () => {
      const report = OneRosterReconciliationEngine.reconcile({
        organizationId: "polytech-sis",
        sisUsers,
        sisClasses,
        sisEnrollments,
        ailssUsers,
        ailssClasses,
        ailssEnrollments,
      });

      expect(report.organizationId).toBe("polytech-sis");
      expect(report.conflictsCount).toBeGreaterThanOrEqual(5);

      const duplicate = report.conflicts.find((c) => c.conflictType === "DUPLICATE_SOURCED_ID");
      expect(duplicate).toBeDefined();

      const orphanEnrs = report.conflicts.filter((c) => c.conflictType === "ORPHAN_ENROLLMENT");
      expect(orphanEnrs).toHaveLength(2);

      const deactivatedStudent = report.conflicts.find((c) => c.conflictType === "DEACTIVATED_STUDENT");
      expect(deactivatedStudent).toBeDefined();
      expect(deactivatedStudent?.sourcedId).toBe("sis-u2");

      const lecturerRoleChange = report.conflicts.find((c) => c.conflictType === "LECTURER_ROLE_CHANGE");
      expect(lecturerRoleChange).toBeDefined();
      expect(lecturerRoleChange?.sourcedId).toBe("sis-u3");

      const staleClass = report.conflicts.find((c) => c.conflictType === "STALE_CLASS");
      expect(staleClass).toBeDefined();
      expect(staleClass?.sourcedId).toBe("sis-cls-stale");
    });
  });
});
