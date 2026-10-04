import { ApiError, record, string } from "./api";

// ============================================================================
// Types & Decoders
// ============================================================================

export interface StudentClass {
  classId: string;
  name: string;
  linkedCourseId?: string;
  ownerLecturerId?: string;
  classKind: "LIVE_COHORT" | "PRIVATE" | "INSTITUTIONAL" | string;
  scheduleState?: string;
  scheduleVersion?: number;
  maxMembers?: number;
  state?: string;
  joinCode?: string;
  photoDataUrl?: string;
  coverDataUrl?: string;
  createdAt?: string;
  updatedAt?: string;
}

function getNumber(value: unknown): number {
  if (typeof value === "number") return value;
  const num = Number(value);
  if (Number.isNaN(num)) throw new ApiError("invalid");
  return num;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  return getNumber(value);
}

export function studentClass(value: unknown): StudentClass {
  const rec = record(value);
  return {
    classId: string(rec.classId),
    name: string(rec.name),
    linkedCourseId: typeof rec.linkedCourseId === "string" ? rec.linkedCourseId : undefined,
    ownerLecturerId: typeof rec.ownerLecturerId === "string" ? rec.ownerLecturerId : undefined,
    classKind: typeof rec.classKind === "string" ? rec.classKind : "PRIVATE",
    scheduleState: typeof rec.scheduleState === "string" ? rec.scheduleState : undefined,
    scheduleVersion: optionalNumber(rec.scheduleVersion),
    maxMembers: optionalNumber(rec.maxMembers),
    state: typeof rec.state === "string" ? rec.state : undefined,
    joinCode: typeof rec.joinCode === "string" ? rec.joinCode : undefined,
    photoDataUrl: typeof rec.photoDataUrl === "string" ? rec.photoDataUrl : undefined,
    coverDataUrl: typeof rec.coverDataUrl === "string" ? rec.coverDataUrl : undefined,
    createdAt: typeof rec.createdAt === "string" ? rec.createdAt : undefined,
    updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : undefined,
  };
}

export function studentClasses(value: unknown): StudentClass[] {
  let arr: unknown;
  if (Array.isArray(value)) {
    arr = value;
  } else {
    const rec = record(value);
    if (Array.isArray(rec.data)) {
      arr = rec.data;
    } else if (Array.isArray(rec.items)) {
      arr = rec.items;
    } else {
      throw new ApiError("invalid");
    }
  }
  return (arr as unknown[]).map(studentClass);
}

export function classDetail(value: unknown): StudentClass {
  const rec = record(value);
  if (rec.data && typeof rec.data === "object") {
    return studentClass(rec.data);
  }
  return studentClass(value);
}

export interface ClassSession {
  sessionId: string;
  classId: string;
  title: string;
  startAt: string;
  endAt: string;
  timezone: string;
  mode: "ONLINE" | "OFFLINE" | string;
  status: "DRAFT" | "SCHEDULED" | "COMPLETED" | "CANCELLED" | string;
  location?: string;
  roomName?: string;
  meetingProvider?: string;
  meetingUrl?: string;
  inMeetingWindow?: boolean;
  scheduleVersion?: number;
  recordVersion?: number;
}

export function classSession(value: unknown): ClassSession {
  const rec = record(value);
  return {
    sessionId: string(rec.sessionId),
    classId: string(rec.classId),
    title: string(rec.title),
    startAt: string(rec.startAt),
    endAt: string(rec.endAt),
    timezone: typeof rec.timezone === "string" ? rec.timezone : "Asia/Ho_Chi_Minh",
    mode: typeof rec.mode === "string" ? rec.mode : "OFFLINE",
    status: typeof rec.status === "string" ? rec.status : "SCHEDULED",
    location: typeof rec.location === "string" ? rec.location : undefined,
    meetingProvider: typeof rec.meetingProvider === "string" ? rec.meetingProvider : undefined,
    meetingUrl: typeof rec.meetingUrl === "string" ? rec.meetingUrl : undefined,
    inMeetingWindow: typeof rec.inMeetingWindow === "boolean" ? rec.inMeetingWindow : undefined,
    scheduleVersion: optionalNumber(rec.scheduleVersion),
    recordVersion: optionalNumber(rec.recordVersion),
  };
}

