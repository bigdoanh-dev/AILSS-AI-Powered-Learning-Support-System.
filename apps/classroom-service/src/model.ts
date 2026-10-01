import { createHash, createHmac, randomBytes } from "node:crypto";
import { z } from "zod";

const text = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine(
      (v) => !Array.from(v).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127),
      "Control characters are not allowed",
    );
const classImage = z
  .string()
  .max(350000)
  .refine((value) => {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value);
    if (!match?.[2]) return false;
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length < 12 || bytes.length > 256 * 1024 || bytes.toString("base64") !== match[2]) return false;
    return match[1] === "png"
      ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : match[1] === "jpeg"
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  }, "Use a PNG, JPEG or WebP image up to 256 KiB");
export const classKinds = ["LIVE_COHORT", "PRIVATE", "INSTITUTIONAL"] as const;
const createSchema = z
  .object({
    name: text(3, 160),
    classKind: z.enum(classKinds),
    linkedCourseId: z.string().uuid().optional(),
    maxMembers: z.number().int().min(1).max(10000).default(10000),
  })
  .strict();
const patchSchema = z
  .object({
    name: text(3, 160).optional(),
    linkedCourseId: z.string().uuid().nullable().optional(),
    maxMembers: z.number().int().min(1).max(10000).optional(),
    photoDataUrl: classImage.nullable().optional(),
    coverDataUrl: classImage.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "PATCH body must not be empty");
const joinSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z2-9]{6,32}$/u),
  })
  .strict();
