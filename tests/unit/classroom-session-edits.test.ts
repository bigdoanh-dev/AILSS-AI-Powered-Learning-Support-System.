import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ClassroomService } from "../../apps/classroom-service/src/service.js";
import { ClassroomRepository } from "../../apps/classroom-service/src/repository.js";
import type { ClassroomClients } from "../../apps/classroom-service/src/clients.js";
import type { ActorContext } from "../../packages/security/src/index.js";
import type { CassandraClient } from "../../packages/cassandra/src/index.js";
import type {
  AttendanceRow,
  AttendanceHistoryRow,
  ClassSession,
  ClassroomClass,
  CommandReceipt,
  ScheduleReservation,
  ScheduleSegment,
} from "../../apps/classroom-service/src/model.js";

function fixture() {
  const student = { userId: randomUUID(), roles: ["STUDENT"] } as ActorContext;
  const lecturer = { userId: randomUUID(), roles: ["LECTURER"] } as ActorContext;
  const klass: ClassroomClass = {
    classId: randomUUID(),
    ownerLecturerId: lecturer.userId,
    name: "Lớp kiểm thử",
    classKind: "INSTITUTIONAL",
    scheduleState: "PUBLISHED",
    scheduleVersion: 1,
    maxMembers: 20,
    state: "ACTIVE",
    activeCodeHash: "hash",
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const session: ClassSession = {
    sessionId: randomUUID(),
    classId: klass.classId,
    title: "Buổi học online",
    mode: "ONLINE",
    timezone: "Asia/Ho_Chi_Minh",
    startAt: new Date("2030-01-01T02:00:00Z"),
    endAt: new Date("2030-01-01T03:00:00Z"),
    status: "SCHEDULED",
    scheduleVersion: 1,
    recordVersion: 1,
    meetingProvider: "CUSTOM",
    meetingUrl: "https://meet.example.com/room",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const sessions = new Map([[session.sessionId, session]]);
  const commands = new Map<
    string,
    { operationId: string; resourceId: string; status: string; receipt: CommandReceipt }
  >();
  const memberships = [{ studentId: student.userId, classId: klass.classId, state: "ACTIVE" }];
  let attendance: AttendanceRow | undefined;
  let history: AttendanceHistoryRow | undefined;
  let reservation: ScheduleReservation | undefined;
  let segments: ScheduleSegment[] = [];
  let manifest = {
    scheduleVersion: 1,
    sessionCount: 1,
    checksum: createHash("sha256").update(session.sessionId).digest("hex"),
    firstStartAt: session.startAt,
    lastEndAt: session.endAt,
    publishedAt: new Date(),
  };
  const repo = {
    getClass: vi.fn(async () => klass),
    getSession: vi.fn(async (id: string) => sessions.get(id)),
    listClassSessionIds: vi.fn(async () => [...sessions.keys()]),
    listStudent: vi.fn(async () => [klass]),
    roster: vi.fn(async () => memberships),
    membership: vi.fn(async () => memberships[0]),
    daySchedule: vi.fn(async () => []),
    listDatePartition: vi.fn(async () => [...sessions.values()]),
    countDatePartition: vi.fn(async () => 0),
    reserve: vi.fn(
      async (
        scope: string,
        _hash: number,
        key: string,
        operationId: string,
        resourceId: string,
        receipt: CommandReceipt,
      ) => {
        if (!commands.has(scope + key))
          commands.set(scope + key, { operationId, resourceId, receipt, status: "IN_PROGRESS" });
      },
    ),
    command: vi.fn(async (scope: string, _hash: number, key: string) => commands.get(scope + key)),
    checkpoint: vi.fn(
      async (scope: string, _hash: number, key: string, _operation: string, receipt: CommandReceipt) => {
        const command = commands.get(scope + key);
        if (!command) throw new Error("Missing command");
        command.receipt = receipt;
      },
    ),
    complete: vi.fn(
      async (scope: string, _hash: number, key: string, _operation: string, receipt: CommandReceipt) => {
        const command = commands.get(scope + key);
        if (!command) throw new Error("Missing command");
        Object.assign(command, { receipt, status: "COMPLETE" });
      },
    ),
    updateSession: vi.fn(async (_old: ClassSession, next: ClassSession) => {
      sessions.set(next.sessionId, next);
      return true;
    }),
    cancelSession: vi.fn(async (_old: ClassSession, next: ClassSession) => {
      sessions.set(next.sessionId, next);
      return true;
    }),
    deleteSessionProjections: vi.fn(async () => {}),
    insertSessionProjections: vi.fn(async () => {}),
    updateSessionProjectionStatus: vi.fn(async () => {}),
    writeManifest: vi.fn(async (value: typeof manifest) => {
      manifest = value;
    }),
    getManifest: vi.fn(async () => manifest),
    attendance: vi.fn(async () => attendance),
    writeManualAttendance: vi.fn(async (_old: AttendanceRow | undefined, next: AttendanceRow) => {
      attendance = next;
      return true;
    }),
    writeAttendanceHistory: vi.fn(async (value: AttendanceHistoryRow) => {
      history = value;
    }),
    attendanceHistoryEntry: vi.fn(async () => history),
    prepareEvent: vi.fn(async () => {}),
    readyEvent: vi.fn(async () => {}),
    getReservation: vi.fn(async () => reservation),
    createReservation: vi.fn(async (value: ScheduleReservation) => {
      reservation = value;
    }),
    writeReservationSegments: vi.fn(async (value: ScheduleSegment[]) => {
      segments = value;
    }),
    reservationSegments: vi.fn(async () => segments),
    acquireScheduleGuard: vi.fn(async () => ({ acquired: true, fence: 1 })),
    releaseScheduleGuard: vi.fn(async () => {}),
    putHeldSegment: vi.fn(async () => {}),
    getDaySegment: vi.fn(async () => undefined),
    transitionReservation: vi.fn(async (value: ScheduleReservation, state: ScheduleReservation["state"]) => {
      reservation = { ...value, state };
    }),
    enqueueReservationExpiry: vi.fn(async () => {}),
  };
  const service = new ClassroomService(
    repo as unknown as ClassroomRepository,
    { lecturer: async () => ({}) } as unknown as ClassroomClients,
    "test-secret",
  );
  const update = (request: { status?: "CANCELLED"; startAt?: string; endAt?: string }, key = randomUUID()) =>
    service.updateSession({
      classId: klass.classId,
      sessionId: session.sessionId,
      actor: lecturer,
      request,
      key,
      requestId: randomUUID(),
    });
  return {
    service,
    repo,
    student,
    lecturer,
    klass,
    session,
    sessions,
    update,
    setAttendance: (value: AttendanceRow) => {
      attendance = value;
    },
  };
}

describe("Session edits and manual online attendance", () => {
  it("shows the new time to enrolled students and repairs the published manifest", async () => {
    const f = fixture();
    await f.update({ startAt: "2030-01-02T02:00:00Z", endAt: "2030-01-02T03:00:00Z" });
    expect(await f.service.studentSchedule(f.student, "2030-01-01", "2030-01-01")).toEqual([]);
    expect(await f.service.studentSchedule(f.student, "2030-01-02", "2030-01-02")).toMatchObject([
      { sessionId: f.session.sessionId, startAt: "2030-01-02T02:00:00.000Z" },
    ]);
    expect(await f.repo.getManifest()).toMatchObject({
      sessionCount: 1,
      firstStartAt: new Date("2030-01-02T02:00:00Z"),
    });
    expect(
      await f.service.listSessions(f.klass.classId, f.lecturer, randomUUID(), "2030-01-01", "2030-01-01"),
    ).toEqual([]);
  });

  it("removes a cancelled session from student schedules, repairs the manifest and replays safely", async () => {
    const f = fixture();
    const key = randomUUID();
    await f.update({ status: "CANCELLED" }, key);
    expect(await f.service.studentSchedule(f.student, "2030-01-01", "2030-01-01")).toEqual([]);
    expect(await f.repo.getManifest()).toMatchObject({
      sessionCount: 0,
      checksum: createHash("sha256").update("").digest("hex"),
    });
    expect((await f.update({ status: "CANCELLED" }, key)).replayed).toBe(true);
    expect(f.repo.cancelSession).toHaveBeenCalledTimes(1);
    await expect(
      f.service.reserveSchedule({
        operationId: randomUUID(),
        offeringId: randomUUID(),
        studentId: f.student.userId,
        classId: f.klass.classId,
      }),
    ).rejects.toMatchObject({ code: "CLASS_SCHEDULE_NOT_AVAILABLE", status: 409 });
  });

  it("recovers cancellation after an interrupted manifest write", async () => {
    const f = fixture();
    f.repo.writeManifest.mockRejectedValueOnce(new Error("interrupted manifest"));
    const key = randomUUID();
    await expect(f.update({ status: "CANCELLED" }, key)).rejects.toThrow("interrupted manifest");
    await f.update({ status: "CANCELLED" }, key);
    expect(await f.repo.getManifest()).toMatchObject({ sessionCount: 0 });
  });

  it("lets the owner edit a future meeting URL while hiding it from students before the meeting window", async () => {
    const f = fixture();
    expect(await f.service.sessionDetail(f.session.sessionId, f.lecturer, randomUUID())).toHaveProperty(
      "meetingUrl",
      f.session.meetingUrl,
    );
    expect(await f.service.sessionDetail(f.session.sessionId, f.student, randomUUID())).not.toHaveProperty(
      "meetingUrl",
    );
  });

  it("overrides automatic attendance and keeps online evidence and the student's history", async () => {
    const f = fixture();
    const joined = new Date("2030-01-01T02:00:00Z");
    f.setAttendance({
      sessionId: f.session.sessionId,
      studentId: f.student.userId,
      attendanceStatus: "PRESENT",
      source: "ONLINE_PRESENCE",
      presenceState: "ONLINE",
      firstJoinedAt: joined,
      lastJoinedAt: joined,
      lastSeenAt: joined,
      connectedDurationSeconds: 600,
      attendanceVersion: 4,
      updatedAt: joined,
    });
    const input = {
      sessionId: f.session.sessionId,
      studentId: f.student.userId,
      actor: f.lecturer,
      request: { attendanceStatus: "ABSENT" as const, note: "Giảng viên xác nhận" },
      key: randomUUID(),
      requestId: randomUUID(),
    };
    const result = await f.service.manualAttendance(input);
    expect(result.data).toMatchObject({
      attendanceStatus: "ABSENT",
      source: "MANUAL_OFFLINE",
      presenceState: "ONLINE",
      connectedDurationSeconds: 600,
      attendanceVersion: 5,
    });
    expect(await f.repo.attendance()).toMatchObject({ firstJoinedAt: joined });
    expect(await f.repo.attendanceHistoryEntry()).toMatchObject({
      mode: "ONLINE",
      attendanceStatus: "ABSENT",
      firstJoinedAt: joined,
      attendanceVersion: 5,
    });
    expect((await f.service.manualAttendance(input)).replayed).toBe(true);
    expect(f.repo.writeManualAttendance).toHaveBeenCalledTimes(1);
  });

  it("uses a version/source conditional write to override an automatic attendance row", async () => {
    const execute = vi.fn(async (_query: string, _params: unknown[]) => [{ "[applied]": true }]);
    const repo = new ClassroomRepository({ execute } as unknown as CassandraClient);
    const old: AttendanceRow = {
      sessionId: randomUUID(),
      studentId: randomUUID(),
      attendanceStatus: "PRESENT",
      source: "ONLINE_PRESENCE",
      presenceState: "ONLINE",
      connectedDurationSeconds: 60,
      attendanceVersion: 2,
      updatedAt: new Date(),
    };
    expect(
      await repo.writeManualAttendance(old, {
        ...old,
        source: "MANUAL_OFFLINE",
        attendanceStatus: "ABSENT",
        attendanceVersion: 3,
      }),
    ).toBe(true);
    expect(execute.mock.calls[0]?.[0]).toContain("IF attendance_version=? AND source=?");
    expect(execute.mock.calls[0]?.[1]).toContain("ONLINE_PRESENCE");
  });

  it("does not let a presence checkpoint overwrite a manual decision", async () => {
    const execute = vi.fn(async (query: string) =>
      query.startsWith("SELECT")
        ? [{ attendance_version: 3, source: "MANUAL_OFFLINE" }]
        : [{ "[applied]": false }],
    );
    const repo = new ClassroomRepository({ execute } as unknown as CassandraClient);
    await expect(
      repo.writeAttendance({
        sessionId: randomUUID(),
        studentId: randomUUID(),
        attendanceStatus: "PRESENT",
        source: "ONLINE_PRESENCE",
        presenceState: "ONLINE",
        connectedDurationSeconds: 80,
        attendanceVersion: 4,
        updatedAt: new Date(),
      }),
    ).resolves.toBe(false);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0]?.[0]).toContain("AND source='ONLINE_PRESENCE'");
  });
});
