import { ApiError, record, string } from "./api";

// ============================================================================
// Helpers
// ============================================================================

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

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// ============================================================================
// OwnedOffering — LRN-28 /api/v1/me/owned-offerings
// ============================================================================

export interface OwnedOffering {
  offeringId: string;
  courseId: string;
  offeringType: string;
  state: string;
  title?: string;
  price?: string;
  currency?: string;
}

export function ownedOffering(value: unknown): OwnedOffering {
  const rec = record(value);
  return {
    offeringId: string(rec.offeringId),
    courseId: string(rec.courseId),
    offeringType: string(rec.offeringType),
    state: string(rec.state),
    title: optionalString(rec.title),
    price: optionalString(rec.price),
    currency: optionalString(rec.currency),
  };
}

export function ownedOfferings(value: unknown): OwnedOffering[] {
  let arr: unknown;
  if (Array.isArray(value)) {
    arr = value;
  } else {
    const rec = record(value);
    if (Array.isArray(rec.items)) {
      arr = rec.items;
    } else if (Array.isArray(rec.data)) {
      arr = rec.data;
    } else {
      throw new ApiError("invalid");
    }
  }
  return (arr as unknown[]).map(ownedOffering);
}

// ============================================================================
// LecturerCourse — LRN-03, LRN-05, LRN-06
// ============================================================================

export interface LecturerCourse {
  courseId: string;
  title: string;
  state?: string;
  description?: string;
  slug?: string;
  priceType?: string;
  price?: string;
  currency?: string;
  categoryId?: string;
  lecturerName?: string;
  publishedAt?: string;
  totalLessons?: number;
  createdAt?: string;
  updatedAt?: string;
  currentVersion?: number;
}

export function lecturerCourse(value: unknown): LecturerCourse {
  const rec = record(value);
  return {
    courseId: string(rec.courseId),
    title: string(rec.title),
    state: optionalString(rec.state),
    description: optionalString(rec.description),
    slug: optionalString(rec.slug),
    priceType: optionalString(rec.priceType),
    price: optionalString(rec.price),
    currency: optionalString(rec.currency),
    categoryId: optionalString(rec.categoryId),
    lecturerName: optionalString(rec.lecturerName),
    publishedAt: optionalString(rec.publishedAt),
    totalLessons: optionalNumber(rec.totalLessons),
    createdAt: optionalString(rec.createdAt),
    updatedAt: optionalString(rec.updatedAt),
    currentVersion: optionalNumber(rec.currentVersion),
  };
}

export function lecturerCourses(value: unknown): LecturerCourse[] {
  let arr: unknown;
  if (Array.isArray(value)) {
    arr = value;
  } else {
    const rec = record(value);
    if (Array.isArray(rec.items)) {
      arr = rec.items;
    } else {
      throw new ApiError("invalid");
    }
  }
  return (arr as unknown[]).map(lecturerCourse);
}

// ============================================================================
// LecturerLesson — LRN-10, LRN-11, LRN-12, LRN-13
// ============================================================================

export interface LessonPosition {
  sectionOrder: number;
  lessonOrder: number;
}

export interface LecturerLesson {
  lessonId: string;
  courseId: string;
  title: string;
  sectionTitle?: string;
  preview: boolean;
  position: LessonPosition;
  contentUrl?: string;
  externalVideo?: string;
  contentType?: string;
  state?: string;
}

function lessonPosition(value: unknown): LessonPosition {
  const rec = record(value);
  return {
    sectionOrder: getNumber(rec.sectionOrder),
    lessonOrder: getNumber(rec.lessonOrder),
  };
}

export function lecturerLesson(value: unknown): LecturerLesson {
  const rec = record(value);
  return {
    lessonId: string(rec.lessonId),
    courseId: string(rec.courseId),
    title: string(rec.title),
    sectionTitle: optionalString(rec.sectionTitle),
    preview: typeof rec.preview === "boolean" ? rec.preview : rec.preview === "true" || rec.preview === true,
    position: rec.position ? lessonPosition(rec.position) : { sectionOrder: 1, lessonOrder: 1 },
    contentUrl: optionalString(rec.contentUrl),
    externalVideo: optionalString(rec.externalVideo),
    contentType: optionalString(rec.contentType),
    state: optionalString(rec.state),
  };
}

export function lecturerLessons(value: unknown): LecturerLesson[] {
  let arr: unknown;
  if (Array.isArray(value)) {
    arr = value;
  } else {
    const rec = record(value);
    if (Array.isArray(rec.items)) {
      arr = rec.items;
    } else {
      throw new ApiError("invalid");
    }
  }
  return (arr as unknown[]).map(lecturerLesson);
}

