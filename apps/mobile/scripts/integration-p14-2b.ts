// Explicit local-only dev smoke for P14.2B Student Mobile - Classroom & Schedule.
// No credentials, passwords, or bearer tokens are printed or persisted.
// Read-only execution with zero mutations to live classroom data.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Transport, ApiError } from "../src/api";
import { Session } from "../src/session";
import {
  studentClasses,
  classDetail,
  classSessions,
  sessionDetail,
  studentSchedule,
  studentAttendance,
  getDateRangeForSchedule,
} from "../src/classroom";

async function main() {
  const origin = process.env.AILSS_MOBILE_TEST_ORIGIN;
  if (!origin || new URL(origin).hostname !== "127.0.0.1" || new URL(origin).protocol !== "http:") {
    throw Error("Explicit loopback dev origin required (e.g. http://127.0.0.1:8080)");
  }
  if (!process.env.AILSS_MOBILE_TEST_EMAIL || !process.env.AILSS_MOBILE_TEST_PASSWORD) {
    throw Error("Dev account credentials required in env");
  }

  let saved: string | null = null;
  const api = new Transport(origin);
  const session = new Session(api, {
    read: async () => saved,
    write: async (value) => {
      saved = value;
    },
    clear: async () => {
      saved = null;
    },
  });

  try {
    // 1. Authenticate Student
    await session.login(process.env.AILSS_MOBILE_TEST_EMAIL, process.env.AILSS_MOBILE_TEST_PASSWORD);
    assert.equal(session.snapshot.state, "AUTHENTICATED");
    assert.equal(session.snapshot.user?.role, "STUDENT");

    // 2. Read Student Classes (CLS-05)
    const myClasses = studentClasses(await session.request("/api/v1/me/classes"));
    assert.ok(Array.isArray(myClasses), "CLS-05 must return array of classes");
    assert.ok(myClasses.length >= 2, "Student should be member of at least 2 classes");
    const targetClass = myClasses[0];

    // 3. Read Class Detail (CLS-02)
    const detail = classDetail(await session.request(`/api/v1/classes/${targetClass.classId}`));
    assert.equal(detail.classId, targetClass.classId, "CLS-02 should return requested classId");
    assert.equal(detail.name, targetClass.name);

    // 4. Read Class Sessions Schedule (CLS-13) within 30-day window
    const range = getDateRangeForSchedule(new Date(), 30);
    const sessions = classSessions(
      await session.request(
        `/api/v1/classes/${targetClass.classId}/sessions?from=${range.from}&to=${range.to}`,
      ),
    );
    assert.ok(Array.isArray(sessions), "CLS-13 must return array of sessions");
    assert.ok(sessions.length > 0, "Class should have at least 1 session scheduled");
    const targetSession = sessions[0];

    // 5. Read Student Confirmed Schedule (CLS-15)
    const schedule = studentSchedule(
      await session.request(`/api/v1/me/schedule?from=${range.from}&to=${range.to}`),
    );
    assert.ok(Array.isArray(schedule), "CLS-15 must return array of schedule entries");
    assert.ok(schedule.length >= 2, "Student schedule should have at least 2 entries");
    // Verify CLS-15 privacy rule: meetingUrl must NOT be included in CLS-15 response
    const rawSchedule = JSON.stringify(schedule);
    assert.ok(!rawSchedule.includes('"meetingUrl"'), "CLS-15 must not leak meetingUrl in schedule overview");

    // 6. Read Session Detail (CLS-14)
    const sessDetail = sessionDetail(
      await session.request(`/api/v1/class-sessions/${targetSession.sessionId}`),
    );
    assert.equal(sessDetail.sessionId, targetSession.sessionId, "CLS-14 should match target sessionId");
    assert.equal(sessDetail.classId, targetClass.classId, "CLS-14 classId should match");

    // 7. Read Student Attendance History (CLS-17)
    const currentMonth = targetSession.startAt.slice(0, 7);
    const attendance = studentAttendance(
      await session.request(`/api/v1/me/attendance?month=${currentMonth}`),
    );
    assert.ok(Array.isArray(attendance), "CLS-17 must return attendance array");

    // 8. Security Boundary: Student Forbidden on Lecturer Attendance Roster (CLS-16)
    let rosterRejectedWith403 = false;
    try {
      await session.request(`/api/v1/class-sessions/${targetSession.sessionId}/attendance`);
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 403) {
        rosterRejectedWith403 = true;
      }
    }
    assert.ok(
      rosterRejectedWith403,
      "Student must be rejected with 403 on Lecturer attendance roster (CLS-16)",
    );

    // 9. Security Boundary: Accessing an unjoined/unauthorized classId
    const unauthorizedClassId = crypto.randomUUID();
    let unjoinedAccessForbiddenOrNotFound = false;
    try {
      await session.request(`/api/v1/classes/${unauthorizedClassId}`);
    } catch (e: unknown) {
      if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
        unjoinedAccessForbiddenOrNotFound = true;
      }
    }
    assert.ok(
      unjoinedAccessForbiddenOrNotFound,
      "Unjoined or nonexistent class must fail closed with 403 or 404",
    );

    // 10. Schedule 31-Day Range Bound Enforcement (CLS-15)
    let rangeRejectedWith400 = false;
    try {
      await session.request("/api/v1/me/schedule?from=2026-09-01&to=2026-10-15");
    } catch (e: unknown) {
      if (e instanceof ApiError && e.status === 400) {
        rangeRejectedWith400 = true;
      }
    }
    assert.ok(rangeRejectedWith400, "Schedule queries exceeding 31 days must be rejected with 400");

    // 11. Logout cleanly
    await session.logout();
    assert.equal(saved, null);

    console.log(
      JSON.stringify({
        status: "PASS",
        p14_2b_student_classroom_schedule: true,
        classesCount: myClasses.length,
        targetClassId: targetClass.classId,
        targetClassName: targetClass.name,
        sessionsCount: sessions.length,
        scheduleCount: schedule.length,
        targetSessionId: targetSession.sessionId,
        attendanceRecordsCount: attendance.length,
        cls16_roster_forbidden_403: rosterRejectedWith403,
        unjoined_class_boundary: unjoinedAccessForbiddenOrNotFound,
        cls15_31day_bound_enforced: rangeRejectedWith400,
        cls15_privacy_preserved: true,
        logout: true,
      }),
    );
  } finally {
    if (saved) await session.logout().catch(() => {});
  }
}

void main().catch((error) => {
  console.error("P14.2B Integration failed:", error instanceof Error ? error.stack : "Unknown");
  process.exitCode = 1;
});
