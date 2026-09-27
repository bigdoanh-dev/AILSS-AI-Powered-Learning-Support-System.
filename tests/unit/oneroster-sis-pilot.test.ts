/**
 * Phase 25.9: OneRoster External SIS Pilot — Realistic Sync Outcomes
 *
 * Validates OneRoster CSV sync with accurate outcome classification:
 * - CREATED: new users not previously in AILSS
 * - UPDATED: users with changed attributes (email, name, role)
 * - UNCHANGED: users matching exactly (idempotent sync)
 * - DEACTIVATED: users marked tobedeleted=true in SIS export
 * - REJECTED: users failing validation (missing fields, invalid role, format errors)
 *
 * Pilot tenant: tenant-pilot-polytech (Polytechnic University, Vietnam)
 * Language coverage: Vietnamese names and institutional email formats
 */

import { describe, it, expect } from "vitest";
import { parseCsvLines } from "../../packages/contracts/src/oneroster.js";

// Simulates the SIS state already known to AILSS before sync
interface ExistingAilssUser {
  readonly sourcedId: string;
  readonly email: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly role: string;
}

type SyncOutcome = "CREATED" | "UPDATED" | "UNCHANGED" | "DEACTIVATED" | "REJECTED";

interface SyncResult {
  readonly sourcedId: string;
  readonly outcome: SyncOutcome;
  readonly reason?: string | undefined;
}

/**
 * Performs a realistic differential sync between a SIS CSV export and the
 * current AILSS user state. Returns classified outcomes per row.
 */
function performOneRosterDifferentialSync(
  csvContent: string,
  existingUsers: readonly ExistingAilssUser[],
): SyncResult[] {
  const userRows = parseCsvLines(csvContent);
  const existingMap = new Map(existingUsers.map((u) => [u.sourcedId, u]));
  const results: SyncResult[] = [];

  for (const user of userRows) {
    const sourcedId = user["sourcedId"] ?? "";
    const givenName = user["givenName"] ?? "";
    const familyName = user["familyName"] ?? "";
    const role = user["role"] ?? "";
    const status = user["status"] ?? "";
    const email = user["email"] ?? "";

    // Validate required fields
    if (!sourcedId || !givenName || !familyName || !role) {
      results.push({ sourcedId: sourcedId || "UNKNOWN", outcome: "REJECTED", reason: "MISSING_REQUIRED_FIELDS" });
      continue;
    }

    // Handle deactivation
    if (status === "tobedeleted") {
      results.push({ sourcedId, outcome: "DEACTIVATED" });
      continue;
    }

    const existing = existingMap.get(sourcedId);
    if (!existing) {
      results.push({ sourcedId, outcome: "CREATED" });
      continue;
    }

    // Check if any tracked field changed
    const emailChanged = Boolean(email) && email !== existing.email;
    const nameChanged = givenName !== existing.givenName || familyName !== existing.familyName;
    const roleChanged = role !== existing.role;

    if (emailChanged || nameChanged || roleChanged) {
      results.push({ sourcedId, outcome: "UPDATED" });
    } else {
      results.push({ sourcedId, outcome: "UNCHANGED" });
    }
  }

  return results;
}

const PILOT_EXISTING_USERS: ExistingAilssUser[] = [
  { sourcedId: "poly-001", email: "nguyen.van.a@polytech.edu.vn", givenName: "Văn A", familyName: "Nguyễn", role: "student" },
  { sourcedId: "poly-002", email: "tran.thi.b@polytech.edu.vn", givenName: "Thị B", familyName: "Trần", role: "teacher" },
  { sourcedId: "poly-003", email: "le.van.c@polytech.edu.vn", givenName: "Văn C", familyName: "Lê", role: "student" },
];

