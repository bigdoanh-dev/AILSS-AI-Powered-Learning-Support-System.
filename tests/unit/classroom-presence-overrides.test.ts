import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type WebSocket from "ws";
import type { Logger } from "pino";
import type { ActorContext, PresenceTicketClaims } from "../../packages/security/src/index.js";
import type {
  AttendanceRow,
  AttendanceHistoryRow,
  ClassSession,
  PresenceCheckpoint,
} from "../../apps/classroom-service/src/model.js";
import type { ClassroomRepository } from "../../apps/classroom-service/src/repository.js";
import type { ClassroomService } from "../../apps/classroom-service/src/service.js";
import { ClassroomPresence } from "../../apps/classroom-service/src/presence.js";

class Socket extends EventEmitter {
  readyState = 1;
  send = vi.fn((_payload: string) => {});
  close() {
    this.readyState = 3;
    this.emit("close");
  }
}

afterEach(() => vi.useRealTimers());
describe("Online presence with manual attendance override", () => {
  it("keeps the teacher's absence decision when a student connects and disconnects", async () => {
    vi.useFakeTimers();
    const session = {
      sessionId: randomUUID(),
      classId: randomUUID(),
      title: "Online session",
      mode: "ONLINE",
      startAt: new Date(),
      endAt: new Date(Date.now() + 3600000),
    } as ClassSession;
    const studentId = randomUUID();
    const manual: AttendanceRow = {
      sessionId: session.sessionId,
      studentId,
      attendanceStatus: "ABSENT",
      source: "MANUAL_OFFLINE",
      manualNote: "Teacher decision",
      presenceState: "OFFLINE",
      connectedDurationSeconds: 100,
      attendanceVersion: 2,
      updatedAt: new Date(),
    };
    let checkpoint: PresenceCheckpoint | undefined;
    const histories: AttendanceHistoryRow[] = [];
    const repo = {
      presenceCheckpoint: vi.fn(async () => checkpoint),
      writeCheckpoint: vi.fn(async (_old: PresenceCheckpoint | undefined, next: PresenceCheckpoint) => {
        checkpoint = next;
        return true;
      }),
      attendance: vi.fn(async () => manual),
      attendanceBySession: vi.fn(async () => [manual]),
      writeAttendance: vi.fn(async () => false),
      writeAttendanceHistory: vi.fn(async (row: AttendanceHistoryRow) => {
        histories.push(row);
      }),
    };
    const service = {
      authorizePresence: vi.fn(async () => ({ session })),
      attendanceRoster: vi.fn(async () => []),
    };
    const presence = new ClassroomPresence(
      repo as unknown as ClassroomRepository,
      service as unknown as ClassroomService,
      { warn: vi.fn() } as unknown as Logger,
    );
    const observer = new Socket();
    const student = new Socket();
    const ticket = (actorKind: string, sub: string) =>
      ({ actorKind, sub, sessionId: session.sessionId }) as PresenceTicketClaims;
    await presence.accept(
      observer as unknown as WebSocket,
      ticket("LECTURER", randomUUID()),
      {} as ActorContext,
      randomUUID(),
    );
    await presence.accept(
      student as unknown as WebSocket,
      ticket("STUDENT", studentId),
      {} as ActorContext,
      randomUUID(),
    );
    expect(JSON.parse(student.send.mock.calls[0]?.[0] ?? "{}") as unknown).toMatchObject({
      type: "presence.connected",
      data: { attendanceStatus: "ABSENT", presenceState: "ONLINE" },
    });
    expect(JSON.parse(observer.send.mock.lastCall?.[0] ?? "{}") as unknown).toMatchObject({
      type: "roster.delta",
      data: {
        attendanceStatus: "ABSENT",
        source: "MANUAL_OFFLINE",
        presenceState: "ONLINE",
        attendanceVersion: 2,
      },
    });
    await vi.advanceTimersByTimeAsync(1000);
    student.close();
    await vi.waitFor(() => expect(checkpoint?.presenceState).toBe("OFFLINE"));
    await vi.waitFor(() => expect(histories).toHaveLength(2));
    expect(
      histories.every(
        (row) =>
          row.attendanceStatus === "ABSENT" &&
          row.manualNote === "Teacher decision" &&
          row.attendanceVersion === 2,
      ),
    ).toBe(true);
    expect(JSON.parse(observer.send.mock.lastCall?.[0] ?? "{}") as unknown).toMatchObject({
      type: "roster.delta",
      data: { attendanceStatus: "ABSENT", source: "MANUAL_OFFLINE", presenceState: "OFFLINE" },
    });
    observer.close();
  });
});
