import { describe, expect, it } from "vitest";
import {
  OneRosterSyncEngine,
  type OneRosterClassInput,
  type OneRosterEnrollmentInput,
  type OneRosterSyncBatch,
  type OneRosterUserInput,
} from "../../packages/contracts/src/oneroster.js";

describe("Phase 23N: OneRoster 1.2 SIS Roster Synchronization Engine", () => {
  it("processes valid batch and calculates processing summary", () => {
    const users: OneRosterUserInput[] = [
      {
        sourcedId: "usr-01",
        username: "gv.an",
        givenName: "An",
        familyName: "Tran",
        role: "teacher",
        email: "an.tran@polytech.edu.vn",
        enabledUser: true,
      },
      {
        sourcedId: "usr-02",
        username: "sv.binh",
        givenName: "Binh",
        familyName: "Le",
        role: "student",
        email: "binh.le@polytech.edu.vn",
        enabledUser: true,
      },
      {
        sourcedId: "usr-03",
        status: "tobedeleted",
        username: "sv.cuong",
        givenName: "Cuong",
        familyName: "Pham",
        role: "student",
        email: "cuong.pham@polytech.edu.vn",
        enabledUser: false,
      },
    ];

    const classes: OneRosterClassInput[] = [
      {
        sourcedId: "cls-101",
        title: "CS101 - Lap trinh can ban",
        classCode: "CS101-2026",
        courseSourcedId: "crs-cs101",
        termSourcedIds: ["term-hki-2026"],
      },
    ];

    const enrollments: OneRosterEnrollmentInput[] = [
      {
        sourcedId: "enr-01",
        userSourcedId: "usr-01",
        classSourcedId: "cls-101",
        role: "teacher",
        primary: true,
      },
      {
        sourcedId: "enr-02",
        userSourcedId: "usr-02",
        classSourcedId: "cls-101",
        role: "student",
      },
    ];

    const batch: OneRosterSyncBatch = {
      organizationId: "polytech-hcm",
      syncId: "sync-2026-09-01",
      users,
      classes,
      enrollments,
    };

    const summary = OneRosterSyncEngine.processBatch(batch);
    expect(summary.usersProcessed).toBe(3);
    expect(summary.usersDeactivated).toBe(1);
    expect(summary.classesProcessed).toBe(1);
    expect(summary.enrollmentsProcessed).toBe(2);
    expect(summary.errors).toHaveLength(0);
  });

  it("fails referential integrity when enrollment references non-existent user or class", () => {
    const batch: OneRosterSyncBatch = {
      organizationId: "polytech-hcm",
      syncId: "sync-broken-ref",
      users: [
        {
          sourcedId: "u-real",
          username: "real.user",
          givenName: "Real",
          familyName: "User",
          role: "student",
          email: "real@polytech.edu.vn",
          enabledUser: true,
        },
      ],
      classes: [
        {
          sourcedId: "c-real",
          title: "Real Class",
          classCode: "RC01",
          courseSourcedId: "crs-01",
          termSourcedIds: ["t1"],
        },
      ],
      enrollments: [
        {
          sourcedId: "enr-orphan-user",
          userSourcedId: "u-ghost-does-not-exist",
          classSourcedId: "c-real",
          role: "student",
        },
        {
          sourcedId: "enr-orphan-class",
          userSourcedId: "u-real",
          classSourcedId: "c-ghost-class-404",
          role: "student",
        },
      ],
    };

    const summary = OneRosterSyncEngine.processBatch(batch);
    expect(summary.enrollmentsProcessed).toBe(0);
    expect(summary.errors).toHaveLength(2);
    expect(summary.errors[0]).toContain("references unknown user u-ghost-does-not-exist");
    expect(summary.errors[1]).toContain("references unknown class c-ghost-class-404");
  });

  it("OneRosterSyncEngine.mapRole maps administrator to INSTITUTION_ADMIN, never PLATFORM_ADMIN", () => {
    expect(OneRosterSyncEngine.mapRole("administrator")).toBe("INSTITUTION_ADMIN");
    expect(OneRosterSyncEngine.mapRole("teacher")).toBe("LECTURER");
    expect(OneRosterSyncEngine.mapRole("student")).toBe("STUDENT");
  });
});
