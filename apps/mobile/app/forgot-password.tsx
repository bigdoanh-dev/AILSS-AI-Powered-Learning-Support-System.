import { useEffect, useMemo, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { ApiError } from "../src/api";
import { runtime } from "../src/runtime";
import { PasswordResetApi, passwordResetError } from "../src/password-reset";
import { Button, Page, PasswordInput, styles } from "../src/ui";

export default function ForgotPassword() {
  const api = useMemo(() => new PasswordResetApi(runtime!.api), []);
  const [step, setStep] = useState<"email" | "code" | "password" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
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
    try {
      if (operation === "request") {
        await api.requestCode(email);
        if (!active.current) return;
        setEmail(email.trim().toLowerCase());
        setCode("");
        token.current = "";
        setResendAt(Date.now() + 60_000);
        setNow(Date.now());
        setStep("code");
      } else if (operation === "verify") {
        const verified = await api.verifyCode(email, code);
        if (!active.current) return;
        token.current = verified;
        setCode("");
        setStep("password");
      } else {
        await api.complete(email, token.current, password, confirmation);
        if (!active.current) return;
        token.current = "";
        setPassword("");
        setConfirmation("");
        setResendAt(0);
        setStep("done");
      }
    } catch (cause) {
      if (!active.current) return;
      setError(passwordResetError(cause));
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
  function changeEmail() {
    token.current = "";
    setCode("");
    setPassword("");
    setConfirmation("");
    setError("");
    setStep("email");
  }
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  return (
    <Page>
      <Text style={styles.title} accessibilityRole="header">
        {step === "done" ? "Đặt lại mật khẩu thành công" : "Quên mật khẩu?"}
      </Text>
      {step === "done" ? (
        <>
          <Text style={styles.text}>Mật khẩu mới đã được lưu. Hãy đăng nhập lại để tiếp tục học tập.</Text>
          <Button label="Đến trang đăng nhập" onPress={() => router.replace("/login")} />
        </>
      ) : (
        <View style={{ gap: 16 }}>
          <Text style={styles.small}>
            Bước {step === "email" ? "1/3 · Email" : step === "code" ? "2/3 · Mã OTP" : "3/3 · Mật khẩu mới"}
          </Text>
          <Text style={styles.text}>
            {step === "email"
              ? "Nhập email đã đăng ký để nhận mã đặt lại mật khẩu."
              : `Nếu email ${email} có tài khoản dùng mật khẩu, bạn sẽ nhận mã OTP gồm 6 chữ số. Mã có hiệu lực 15 phút. Kiểm tra cả thư rác.`}
          </Text>
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          {step === "email" && (
            <>
              <Text style={styles.text}>Email đăng ký</Text>
              <TextInput
                accessibilityLabel="Email đăng ký"
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                maxLength={254}
                editable={!busy}
              />
            </>
          )}
          {step === "code" && (
            <>
              <Text style={styles.text}>Mã OTP</Text>
              <TextInput
                accessibilityLabel="Mã OTP"
                style={[styles.input, { textAlign: "center", letterSpacing: 6 }]}
                value={code}
                onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={6}
                editable={!busy}
              />
            </>
          )}
          {step === "password" && (
            <>
              <Text style={styles.text}>Mật khẩu mới</Text>
              <PasswordInput
                key="new"
                accessibilityLabel="Mật khẩu mới"
                value={password}
                onChangeText={setPassword}
                autoComplete="new-password"
                maxLength={128}
                editable={!busy}
              />
              <Text style={styles.small}>Dùng 12–128 ký tự.</Text>
              <Text style={styles.text}>Nhập lại mật khẩu mới</Text>
              <PasswordInput
                key="confirm"
                accessibilityLabel="Nhập lại mật khẩu mới"
                value={confirmation}
                onChangeText={setConfirmation}
                autoComplete="new-password"
                maxLength={128}
                editable={!busy}
              />
            </>
          )}
          <Button
            label={
              busy
                ? "Đang xử lý…"
                : step === "email"
                  ? remaining > 0
                    ? `Gửi mã sau ${remaining}s`
                    : "Gửi mã OTP"
                  : step === "code"
                    ? "Xác nhận mã OTP"
                    : "Lưu mật khẩu mới"
            }
            onPress={() => void send(step === "email" ? "request" : step === "code" ? "verify" : "complete")}
            disabled={
              busy ||
              (step === "email" && (!validEmail || remaining > 0)) ||
              (step === "code" && !/^\d{6}$/.test(code)) ||
              (step === "password" && (!password || !confirmation))
            }
          />
          {step === "code" && (
            <Button
              variant="secondary"
              label={remaining > 0 ? `Gửi lại mã sau ${remaining}s` : "Gửi lại mã OTP"}
              disabled={busy || remaining > 0}
              onPress={() => void send("request")}
            />
          )}
          {step !== "email" && (
            <Button variant="ghost" label="Đổi email / bắt đầu lại" disabled={busy} onPress={changeEmail} />
          )}
          <Button variant="ghost" label="Quay lại đăng nhập" onPress={() => router.replace("/login")} />
          <Text style={styles.small}>
            Nếu dùng Google để đăng nhập, bạn có thể tiếp tục bằng nút Google trên trang đăng nhập.
          </Text>
        </View>
      )}
    </Page>
  );
}
