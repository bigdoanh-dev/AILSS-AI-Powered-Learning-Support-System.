const API_ERROR_MESSAGES: Record<string, string> = {
  network: "Không thể kết nối. Kiểm tra mạng rồi thử lại.",
  timeout: "Kết nối quá thời gian. Vui lòng thử lại.",
  cancelled: "Yêu cầu đã hủy.",
  invalid: "Dữ liệu phản hồi không hợp lệ.",
  401: "Phiên đăng nhập đã hết hạn.",
  403: "Bạn không có quyền thực hiện.",
  404: "Không tìm thấy dữ liệu.",
  409: "Dữ liệu đã thay đổi. Vui lòng thử lại.",
  422: "Vui lòng kiểm tra thông tin đã nhập.",
  429: "Quá nhiều yêu cầu. Vui lòng đợi.",
  server: "Dịch vụ tạm thời không khả dụng.",
};

export class ApiError extends Error {
  constructor(
    public kind: string,
    public status = 0,
    public requestId?: string,
    public code?: string,
  ) {
    super(
      code === "SOCIAL_PROVIDER_UNAVAILABLE"
        ? "Dịch vụ xác thực Google/Apple tạm thời không kết nối được. Vui lòng thử lại sau."
        : code === "ATTEMPT_LIMIT_REACHED"
          ? "Bạn đã dùng hết số lần làm bài cho phép."
          : (API_ERROR_MESSAGES[kind] ?? "Không thể hoàn tất yêu cầu."),
    );
  }
}
export type RequestOptions = {
  includeMeta?: boolean;
  method?: string;
  body?: unknown;
  token?: string;
  signal?: AbortSignal;
  idempotencyKey?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
};
export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
function createCorrelationId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  // Correlation IDs are identifiers, not credentials; UUID format lets the Gateway trust them.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/gu, (character) => {
    const value = Math.floor(Math.random() * 16);
    return (character === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}
export class Transport {
  constructor(
    readonly origin: string,
    private fetcher: Fetcher = fetch,
    private timeout = 12000,
    private readonly requestId: () => string = createCorrelationId,
  ) {}
  async request(path: string, options: RequestOptions = {}): Promise<unknown> {
    if (!path.startsWith("/api/v1/") || path.includes("://") || path.includes(".."))
      throw new ApiError("invalid");
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort();
    if (options.signal?.aborted) cancel();
    options.signal?.addEventListener("abort", cancel);
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs ?? this.timeout);
    try {
      const response = await this.fetcher(this.origin + path, {
        method: options.method ?? "GET",
        redirect: "error",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "X-Correlation-Id": this.requestId(),
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
          ...(options.headers ?? {}),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      if (response.url && new URL(response.url).origin !== this.origin) throw new ApiError("invalid");
      const id = response.headers.get("x-request-id") ?? undefined;
      if (!response.ok) {
        let code: string | undefined;
        try {
          const raw: unknown = await response.clone().json();
          if (raw && typeof raw === "object") {
            const err = (raw as Record<string, unknown>).error;
            if (err && typeof err === "object" && typeof (err as Record<string, unknown>).code === "string") {
              code = (err as Record<string, unknown>).code as string;
            } else if (typeof (raw as Record<string, unknown>).code === "string") {
              code = (raw as Record<string, unknown>).code as string;
            }
          }
        } catch {
          // Ignore non-JSON response bodies
        }
        throw new ApiError(
          response.status >= 500 ? "server" : String(response.status),
          response.status,
          id,
          code,
        );
      }
      if (response.status === 204) return null;
      const payload: unknown = await response.json().catch(() => {
        throw new ApiError("invalid", response.status, id);
      });
      if (!payload || typeof payload !== "object" || !("data" in payload))
        throw new ApiError("invalid", response.status, id);
      return options.includeMeta ? payload : payload.data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(timedOut ? "timeout" : controller.signal.aborted ? "cancelled" : "network");
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
    }
  }
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ApiError("invalid");
  return value as Record<string, unknown>;
}
export function string(value: unknown): string {
  if (typeof value !== "string" || !value) throw new ApiError("invalid");
  return value;
}
export type Role = "STUDENT" | "LECTURER" | "ADMIN";
export type Profile = { userId: string; displayName: string; emailMasked: string; role: Role };
export function profile(value: unknown): Profile {
  const x = record(value);
  if (!["STUDENT", "LECTURER", "ADMIN"].includes(String(x.role)) || x.status !== "ACTIVE")
    throw new ApiError("401", 401);
  return {
    userId: string(x.userId),
    displayName: string(x.displayName),
    emailMasked: string(x.emailMasked),
    role: x.role as Role,
  };
}
export type Tokens = { accessToken: string; refreshToken: string; sessionId: string };
export function tokens(value: unknown): Tokens {
  const x = record(value);
  return {
    accessToken: string(x.accessToken),
    refreshToken: string(x.refreshToken),
    sessionId: string(x.sessionId),
  };
}
