import { describe, expect, it } from "vitest";
import {
  attendanceDto,
  manualAttendanceDto,
  parseAttendanceMonth,
  parseManualAttendance,
} from "../../apps/classroom-service/src/model.js";
import { checkpointWriteAllowed, presenceHydration } from "../../apps/classroom-service/src/presence.js";

describe("P7.18 attendance contracts", () => {
  it("accepts only the exact private YYYY-MM selector", () => {
    expect(parseAttendanceMonth("2026-08")).toBe("2026-08");
    expect(() => parseAttendanceMonth("2026-8")).toThrow();
    expect(() => parseAttendanceMonth("2026-13")).toThrow();
    expect(() => parseAttendanceMonth("2026-08-01")).toThrow();
  });

  it("keeps roster output bounded and free of provider internals", () => {
    const output = attendanceDto({
      sessionId: crypto.randomUUID(),
      studentId: crypto.randomUUID(),
      attendanceStatus: "PRESENT",
      source: "ONLINE_PRESENCE",
      presenceState: "OFFLINE",
      connectedDurationSeconds: 12,
      attendanceVersion: 2,
      updatedAt: new Date(),
    });
    expect(output).toMatchObject({
      attendanceStatus: "PRESENT",
      presenceState: "OFFLINE",
      connectedDurationSeconds: 12,
    });
    expect(output).not.toHaveProperty("meetingUrl");
    expect(output).not.toHaveProperty("ticket");
  });

  it("rejects stale disconnect ownership after a newer reconnect checkpoint", () => {
    const durable = {
      sessionId: crypto.randomUUID(),
      studentId: crypto.randomUUID(),
      presenceState: "ONLINE" as const,
      activeConnectionCount: 1,
      accumulatedDurationSeconds: 20,
      checkpointVersion: 8,
      updatedAt: new Date(),
    };
    expect(checkpointWriteAllowed(7, durable)).toBe(false);
    expect(checkpointWriteAllowed(8, durable)).toBe(true);
  });

  it("hydrates stale ONLINE state without trusting a crashed process connection count", () => {
    const now = new Date();
    const recovered = presenceHydration(
      {
        sessionId: crypto.randomUUID(),
        studentId: crypto.randomUUID(),
        presenceState: "ONLINE",
        activeConnectionCount: 3,
        accumulatedDurationSeconds: 90,
        checkpointVersion: 4,
        updatedAt: new Date(now.getTime() - 46_000),
      },
      now,
    );
    expect(recovered).toEqual({ activeConnectionCount: 0, staleOnline: true });
  });

  it("keeps manual notes strict and exposes them only in CLS-19 output", () => {
    expect(parseManualAttendance({ attendanceStatus: "EXCUSED", note: "Approved absence" })).toEqual({
      attendanceStatus: "EXCUSED",
      note: "Approved absence",
    });
    expect(() => parseManualAttendance({ attendanceStatus: "PRESENT", source: "MANUAL_OFFLINE" })).toThrow();
    const output = manualAttendanceDto({
      sessionId: crypto.randomUUID(),
      studentId: crypto.randomUUID(),
      attendanceStatus: "EXCUSED",
      source: "MANUAL_OFFLINE",
      manualNote: "Approved absence",
      presenceState: "OFFLINE",
      connectedDurationSeconds: 0,
      attendanceVersion: 2,
      updatedAt: new Date(),
    });
    expect(output).toMatchObject({ source: "MANUAL_OFFLINE", note: "Approved absence" });
    expect(
      attendanceDto({
        sessionId: output.sessionId,
        studentId: output.studentId,
        attendanceStatus: "EXCUSED",
        source: "MANUAL_OFFLINE",
        manualNote: "Approved absence",
        presenceState: "OFFLINE",
        connectedDurationSeconds: 0,
        attendanceVersion: 2,
        updatedAt: new Date(),
      }),
    ).not.toHaveProperty("note");
  });
});