export function classSessions(value: unknown): ClassSession[] {
  let arr: unknown;
  if (Array.isArray(value)) {
    arr = value;
  } else {
    const rec = record(value);
    if (Array.isArray(rec.data)) {
      arr = rec.data;
    } else if (Array.isArray(rec.items)) {
      arr = rec.items;
    } else {
      throw new ApiError("invalid");
    }
  }
  return (arr as unknown[]).map(classSession);
}

export function sessionDetail(value: unknown): ClassSession {
  const rec = record(value);
  if (rec.data && typeof rec.data === "object") {
    return classSession(rec.data);
  }
  return classSession(value);
}

export interface StudentScheduleEntry {
  sessionId: string;
  classId: string;
  className: string;
  title: string;
  startAt: string;
  endAt: string;
  mode: "ONLINE" | "OFFLINE" | string;
  timezone: string;
  scheduleVersion: number;
}

export function studentScheduleEntry(value: unknown): StudentScheduleEntry {
  const rec = record(value);
  return {
    sessionId: string(rec.sessionId),
    classId: string(rec.classId),
    className: string(rec.className),
    title: string(rec.title),
    startAt: string(rec.startAt),
    endAt: string(rec.endAt),
    mode: typeof rec.mode === "string" ? rec.mode : "OFFLINE",
    timezone: typeof rec.timezone === "string" ? rec.timezone : "Asia/Ho_Chi_Minh",
    scheduleVersion: getNumber(rec.scheduleVersion),
  };
}

export function studentSchedule(value: unknown): StudentScheduleEntry[] {
  let arr: unknown;
  if (Array.isArray(value)) {
    arr = value;
  } else {
    const rec = record(value);
    if (Array.isArray(rec.data)) {
      arr = rec.data;
    } else if (Array.isArray(rec.items)) {
      arr = rec.items;
    } else {
      throw new ApiError("invalid");
    }
  }
  return (arr as unknown[]).map(studentScheduleEntry);
}

export interface StudentAttendanceEntry {
  sessionId: string;
  classId: string;
  title: string;
  mode: "ONLINE" | "OFFLINE" | string;
  startAt: string;
  attendanceStatus: "NOT_RECORDED" | "PRESENT" | "ABSENT" | "EXCUSED" | string;
  firstJoinedAt?: string;
  lastJoinedAt?: string;
  lastLeftAt?: string;
  connectedDurationSeconds: number;
  attendanceVersion: number;
}

export function studentAttendanceEntry(value: unknown): StudentAttendanceEntry {
  const rec = record(value);
  return {
    sessionId: string(rec.sessionId),
    classId: string(rec.classId),
    title: string(rec.title),
    mode: typeof rec.mode === "string" ? rec.mode : "OFFLINE",
    startAt: string(rec.startAt),
    attendanceStatus: typeof rec.attendanceStatus === "string" ? rec.attendanceStatus : "NOT_RECORDED",
    firstJoinedAt: typeof rec.firstJoinedAt === "string" ? rec.firstJoinedAt : undefined,
    lastJoinedAt: typeof rec.lastJoinedAt === "string" ? rec.lastJoinedAt : undefined,
    lastLeftAt: typeof rec.lastLeftAt === "string" ? rec.lastLeftAt : undefined,
    connectedDurationSeconds: getNumber(rec.connectedDurationSeconds),
    attendanceVersion: getNumber(rec.attendanceVersion),
  };
}

