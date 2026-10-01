import { ApiError, record, type Transport } from "./api";

export class PasswordResetApi {
  constructor(private readonly api: Pick<Transport, "request">) {}
  async requestCode(email: string) {
    const value = record(
      await this.api.request("/api/v1/auth/password-reset/request", {
        method: "POST",
        body: { email: email.trim().toLowerCase() },
        timeoutMs: 55_000,
      }),
    );
    if (value.accepted !== true) throw new ApiError("invalid");
  }
  async verifyCode(email: string, code: string): Promise<string> {
    const value = record(
      await this.api.request("/api/v1/auth/password-reset/verify", {
        method: "POST",
        body: { email: email.trim().toLowerCase(), code },
      }),
    );
    if (typeof value.resetToken !== "string" || !/^[A-Za-z0-9_-]{40,128}$/.test(value.resetToken))
      throw new ApiError("invalid");
    return value.resetToken;
  }
  async complete(email: string, resetToken: string, newPassword: string, confirmPassword: string) {
    const value = record(
      await this.api.request("/api/v1/auth/password-reset/complete", {
        method: "POST",
        body: { email: email.trim().toLowerCase(), resetToken, newPassword, confirmPassword },
        timeoutMs: 30_000,
      }),
    );
    if (value.passwordReset !== true) throw new ApiError("invalid");
  }
}

export function passwordResetError(error: unknown): string {
  const messages: Record<string, string> = {
    PASSWORD_RESET_EMAIL_UNAVAILABLE:
      "Chức năng gửi mã chưa được cấu hình email. Vui lòng báo quản trị viên.",
    INVALID_PASSWORD_RESET_CODE: "Mã OTP không đúng, đã hết hạn hoặc đã vượt quá số lần thử.",
    INVALID_PASSWORD_RESET_TOKEN: "Phiên đặt lại mật khẩu hết hạn. Hãy yêu cầu mã OTP mới.",
    PASSWORD_RESET_UNAVAILABLE: "Chưa thể lưu mật khẩu mới. Vui lòng thử lại sau.",
    PASSWORD_RESET_VALIDATION_FAILED: "Vui lòng kiểm tra email, mã OTP và mật khẩu đã nhập.",
  };
  return error instanceof ApiError
    ? (messages[error.code ?? ""] ?? error.message)
    : "Không thể hoàn tất yêu cầu. Vui lòng thử lại.";
}
