import { describe, it, expect } from "vitest";
import {
  studentClass,
  studentClasses,
  classDetail,
  classSession,
  classSessions,
  sessionDetail,
  studentScheduleEntry,
  studentSchedule,
  studentAttendanceEntry,
  studentAttendance,
  parseTimestamp,
  formatDate,
  formatTime,
  formatTimeRange,
  sortChronological,
  filterUpcoming,
  filterPast,
  nextUpcomingSession,
  groupSessionsByDay,
  formatDateQueryParam,
  getDateRangeForSchedule,
  safeMeetingUrl,
} from "../src/classroom";
import { ApiError } from "../src/api";

const sampleClass = {
  classId: "cd86971d-1e29-48cb-a614-53bad87eda8c",
  name: "Nhóm thực hành web 2",
  linkedCourseId: "c-1",
  ownerLecturerId: "l-1",
  classKind: "OFFLINE",
  scheduleState: "PUBLISHED",
  scheduleVersion: 1,
  maxMembers: 50,
  state: "ACTIVE",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const sampleSession = {
  sessionId: "4be22f54-f501-4506-828c-6fb5dfc57df9",
  classId: "cd86971d-1e29-48cb-a614-53bad87eda8c",
  title: "Buổi 1: Tổng quan React Native",
  startAt: "2026-09-16T07:00:00.000Z",
  endAt: "2026-09-16T09:00:00.000Z",
  timezone: "Asia/Ho_Chi_Minh",
  mode: "ONLINE",
  status: "SCHEDULED",
  location: undefined,
  meetingProvider: "Google Meet",
  meetingUrl: "https://meet.google.com/abc-defg-hij",
  inMeetingWindow: true,
  scheduleVersion: 1,
  recordVersion: 1,
};

const sampleScheduleEntry = {
  sessionId: "4be22f54-f501-4506-828c-6fb5dfc57df9",
  classId: "cd86971d-1e29-48cb-a614-53bad87eda8c",
  className: "Nhóm thực hành web 2",
  title: "Buổi 1: Tổng quan React Native",
  startAt: "2026-09-16T07:00:00.000Z",
  endAt: "2026-09-16T09:00:00.000Z",
  mode: "ONLINE",
  timezone: "Asia/Ho_Chi_Minh",
  scheduleVersion: 1,
};

const sampleAttendanceEntry = {
  sessionId: "4be22f54-f501-4506-828c-6fb5dfc57df9",
  classId: "cd86971d-1e29-48cb-a614-53bad87eda8c",
  title: "Buổi 1: Tổng quan React Native",
  mode: "ONLINE",
  startAt: "2026-09-16T07:00:00.000Z",
  attendanceStatus: "PRESENT",
  connectedDurationSeconds: 3600,
  attendanceVersion: 1,
};

describe("StudentClass decoder", () => {
  it("decodes a valid student class", () => {
    const result = studentClass(sampleClass);
    expect(result.classId).toBe("cd86971d-1e29-48cb-a614-53bad87eda8c");
    expect(result.name).toBe("Nhóm thực hành web 2");
    expect(result.classKind).toBe("OFFLINE");
    expect(result.maxMembers).toBe(50);
  });

  it("throws on missing classId", () => {
    expect(() => studentClass({ name: "Web 1" })).toThrow(ApiError);
  });

  it("throws on missing name", () => {
    expect(() => studentClass({ classId: "123" })).toThrow(ApiError);
  });

  it("decodes array of classes in data wrapper or plain array", () => {
    expect(studentClasses({ data: [sampleClass] })).toHaveLength(1);
    expect(studentClasses([sampleClass])).toHaveLength(1);
    expect(studentClasses({ items: [sampleClass] })).toHaveLength(1);
  });

  it("throws when class list payload is neither array nor wrapped", () => {
    expect(() => studentClasses({ other: 123 })).toThrow(ApiError);
  });

  it("decodes classDetail for wrapped or direct object", () => {
    expect(classDetail({ data: sampleClass }).classId).toBe(sampleClass.classId);
    expect(classDetail(sampleClass).classId).toBe(sampleClass.classId);
  });
});

describe("ClassSession decoder", () => {
  it("decodes a valid session", () => {
    const result = classSession(sampleSession);
    expect(result.sessionId).toBe("4be22f54-f501-4506-828c-6fb5dfc57df9");
    expect(result.title).toBe("Buổi 1: Tổng quan React Native");
    expect(result.mode).toBe("ONLINE");
    expect(result.inMeetingWindow).toBe(true);
    expect(result.meetingUrl).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("throws on missing required fields", () => {
    expect(() => classSession({ sessionId: "123" })).toThrow(ApiError);
    expect(() => classSession({ ...sampleSession, startAt: 123 })).toThrow(ApiError);
  });

  it("decodes classSessions in data wrapper or array", () => {
    expect(classSessions({ data: [sampleSession] })).toHaveLength(1);
    expect(classSessions([sampleSession])).toHaveLength(1);
  });

  it("decodes sessionDetail for wrapped or direct object", () => {
    expect(sessionDetail({ data: sampleSession }).sessionId).toBe(sampleSession.sessionId);
    expect(sessionDetail(sampleSession).sessionId).toBe(sampleSession.sessionId);
  });
});

describe("StudentSchedule decoder", () => {
  it("decodes valid schedule entry", () => {
    const result = studentScheduleEntry(sampleScheduleEntry);
    expect(result.sessionId).toBe(sampleScheduleEntry.sessionId);
    expect(result.className).toBe("Nhóm thực hành web 2");
    expect(result.scheduleVersion).toBe(1);
  });

  it("decodes studentSchedule array from data envelope", () => {
    const list = studentSchedule({ data: [sampleScheduleEntry] });
    expect(list).toHaveLength(1);
    expect(list[0].className).toBe("Nhóm thực hành web 2");
  });

  it("throws on invalid schedule entry format", () => {
    expect(() => studentScheduleEntry({ title: "No sessionId" })).toThrow(ApiError);
  });
});

describe("StudentAttendance decoder", () => {
  it("decodes valid attendance entry", () => {
    const result = studentAttendanceEntry(sampleAttendanceEntry);
    expect(result.sessionId).toBe(sampleAttendanceEntry.sessionId);
    expect(result.attendanceStatus).toBe("PRESENT");
    expect(result.connectedDurationSeconds).toBe(3600);
  });

  it("decodes studentAttendance array from data wrapper", () => {
    const list = studentAttendance({ data: [sampleAttendanceEntry] });
    expect(list).toHaveLength(1);
    expect(list[0].attendanceStatus).toBe("PRESENT");
  });
});

describe("Date/Time utilities & Schedule helpers", () => {
  it("parses valid ISO timestamps and throws on invalid", () => {
    const d = parseTimestamp("2026-09-16T07:00:00.000Z");
    expect(d.toISOString()).toBe("2026-09-16T07:00:00.000Z");
    expect(() => parseTimestamp("not-a-date")).toThrow(ApiError);
    expect(() => parseTimestamp("")).toThrow(ApiError);
  });

  it("formats date deterministically in vi-VN locale", () => {
    const d = new Date("2026-09-16T07:00:00.000Z");
    const formatted = formatDate(d, "Asia/Ho_Chi_Minh");
    expect(formatted).toContain("2026");
    expect(formatted).toContain("16");
    expect(formatted).toContain("09");
  });

  it("formats time and time range accurately with timezone", () => {
    const start = new Date("2026-09-16T00:00:00.000Z"); // 07:00 in +07
    const end = new Date("2026-09-16T02:00:00.000Z"); // 09:00 in +07
    expect(formatTime(start, "Asia/Ho_Chi_Minh")).toBe("07:00");
    const range = formatTimeRange(start, end, "Asia/Ho_Chi_Minh");
    expect(range).toContain("07:00");
    expect(range).toContain("09:00");
    expect(range).toContain("Asia/Ho_Chi_Minh");
    expect(formatDateQueryParam(start)).toBe("2026-09-16");
  });

  it("sorts sessions chronologically ascending", () => {
    const s1 = { startAt: "2026-09-16T10:00:00.000Z" };
    const s2 = { startAt: "2026-09-15T08:00:00.000Z" };
    const s3 = { startAt: "2026-09-17T09:00:00.000Z" };
    const sorted = sortChronological([s1, s2, s3]);
    expect(sorted[0].startAt).toBe(s2.startAt);
    expect(sorted[1].startAt).toBe(s1.startAt);
    expect(sorted[2].startAt).toBe(s3.startAt);
  });

  it("filters upcoming and past sessions accurately relative to reference time", () => {
    const now = new Date("2026-09-16T00:00:00.000Z");
    const past = { startAt: "2026-09-15T07:00:00.000Z", endAt: "2026-09-15T09:00:00.000Z" };
    const future = { startAt: "2026-09-16T07:00:00.000Z", endAt: "2026-09-16T09:00:00.000Z" };
    const list = [past, future];

    const upcoming = filterUpcoming(list, now);
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].startAt).toBe(future.startAt);

    const pastList = filterPast(list, now);
    expect(pastList).toHaveLength(1);
    expect(pastList[0].startAt).toBe(past.startAt);

    const next = nextUpcomingSession(list, now);
    expect(next?.startAt).toBe(future.startAt);
  });

  it("groups sessions by day deterministically", () => {
    const s1 = { startAt: "2026-09-16T01:00:00.000Z", id: "1" };
    const s2 = { startAt: "2026-09-16T05:00:00.000Z", id: "2" };
    const s3 = { startAt: "2026-09-17T01:00:00.000Z", id: "3" };
    const groups = groupSessionsByDay([s1, s2, s3], "Asia/Ho_Chi_Minh");
    expect(groups.size).toBe(2);
    expect(groups.get("2026-09-16")?.length).toBe(2);
    expect(groups.get("2026-09-17")?.length).toBe(1);
  });

  it("enforces 31-day bounds for schedule queries", () => {
    const from = new Date("2026-09-01T00:00:00.000Z");
    const normalRange = getDateRangeForSchedule(from, 14);
    expect(normalRange.from).toBe("2026-09-01");
    expect(normalRange.to).toBe("2026-09-15");

    // Clamps requests > 30 days down to 30 days to avoid 400 INVALID_DATE_RANGE
    const clampedRange = getDateRangeForSchedule(from, 60);
    expect(clampedRange.from).toBe("2026-09-01");
    expect(clampedRange.to).toBe("2026-10-01");
  });
});

describe("safeMeetingUrl security boundary", () => {
  it("allows clean HTTPS URLs in production and dev", () => {
    expect(safeMeetingUrl("https://meet.google.com/abc-defg-hij", "production")).toBe(
      "https://meet.google.com/abc-defg-hij",
    );
    expect(safeMeetingUrl("https://zoom.us/j/123456789", "development")).toBe("https://zoom.us/j/123456789");
  });

  it("allows HTTP only in development/research, denies in production", () => {
    expect(safeMeetingUrl("http://localhost:8080/meet", "development")).toBe("http://localhost:8080/meet");
    expect(safeMeetingUrl("http://meet.local/room", "production")).toBeUndefined();
  });

  it("fails closed on embedded credentials", () => {
    expect(safeMeetingUrl("https://user:pass@meet.google.com/room")).toBeUndefined();
  });

  it("fails closed on non-http/https protocols", () => {
    expect(safeMeetingUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeMeetingUrl("file:///etc/passwd")).toBeUndefined();
  });

  it("fails closed on undefined or empty", () => {
    expect(safeMeetingUrl(undefined)).toBeUndefined();
    expect(safeMeetingUrl("   ")).toBeUndefined();
  });
});