export function studentAttendance(value: unknown): StudentAttendanceEntry[] {
  let arr: unknown;
  if (Array.isArray(value)) {
    arr = value;
  } else {
    const rec = record(value);
    if (Array.isArray(rec.data)) {
      arr = rec.data;
    } else if (Array.isArray(rec.items)) {
      arr = rec.items;
    } else {
      throw new ApiError("invalid");
    }
  }
  return (arr as unknown[]).map(studentAttendanceEntry);
}

// ============================================================================
// Date/Time Adapter & Schedule Helpers
// ============================================================================

export function parseTimestamp(isoString: string): Date {
  if (typeof isoString !== "string" || !isoString.trim()) {
    throw new ApiError("invalid");
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError("invalid");
  }
  return date;
}

export function formatDate(
  date: Date,
  timezone: string = "Asia/Ho_Chi_Minh",
  locale: string = "vi-VN",
): string {
  try {
    const formatter = new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function formatTime(date: Date, timezone: string = "Asia/Ho_Chi_Minh", locale = "vi-VN"): string {
  try {
    const formatter = new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return formatter.format(date);
  } catch {
    return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
  }
}

export function formatTimeRange(
  start: Date,
  end: Date,
  timezone: string = "Asia/Ho_Chi_Minh",
  locale = "vi-VN",
): string {
  const startTime = formatTime(start, timezone, locale);
  const endTime = formatTime(end, timezone, locale);
  return `${startTime} - ${endTime} (${timezone})`;
}

export function sortChronological<T extends { startAt: string }>(sessions: T[]): T[] {
  return [...sessions].sort((a, b) => {
    const timeA = new Date(a.startAt).getTime();
    const timeB = new Date(b.startAt).getTime();
    return timeA - timeB;
  });
}

export function filterUpcoming<T extends { startAt: string }>(sessions: T[], now: Date = new Date()): T[] {
  const nowTime = now.getTime();
  return sessions.filter((s) => new Date(s.startAt).getTime() >= nowTime);
}

export function filterPast<T extends { endAt: string }>(sessions: T[], now: Date = new Date()): T[] {
  const nowTime = now.getTime();
  return sessions.filter((s) => new Date(s.endAt).getTime() < nowTime);
}

export function nextUpcomingSession<T extends { startAt: string }>(
  sessions: T[],
  now: Date = new Date(),
): T | undefined {
  const upcoming = sortChronological(filterUpcoming(sessions, now));
  return upcoming[0];
}

export function groupSessionsByDay<T extends { startAt: string }>(
  sessions: T[],
  timezone: string = "Asia/Ho_Chi_Minh",
): Map<string, T[]> {
  const sorted = sortChronological(sessions);
  const groups = new Map<string, T[]>();

  for (const session of sorted) {
    const date = parseTimestamp(session.startAt);
    let key: string;
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date);
      key = parts; // YYYY-MM-DD
    } catch {
      key = date.toISOString().slice(0, 10);
    }

    const current = groups.get(key) ?? [];
    current.push(session);
    groups.set(key, current);
  }

  return groups;
}

export function formatDateQueryParam(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getDateRangeForSchedule(
  from: Date = new Date(),
  days: number = 28,
): { from: string; to: string } {
  // Enforce the 31-day boundary strictly (capped at 30 days max to prevent 400 INVALID_DATE_RANGE)
  const safeDays = Math.min(Math.max(1, days), 30);
  const to = new Date(from.getTime() + safeDays * 86_400_000);
  return {
    from: formatDateQueryParam(from),
    to: formatDateQueryParam(to),
  };
}

export function safeMeetingUrl(
  value?: string,
  environment: "development" | "research" | "production" = (process.env.EXPO_PUBLIC_AILSS_ENV as
    "development" | "research" | "production") ?? "development",
): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value);
    // Unsupported URI schemes fail closed
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    // Credential-bearing URLs fail closed
    if (url.username || url.password) return undefined;
    // Production external meeting URLs require HTTPS
    if (environment === "production" && url.protocol !== "https:") return undefined;
    // Disallow dangerous protocols or ports
    return url.toString();
  } catch {
    return undefined;
  }
}
