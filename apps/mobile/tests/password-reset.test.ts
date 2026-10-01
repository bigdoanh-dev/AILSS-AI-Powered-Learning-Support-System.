import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api";
import { PasswordResetApi, passwordResetError } from "../src/password-reset";

describe("anonymous password recovery API", () => {
  it("normalizes email and sends the three backend contracts without bearer credentials", async () => {
    const token = "a".repeat(43);
    const request = vi
      .fn()
      .mockResolvedValueOnce({ accepted: true })
      .mockResolvedValueOnce({ resetToken: token })
      .mockResolvedValueOnce({ passwordReset: true });
    const api = new PasswordResetApi({ request });
    await api.requestCode(" Test@Example.Invalid ");
    expect(await api.verifyCode(" Test@Example.Invalid ", "123456")).toBe(token);
    await api.complete(" Test@Example.Invalid ", token, "NewPassword!123", "NewPassword!123");
    expect(request.mock.calls[0]?.[1].timeoutMs).toBe(55_000);
    expect(request.mock.calls.map(([path, options]) => [path, options.body, options.token])).toEqual([
      ["/api/v1/auth/password-reset/request", { email: "test@example.invalid" }, undefined],
      ["/api/v1/auth/password-reset/verify", { email: "test@example.invalid", code: "123456" }, undefined],
      [
        "/api/v1/auth/password-reset/complete",
        {
          email: "test@example.invalid",
          resetToken: token,
          newPassword: "NewPassword!123",
          confirmPassword: "NewPassword!123",
        },
        undefined,
      ],
    ]);
  });
  it.each([{ resetToken: "" }, { resetToken: "bad" }, { resetToken: null }, {}])(
    "rejects malformed verification responses %j",
    async (value) => {
      const api = new PasswordResetApi({ request: vi.fn().mockResolvedValue(value) });
      await expect(api.verifyCode("test@example.invalid", "123456")).rejects.toMatchObject({
        kind: "invalid",
      });
    },
  );
  it("does not show completion when the backend has not confirmed it", async () => {
    const api = new PasswordResetApi({ request: vi.fn().mockResolvedValue({ passwordReset: false }) });
    await expect(
      api.complete("test@example.invalid", "a".repeat(43), "NewPassword!123", "NewPassword!123"),
    ).rejects.toMatchObject({ kind: "invalid" });
  });
  it.each([
    ["INVALID_PASSWORD_RESET_CODE", "Mã OTP không đúng"],
    ["INVALID_PASSWORD_RESET_TOKEN", "yêu cầu mã OTP mới"],
    ["PASSWORD_RESET_EMAIL_UNAVAILABLE", "chưa được cấu hình email"],
    ["PASSWORD_RESET_UNAVAILABLE", "Chưa thể lưu mật khẩu"],
  ])("explains %s", (code, message) => {
    expect(passwordResetError(new ApiError("server", 503, undefined, code))).toContain(message);
  });
});
