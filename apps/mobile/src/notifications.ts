import { ApiError, record, string } from "./api";

export interface NotificationSource {
  type: string;
  id: string;
  contextId: string;
}

export interface NotificationItem {
  notificationId: string;
  type: string;
  title: string;
  body: string;
  source: NotificationSource;
  createdAt: string;
  readAt: string | null;
  locator: string;
}

export interface NotificationListResponse {
  items: NotificationItem[];
  month: string;
  nextCursor: string | null;
}

export interface NotificationReadResult {
  notificationId: string;
  state: string;
  readAt: string;
}

export function notificationSource(value: unknown): NotificationSource {
  const data = record(value);
  return {
    type: string(data.type),
    id: string(data.id),
    contextId: string(data.contextId),
  };
}

export function notificationItem(value: unknown): NotificationItem {
  const data = record(value);
  return {
    notificationId: string(data.notificationId),
    type: string(data.type),
    title: string(data.title),
    body: string(data.body),
    source: notificationSource(data.source),
    createdAt: string(data.createdAt),
    readAt: data.readAt === null || data.readAt === undefined ? null : string(data.readAt),
    locator: string(data.locator),
  };
}

export function notifications(value: unknown): NotificationItem[] {
  if (Array.isArray(value)) {
    return value.map(notificationItem);
  }
  const data = record(value);
  if (Array.isArray(data.items)) {
    return data.items.map(notificationItem);
  }
  if (Array.isArray(data.data)) {
    return data.data.map(notificationItem);
  }
  throw new ApiError("invalid");
}

export function notificationList(value: unknown): NotificationListResponse {
  const rec = record(value);
  const dataObj =
    rec.data && typeof rec.data === "object" && !Array.isArray(rec.data)
      ? (rec.data as Record<string, unknown>)
      : null;

  const rawItems = Array.isArray(rec.items)
    ? rec.items
    : Array.isArray(rec.data)
      ? rec.data
      : dataObj && Array.isArray(dataObj.items)
        ? dataObj.items
        : null;
  if (!rawItems) throw new ApiError("invalid");

  const items = rawItems.map(notificationItem);
  let month = "";
  let nextCursor: string | null = null;

  const page =
    rec.page && typeof rec.page === "object"
      ? (rec.page as Record<string, unknown>)
      : dataObj && dataObj.page && typeof dataObj.page === "object"
        ? (dataObj.page as Record<string, unknown>)
        : null;

  if (page) {
    if (typeof page.month === "string") month = page.month;
    if (typeof page.nextCursor === "string") nextCursor = page.nextCursor;
  }

  if (!month && rec.meta && typeof rec.meta === "object") {
    const meta = rec.meta as Record<string, unknown>;
    if (meta.page && typeof meta.page === "object") {
      const p = meta.page as Record<string, unknown>;
      if (typeof p.month === "string") month = p.month;
      if (typeof p.nextCursor === "string") nextCursor = p.nextCursor;
    }
    if (!nextCursor && typeof meta.nextCursor === "string") {
      nextCursor = meta.nextCursor;
    }
  }

  return {
    items,
    month: month || formatCurrentMonth(),
    nextCursor,
  };
}

export function notificationReadResult(value: unknown): NotificationReadResult {
  const data = record(value);
  return {
    notificationId: string(data.notificationId),
    state: string(data.state),
    readAt: string(data.readAt),
  };
}

export function formatCurrentMonth(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function formatDisplayMonth(month: string): string {
  const parts = month.split("-");
  if (parts.length === 2 && parts[0] && parts[1]) {
    return `Tháng ${parts[1]}/${parts[0]}`;
  }
  return month ? `Tháng ${month}` : "";
}

export function isValidMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/u.test(month);
}

export function isRead(item: NotificationItem): boolean {
  return item.readAt !== null && item.readAt !== undefined;
}

export function resolveNotificationRoute(item: NotificationItem, role?: string): string | null {
  const isLecturer = role === "LECTURER";
  const isAdmin = role === "ADMIN";
  const source = item.source;

  if (isAdmin) {
    if (source.type === "LECTURER_APPLICATION" || source.type === "LECTURER_VERIFICATION") {
      return `/admin/lecturers`;
    }
    if (source.type === "MODERATION" || source.type === "REPORT") {
      return source.id ? `/admin/moderation/${source.id}` : `/admin/moderation`;
    }
    if (source.type === "ORDER") {
      return source.id ? `/admin/commerce/orders/${source.id}` : `/admin/commerce`;
    }
    if (source.type === "USER") {
      return source.id ? `/admin/users/${source.id}` : `/admin/users`;
    }
  }

  if (source.type === "CLASS_ANNOUNCEMENT") {
    const classId = source.contextId || source.id;
    if (!classId) return null;
    return isLecturer ? `/teaching/classes/${classId}` : `/classes/${classId}`;
  }

  if (source.type === "TEACHING_COURSE" || source.type === "COURSE") {
    const courseId = source.contextId || source.id;
    if (!courseId) return null;
    return isLecturer ? `/teaching/courses/${courseId}` : `/courses/${courseId}`;
  }

  if (source.type === "CLASS_SESSION" || source.type === "SESSION") {
    const classId = source.contextId;
    const sessionId = source.id;
    if (!classId || !sessionId) return null;
    return isLecturer
      ? `/teaching/classes/${classId}/sessions/${sessionId}`
      : `/classes/${classId}/sessions/${sessionId}`;
  }

  if (source.type === "ASSESSMENT" || source.type === "QUIZ") {
    const quizId = source.id || source.contextId;
    if (!quizId) return null;
    return isLecturer ? `/teaching/assessments/${quizId}` : `/assessments/${quizId}`;
  }

  if (source.type === "AI_JOB" || source.type === "AI_QUIZ") {
    const jobId = source.id || source.contextId;
    if (!jobId) return null;
    return `/teaching/ai/${jobId}`;
  }

  return null;
}