const announcementSchema = z.object({ title: text(3, 160), body: text(1, 5000) }).strict();
const warningSchema = z.object({ reason: text(5, 500) }).strict();
const manualAttendanceSchema = z
  .object({
    attendanceStatus: z.enum(["PRESENT", "ABSENT", "EXCUSED"]),
    note: z.preprocess(
      (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
      text(1, 500).optional(),
    ),
  })
  .strict();
export type ClassCreateRequest = z.infer<typeof createSchema>;
export type ClassPatchRequest = z.infer<typeof patchSchema>;
export type ClassJoinRequest = z.infer<typeof joinSchema>;
export type AnnouncementRequest = z.infer<typeof announcementSchema>;
export type ManualAttendanceRequest = z.infer<typeof manualAttendanceSchema>;
export const parseClassCreate = (v: unknown) => createSchema.parse(v);
export const parseClassPatch = (v: unknown) => patchSchema.parse(v);
export const parseClassJoin = (v: unknown) => joinSchema.parse(v);
export const parseAnnouncement = (v: unknown) => announcementSchema.parse(v);
export const parseStudentWarning = (v: unknown) => warningSchema.parse(v);
export type StudentWarningRequest = z.infer<typeof warningSchema>;
export const parseManualAttendance = (v: unknown) => manualAttendanceSchema.parse(v);

export interface ClassroomClass {
  classId: string;
  ownerLecturerId: string;
  name: string;
  linkedCourseId?: string;
  classKind: (typeof classKinds)[number];
  scheduleState: "DRAFT" | "PUBLISHED";
  scheduleVersion: number;
  maxMembers: number;
  photoDataUrl?: string | undefined;
  coverDataUrl?: string | undefined;
  state: "ACTIVE" | "CLOSED";
  activeCodeHash: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
export interface Membership {
  membershipId: string;
  classId: string;
  studentId: string;
  state: "PENDING" | "ACTIVE" | "REMOVED";
  source: "JOIN_CODE" | "PURCHASE";
  offeringId?: string;
  enrollmentId?: string;
  scheduleReservationId?: string;
  joinedAt: Date;
  version: number;
}

export type ReservationState = "PREPARED" | "HELD" | "CONFIRMED" | "RELEASED" | "EXPIRED";
export interface ScheduleSegment {
  entryId: string;
  scheduleDay: string;
  startAt: Date;
  endAt: Date;
  sessionId: string;
  classId: string;
  className: string;
  studentId: string;
  offeringId: string;
  reservationId: string;
  title: string;
  mode: "ONLINE" | "OFFLINE";
  timezone: string;
  scheduleVersion: number;
}
export interface ScheduleReservation {
  reservationId: string;
  operationId: string;
  studentId: string;
  classId: string;
  offeringId: string;
  state: ReservationState;
  expiresAt: Date;
  segmentCount: number;
  scheduleVersion: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  terminalReason?: string;
  orderId?: string;
  membershipId?: string;
}
export interface CommandReceipt {
  fingerprint: string;
  eventId?: string;
  occurredAt: string;
  resource?: Record<string, unknown>;
  oldUpdatedAt?: string;
  oldCodeHash?: string;
  target?: Record<string, unknown>;
  correlationId?: string;
  noOp?: boolean;
}
export function classDto(v: ClassroomClass) {
  return {
    classId: v.classId,
    ownerLecturerId: v.ownerLecturerId,
    name: v.name,
    ...(v.linkedCourseId ? { linkedCourseId: v.linkedCourseId } : {}),
    classKind: v.classKind,
    scheduleState: v.scheduleState,
    scheduleVersion: v.scheduleVersion,
    maxMembers: v.maxMembers,
    ...(v.photoDataUrl ? { photoDataUrl: v.photoDataUrl } : {}),
    ...(v.coverDataUrl ? { coverDataUrl: v.coverDataUrl } : {}),
    state: v.state,
    version: v.version,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}
export function membershipDto(v: Membership) {
  return {
    membershipId: v.membershipId,
    classId: v.classId,
    studentId: v.studentId,
    state: v.state,
    source: v.source,
    ...(v.offeringId ? { offeringId: v.offeringId } : {}),
    ...(v.enrollmentId ? { enrollmentId: v.enrollmentId } : {}),
    ...(v.scheduleReservationId ? { scheduleReservationId: v.scheduleReservationId } : {}),
    joinedAt: v.joinedAt.toISOString(),
    version: v.version,
  };
}
export function fingerprint(secret: string, value: object) {
  return createHmac("sha256", secret).update(JSON.stringify(value)).digest("hex");
}
export function keyHash(secret: string, value: string) {
  const b = createHmac("sha256", secret).update(value).digest()[0] ?? 0;
  return b > 127 ? b - 256 : b;
}
export function codeHash(secret: string, code: string) {
  return createHmac("sha256", secret).update(code).digest("hex");
}
export function newJoinCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
    bytes = randomBytes(10);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
export function deterministicJoinCode(secret: string, operationId: string) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789",
    bytes = createHmac("sha256", secret).update(`join-code:${operationId}`).digest().subarray(0, 10);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
export function eventShard(id: string) {
  return (createHash("sha256").update(id).digest()[0] ?? 0) % 16;
}

export interface ClassSession {
  sessionId: string;
  classId: string;
  title: string;
  startAt: Date;
  endAt: Date;
  mode: "ONLINE" | "OFFLINE";
  status: "DRAFT" | "SCHEDULED" | "COMPLETED" | "CANCELLED";
  timezone: string;
  meetingProvider?: string;
  meetingUrl?: string;
  location?: string;
  scheduleVersion: number;
  recordVersion: number;
  createdAt: Date;
  updatedAt: Date;
}
const calendarDate = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u);
const sessionRecurrence = z
  .object({
    frequency: z.literal("WEEKLY"),
    interval: z.number().int().min(1).max(4),
    until: calendarDate,
  })
  .strict();
const sessionWrite = z
  .object({
    title: text(3, 160),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    timezone: z.string().trim().min(1).max(64),
    mode: z.enum(["ONLINE", "OFFLINE"]),
    meetingProvider: text(1, 50).optional(),
    meetingUrl: z.string().url().max(2048).optional(),
    location: text(1, 300).optional(),
    recurrence: sessionRecurrence.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.mode === "ONLINE") {
      if (!v.meetingProvider)
        ctx.addIssue({
          code: "custom",
          path: ["meetingProvider"],
          message: "ONLINE requires meetingProvider",
        });
      if (!v.meetingUrl)
        ctx.addIssue({ code: "custom", path: ["meetingUrl"], message: "ONLINE requires meetingUrl" });
    } else if (!v.location) {
      ctx.addIssue({ code: "custom", path: ["location"], message: "OFFLINE requires location" });
    }
  });
const sessionPatch = z
  .object({
    title: text(3, 160).optional(),
    startAt: z.string().datetime({ offset: true }).optional(),
    endAt: z.string().datetime({ offset: true }).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    meetingProvider: text(1, 50).optional(),
    meetingUrl: z.string().url().max(2048).optional(),
    location: text(1, 300).optional(),
    status: z.literal("CANCELLED").optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "PATCH body must not be empty");
export type SessionWriteRequest = z.infer<typeof sessionWrite>;
export type SessionPatchRequest = z.infer<typeof sessionPatch>;
export const parseSessionWrite = (v: unknown) => sessionWrite.parse(v);
export const parseSessionPatch = (v: unknown) => sessionPatch.parse(v);
export const parseCalendarDate = (v: unknown) => calendarDate.parse(v);

export function isValidTimezone(value: string) {
  if (/^[+-]\d{2}:?\d{2}$/u.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}
export const MAX_SESSION_DURATION_MS = 12 * 3_600_000;
export const MAX_SESSIONS_PER_CLASS = 200;
export const MAX_SESSIONS_PER_CLASS_DATE = 100;
export const MAX_SCHEDULE_LIST_DAYS = 31;
export function sessionWindow(openBeforeMs = 30 * 60_000, closeAfterMs = 15 * 60_000) {
  return { openBeforeMs, closeAfterMs };
}
export function inMeetingWindow(startAt: Date, endAt: Date, now: Date) {
  const w = sessionWindow();
  return (
    now.getTime() >= startAt.getTime() - w.openBeforeMs && now.getTime() <= endAt.getTime() + w.closeAfterMs
  );
}
export const sessionsOverlap = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) =>
  aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
export function utcDatesTouched(startAt: Date, endAt: Date) {
  const out: string[] = [];
  let t = startAt.getTime();
  const last = endAt.getTime() - 1;
  while (t <= last) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push(day);
    t = Date.parse(`${day}T00:00:00.000Z`) + 86_400_000;
  }
  return out;
}
export function deterministicSessionId(secret: string, operationId: string, index: number) {
  const b = createHmac("sha256", secret)
    .update(`session:${operationId}:${String(index)}`)
    .digest()
    .subarray(0, 16);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Buffer.from(b).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function deterministicUuid(secret: string, namespace: string, value: string) {
  const b = createHmac("sha256", secret).update(`${namespace}:${value}`).digest().subarray(0, 16);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x50;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Buffer.from(b).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const attendanceStatuses = ["NOT_RECORDED", "PRESENT", "ABSENT", "EXCUSED"] as const;
export const presenceStates = ["ONLINE", "OFFLINE"] as const;
export type AttendanceStatus = (typeof attendanceStatuses)[number];
export type PresenceState = (typeof presenceStates)[number];
export interface AttendanceRow {
  sessionId: string;
  studentId: string;
  attendanceStatus: AttendanceStatus;
  source: "ONLINE_PRESENCE" | "MANUAL_OFFLINE" | "NONE";
  manualNote?: string | undefined;
  firstJoinedAt?: Date | undefined;
  lastJoinedAt?: Date | undefined;
  lastLeftAt?: Date | undefined;
  lastSeenAt?: Date | undefined;
  connectedDurationSeconds: number;
  presenceState: PresenceState;
  attendanceVersion: number;
  updatedAt: Date;
}
export interface AttendanceHistoryRow {
  studentId: string;
  yearMonth: string;
  startAt: Date;
  sessionId: string;
  classId: string;
  title: string;
  mode: "ONLINE" | "OFFLINE";
  attendanceStatus: AttendanceStatus;
  manualNote?: string | undefined;
  firstJoinedAt?: Date | undefined;
  lastJoinedAt?: Date | undefined;
  lastLeftAt?: Date | undefined;
  connectedDurationSeconds: number;
  attendanceVersion: number;
}
export interface PresenceCheckpoint {
  sessionId: string;
  studentId: string;
  presenceState: PresenceState;
  activeConnectionCount: number;
  firstJoinedAt?: Date | undefined;
  lastJoinedAt?: Date | undefined;
  lastLeftAt?: Date | undefined;
  lastSeenAt?: Date | undefined;
  accumulatedDurationSeconds: number;
  checkpointVersion: number;
  updatedAt: Date;
}
export function attendanceDto(v: AttendanceRow) {
  return {
    studentId: v.studentId,
    attendanceStatus: v.attendanceStatus,
    source: v.source,
    presenceState: v.presenceState,
    ...(v.firstJoinedAt ? { firstJoinedAt: v.firstJoinedAt.toISOString() } : {}),
    ...(v.lastJoinedAt ? { lastJoinedAt: v.lastJoinedAt.toISOString() } : {}),
    ...(v.lastLeftAt ? { lastLeftAt: v.lastLeftAt.toISOString() } : {}),
    ...(v.lastSeenAt ? { lastSeenAt: v.lastSeenAt.toISOString() } : {}),
    connectedDurationSeconds: v.connectedDurationSeconds,
    attendanceVersion: v.attendanceVersion,
  };
}
export function attendanceHistoryDto(v: AttendanceHistoryRow) {
  return {
    sessionId: v.sessionId,
    classId: v.classId,
    title: v.title,
    mode: v.mode,
    startAt: v.startAt.toISOString(),
    attendanceStatus: v.attendanceStatus,
    ...(v.firstJoinedAt ? { firstJoinedAt: v.firstJoinedAt.toISOString() } : {}),
    ...(v.lastJoinedAt ? { lastJoinedAt: v.lastJoinedAt.toISOString() } : {}),
    ...(v.lastLeftAt ? { lastLeftAt: v.lastLeftAt.toISOString() } : {}),
    connectedDurationSeconds: v.connectedDurationSeconds,
    attendanceVersion: v.attendanceVersion,
  };
}
export function manualAttendanceDto(v: AttendanceRow) {
  return {
    sessionId: v.sessionId,
    studentId: v.studentId,
    attendanceStatus: v.attendanceStatus,
    source: v.source,
    presenceState: v.presenceState,
    connectedDurationSeconds: v.connectedDurationSeconds,
    attendanceVersion: v.attendanceVersion,
    updatedAt: v.updatedAt.toISOString(),
    ...(v.manualNote ? { note: v.manualNote } : {}),
  };
}
const attendanceMonth = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/u);
export const parseAttendanceMonth = (v: unknown) => attendanceMonth.parse(v);
function zonedParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}
/** Deterministic wall-clock -> canonical instant resolution for one IANA timezone. */
export function wallToInstant(
  wall: { year: number; month: number; day: number; hour: number; minute: number; second: number },
  timeZone: string,
) {
  const target = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  let t = target;
  for (let i = 0; i < 4; i++) {
    const p = zonedParts(new Date(t), timeZone);
    const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t;
    const next = target - offset;
    if (next === t) break;
    t = next;
  }
  return new Date(t);
}
export function zonedDateString(instant: Date, timeZone: string) {
  const p = zonedParts(instant, timeZone);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
export interface SessionInstance {
  startAt: Date;
  endAt: Date;
}
/**
 * Materializes wall-clock weekly recurrences as canonical instants. Deterministic for a fixed
 * IANA database: same base/timezone/interval/until always yields the same instants.
 */
export function materializeRecurrence(
  base: { startAt: Date; endAt: Date; timezone: string },
  recurrence: { interval: number; until: string },
  maxInstances = MAX_SESSIONS_PER_CLASS,
): SessionInstance[] | "RECURRENCE_OVERFLOW" {
  const duration = base.endAt.getTime() - base.startAt.getTime();
  const wall = zonedParts(base.startAt, base.timezone);
  const horizonEnd = base.startAt.getTime() + 366 * 86_400_000;
  const instances: SessionInstance[] = [{ startAt: base.startAt, endAt: base.endAt }];
  const baseUtc = Date.UTC(wall.year, wall.month - 1, wall.day);
  for (let k = 1; ; k++) {
    const shifted = new Date(baseUtc + 7 * recurrence.interval * k * 86_400_000);
    const wallDate = shifted.toISOString().slice(0, 10);
    if (wallDate > recurrence.until) break;
    const startAt = wallToInstant(
      {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
        hour: wall.hour,
        minute: wall.minute,
        second: wall.second,
      },
      base.timezone,
    );
    if (startAt.getTime() >= horizonEnd) break;
    instances.push({ startAt, endAt: new Date(startAt.getTime() + duration) });
    if (instances.length > maxInstances) return "RECURRENCE_OVERFLOW";
  }
  return instances;
}
export function sessionDto(v: ClassSession) {
  return {
    sessionId: v.sessionId,
    classId: v.classId,
    title: v.title,
    startAt: v.startAt.toISOString(),
    endAt: v.endAt.toISOString(),
    timezone: v.timezone,
    mode: v.mode,
    status: v.status,
    ...(v.mode === "ONLINE" && v.meetingProvider ? { meetingProvider: v.meetingProvider } : {}),
    ...(v.mode === "OFFLINE" && v.location ? { location: v.location } : {}),
    scheduleVersion: v.scheduleVersion,
    recordVersion: v.recordVersion,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}
