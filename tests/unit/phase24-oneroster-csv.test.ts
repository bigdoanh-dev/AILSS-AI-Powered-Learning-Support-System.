import { describe, expect, it } from "vitest";
import { OneRosterCsvParser, type OneRosterCsvPackage } from "../../packages/contracts/src/oneroster.js";

describe("Phase 24.11: OneRoster 1.2 CSV Import & Delta Sync Conformance", () => {
  const organizationId = "tenant-pilot-polytech";

  it("successfully parses valid OneRoster 1.2 CSV package and executes relational sync", () => {
    const pkg: OneRosterCsvPackage = {
      manifestCsv: `
        property,value
        manifest.version,1.0
        oneroster.version,1.2
      `,
      orgsCsv: `
        sourcedId,status,dateLastModified,name,type,identifier
        org-polytech,active,2026-09-01T00:00:00Z,Polytechnic Institute,school,POLYTECH
      `,
      coursesCsv: `
        sourcedId,status,dateLastModified,title,courseCode,orgSourcedId
        course-cs-101,active,2026-09-01T00:00:00Z,Introduction to CS,CS101,org-polytech
      `,
      classesCsv: `
        sourcedId,status,dateLastModified,title,classCode,courseSourcedId,termSourcedIds
        class-cs-101-a,active,2026-09-01T00:00:00Z,Intro CS Section A,CS101A,course-cs-101,fall-2026
      `,
      usersCsv: `
        sourcedId,status,dateLastModified,username,givenName,familyName,role,email,enabledUser
        user-teacher-1,active,2026-09-01T00:00:00Z,thay.hoang,Hoang,Nguyen,teacher,thay.hoang@polytech.edu.vn,true
        user-student-1,active,2026-09-01T00:00:00Z,em.lan,Lan,Tran,student,em.lan@polytech.edu.vn,true
      `,
      enrollmentsCsv: `
        sourcedId,status,dateLastModified,userSourcedId,classSourcedId,role,primary,beginDate,endDate
        enr-1,active,2026-09-01T00:00:00Z,user-teacher-1,class-cs-101-a,teacher,true,2026-09-01,2026-12-31
        enr-2,active,2026-09-01T00:00:00Z,user-student-1,class-cs-101-a,student,false,2026-09-01,2026-12-31
      `,
    };

    const result = OneRosterCsvParser.parsePackage(pkg, { organizationId });

    expect(result.manifestValid).toBe(true);
    expect(result.orgsCount).toBe(1);
    expect(result.coursesCount).toBe(1);
    expect(result.classesCount).toBe(1);
    expect(result.usersCount).toBe(2);
    expect(result.enrollmentsCount).toBe(2);
    expect(result.integrityViolations.length).toBe(0);
    expect(result.summary.usersProcessed).toBe(2);
    expect(result.summary.classesProcessed).toBe(1);
    expect(result.summary.enrollmentsProcessed).toBe(2);
  });

  it("handles batch delta sync with tobedeleted records and deactivations", () => {
    const pkg: OneRosterCsvPackage = {
      usersCsv: `
        sourcedId,status,dateLastModified,username,givenName,familyName,role,email,enabledUser
        user-del-1,tobedeleted,2026-09-17T00:00:00Z,cu.sinhvien,Cu,SinhVien,student,cu.sv@polytech.edu.vn,false
      `,
      classesCsv: `
        sourcedId,status,dateLastModified,title,classCode,courseSourcedId,termSourcedIds
        class-del-1,tobedeleted,2026-09-17T00:00:00Z,Old Class,OLD1,course-cs-101,term-old
      `,
      enrollmentsCsv: `
        sourcedId,status,dateLastModified,userSourcedId,classSourcedId,role,primary,beginDate,endDate
        enr-del-1,tobedeleted,2026-09-17T00:00:00Z,user-del-1,class-del-1,student,false,2026-09-01,2026-12-31
      `,
    };

    const result = OneRosterCsvParser.parsePackage(pkg, { organizationId });

    expect(result.deltaDeletionsCount).toBe(2); // user tobedeleted (or disabled) + enrollment tobedeleted
    expect(result.summary.usersDeactivated).toBe(1);
    expect(result.summary.enrollmentsDeactivated).toBe(1);
  });

  it("detects referential integrity violations: orphan enrollments and orphan classes", () => {
    const brokenPkg: OneRosterCsvPackage = {
      coursesCsv: `
        sourcedId,status,dateLastModified,title,courseCode,orgSourcedId
        course-existing,active,2026-09-01T00:00:00Z,Existing Course,EX101,org-1
      `,
      classesCsv: `
        sourcedId,status,dateLastModified,title,classCode,courseSourcedId,termSourcedIds
        class-broken,active,2026-09-01T00:00:00Z,Broken Class,BR101,course-phantom-999,term-1
      `,
      usersCsv: `
        sourcedId,status,dateLastModified,username,givenName,familyName,role,email,enabledUser
        user-real,active,2026-09-01T00:00:00Z,real.user,Real,User,student,real@polytech.edu.vn,true
      `,
      enrollmentsCsv: `
        sourcedId,status,dateLastModified,userSourcedId,classSourcedId,role,primary,beginDate,endDate
        enr-broken-1,active,2026-09-01T00:00:00Z,user-ghost-404,class-broken,student,false,2026-09-01,2026-12-31
      `,
    };

    const result = OneRosterCsvParser.parsePackage(brokenPkg, { organizationId });

    expect(result.integrityViolations.length).toBeGreaterThan(0);
    // Class references unknown course
    expect(
      result.integrityViolations.some((v) => v.includes("references unknown course course-phantom-999")),
    ).toBe(true);
    // Enrollment references unknown user
    expect(result.integrityViolations.some((v) => v.includes("references unknown user user-ghost-404"))).toBe(
      true,
    );
  });
});
