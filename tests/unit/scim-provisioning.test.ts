import { describe, expect, it } from "vitest";
import {
  SCIM_USER_SCHEMA_URI,
  processScimUserProvisioning,
} from "../../packages/contracts/src/scim.js";

describe("Phase 23E: SCIM 2.0 User Provisioning & Privilege Guard", () => {
  const institutionId = "tenant-pilot-polytech";

  it("provisions standard student account from compliant SCIM 2.0 User payload", () => {
    const scimPayload = {
      schemas: [SCIM_USER_SCHEMA_URI],
      externalId: "ext-poly-1001",
      userName: "nguyen.van.b@polytech.edu.vn",
      name: {
        formatted: "Nguyen Van B",
        familyName: "Nguyen",
        givenName: "Van B",
      },
      emails: [
        {
          value: "nguyen.van.b@polytech.edu.vn",
          type: "work",
          primary: true,
        },
      ],
      active: true,
      roles: [{ value: "Student" }],
    };

    const result = processScimUserProvisioning(scimPayload, institutionId);
    expect(result.externalId).toBe("ext-poly-1001");
    expect(result.email).toBe("nguyen.van.b@polytech.edu.vn");
    expect(result.fullName).toBe("Nguyen Van B");
    expect(result.role).toBe("STUDENT");
    expect(result.active).toBe(true);
  });

  it("provisions lecturer and institution admin roles", () => {
    const lecturerPayload = {
      schemas: [SCIM_USER_SCHEMA_URI],
      externalId: "ext-poly-2001",
      userName: "giangvien.c@polytech.edu.vn",
      emails: [{ value: "giangvien.c@polytech.edu.vn", primary: true }],
      roles: [{ value: "Instructor" }],
    };
    const lecturerResult = processScimUserProvisioning(lecturerPayload, institutionId);
    expect(lecturerResult.role).toBe("LECTURER");

    const adminPayload = {
      schemas: [SCIM_USER_SCHEMA_URI],
      externalId: "ext-poly-3001",
      userName: "quanly.d@polytech.edu.vn",
      emails: [{ value: "quanly.d@polytech.edu.vn", primary: true }],
      roles: [{ value: "Administrator" }],
    };
    const adminResult = processScimUserProvisioning(adminPayload, institutionId);
    expect(adminResult.role).toBe("INSTITUTION_ADMIN");
  });

  it("ANTI-PRIVILEGE ESCALATION: Throws 403 when SCIM attempts to provision PLATFORM_ADMIN", () => {
    const hostilePayload = {
      schemas: [SCIM_USER_SCHEMA_URI],
      externalId: "ext-hostile-01",
      userName: "attacker@polytech.edu.vn",
      emails: [{ value: "attacker@polytech.edu.vn", primary: true }],
      roles: [{ value: "PLATFORM_ADMIN" }],
    };

    expect(() => processScimUserProvisioning(hostilePayload, institutionId)).toThrowError(
      "SCIM provisioning is forbidden from assigning PLATFORM_ADMIN role",
    );
  });

  it("handles user deactivation via active: false flag", () => {
    const deactPayload = {
      schemas: [SCIM_USER_SCHEMA_URI],
      externalId: "ext-poly-4001",
      userName: "cuusinhvien@polytech.edu.vn",
      emails: [{ value: "cuusinhvien@polytech.edu.vn", primary: true }],
      active: false,
    };

    const result = processScimUserProvisioning(deactPayload, institutionId);
    expect(result.active).toBe(false);
  });
});
