import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Transport, ApiError } from "../src/api";
import { Session } from "../src/session";
import { sessionDetail, attendanceRoster, presenceTicket } from "../src/teaching";

interface SubGateResults {
  contractMapReconciled: boolean;
  schedulePublish: boolean | "BLOCKED_FIXTURE";
  sessionCreate: boolean;
  sessionIdempotency: boolean;
  sessionCancel: boolean;
  presenceTicketSuccess: boolean | "BLOCKED_FIXTURE";
  attendanceRosterRead: boolean;
  manualOfflineAttendance: boolean | "BLOCKED_FIXTURE";
  onlineManualBoundary: boolean;
  student403: boolean;
  foreignOwnershipBoundary: boolean;
  logout: boolean;
}

async function main() {
  const origin = process.env.AILSS_MOBILE_TEST_ORIGIN || "http://127.0.0.1:8080";
  const lecturerEmail = process.env.AILSS_LECTURER_EMAIL || "lecturer.demo@ailss.local";
  const lecturerPassword = process.env.AILSS_LECTURER_PASSWORD || "AilssLecturer!2026";
  const studentEmail = process.env.AILSS_STUDENT_EMAIL || "student.demo@ailss.local";
  const studentPassword = process.env.AILSS_STUDENT_PASSWORD || "AilssDemo!2026";

  console.log("============================================================");
  console.log("AILSS PHASE 14.3B — ACCEPTANCE CLOSURE INTEGRATION TEST");
  console.log("Lecturer Sessions, Attendance & Classroom Management");
  console.log(`Gateway: ${origin}`);
  console.log(`Lecturer: ${lecturerEmail}`);
  console.log(`Student:  ${studentEmail}`);
  console.log("Credentials: [REDACTED]");
  console.log("============================================================\n");

  const results: SubGateResults = {
    contractMapReconciled: false,
    schedulePublish: "BLOCKED_FIXTURE",
    sessionCreate: false,
    sessionIdempotency: false,
    sessionCancel: false,
    presenceTicketSuccess: "BLOCKED_FIXTURE",
    attendanceRosterRead: false,
    manualOfflineAttendance: "BLOCKED_FIXTURE",
    onlineManualBoundary: false,
    student403: false,
    foreignOwnershipBoundary: false,
    logout: false,
  };

  // Step 1: Reconcile Contract IDs against contracts/api-registry.json
  console.log("Step 1: Reconciling Contract IDs against api-registry.json...");
  const registryPath = path.resolve(process.cwd(), "contracts/api-registry.json");
  const registryRaw = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const allApis: { id: string; method: string; path: string; summary: string }[] = [
    ...(registryRaw.public || []),
    ...(registryRaw.internal || []),
  ];

  const cls12 = allApis.find((a) => a.id === "CLS-12");
  const cls15 = allApis.find((a) => a.id === "CLS-15");
  const cls18 = allApis.find((a) => a.id === "CLS-18");
  const cls19 = allApis.find((a) => a.id === "CLS-19");
  const cls20 = allApis.find((a) => a.id === "CLS-20");

  assert.ok(
    cls12 && cls12.path === "/api/v1/classes/{classId}/sessions/{sessionId}",
    "CLS-12 must be session patch/cancel",
  );
  assert.ok(cls15 && cls15.path === "/api/v1/me/schedule", "CLS-15 must be student schedule");
  assert.ok(
    cls18 && cls18.path === "/api/v1/class-sessions/{sessionId}/presence-tickets",
    "CLS-18 must be presence tickets",
  );
  assert.ok(
    cls19 && cls19.path === "/api/v1/class-sessions/{sessionId}/attendance/{studentId}",
    "CLS-19 must be manual attendance",
  );
  assert.ok(
    cls20 && cls20.path === "/api/v1/classes/{classId}/schedule/publish",
    "CLS-20 must be schedule publish",
  );

  results.contractMapReconciled = true;
  console.log("✓ Contract IDs reconciled successfully with authoritative registry:");
  console.log("  - CLS-12: PATCH /api/v1/classes/{classId}/sessions/{sessionId} (Update / Cancel session)");
  console.log("  - CLS-15: GET /api/v1/me/schedule (Student 30-day schedule)");
  console.log(
    "  - CLS-18: POST /api/v1/class-sessions/{sessionId}/presence-tickets (Presence ticket issuance)",
  );
  console.log(
    "  - CLS-19: PUT /api/v1/class-sessions/{sessionId}/attendance/{studentId} (Manual offline attendance)",
  );
  console.log("  - CLS-20: POST /api/v1/classes/{classId}/schedule/publish (Publish & freeze schedule)");

  // Session managers
  let lecturerSaved: string | null = null;
  const lecturerApi = new Transport(origin);
  const lecturerSession = new Session(lecturerApi, {
    read: async () => lecturerSaved,
    write: async (v) => {
      lecturerSaved = v;
    },
    clear: async () => {
      lecturerSaved = null;
    },
  });

  let studentSaved: string | null = null;
  const studentApi = new Transport(origin);
  const studentSession = new Session(studentApi, {
    read: async () => studentSaved,
    write: async (v) => {
      studentSaved = v;
    },
    clear: async () => {
      studentSaved = null;
    },
  });

  // Step 2: Authenticate Lecturer & Student
  console.log("\nStep 2: Authenticating Lecturer and Student...");
  await lecturerSession.login(lecturerEmail, lecturerPassword);
  assert.equal(lecturerSession.snapshot.state, "AUTHENTICATED");
  assert.equal(lecturerSession.snapshot.user?.role, "LECTURER");
  const lecturerId = lecturerSession.snapshot.user?.userId;
  console.log(`✓ Lecturer authenticated: UserID=${lecturerId}, Role=LECTURER`);

  await studentSession.login(studentEmail, studentPassword);
  assert.equal(studentSession.snapshot.state, "AUTHENTICATED");
  assert.equal(studentSession.snapshot.user?.role, "STUDENT");
  const studentId = studentSession.snapshot.user?.userId;
  console.log(`✓ Student authenticated: UserID=${studentId}, Role=STUDENT`);

  // Step 3: Create dedicated disposable PRIVATE class (CLS-01) for write-path lifecycle
  console.log("\nStep 3: Creating dedicated disposable PRIVATE class (CLS-01)...");
  const classKey = crypto.randomUUID();
  const classRes = (await lecturerSession.request("/api/v1/classes", {
    method: "POST",
    headers: { "Idempotency-Key": classKey },
    body: {
      name: `P14.3B Acceptance Fixture ${Date.now()}`,
      classKind: "PRIVATE",
      maxMembers: 15,
    },
  })) as { classId: string; joinCode: string; scheduleState: string };

  const fixtureClassId = classRes.classId;
  assert.equal(classRes.scheduleState, "DRAFT", "New class must start in DRAFT scheduleState");
  console.log(`✓ Created fixture class: ID=${fixtureClassId}, ScheduleState=DRAFT`);

  // Step 4: Create disposable session S1 + Test Idempotency (CLS-11)
  console.log("\nStep 4: Testing Session Creation & Idempotency (CLS-11)...");
  const now = Date.now();
  const s1Key = crypto.randomUUID();
  const s1Payload = {
    title: "P14.3B Disposable Cancel Session",
    startAt: new Date(now + 3600_000).toISOString(),
    endAt: new Date(now + 7200_000).toISOString(),
    timezone: "Asia/Ho_Chi_Minh",
    mode: "OFFLINE",
    location: "Phòng Thực hành 101, Tòa AILSS",
  };

  const s1Res = (await lecturerSession.request(`/api/v1/classes/${fixtureClassId}/sessions`, {
    method: "POST",
    headers: { "Idempotency-Key": s1Key },
    body: s1Payload,
  })) as { sessions: { sessionId: string; title: string; status: string }[] };

  const s1Id = s1Res.sessions[0].sessionId;
  assert.ok(s1Id, "Created session must have a sessionId");
  assert.equal(s1Res.sessions[0].status, "DRAFT");
  results.sessionCreate = true;
  console.log(`✓ Created S1: ID=${s1Id}, Status=DRAFT`);

  // Replay identical request with same key
  const s1Replay = (await lecturerSession.request(`/api/v1/classes/${fixtureClassId}/sessions`, {
    method: "POST",
    headers: { "Idempotency-Key": s1Key },
    body: s1Payload,
  })) as { sessions: { sessionId: string }[] };

  assert.equal(s1Replay.sessions[0].sessionId, s1Id, "Idempotent replay must return identical session");
  results.sessionIdempotency = true;
  console.log("✓ Idempotency verified: identical key returned cached session without duplication");

  // Step 5: Cancel S1 (CLS-12)
  console.log("\nStep 5: Testing Session Cancellation (CLS-12)...");
  const cancelKey = crypto.randomUUID();
  const cancelRes = (await lecturerSession.request(`/api/v1/classes/${fixtureClassId}/sessions/${s1Id}`, {
    method: "PATCH",
    headers: { "Idempotency-Key": cancelKey },
    body: { status: "CANCELLED" },
  })) as { status: string };

  assert.equal(cancelRes.status, "CANCELLED");
  const s1Detail = sessionDetail(await lecturerSession.request(`/api/v1/class-sessions/${s1Id}`));
  assert.equal(s1Detail.status, "CANCELLED");
  results.sessionCancel = true;
  console.log(`✓ Cancelled S1 via CLS-12: refetched status=${s1Detail.status}`);

  // Step 6: Create an active session to allow schedule publishing (schedule requires at least one active session)
  console.log("\nStep 6: Creating active session in disposable class to publish schedule...");
  await lecturerSession.request(`/api/v1/classes/${fixtureClassId}/sessions`, {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: {
      title: "P14.3B Active Published Session",
      startAt: new Date(now + 86400_000).toISOString(),
      endAt: new Date(now + 90000_000).toISOString(),
      timezone: "Asia/Ho_Chi_Minh",
      mode: "OFFLINE",
      location: "Phòng Thực hành 103, Tòa AILSS",
    },
  });

  // Step 7: Publish Class Schedule (CLS-20)
  console.log("\nStep 7: Publishing Class Schedule (CLS-20)...");
  const publishKey = crypto.randomUUID();
  const publishRes = (await lecturerSession.request(`/api/v1/classes/${fixtureClassId}/schedule/publish`, {
    method: "POST",
    headers: { "Idempotency-Key": publishKey },
  })) as { scheduleState: string };

  assert.equal(publishRes.scheduleState, "PUBLISHED");
  const classRefetch = (await lecturerSession.request(`/api/v1/classes/${fixtureClassId}`)) as {
    scheduleState: string;
  };
  assert.equal(classRefetch.scheduleState, "PUBLISHED");
  results.schedulePublish = true;
  console.log(`✓ Schedule published via CLS-20: Class scheduleState=${classRefetch.scheduleState}`);

  // Step 8: Dedicated Attendance & Presence Fixtures
  // We use the durable fixture class (7d498191-adfb-484e-b264-fbd190085d2e)
  // which has:
  // - S2 (334a8cc3-913c-4e8c-9429-5db894b3cd9d): ONLINE, SCHEDULED, inside 30m presence window
  // - S3 (6060bc42-5486-4195-8872-4cd949e5957f): OFFLINE, SCHEDULED, started in past
  // - Student 5d569736-4695-4d3d-9ca3-d82ed2874293: ACTIVE confirmed member
  const durableOnlineSessionId = "334a8cc3-913c-4e8c-9429-5db894b3cd9d";
  const durableOfflineSessionId = "6060bc42-5486-4195-8872-4cd949e5957f";

  // Step 9: Issue Presence Ticket on S2 (CLS-18)
  console.log("\nStep 9: Testing Presence Ticket Issuance on eligible ONLINE session (CLS-18)...");
  try {
    const ticketRaw = await lecturerSession.request(
      `/api/v1/class-sessions/${durableOnlineSessionId}/presence-tickets`,
      { method: "POST" },
    );
    const pt = presenceTicket(ticketRaw);
    assert.ok(pt.ticket && pt.ticket.length > 20, "Presence ticket must be non-empty JWT");
    assert.equal(pt.expiresIn, 30, "Ticket expiresIn must be 30 seconds");
    results.presenceTicketSuccess = true;
    const redactedTicket = `${pt.ticket.slice(0, 15)}...[REDACTED]`;
    console.log(
      `✓ Presence ticket issued successfully: ticket=${redactedTicket}, expiresIn=${pt.expiresIn}s`,
    );
  } catch (e: unknown) {
    console.log("! Presence ticket error:", e instanceof ApiError ? e.message : e);
    results.presenceTicketSuccess = "BLOCKED_FIXTURE";
  }

  // Step 10: Manual Offline Attendance on S3 (CLS-19)
  console.log("\nStep 10: Testing Manual Offline Attendance on eligible OFFLINE session (CLS-19)...");
  try {
    const attKey = crypto.randomUUID();
    const attRes = (await lecturerSession.request(
      `/api/v1/class-sessions/${durableOfflineSessionId}/attendance/${studentId}`,
      {
        method: "PUT",
        headers: { "Idempotency-Key": attKey },
        body: {
          attendanceStatus: "PRESENT",
          note: "P14.3B Acceptance: Student verified present in offline lab",
        },
      },
    )) as { attendanceStatus: string; source: string };

    assert.equal(attRes.attendanceStatus, "PRESENT");
    assert.equal(attRes.source, "MANUAL_OFFLINE");

    // Step 11: Verify Attendance Roster (CLS-16)
    console.log("\nStep 11: Verifying Attendance Roster (CLS-16)...");
    const rosterRaw = await lecturerSession.request(
      `/api/v1/class-sessions/${durableOfflineSessionId}/attendance`,
    );
    const roster = attendanceRoster(rosterRaw);
    assert.ok(Array.isArray(roster) && roster.length >= 1, "Roster must contain at least 1 record");
    const record = roster.find((r) => r.studentId === studentId);
    assert.ok(record, "Student record must exist in attendance roster");
    assert.equal(record.attendanceStatus, "PRESENT");
    results.manualOfflineAttendance = true;
    results.attendanceRosterRead = true;
    console.log(
      `✓ Manual attendance recorded and verified via CLS-16 roster: status=${record.attendanceStatus}, source=${record.source}`,
    );
  } catch (e: unknown) {
    console.log("! Manual attendance error:", e instanceof ApiError ? e.message : e);
    results.manualOfflineAttendance = "BLOCKED_FIXTURE";
  }

  // Step 12: Online Manual Attendance Boundary (CLS-19 on S2 should reject with 409)
  console.log("\nStep 12: Testing Online Manual Attendance Boundary on ONLINE session (409 Conflict)...");
  try {
    await lecturerSession.request(
      `/api/v1/class-sessions/${durableOnlineSessionId}/attendance/${studentId}`,
      {
        method: "PUT",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: { attendanceStatus: "PRESENT" },
      },
    );
    assert.fail("Manual attendance on ONLINE session must fail");
  } catch (e: unknown) {
    assert.ok(e instanceof ApiError && (e.status === 409 || e.code === "MANUAL_ATTENDANCE_OFFLINE_ONLY"));
    results.onlineManualBoundary = true;
    console.log(
      `✓ Correctly rejected manual attendance on ONLINE session with HTTP 409 (${(e as ApiError).code})`,
    );
  }

  // Step 13: Role Boundary — Student cannot read lecturer roster
  console.log("\nStep 13: Testing Role Boundary — Student access to CLS-16...");
  try {
    await studentSession.request(`/api/v1/class-sessions/${durableOfflineSessionId}/attendance`);
    assert.fail("Student should not be able to access lecturer attendance roster");
  } catch (e: unknown) {
    assert.ok(e instanceof ApiError && e.status === 403);
    results.student403 = true;
    console.log("✓ Correctly rejected student access to lecturer attendance with HTTP 403");
  }

  // Step 14: Foreign Ownership Boundary — Student cannot cancel session or publish schedule
  console.log("\nStep 14: Testing Foreign Ownership Boundary...");
  try {
    await studentSession.request(`/api/v1/classes/${fixtureClassId}/sessions/${s1Id}`, {
      method: "PATCH",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: { status: "CANCELLED" },
    });
    assert.fail("Student must not be able to cancel session");
  } catch (e: unknown) {
    assert.ok(e instanceof ApiError && (e.status === 403 || e.status === 401));
    results.foreignOwnershipBoundary = true;
    console.log("✓ Correctly rejected foreign modification attempt with HTTP 403");
  }

  // Step 15: Revoke sessions cleanly
  console.log("\nStep 15: Revoking sessions cleanly...");
  await studentSession.logout();
  await lecturerSession.logout();
  results.logout = true;
  console.log("✓ Sessions revoked cleanly.");

  console.log("\n============================================================");
  console.log("ACCEPTANCE RESULT OBJECT:");
  console.log(JSON.stringify(results, null, 2));
  console.log("============================================================");

  // Assert all required boolean gates are strictly true
  assert.equal(results.contractMapReconciled, true);
  assert.equal(results.schedulePublish, true);
  assert.equal(results.sessionCreate, true);
  assert.equal(results.sessionIdempotency, true);
  assert.equal(results.sessionCancel, true);
  assert.equal(results.presenceTicketSuccess, true);
  assert.equal(results.attendanceRosterRead, true);
  assert.equal(results.manualOfflineAttendance, true);
  assert.equal(results.onlineManualBoundary, true);
  assert.equal(results.student403, true);
  assert.equal(results.foreignOwnershipBoundary, true);
  assert.equal(results.logout, true);
}

main().catch((err) => {
  console.error("\n❌ Acceptance Integration Failed:", err);
  process.exit(1);
});