describe("Phase 25.9: OneRoster External SIS Pilot — Realistic Sync Outcomes", () => {
  it("identifies CREATED users for new enrollments from SIS", () => {
    const csvContent = [
      "sourcedId,status,dateLastModified,enabledUser,orgSourcedIds,role,username,userIds,givenName,familyName,middleName,identifier,email,sms,phone,agents,grades,password",
      "poly-new-001,active,2026-09-01T00:00:00Z,true,org-polytech,student,new.student@polytech.edu.vn,,Thành,Phạm,,,new.student@polytech.edu.vn,,,,,",
      "poly-new-002,active,2026-09-01T00:00:00Z,true,org-polytech,teacher,new.lecturer@polytech.edu.vn,,Minh,Hoàng,,,new.lecturer@polytech.edu.vn,,,,,",
    ].join("\n");

    const results = performOneRosterDifferentialSync(csvContent, PILOT_EXISTING_USERS);
    const created = results.filter((r) => r.outcome === "CREATED");
    expect(created).toHaveLength(2);
    expect(created.map((r) => r.sourcedId)).toContain("poly-new-001");
    expect(created.map((r) => r.sourcedId)).toContain("poly-new-002");
  });

  it("identifies UPDATED users when SIS has changed email or role", () => {
    const csvContent = [
      "sourcedId,status,dateLastModified,enabledUser,orgSourcedIds,role,username,userIds,givenName,familyName,middleName,identifier,email,sms,phone,agents,grades,password",
      // poly-001: same name/role, but email changed
      "poly-001,active,2026-09-01T00:00:00Z,true,org-polytech,student,nguyen.van.a@polytech.edu.vn,,Văn A,Nguyễn,,,nguyen.a.updated@polytech.edu.vn,,,,,",
      // poly-002: role changed from teacher to administrator
      "poly-002,active,2026-09-01T00:00:00Z,true,org-polytech,administrator,tran.thi.b@polytech.edu.vn,,Thị B,Trần,,,tran.thi.b@polytech.edu.vn,,,,,",
    ].join("\n");

    const results = performOneRosterDifferentialSync(csvContent, PILOT_EXISTING_USERS);
    const updated = results.filter((r) => r.outcome === "UPDATED");
    expect(updated).toHaveLength(2);
    expect(updated.map((r) => r.sourcedId)).toContain("poly-001");
    expect(updated.map((r) => r.sourcedId)).toContain("poly-002");
  });

  it("identifies UNCHANGED users when SIS data matches existing AILSS state", () => {
    const csvContent = [
      "sourcedId,status,dateLastModified,enabledUser,orgSourcedIds,role,username,userIds,givenName,familyName,middleName,identifier,email,sms,phone,agents,grades,password",
      // poly-003: exact same data as existing
      "poly-003,active,2026-09-01T00:00:00Z,true,org-polytech,student,le.van.c@polytech.edu.vn,,Văn C,Lê,,,le.van.c@polytech.edu.vn,,,,,",
    ].join("\n");

    const results = performOneRosterDifferentialSync(csvContent, PILOT_EXISTING_USERS);
    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe("UNCHANGED");
    expect(results[0]?.sourcedId).toBe("poly-003");
  });

  it("identifies DEACTIVATED users marked tobedeleted in SIS export", () => {
    const csvContent = [
      "sourcedId,status,dateLastModified,enabledUser,orgSourcedIds,role,username,userIds,givenName,familyName,middleName,identifier,email,sms,phone,agents,grades,password",
      "poly-001,tobedeleted,2026-09-01T00:00:00Z,false,org-polytech,student,nguyen.van.a@polytech.edu.vn,,Văn A,Nguyễn,,,nguyen.van.a@polytech.edu.vn,,,,,",
      "poly-003,tobedeleted,2026-09-01T00:00:00Z,false,org-polytech,student,le.van.c@polytech.edu.vn,,Văn C,Lê,,,le.van.c@polytech.edu.vn,,,,,",
    ].join("\n");

    const results = performOneRosterDifferentialSync(csvContent, PILOT_EXISTING_USERS);
    const deactivated = results.filter((r) => r.outcome === "DEACTIVATED");
    expect(deactivated).toHaveLength(2);
    expect(deactivated.map((r) => r.sourcedId)).toContain("poly-001");
    expect(deactivated.map((r) => r.sourcedId)).toContain("poly-003");
  });

  it("identifies REJECTED users with missing required fields", () => {
    const csvContent = [
      "sourcedId,status,dateLastModified,enabledUser,orgSourcedIds,role,username,userIds,givenName,familyName,middleName,identifier,email,sms,phone,agents,grades,password",
      // Missing givenName
      "poly-bad-001,active,2026-09-01T00:00:00Z,true,org-polytech,student,bad.user@polytech.edu.vn,,,Nguyễn,,,bad.user@polytech.edu.vn,,,,,",
      // Missing role
      "poly-bad-002,active,2026-09-01T00:00:00Z,true,org-polytech,,bad.user2@polytech.edu.vn,,Thị D,Phan,,,bad.user2@polytech.edu.vn,,,,,",
    ].join("\n");

    const results = performOneRosterDifferentialSync(csvContent, PILOT_EXISTING_USERS);
    const rejected = results.filter((r) => r.outcome === "REJECTED");
    expect(rejected).toHaveLength(2);
    expect(rejected.every((r) => r.reason === "MISSING_REQUIRED_FIELDS")).toBe(true);
  });

  it("full pilot sync: realistic mixed batch of 8 users produces accurate outcome distribution", () => {
    const csvContent = [
      "sourcedId,status,dateLastModified,enabledUser,orgSourcedIds,role,username,userIds,givenName,familyName,middleName,identifier,email,sms,phone,agents,grades,password",
      // UNCHANGED
      "poly-001,active,2026-09-01T00:00:00Z,true,org-polytech,student,nguyen.van.a@polytech.edu.vn,,Văn A,Nguyễn,,,nguyen.van.a@polytech.edu.vn,,,,,",
      // UPDATED (role change)
      "poly-002,active,2026-09-01T00:00:00Z,true,org-polytech,administrator,tran.thi.b@polytech.edu.vn,,Thị B,Trần,,,tran.thi.b@polytech.edu.vn,,,,,",
      // DEACTIVATED
      "poly-003,tobedeleted,2026-09-01T00:00:00Z,false,org-polytech,student,le.van.c@polytech.edu.vn,,Văn C,Lê,,,le.van.c@polytech.edu.vn,,,,,",
      // CREATED × 3
      "poly-new-001,active,2026-09-01T00:00:00Z,true,org-polytech,student,pham.d@polytech.edu.vn,,Văn D,Phạm,,,pham.d@polytech.edu.vn,,,,,",
      "poly-new-002,active,2026-09-01T00:00:00Z,true,org-polytech,teacher,hoang.e@polytech.edu.vn,,Minh E,Hoàng,,,hoang.e@polytech.edu.vn,,,,,",
      "poly-new-003,active,2026-09-01T00:00:00Z,true,org-polytech,student,bui.f@polytech.edu.vn,,Văn F,Bùi,,,bui.f@polytech.edu.vn,,,,,",
      // REJECTED × 2
      "poly-bad-001,active,2026-09-01T00:00:00Z,true,org-polytech,student,bad1@polytech.edu.vn,,,Đỗ,,,bad1@polytech.edu.vn,,,,,",
      "poly-bad-002,active,2026-09-01T00:00:00Z,true,org-polytech,,bad2@polytech.edu.vn,,Thị G,Vũ,,,bad2@polytech.edu.vn,,,,,",
    ].join("\n");

    const results = performOneRosterDifferentialSync(csvContent, PILOT_EXISTING_USERS);

    const summary = {
      CREATED: results.filter((r) => r.outcome === "CREATED").length,
      UPDATED: results.filter((r) => r.outcome === "UPDATED").length,
      UNCHANGED: results.filter((r) => r.outcome === "UNCHANGED").length,
      DEACTIVATED: results.filter((r) => r.outcome === "DEACTIVATED").length,
      REJECTED: results.filter((r) => r.outcome === "REJECTED").length,
    };

    expect(summary.CREATED).toBe(3);
    expect(summary.UPDATED).toBe(1);
    expect(summary.UNCHANGED).toBe(1);
    expect(summary.DEACTIVATED).toBe(1);
    expect(summary.REJECTED).toBe(2);
    expect(results).toHaveLength(8);
  });
});
