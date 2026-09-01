import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  deterministicSessionId,
  inMeetingWindow,
  isValidTimezone,
  materializeRecurrence,
  parseSessionPatch,
  parseSessionWrite,
  sessionDto,
  sessionsOverlap,
  utcDatesTouched,
  wallToInstant,
  zonedDateString,
  type ClassSession,
} from "../../apps/classroom-service/src/model.js";

describe("P7.15B ClassSession model", () => {
  it("locks the ONLINE/OFFLINE conditional write DTO", () => {
    const online = parseSessionWrite({
      title: "Kickoff",
      startAt: "2026-09-07T02:00:00.000Z",
      endAt: "2026-09-07T04:00:00.000Z",
      timezone: "Asia/Ho_Chi_Minh",
      mode: "ONLINE",
      meetingProvider: "meet",
      meetingUrl: "https://meet.example.com/room",
    });
    expect(online.mode).toBe("ONLINE");
    expect(() =>
      parseSessionWrite({
        title: "Missing Link",
        startAt: "2026-09-07T02:00:00.000Z",
        endAt: "2026-09-07T04:00:00.000Z",
        timezone: "Asia/Ho_Chi_Minh",
        mode: "ONLINE",
      }),
    ).toThrow();
    expect(() =>
      parseSessionWrite({
        title: "Offline Without Location",
        startAt: "2026-09-07T02:00:00.000Z",
        endAt: "2026-09-07T04:00:00.000Z",
        timezone: "Asia/Ho_Chi_Minh",
        mode: "OFFLINE",
      }),
    ).toThrow();
    expect(() =>
      parseSessionWrite({
        title: "Extra",
        startAt: "2026-09-07T02:00:00.000Z",
        endAt: "2026-09-07T04:00:00.000Z",
        timezone: "Asia/Ho_Chi_Minh",
        mode: "OFFLINE",
        location: "Hall A",
        state: "SCHEDULED",
      }),
    ).toThrow();
    expect(() =>
      parseSessionWrite({
        title: "Bad Recurrence",
        startAt: "2026-09-07T02:00:00.000Z",
        endAt: "2026-09-07T04:00:00.000Z",
        timezone: "Asia/Ho_Chi_Minh",
        mode: "OFFLINE",
        location: "Hall A",
        recurrence: { frequency: "WEEKLY", interval: 5, until: "2026-12-31" },
      }),
    ).toThrow();
    expect(
      parseSessionWrite({
        title: "Recurring",
        startAt: "2026-09-07T02:00:00.000Z",
        endAt: "2026-09-07T04:00:00.000Z",
        timezone: "Asia/Ho_Chi_Minh",
        mode: "OFFLINE",
        location: "Hall A",
        recurrence: { frequency: "WEEKLY", interval: 4, until: "2026-12-31" },
      }).recurrence,
    ).toMatchObject({ interval: 4 });
  });
  it("locks the session PATCH DTO", () => {
    expect(parseSessionPatch({ status: "CANCELLED" })).toEqual({ status: "CANCELLED" });
    expect(() => parseSessionPatch({})).toThrow();
    expect(() => parseSessionPatch({ status: "COMPLETED" })).toThrow();
    expect(() => parseSessionPatch({ recordVersion: 2 })).toThrow();
  });
  it("never exposes meetingUrl in the session DTO", () => {
    const session = baseSession({
      mode: "ONLINE",
      meetingProvider: "meet",
      meetingUrl: "https://x.example/r",
    });
    const dto = sessionDto(session);
    expect(dto).not.toHaveProperty("meetingUrl");
    expect(dto).toMatchObject({ meetingProvider: "meet" });
    expect(dto).not.toHaveProperty("location");
    const offline = baseSession({ mode: "OFFLINE", location: "Hall B" });
    const offlineDto = sessionDto(offline);
    expect(offlineDto).toMatchObject({ location: "Hall B" });
    expect(offlineDto).not.toHaveProperty("meetingProvider");
  });
  it("validates IANA timezones and rejects offsets", () => {
    expect(isValidTimezone("Asia/Ho_Chi_Minh")).toBe(true);
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("+07:00")).toBe(false);
    expect(isValidTimezone("-0500")).toBe(false);
    expect(isValidTimezone("Not/AZone")).toBe(false);
  });
  it("detects overlap on the same day, allows touching endpoints, and spans midnight", () => {
    const day = (h: number) => new Date(`2026-09-07T${String(h).padStart(2, "0")}:00:00.000Z`);
    expect(sessionsOverlap(day(9), day(11), day(10), day(12))).toBe(true);
    expect(sessionsOverlap(day(9), day(10), day(10), day(11))).toBe(false);
    expect(sessionsOverlap(day(10), day(11), day(9), day(10))).toBe(false);
    const nightStart = new Date("2026-09-07T22:00:00.000Z"),
      nightEnd = new Date("2026-09-08T02:00:00.000Z");
    expect(
      sessionsOverlap(
        nightStart,
        nightEnd,
        new Date("2026-09-08T01:00:00.000Z"),
        new Date("2026-09-08T09:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      sessionsOverlap(
        nightStart,
        nightEnd,
        new Date("2026-09-08T02:00:00.000Z"),
        new Date("2026-09-08T09:00:00.000Z"),
      ),
    ).toBe(false);
  });
  it("writes one projection row per touched UTC date for cross-midnight sessions", () => {
    expect(
      utcDatesTouched(new Date("2026-09-07T02:00:00.000Z"), new Date("2026-09-07T04:00:00.000Z")),
    ).toEqual(["2026-09-07"]);
    expect(
      utcDatesTouched(new Date("2026-09-07T22:00:00.000Z"), new Date("2026-09-08T02:00:00.000Z")),
    ).toEqual(["2026-09-07", "2026-09-08"]);
    expect(
      utcDatesTouched(new Date("2026-09-07T22:00:00.000Z"), new Date("2026-09-08T00:00:00.000Z")),
    ).toEqual(["2026-09-07"]);
  });
  it("opens the meetingUrl window exactly from startAt-30m through endAt+15m", () => {
    const start = new Date("2026-09-07T02:00:00.000Z"),
      end = new Date("2026-09-07T04:00:00.000Z");
    expect(inMeetingWindow(start, end, new Date("2026-09-07T01:29:59.999Z"))).toBe(false);
    expect(inMeetingWindow(start, end, new Date("2026-09-07T01:30:00.000Z"))).toBe(true);
    expect(inMeetingWindow(start, end, new Date("2026-09-07T03:00:00.000Z"))).toBe(true);
    expect(inMeetingWindow(start, end, new Date("2026-09-07T04:15:00.000Z"))).toBe(true);
    expect(inMeetingWindow(start, end, new Date("2026-09-07T04:15:00.001Z"))).toBe(false);
  });
  it("derives deterministic session UUIDs from the operation", () => {
    const operationId = randomUUID();
    const a = deterministicSessionId("secret", operationId, 0),
      b = deterministicSessionId("secret", operationId, 0),
      c = deterministicSessionId("secret", operationId, 1),
      d = deterministicSessionId("other", operationId, 0);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  });
  it("materializes wall-clock weekly recurrences deterministically within caps", () => {
    const base = {
      startAt: new Date("2026-09-07T02:00:00.000Z"),
      endAt: new Date("2026-09-07T04:00:00.000Z"),
      timezone: "Asia/Ho_Chi_Minh",
    };
    const weekly = materializeRecurrence(base, { interval: 1, until: "2026-09-28" });
    expect(weekly).not.toBe("RECURRENCE_OVERFLOW");
    if (weekly === "RECURRENCE_OVERFLOW") return;
    expect(weekly).toHaveLength(4);
    expect(weekly.map((v) => v.startAt.toISOString())).toEqual([
      "2026-09-07T02:00:00.000Z",
      "2026-09-14T02:00:00.000Z",
      "2026-09-21T02:00:00.000Z",
      "2026-09-28T02:00:00.000Z",
    ]);
    expect(weekly.every((v) => v.endAt.getTime() - v.startAt.getTime() === 2 * 3_600_000)).toBe(true);
    const again = materializeRecurrence(base, { interval: 1, until: "2026-09-28" });
    expect(again).toEqual(weekly);
    const biweekly = materializeRecurrence(base, { interval: 2, until: "2026-10-05" });
    if (biweekly === "RECURRENCE_OVERFLOW") throw new Error("unexpected overflow");
    expect(biweekly.map((v) => v.startAt.toISOString().slice(0, 10))).toEqual([
      "2026-09-07",
      "2026-09-21",
      "2026-10-05",
    ]);
    expect(materializeRecurrence(base, { interval: 1, until: "2030-01-01" }, 3)).toBe("RECURRENCE_OVERFLOW");
    const yearly = materializeRecurrence(base, { interval: 4, until: "2030-01-01" });
    if (yearly === "RECURRENCE_OVERFLOW") throw new Error("unexpected overflow");
    expect(yearly.length).toBeLessThanOrEqual(14);
    const last = yearly.at(-1);
    if (!last) throw new Error("missing instances");
    expect(last.startAt.getTime()).toBeLessThan(base.startAt.getTime() + 366 * 86_400_000);
  });
  it("keeps wall-clock time stable across DST transitions", () => {
    const base = {
      startAt: new Date("2026-10-19T13:00:00.000Z"),
      endAt: new Date("2026-10-19T15:00:00.000Z"),
      timezone: "America/New_York",
    };
    expect(zonedDateString(base.startAt, base.timezone)).toBe("2026-10-19");
    const instances = materializeRecurrence(base, { interval: 1, until: "2026-11-09" });
    if (instances === "RECURRENCE_OVERFLOW") throw new Error("unexpected overflow");
    expect(instances.map((v) => v.startAt.toISOString())).toEqual([
      "2026-10-19T13:00:00.000Z",
      "2026-10-26T13:00:00.000Z",
      "2026-11-02T14:00:00.000Z",
      "2026-11-09T14:00:00.000Z",
    ]);
    for (const v of instances)
      expect(zonedDateString(v.startAt, base.timezone)).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });
  it("resolves wall-clock times to canonical instants for fixed offsets", () => {
    const instant = wallToInstant(
      { year: 2026, month: 9, day: 7, hour: 9, minute: 0, second: 0 },
      "Asia/Ho_Chi_Minh",
    );
    expect(instant.toISOString()).toBe("2026-09-07T02:00:00.000Z");
    expect(zonedDateString(instant, "Asia/Ho_Chi_Minh")).toBe("2026-09-07");
    expect(
      wallToInstant({ year: 2026, month: 9, day: 7, hour: 9, minute: 0, second: 0 }, "UTC").toISOString(),
    ).toBe("2026-09-07T09:00:00.000Z");
  });
});

function baseSession(overrides: Partial<ClassSession> = {}): ClassSession {
  const now = new Date("2026-09-01T00:00:00.000Z");
  return {
    sessionId: randomUUID(),
    classId: randomUUID(),
    title: "Session",
    startAt: new Date("2026-09-07T02:00:00.000Z"),
    endAt: new Date("2026-09-07T04:00:00.000Z"),
    mode: "ONLINE",
    status: "DRAFT",
    timezone: "Asia/Ho_Chi_Minh",
    scheduleVersion: 0,
    recordVersion: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
