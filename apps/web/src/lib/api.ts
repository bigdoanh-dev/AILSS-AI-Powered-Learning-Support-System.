export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    signal: init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok) throw new ApiError(response.status, `HTTP_${response.status}`);
  return response.json() as Promise<T>;
}
export function errorMessage(error: unknown): string {
  if (typeof navigator !== "undefined" && !navigator.onLine)
    return "Bạn đang ngoại tuyến. Kết nối lại rồi thử lại.";
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      LOGIN_NOT_ALLOWED: "Tài khoản không được phép đăng nhập. Liên hệ quản trị viên.",
      INVALID_REAUTHENTICATION: "Mật khẩu hiện tại không đúng. Vui lòng kiểm tra lại.",
      ACCOUNT_DISABLED: "Tài khoản đã bị vô hiệu hóa. Liên hệ quản trị viên.",
      INVALID_REFRESH_CREDENTIALS: "Phiên đã hết hạn hoặc bị thu hồi. Vui lòng đăng nhập lại.",
      SESSION_EXPIRED: "Phiên đã hết hạn. Vui lòng đăng nhập lại.",
      SOCIAL_PROVIDER_NOT_CONFIGURED: "Đăng nhập xã hội chưa được cấu hình cho môi trường này.",
      SOCIAL_PROVIDER_UNAVAILABLE:
        "Dịch vụ xác thực Google/Apple tạm thời không kết nối được. Vui lòng thử lại sau.",
      AUDIENCE_MISMATCH: "Ứng dụng đăng nhập chưa khớp cấu hình Google/Apple. Vui lòng báo quản trị viên.",
      UNTRUSTED_ISSUER: "Không xác thực được nhà cung cấp đăng nhập. Vui lòng thử lại.",
      UNVERIFIED_EMAIL: "Nhà cung cấp chưa xác minh email của tài khoản này.",
      INVALID_TOKEN: "Token đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.",
      REFRESH_OUTCOME_UNKNOWN:
        "Không xác nhận được lần gia hạn phiên. Vui lòng đăng nhập lại để tiếp tục an toàn.",
      ORIGIN_REJECTED: "Không thể xác nhận nguồn yêu cầu. Mở lại trang trên địa chỉ chính thức.",
      LOGOUT_PENDING: "Phiên đang được đăng xuất. Vui lòng chờ.",
      PASSWORD_RESET_EMAIL_UNAVAILABLE:
        "Chức năng gửi mã đặt lại mật khẩu chưa được cấu hình email. Vui lòng báo quản trị viên.",
      INVALID_PASSWORD_RESET_CODE: "Mã OTP không đúng, đã hết hạn hoặc đã vượt quá số lần thử.",
      INVALID_PASSWORD_RESET_TOKEN: "Phiên đặt lại mật khẩu không còn hợp lệ. Hãy yêu cầu mã OTP mới.",
      PASSWORD_RESET_UNAVAILABLE: "Chưa thể lưu mật khẩu mới. Vui lòng thử lại sau.",
      PASSWORD_RESET_VALIDATION_FAILED: "Vui lòng kiểm tra email, mã OTP và mật khẩu đã nhập.",
    };
    if (messages[error.code]) return messages[error.code];
    return (
      (
        {
          400: "Yêu cầu chưa hợp lệ. Vui lòng kiểm tra thông tin và thử lại.",
          401: "Email hoặc mật khẩu không đúng.",
          403: "Tài khoản chưa được phép thực hiện thao tác này.",
          404: "Không tìm thấy nội dung công khai này.",
          409: "Thông tin đã tồn tại hoặc yêu cầu bị xung đột. Vui lòng kiểm tra lại.",
          422: "Vui lòng kiểm tra thông tin đã nhập.",
          429: "Có quá nhiều yêu cầu. Vui lòng chờ rồi thử lại.",
        } as Record<number, string>
      )[error.status] || "Dịch vụ đang tạm thời không khả dụng. Vui lòng thử lại sau."
    );
  }
  return "Không thể kết nối dịch vụ. Kiểm tra kết nối và thử lại.";
}
export interface Course {
  coverDataUrl?: string | null;
  description?: string;
  courseId: string;
  title: string;
  slug: string;
  categoryId: string;
  lecturerId: string;
  priceType: string;
  price: string;
  currency: string;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
}
export interface Catalog {
  data: Course[];
  meta: { pagination: { hasMore: boolean; nextCursor: string | null } };
}
export const normalizeQuery = (q: string) =>
  q
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
    .split(/\s+/u)[0]
    .replace(/[^a-z0-9]/gu, "");
export function searchCourses(q: string, cursor?: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ q, limit: "12" });
  if (cursor) params.set("cursor", cursor);
  return request<Catalog>(`/courses/search?${params}`, { signal });
}
export function priceLabel(course: Course) {
  if (course.priceType === "FREE") return "Miễn phí";
  try {
    return new Intl.NumberFormat("vi-VN", { style: "currency", currency: course.currency }).format(
      Number(course.price),
    );
  } catch {
    return `${course.price} ${course.currency}`;
  }
}
