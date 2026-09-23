import { useEffect, useRef, useState } from "react";
import { useSession } from "../auth/session";
import { ApiError, errorMessage } from "../lib/api";
export interface Envelope<T> {
  data: T;
  meta?: { page?: { nextCursor: string | null }; pagination?: { nextCursor: string | null } };
}
export interface LearningCourse {
  courseId: string;
  title: string;
  state?: string;
  priceType?: string;
  price?: string;
  currency?: string;
}
export interface Lesson {
  lessonId: string;
  courseId: string;
  title: string;
  sectionTitle?: string;
  preview: boolean;
  state: string;
  contentUrl?: string;
  externalVideo?: string;
  contentType?: string;
  position?: { sectionOrder: number; lessonOrder: number };
}
export interface Progress {
  courseId: string;
  percent: number;
  completedCount: number;
  publishedTotal: number;
  progressVersion: number;
  courseContentVersion: number;
  completed: boolean;
}
export interface ClassItem {
  classId: string;
  name: string;
  state: string;
  linkedCourseId?: string;
  scheduleState: string;
}
export interface SessionItem {
  sessionId: string;
  classId: string;
  className?: string;
  title: string;
  startAt: string;
  endAt: string;
  timezone: string;
  mode: string;
  status?: string;
  location?: string;
  meetingUrl?: string;
}
export interface Attendance {
  sessionId: string;
  classId: string;
  title: string;
  startAt: string;
  attendanceStatus: string;
}
export interface Notice {
  notificationId: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  locator: string;
  source: { type: string; contextId: string };
}
export interface Notices {
  items: Notice[];
  page: { month: string; nextCursor: string | null };
}
export interface CommentItem {
  commentId: string;
  authorId: string;
  body: string | null;
  parentId: string | null;
  version: number;
  state: string;
  createdAt: string;
}
export interface ReviewItem {
  reviewId: string;
  authorId: string;
  body: string | null;
  rating: number;
  version: number;
  state: string;
  createdAt: string;
}
export interface Question {
  questionId: string;
  questionOrder: number;
  prompt: string;
  questionType: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER";
  options?: string[];
  points: string;
}
export interface Quiz {
  quizId: string;
  title: string;
  state: string;
  questionCount: number;
  durationSeconds?: number;
  attemptLimit?: number;
  opensAt?: string;
  closesAt?: string;
  questions?: Question[];
}
export interface Attempt {
  attemptId: string;
  quizId: string;
  state: "CREATED" | "IN_PROGRESS" | "SUBMITTED" | "EXPIRED";
  attemptNo: number;
  deadlineAt?: string;
  questions: Question[];
}
export interface Result {
  attemptId: string;
  quizId: string;
  score: string;
  maxScore: string;
  submittedAt: string;
  resultVersion: number;
}
export type Answer = { questionId: string } & (
  { selectedOptionId: string } | { selectedOptionIds: string[] } | { value: boolean } | { text: string }
);
export function studentError(e: unknown) {
  if (e instanceof ApiError) {
    if (e.code === "OFFERING_NOT_AVAILABLE")
      return "Khóa học chưa mở đăng ký theo hình thức này. Vui lòng liên hệ đơn vị đào tạo.";
    if (e.code === "PURCHASE_REQUIRED")
      return "Khóa học này cần đăng ký theo hình thức có học phí. Liên hệ đơn vị đào tạo để được hướng dẫn.";
    if (e.code === "CLASS_NOT_FOUND") return "Mã lớp không hợp lệ hoặc đã hết hiệu lực.";
    if (e.code === "CLASS_CAPACITY_EXCEEDED") return "Lớp đã đủ số thành viên.";
    if (e.code === "SCHEDULE_CONFLICT") return "Lịch học bị trùng với một lớp bạn đã tham gia.";
    if (e.code === "LIVE_COHORT_JOIN_CODE_DENIED")
      return "Lớp theo lịch cần được tham gia qua đợt mở đăng ký.";
    if (e.status === 503) return "Dịch vụ tạm thời không khả dụng. Hãy thử lại.";
    if (e.status === 401) return "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.";
    if (e.status === 403) return "Bạn hiện không có quyền truy cập nội dung này.";
    if (e.status === 404) return "Không tìm thấy nội dung hoặc nội dung không còn khả dụng.";
    if (e.code.includes("EXPIRED")) return "Bài kiểm tra đã hết thời gian.";
    if (e.code.includes("CURSOR")) return "Trang dữ liệu đã hết hạn. Hãy tải lại danh sách từ đầu.";
    if (e.code.includes("VERSION")) return "Nội dung đã thay đổi. Tải lại trước khi sửa tiếp.";
    if (e.code === "ATTEMPT_LIMIT_REACHED") return "Bạn đã dùng hết số lần làm bài cho phép.";
  }
  return errorMessage(e);
}
export async function studentRequest<T>(
  path: string,
  signal: AbortSignal,
  method = "GET",
  body?: unknown,
  key?: string,
  headers?: Record<string, string>,
): Promise<Envelope<T>> {
  const r = await fetch("/web-session/student" + path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(path === "/assistant/chat" ? 65000 : 20000)]),
    headers: {
      Accept: "application/json",
      ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
      ...(key ? { "Idempotency-Key": key } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const value = await r.json();
  if (signal.aborted) throw new DOMException("Request cancelled", "AbortError");
  if (!r.ok) {
    if (
      r.status === 401 ||
      value.error?.code === "STUDENT_REQUIRED" ||
      value.error?.code === "ACCOUNT_DISABLED"
    )
      window.dispatchEvent(new Event("ailss-session-invalid"));
    throw new ApiError(r.status, value.error?.code || "UNAVAILABLE");
  }
  return value;
}
export function useStudent<T>(path: string | null) {
  const { profile, state } = useSession();
  const identity =
    state === "AUTHENTICATED" && profile?.role === "STUDENT"
      ? profile.userId + ":" + profile.profileVersion
      : "";
  const scope = identity + "|" + path;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ scope: string; value?: Envelope<T>; error?: unknown }>({
    scope: "",
  });
  useEffect(() => {
    const c = new AbortController();
    setResult({ scope });
    if (identity && path)
      studentRequest<T>(path, c.signal)
        .then((value) => {
          if (!c.signal.aborted) setResult({ scope, value });
        })
        .catch((error) => {
          if (!c.signal.aborted) setResult({ scope, error });
        });
    return () => c.abort();
  }, [scope, identity, path, revision]);
  const current = result.scope === scope ? result : undefined;
  return {
    data: current?.value?.data,
    meta: current?.value?.meta,
    error: current?.error,
    pending: !!path && !current?.value && !current?.error,
    retry: () => setRevision((n) => n + 1),
  };
}
// A logical retry retains its key and payload; a successful or changed command gets a fresh key.
export function logicalCommand() {
  let previous = "";
  let key = "";
  return {
    key(value: unknown) {
      const text = JSON.stringify(value);
      if (text !== previous) {
        previous = text;
        key = crypto.randomUUID();
      }
      return key;
    },
    success() {
      previous = "";
      key = "";
    },
  };
}
export function useCommand() {
  const [outcome, setOutcome] = useState<"success" | "failure" | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const flight = useRef(false),
    controller = useRef(new AbortController()),
    logical = useRef(logicalCommand());
  useEffect(() => {
    controller.current = new AbortController();
    return () => controller.current.abort();
  }, []);
  async function run<T>(
    path: string,
    method: string,
    body: unknown = {},
    headers?: Record<string, string>,
  ): Promise<T | undefined> {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setMessage("");
    setOutcome(null);
    try {
      const r = await studentRequest<T>(
        path,
        controller.current.signal,
        method,
        body,
        logical.current.key({ path, method, body, headers }),
        headers,
      );
      if (controller.current.signal.aborted) return;
      logical.current.success();
      setMessage("Đã lưu thay đổi.");
      setOutcome("success");
      setRevision((value) => value + 1);
      return r.data;
    } catch (e) {
      if (!controller.current.signal.aborted) {
        setMessage(studentError(e));
        setOutcome("failure");
        setRevision((value) => value + 1);
      }
      return;
    } finally {
      flight.current = false;
      if (!controller.current.signal.aborted) setBusy(false);
    }
  }
  return {
    run,
    busy,
    message,
    outcome,
    revision,
    clear: () => {
      setMessage("");
      setOutcome(null);
    },
  };
}
export const monthNow = () => new Date().toISOString().slice(0, 7);
export const rangeForMonth = (month: string) => ({
  from: month + "-01",
  to: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10),
});
export function dateLabel(value: string, timezone = "Asia/Ho_Chi_Minh") {
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date(value));
  } catch {
    return "Thời gian chưa xác định";
  }
}
export const isUuid = (s: string) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(s);
export function safeContentUrl(value?: string) {
  if (!value) return undefined;
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password ? u.href : undefined;
  } catch {
    return undefined;
  }
}