// ============================================================================
// OwnedClass — CLS-06 /api/v1/me/owned-classes
// ============================================================================

export interface OwnedClass {
  classId: string;
  name: string;
  linkedCourseId?: string;
  classKind: string;
  state?: string;
  maxMembers?: number;
  joinCode?: string;
  scheduleState?: string;
  createdAt?: string;
  updatedAt?: string;
}

export function ownedClass(value: unknown): OwnedClass {
  const rec = record(value);
  return {
    classId: string(rec.classId),
    name: string(rec.name),
    linkedCourseId: optionalString(rec.linkedCourseId),
    classKind: optionalString(rec.classKind) ?? "PRIVATE",
    state: optionalString(rec.state),
    maxMembers: optionalNumber(rec.maxMembers),
    joinCode: optionalString(rec.joinCode),
    scheduleState: optionalString(rec.scheduleState),
    createdAt: optionalString(rec.createdAt),
    updatedAt: optionalString(rec.updatedAt),
  };
}

export function ownedClasses(value: unknown): OwnedClass[] {
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
  return (arr as unknown[]).map(ownedClass);
}

// ============================================================================
// ClassMember — CLS-07 /api/v1/classes/{classId}/members
// ============================================================================

export interface ClassMember {
  userId: string;
  displayName: string;
  role: string;
  joinedAt?: string;
}

export function classMember(value: unknown): ClassMember {
  const rec = record(value);
  return {
    userId: string(rec.userId),
    displayName: string(rec.displayName),
    role: optionalString(rec.role) ?? "STUDENT",
    joinedAt: optionalString(rec.joinedAt),
  };
}

export function classMembers(value: unknown): ClassMember[] {
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
  return (arr as unknown[]).map(classMember);
}

// ============================================================================
// Helpers — Unique courses from offerings
// ============================================================================

export function uniqueCoursesFromOfferings(items: OwnedOffering[]): { courseId: string; title: string }[] {
  const seen = new Map<string, string>();
  for (const item of items) {
    if (!seen.has(item.courseId)) {
      seen.set(item.courseId, item.title ?? item.courseId.slice(0, 8));
    }
  }
  return Array.from(seen.entries()).map(([courseId, title]) => ({ courseId, title }));
}

