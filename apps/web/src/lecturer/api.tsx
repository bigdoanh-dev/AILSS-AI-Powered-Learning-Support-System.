import { useEffect, useState } from "react";
import { ApiError, errorMessage } from "../lib/api";
import { useSession } from "../auth/session";
export type Envelope<T> = {
  data: T;
  meta?: {
    nextCursor?: string;
    page?: { nextCursor: string | null };
    pagination?: { nextCursor: string | null };
  };
};
const logicalCommands = new Map<string, string>();
export async function lecturerRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
  signal = new AbortController().signal,
): Promise<Envelope<T>> {
  const fingerprint = method === "GET" ? "" : `${method}|${path}|${JSON.stringify(body ?? {})}`;
  const implicitKey = fingerprint ? logicalCommands.get(fingerprint) || crypto.randomUUID() : "";
  if (fingerprint && !logicalCommands.has(fingerprint)) logicalCommands.set(fingerprint, implicitKey);
  const r = await fetch("/web-session/lecturer" + path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
    headers: {
      Accept: "application/json",
      ...(method !== "GET" ? { "Content-Type": "application/json", "Idempotency-Key": implicitKey } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const value = await r.json();
  if (!r.ok) {
    if (
      r.status === 401 ||
      ["LECTURER_REQUIRED", "LECTURER_VERIFICATION_REQUIRED", "ACCOUNT_DISABLED"].includes(value.error?.code)
    )
      window.dispatchEvent(new Event("ailss-session-invalid"));
    throw new ApiError(r.status, value.error?.code || "UNAVAILABLE");
  }
  if (fingerprint) logicalCommands.delete(fingerprint);
  return value;
}
export function lecturerError(e: unknown) {
  if (e instanceof ApiError) {
    if (e.code === "REVENUE_PROJECTION_NOT_READY")
      return "Báo cáo doanh thu đang chờ đồng bộ dữ liệu thanh toán và hoàn tiền. Vui lòng kiểm tra lại sau ít phút.";
    if (e.status === 403)
      return e.code === "LECTURER_VERIFICATION_REQUIRED"
        ? "Tài khoản Giảng viên cần được xác minh."
        : "Bạn không có quyền thực hiện thao tác này.";
    if (e.status === 404) return "Không tìm thấy dữ liệu hoặc bạn không sở hữu tài nguyên.";
    if (e.code === "SCHEDULE_CONFLICT" || e.code === "SESSION_OVERLAP_CONFLICT")
      return "Lịch bị trùng với một buổi học hiện có. Giữ nguyên nội dung và chọn thời gian khác.";
    if (e.code === "ATTENDANCE_VERSION_CONFLICT")
      return "Điểm danh đã thay đổi. Dữ liệu mới nhất đã được tải lại.";
    if (e.code.includes("VERSION")) return "Dữ liệu đã thay đổi. Hãy tải lại trước khi lưu.";
    if (e.code.includes("STATE") || e.code.includes("EDITABLE"))
      return "Trạng thái hiện tại không cho phép thao tác này.";
    if (e.status === 503) return "Dịch vụ tạm thời không khả dụng. Hãy thử lại.";
  }
  return errorMessage(e);
}
export function useLecturer<T>(path: string | null) {
  const { profile } = useSession(),
    identity = profile?.role === "LECTURER" && profile.lecturerVerified ? profile.userId : "",
    scope = identity + "|" + path;
  const [rev, setRev] = useState(0),
    [state, setState] = useState<{ scope: string; data?: Envelope<T>; error?: unknown }>({ scope: "" });
  useEffect(() => {
    const c = new AbortController();
    setState({ scope });
    if (identity && path)
      lecturerRequest<T>(path, "GET", undefined, {}, c.signal)
        .then((data) => !c.signal.aborted && setState({ scope, data }))
        .catch((error) => !c.signal.aborted && setState({ scope, error }));
    return () => c.abort();
  }, [scope, rev, identity, path]);
  const x = state.scope === scope ? state : undefined;
  return {
    data: x?.data?.data,
    meta: x?.data?.meta,
    error: x?.error,
    pending: !!path && !x?.data && !x?.error,
    retry: () => setRev((n) => n + 1),
  };
}
export const month = () => new Date().toISOString().slice(0, 7);
export const range = () => {
  const a = new Date(),
    b = new Date(a);
  b.setUTCDate(b.getUTCDate() + 30);
  return `from=${a.toISOString().slice(0, 10)}&to=${b.toISOString().slice(0, 10)}`;
};
