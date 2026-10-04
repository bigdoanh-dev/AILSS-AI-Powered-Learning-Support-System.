import { useUiText } from "../lib/i18n";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { sessionRequest } from "./session";
import { ApiError, errorMessage } from "../lib/api";

export function PasswordReset() {
  const uiText = useUiText();
  const [step, setStep] = useState<"email" | "code" | "password" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const token = useRef("");
  const flight = useRef(false);
  const active = useRef(true);
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000));
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      token.current = "";
    };
  }, []);
  useEffect(() => {
    if (!resendAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);

  async function send(operation: "request" | "verify" | "complete") {
    if (flight.current || (operation === "request" && Date.now() < resendAt)) return;
    if (
      operation === "complete" &&
      (password.length < 12 || password.length > 128 || password !== confirmation)
    ) {
      setError("Mật khẩu cần 12–128 ký tự và hai lần nhập phải giống nhau.");
      return;
    }
    flight.current = true;
    setBusy(true);
    setError("");
    const normalizedEmail = email.trim().toLowerCase();
    try {
      const body =
        operation === "request"
          ? { email: normalizedEmail }
          : operation === "verify"
            ? { email: normalizedEmail, code }
            : {
                email: normalizedEmail,
                resetToken: token.current,
                newPassword: password,
                confirmPassword: confirmation,
              };
      const result = await sessionRequest<{
        accepted?: boolean;
        resetToken?: string;
        passwordReset?: boolean;
      }>(`auth/password-reset/${operation}`, "POST", body);
      if (!active.current) return;
      if (operation === "request") {
        if (result.accepted !== true) throw new Error("Invalid reset response");
        setEmail(normalizedEmail);
        setCode("");
        token.current = "";
        setResendAt(Date.now() + 60_000);
        setNow(Date.now());
        setStep("code");
      } else if (operation === "verify") {
        if (typeof result.resetToken !== "string" || !/^[A-Za-z0-9_-]{40,128}$/.test(result.resetToken))
          throw new Error("Invalid reset response");
        token.current = result.resetToken;
        setCode("");
        setStep("password");
      } else {
        if (result.passwordReset !== true) throw new Error("Invalid reset response");
        token.current = "";
        setPassword("");
        setConfirmation("");
        setResendAt(0);
        setStep("done");
      }
    } catch (cause) {
      if (!active.current) return;
      setError(errorMessage(cause));
      if (cause instanceof ApiError && cause.code === "INVALID_PASSWORD_RESET_TOKEN") {
        token.current = "";
        setPassword("");
        setConfirmation("");
        setStep("code");
      }
    } finally {
      flight.current = false;
      if (active.current) setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void send(step === "email" ? "request" : step === "code" ? "verify" : "complete");
  }
  function changeEmail() {
    token.current = "";
    setCode("");
    setPassword("");
    setConfirmation("");
    setError("");
    setStep("email");
  }

  return (
    <div className="forgot-password-card auth-form-card">
      <h2>{step === "done" ? uiText("Đặt lại mật khẩu thành công") : uiText("Quên mật khẩu?")}</h2>
      {step === "done" ? (
        <>
          <p>{uiText("Mật khẩu mới đã được lưu. Hãy đăng nhập lại để tiếp tục học tập.")}</p>
          <Link to="/auth/login" className="button auth-submit-btn">
            {uiText("Đến trang đăng nhập")}
          </Link>
        </>
      ) : (
        <>
          <ol className="forgot-reset-progress" aria-label={uiText("Các bước đặt lại mật khẩu")}>
            {["Email", "Mã OTP", "Mật khẩu mới"].map((label, index) => (
              <li
                key={label}
                aria-current={index === ["email", "code", "password"].indexOf(step) ? "step" : undefined}
              >
                {index + 1}. {label}
              </li>
            ))}
          </ol>
          {step === "email" ? (
            <p>{uiText("Nhập email đã đăng ký để nhận mã đặt lại mật khẩu.")}</p>
          ) : (
            <p>
              {uiText("Nếu email ")}
              <strong>{email}</strong>{" "}
              {uiText(
                " có tài khoản dùng mật khẩu, bạn sẽ nhận mã OTP gồm 6 chữ số. Mã có hiệu lực 15 phút. Kiểm tra cả thư rác.",
              )}
            </p>
          )}
          {error && (
            <p className="form-status" role="alert">
              {uiText(error)}
            </p>
          )}
          <form key={step} className="forgot-reset-form" onSubmit={submit} aria-busy={busy}>
            {step === "email" && (
              <label className="auth-field-label">
                <span className="label-text">{uiText("Email đăng ký")}</span>
                <input
                  className="auth-input"
                  type="email"
                  autoFocus
                  autoComplete="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                />
              </label>
            )}
            {step === "code" && (
              <label className="auth-field-label">
                <span className="label-text">{uiText("Mã OTP")}</span>
                <input
                  className="auth-input forgot-otp-input"
                  inputMode="numeric"
                  autoFocus
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  required
                  minLength={6}
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  disabled={busy}
                />
              </label>
            )}
            {step === "password" && (
              <>
                <label className="auth-field-label">
                  <span className="label-text">{uiText("Mật khẩu mới")}</span>
                  <input
                    className="auth-input"
                    type="password"
                    autoFocus
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={128}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                    aria-describedby="reset-password-help"
                  />
                </label>
                <p id="reset-password-help" className="auth-reset-hint">
                  {uiText("Dùng 12–128 ký tự.")}
                </p>
                <label className="auth-field-label">
                  <span className="label-text">{uiText("Nhập lại mật khẩu mới")}</span>
                  <input
                    className="auth-input"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    maxLength={128}
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    disabled={busy}
                  />
                </label>
              </>
            )}
            <button
              type="submit"
              className="button auth-submit-btn"
              disabled={busy || (step === "email" && remaining > 0)}
            >
              {busy
                ? uiText("Đang xử lý…")
                : step === "email"
                  ? remaining > 0
                    ? uiText("Gửi mã sau {0}s", [remaining])
                    : uiText("Gửi mã OTP")
                  : step === "code"
                    ? uiText("Xác nhận mã OTP")
                    : uiText("Lưu mật khẩu mới")}
            </button>
          </form>
          {step === "code" && (
            <button
              type="button"
              className="forgot-back-step"
              disabled={busy || remaining > 0}
              onClick={() => void send("request")}
            >
              {remaining > 0 ? uiText("Gửi lại mã sau {0}s", [remaining]) : uiText("Gửi lại mã OTP")}
            </button>
          )}
          {step !== "email" && (
            <button type="button" className="forgot-back-step" disabled={busy} onClick={changeEmail}>
              {uiText("Đổi email / bắt đầu lại")}
            </button>
          )}
          <Link to="/auth/login" className="forgot-back-step">
            {uiText("Quay lại đăng nhập")}
          </Link>
        </>
      )}
    </div>
  );
}
