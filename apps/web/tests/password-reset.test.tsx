import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PasswordReset } from "../src/auth/PasswordReset";

const email = "test@example.invalid";
const token = "a".repeat(43);
const password = "NewPassword!123";
const ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) });
const failure = (code: string, status = 400) => ({
  ok: false,
  status,
  json: async () => ({ error: { code } }),
});
function show() {
  render(
    <MemoryRouter initialEntries={["/auth/forgot-password"]}>
      <Routes>
        <Route path="/auth/forgot-password" element={<PasswordReset />} />
        <Route path="/auth/login" element={<p>Trang đăng nhập</p>} />
      </Routes>
    </MemoryRouter>,
  );
}
async function requestCode() {
  fireEvent.change(screen.getByLabelText("Email đăng ký"), { target: { value: " Test@Example.Invalid " } });
  fireEvent.submit(screen.getByRole("button", { name: "Gửi mã OTP" }).closest("form")!);
  await screen.findByLabelText("Mã OTP");
}
async function verifyCode() {
  fireEvent.change(screen.getByLabelText("Mã OTP"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Xác nhận mã OTP" }));
  await screen.findByLabelText("Mật khẩu mới");
}
function enterPassword(confirm = password) {
  fireEvent.change(screen.getByLabelText("Mật khẩu mới"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Nhập lại mật khẩu mới"), { target: { value: confirm } });
  fireEvent.click(screen.getByRole("button", { name: "Lưu mật khẩu mới" }));
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("password recovery", () => {
  it("requests an email OTP, verifies it, saves matching passwords, and returns to login", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(ok({ accepted: true }))
      .mockResolvedValueOnce(ok({ resetToken: token }))
      .mockResolvedValueOnce(ok({ passwordReset: true }));
    vi.stubGlobal("fetch", fetcher);
    show();
    await requestCode();
    await verifyCode();
    expect(document.body.textContent).not.toContain(token);
    enterPassword();
    await screen.findByText("Đặt lại mật khẩu thành công");
    expect(fetcher.mock.calls.map(([url, init]) => [url, JSON.parse(init.body)])).toEqual([
      ["/web-session/auth/password-reset/request", { email }],
      ["/web-session/auth/password-reset/verify", { email, code: "123456" }],
      [
        "/web-session/auth/password-reset/complete",
        { email, resetToken: token, newPassword: password, confirmPassword: password },
      ],
    ]);
    fireEvent.click(screen.getByRole("link", { name: "Đến trang đăng nhập" }));
    await screen.findByText("Trang đăng nhập");
  });
  it("keeps invalid or expired OTP errors on the code screen", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(ok({ accepted: true }))
        .mockResolvedValueOnce(failure("INVALID_PASSWORD_RESET_CODE")),
    );
    show();
    await requestCode();
    fireEvent.change(screen.getByLabelText("Mã OTP"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận mã OTP" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Mã OTP không đúng");
    expect(screen.getByLabelText("Mã OTP")).toBeTruthy();
  });
  it("does not submit mismatched passwords", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(ok({ accepted: true }))
      .mockResolvedValueOnce(ok({ resetToken: token }));
    vi.stubGlobal("fetch", fetcher);
    show();
    await requestCode();
    await verifyCode();
    enterPassword("OtherPassword!123");
    expect((await screen.findByRole("alert")).textContent).toContain("hai lần nhập phải giống nhau");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("clears passwords and asks for a new code when the reset token expires", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(ok({ accepted: true }))
        .mockResolvedValueOnce(ok({ resetToken: token }))
        .mockResolvedValueOnce(failure("INVALID_PASSWORD_RESET_TOKEN")),
    );
    show();
    await requestCode();
    await verifyCode();
    enterPassword();
    await screen.findByLabelText("Mã OTP");
    expect(screen.getByRole("alert").textContent).toContain("yêu cầu mã OTP mới");
    expect(screen.queryByLabelText("Mật khẩu mới")).toBeNull();
  });
  it("shows an email service failure without advancing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failure("PASSWORD_RESET_EMAIL_UNAVAILABLE", 503)));
    show();
    fireEvent.change(screen.getByLabelText("Email đăng ký"), { target: { value: email } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi mã OTP" }));
    expect((await screen.findByRole("alert")).textContent).toContain("chưa được cấu hình email");
    expect(screen.queryByLabelText("Mã OTP")).toBeNull();
  });
  it("allows resending only after 60 seconds and starts a new cooldown", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const fetcher = vi.fn().mockResolvedValue(ok({ accepted: true }));
    vi.stubGlobal("fetch", fetcher);
    show();
    await requestCode();
    expect((screen.getByRole("button", { name: /Gửi lại mã sau/ }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Gửi lại mã OTP" }));
    await screen.findByRole("button", { name: "Gửi lại mã sau 60s" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("ignores repeated submits while a request is pending", async () => {
    let resolve!: (value: unknown) => void;
    const fetcher = vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    show();
    fireEvent.change(screen.getByLabelText("Email đăng ký"), { target: { value: email } });
    const form = screen.getByRole("button", { name: "Gửi mã OTP" }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve(ok({ accepted: true }));
    });
    await screen.findByLabelText("Mã OTP");
  });
});
