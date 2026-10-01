import { ApiError, errorMessage } from "../lib/api";
const keys = new Map<string, string>();
export async function adminRequest<T>(
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
) {
  const fingerprint = method === "GET" ? "" : `${method}|${path}|${JSON.stringify(body)}`;
  const key = fingerprint ? keys.get(fingerprint) || crypto.randomUUID() : "";
  if (fingerprint) keys.set(fingerprint, key);
  const response = await fetch("/web-session/admin" + path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(method !== "GET" ? { "Content-Type": "application/json", "Idempotency-Key": key } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(path === "/assistant/chat" ? 65000 : 20000)])
      : AbortSignal.timeout(path === "/assistant/chat" ? 65000 : 20000),
  });
  const value = await response.json();
  if (!response.ok) throw new ApiError(response.status, value.error?.code || "UNAVAILABLE");
  if (fingerprint) keys.delete(fingerprint);
  return value as {
    data: T;
    meta?: {
      page?: { nextCursor: string | null };
      pagination?: { nextCursor: string | null; hasMore?: boolean };
      replayed?: boolean;
    };
  };
}
export function adminError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === "ADMIN_REAUTH_REJECTED" || error.code === "INVALID_REAUTHENTICATION")
      return "Mật khẩu hiện tại không đúng.";
    if (error.code.includes("VERSION") || error.status === 409)
      return "Dữ liệu đã thay đổi hoặc thao tác không còn hợp lệ. Hãy tải lại.";
    if (error.status === 403) return "Tài khoản Admin mới được xử lý báo cáo.";
  }
  return errorMessage(error);
}