// ============================================================================
// ClassSession — CLS-11, CLS-12, CLS-13, CLS-14
// ============================================================================

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
    location: optionalString(rec.location),
    meetingProvider: optionalString(rec.meetingProvider),
    meetingUrl: optionalString(rec.meetingUrl),
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
    } else if (Array.isArray(rec.sessions)) {
      arr = rec.sessions;
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

// ============================================================================
// AttendanceEntry — CLS-16, CLS-19
// ============================================================================

export interface AttendanceEntry {
  studentId: string;
  attendanceStatus: "NOT_RECORDED" | "PRESENT" | "ABSENT" | "EXCUSED" | string;
  source: "NONE" | "ONLINE_PRESENCE" | "MANUAL_OFFLINE" | string;
  presenceState: "ONLINE" | "OFFLINE" | string;
  firstJoinedAt?: string;
  lastJoinedAt?: string;
  lastLeftAt?: string;
  lastSeenAt?: string;
  connectedDurationSeconds: number;
  attendanceVersion: number;
  note?: string;
}

export function attendanceEntry(value: unknown): AttendanceEntry {
  const rec = record(value);
  return {
    studentId: string(rec.studentId),
    attendanceStatus: typeof rec.attendanceStatus === "string" ? rec.attendanceStatus : "NOT_RECORDED",
    source: typeof rec.source === "string" ? rec.source : "NONE",
    presenceState: typeof rec.presenceState === "string" ? rec.presenceState : "OFFLINE",
    firstJoinedAt: optionalString(rec.firstJoinedAt),
    lastJoinedAt: optionalString(rec.lastJoinedAt),
    lastLeftAt: optionalString(rec.lastLeftAt),
    lastSeenAt: optionalString(rec.lastSeenAt),
    connectedDurationSeconds: optionalNumber(rec.connectedDurationSeconds) ?? 0,
    attendanceVersion: optionalNumber(rec.attendanceVersion) ?? 0,
    note: optionalString(rec.note),
  };
}

export function attendanceRoster(value: unknown): AttendanceEntry[] {
  let arr: unknown;
  if (Array.isArray(value)) {
    arr = value;
  } else {
    const rec = record(value);
    if (Array.isArray(rec.data)) {
      arr = rec.data;
    } else if (Array.isArray(rec.attendance)) {
      arr = rec.attendance;
    } else if (Array.isArray(rec.items)) {
      arr = rec.items;
    } else {
      throw new ApiError("invalid");
    }
  }
  return (arr as unknown[]).map(attendanceEntry);
}

// ============================================================================
// PresenceTicket — CLS-18
// ============================================================================

export interface PresenceTicket {
  ticket: string;
  expiresIn: number;
  websocketUrl?: string;
  expiresAt?: string;
  sessionId?: string;
}

export function presenceTicket(value: unknown): PresenceTicket {
  const rec = record(value);
  const data = rec.data && typeof rec.data === "object" ? record(rec.data) : rec;
  return {
    ticket: string(data.ticket),
    expiresIn: typeof data.expiresIn === "number" ? data.expiresIn : 30,
    websocketUrl: optionalString(data.websocketUrl),
    expiresAt: optionalString(data.expiresAt),
    sessionId: optionalString(data.sessionId),
  };
}

// ============================================================================
// Helpers — Date range for sessions query
// ============================================================================

export function rangeForMonth(d?: Date): { from: string; to: string } {
  const now = d ? new Date(d) : new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  return {
    from: firstDay.toISOString().slice(0, 10),
    to: lastDay.toISOString().slice(0, 10),
  };
}

// ============================================================================
// Classroom Announcements — CLS-09, CLS-10
// ============================================================================

export interface Announcement {
  announcementId: string;
  classId?: string;
  authorId?: string;
  title: string;
  body: string;
  createdAt: string;
  version?: number;
}

export function announcement(value: unknown): Announcement {
  const rec = record(value);
  const data = rec.data && typeof rec.data === "object" ? record(rec.data) : rec;
  return {
    announcementId: string(data.announcementId ?? data.announcement_id),
    classId: optionalString(data.classId ?? data.class_id),
    authorId: optionalString(data.authorId ?? data.author_id),
    title: string(data.title),
    body: string(data.body ?? data.content ?? data.body_sanitized),
    createdAt: string(data.createdAt ?? data.created_at),
    version: optionalNumber(data.version),
  };
}

export function announcements(value: unknown): Announcement[] {
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
  return (arr as unknown[]).map(announcement);
}

export function validateAnnouncement(title: string, body: string): { valid: boolean; error?: string } {
  const t = title.trim();
  const b = body.trim();
  if (t.length < 3 || t.length > 160) {
    return { valid: false, error: "Tiêu đề thông báo phải từ 3 đến 160 ký tự." };
  }
  if (b.length < 1 || b.length > 5000) {
    return { valid: false, error: "Nội dung thông báo phải từ 1 đến 5000 ký tự." };
  }
  return { valid: true };
}

// ============================================================================
// CONTRACT_LIMITED — Operations not supported by existing public APIs
// ============================================================================

export const CONTRACT_LIMITED = {
  lessonDelete: "API không hỗ trợ xóa bài học. Vui lòng sử dụng Web.",
  lessonReorder: "API không hỗ trợ sắp xếp lại bài học. Vui lòng sử dụng Web.",
  coursePublish: "Xuất bản khóa học cần quyền quản trị viên (Admin). Vui lòng liên hệ Admin.",
  courseDelete: "Lưu trữ khóa học cần quyền quản trị viên (Admin).",
  offeringDelete: "API không hỗ trợ xóa offering.",
  lessonFileUpload: "Tải tệp bài học chưa được hỗ trợ trên thiết bị di động.",
  courseImageUpload: "Tải ảnh khóa học chưa được hỗ trợ trên thiết bị di động.",
  attendanceDelete: "API không hỗ trợ xóa bản ghi điểm danh.",
  onlineManualOverride: "Buổi học trực tuyến ghi nhận điểm danh tự động qua kết nối presence.",
  announcementEdit: "Hệ thống chưa hỗ trợ chỉnh sửa thông báo đã đăng.",
  announcementDelete: "Hệ thống chưa hỗ trợ xóa thông báo đã đăng.",
  reviewModerate: "Giảng viên không có quyền kiểm duyệt hoặc xóa đánh giá của học viên.",
  selfVerification: "Giảng viên không thể tự xác minh tài khoản. Quá trình này do Quản trị viên thực hiện.",
} as const;
