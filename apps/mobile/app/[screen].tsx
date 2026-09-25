import { useEffect, useState, useSyncExternalStore } from "react";
import { Text, TextInput, View, Image, Pressable } from "react-native";
import { router, useLocalSearchParams, useGlobalSearchParams, usePathname, type Href } from "expo-router";
import * as Crypto from "expo-crypto";
import { ApiError, record } from "../src/api";
import { runtime } from "../src/runtime";
import { destinations } from "../src/navigation";
import { items } from "../src/domain";
import { Page, Button, Icon, tokens, styles } from "../src/ui";

function goToResult(
  type: string,
  opts?: { role?: string; name?: string; email?: string; target?: string; message?: string },
) {
  const q = new URLSearchParams();
  q.set("type", type);
  if (opts?.role) q.set("role", opts.role);
  if (opts?.name) q.set("name", opts.name);
  if (opts?.email) q.set("email", opts.email);
  if (opts?.target) q.set("target", opts.target);
  if (opts?.message) q.set("message", opts.message);
  router.replace(`/result?${q.toString()}` as Href);
}

export default function Screen({ screenKey }: { screenKey?: string } = {}) {
  const local = useLocalSearchParams<{ screen?: string; role?: string }>();
  const global = useGlobalSearchParams<{ screen?: string; role?: string }>();
  const pathname = usePathname();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const rawPath =
    typeof pathname === "string"
      ? pathname.replace(/^\//, "").split("?")[0].split("/").filter(Boolean)[0]
      : "";
  const screen =
    screenKey || local.screen || global.screen || (rawPath && rawPath !== "[screen]" ? rawPath : undefined);
  const destination =
    destinations(snapshot.user?.role).find((item) => item.key === screen) ||
    (screen === "login"
      ? { key: "login", label: "Đăng nhập" }
      : screen === "register"
        ? { key: "register", label: "Đăng ký học viên" }
        : undefined);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [data, setData] = useState<ReturnType<typeof items> | null>(null);
  const [retry, setRetry] = useState(0);
  const [registrationKey, setRegistrationKey] = useState(() => Crypto.randomUUID());
  const [avatar, setAvatar] = useState<string | null>(null);
  const [avatarStatus, setAvatarStatus] = useState("loading");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  const path =
    screen === "courses"
      ? query
        ? `/api/v1/courses/search?q=${encodeURIComponent(query)}`
        : undefined
      : destination?.path;

  useEffect(() => {
    setAvatar(null);
    setAvatarStatus("loading");
    if (screen !== "account" || !snapshot.user) return;
    const abort = new AbortController();
    void session
      .request("/api/v1/me/avatar", { signal: abort.signal })
      .then((value) => {
        const url = record(value).dataUrl;
        if (
          url !== null &&
          (typeof url !== "string" ||
            url.length > 3000000 ||
            !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url))
        )
          throw new ApiError("invalid");
        if (!abort.signal.aborted) {
          setAvatar(url as string | null);
          setAvatarStatus(url ? "ready" : "empty");
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setAvatarStatus("error");
      });
    return () => abort.abort();
  }, [screen, session, snapshot.user?.userId, retry]);
  useEffect(() => {
    setData(null);
    setError("");
    if (!path) return;
    const abort = new AbortController();
    const request = snapshot.user
      ? session.request(path, { signal: abort.signal })
      : session.api.request(path, { signal: abort.signal });
    void request
      .then((value) => {
        if (!abort.signal.aborted) setData(items(value));
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted)
          setError(
            e instanceof ApiError
              ? `${e.message}${e.requestId ? ` Mã yêu cầu: ${e.requestId}` : ""}`
              : "Không thể tải dữ liệu.",
          );
      });
    return () => abort.abort();
  }, [path, retry, session, snapshot.user?.userId]);
  if (!destination)
    return (
      <Page>
        <Text style={styles.title}>Không gian đã thay đổi</Text>
        <Button
          label="Về trang chủ"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
        />
      </Page>
    );

  async function submit() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (screen === "register") {
        const response = record(
          await session.api.request("/api/v1/auth/register", {
            method: "POST",
            body: { email, password, displayName: name },
            idempotencyKey: registrationKey,
          }),
        );
        if (typeof response.userId !== "string") throw new ApiError("invalid");
        setRegistrationKey(Crypto.randomUUID());
        goToResult("register-success", { name, email });
      } else {
        await session.login(email, password);
        if (session.snapshot.state === "AUTHENTICATED") {
          const user = session.snapshot.user;
          const target =
            user?.role === "ADMIN"
              ? "/admin"
              : user?.role === "LECTURER"
                ? "/teaching"
                : "/";
          goToResult("login-success", {
            role: user?.role,
            name: user?.displayName,
            email: user?.emailMasked,
            target,
          });
        } else {
          goToResult("login-failure", {
            message: session.snapshot.error ?? "Email hoặc mật khẩu không chính xác.",
          });
        }
      }
    } catch (e: unknown) {
      goToResult("login-failure", {
        message: e instanceof ApiError ? e.message : "Không thể hoàn tất yêu cầu đăng nhập.",
      });
    } finally {
      setPassword("");
      setBusy(false);
    }
  }

  async function handleLogout() {
    try {
      await session.logout();
    } finally {
      goToResult("logout-success");
    }
  }
  return (
    <Page>
      <Text style={styles.title}>{destination.label}</Text>
      {screen === "courses" && (
        <>
          <Text style={styles.small}>Nhập từ khóa từ 3 đến 20 ký tự.</Text>
          <TextInput
            style={styles.input}
            accessibilityLabel="Từ khóa khóa học"
            value={search}
            onChangeText={setSearch}
            maxLength={20}
          />
          <Button
            label="Tìm khóa học"
            disabled={search.trim().length < 3}
            onPress={() => {
              setQuery(search.trim());
              setRetry((v) => v + 1);
            }}
          />
        </>
      )}
      {(screen === "login" || screen === "register") && (
        <View style={{ gap: 16 }}>
          {/* Brand Logo & Welcome */}
          <View style={{ alignItems: "center", paddingVertical: 12, gap: 8 }}>
            <View
              style={{
                width: 68,
                height: 68,
                borderRadius: 20,
                backgroundColor: tokens.color.brand,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 3,
                borderColor: tokens.color.brandLight,
                ...tokens.shadow.card,
              }}
            >
              <Icon name="academic" size={34} color="#FFF" />
            </View>
            <Text style={[styles.title, { textAlign: "center" }]}>
              {screen === "login" ? "Chào mừng trở lại!" : "Tạo tài khoản học viên"}
            </Text>
            <Text style={[styles.small, { textAlign: "center", maxWidth: 280 }]}>
              {screen === "login"
                ? "Đăng nhập để tiếp tục lộ trình học tập và kết nối cùng trợ lý AI."
                : "Gia nhập AILSS để trải nghiệm học tập thông minh hoàn toàn miễn phí."}
            </Text>
          </View>

          {/* Segmented Tab Switcher */}
          <View
            style={{
              flexDirection: "row",
              backgroundColor: "#E2E8F0",
              padding: 4,
              borderRadius: 14,
              gap: 4,
            }}
          >
            <Pressable
              onPress={() => router.replace("/login")}
              style={{
                flex: 1,
                paddingVertical: 10,
                alignItems: "center",
                borderRadius: 10,
                backgroundColor: screen === "login" ? "#FFF" : "transparent",
                ... (screen === "login" ? tokens.shadow.subtle : {}),
              }}
            >
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: screen === "login" ? "700" : "600",
                  color: screen === "login" ? tokens.color.ink : tokens.color.muted,
                }}
              >
                Đăng nhập
              </Text>
            </Pressable>
            <Pressable
              onPress={() => router.replace("/register")}
              style={{
                flex: 1,
                paddingVertical: 10,
                alignItems: "center",
                borderRadius: 10,
                backgroundColor: screen === "register" ? "#FFF" : "transparent",
                ... (screen === "register" ? tokens.shadow.subtle : {}),
              }}
            >
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: screen === "register" ? "700" : "600",
                  color: screen === "register" ? tokens.color.ink : tokens.color.muted,
                }}
              >
                Đăng ký học viên
              </Text>
            </Pressable>
          </View>

          {/* Form Card */}
          <View style={[styles.card, { padding: 22, gap: 14 }]}>
            {snapshot.state === "AUTHENTICATED" && snapshot.user && screen === "login" && (
              <View
                style={{
                  backgroundColor: "#F0FDF4",
                  padding: 12,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: "#BBF7D0",
                  gap: 6,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 12, color: "#166534", fontWeight: "700" }}>
                    Phiên hiện tại: {snapshot.user.displayName} ({snapshot.user.role})
                  </Text>
                  <Button
                    label="Đăng xuất"
                    size="sm"
                    variant="outline"
                    onPress={() => void handleLogout()}
                  />
                </View>
                <Text style={{ fontSize: 11, color: "#15803D" }}>
                  Bạn có thể nhập thông tin Quản trị viên bên dưới để chuyển sang tài khoản Admin.
                </Text>
              </View>
            )}
            {error && (
              <View
                style={{
                  backgroundColor: tokens.color.dangerLight,
                  padding: 12,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: "#FECACA",
                }}
              >
                <Text accessibilityRole="alert" style={styles.error}>
                  {error}
                </Text>
              </View>
            )}

            {message && (
              <View
                style={{
                  backgroundColor: tokens.color.successLight,
                  padding: 12,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: "#A7F3D0",
                }}
              >
                <Text style={{ color: "#065F46", fontSize: 14, fontWeight: "600" }}>{message}</Text>
              </View>
            )}

            {screen === "login" && (
              <Text style={styles.small}>
                Đăng nhập bằng Google và Apple đang chờ cấu hình OIDC cho ứng dụng.
              </Text>
            )}

            {screen === "register" && (
              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: tokens.color.inkSecondary }}>
                  Họ và tên hiển thị
                </Text>
                <TextInput
                  accessibilityLabel="Tên hiển thị"
                  style={styles.input}
                  placeholder="Ví dụ: Nguyễn Văn A"
                  placeholderTextColor={tokens.color.muted}
                  value={name}
                  onChangeText={(v) => {
                    setName(v);
                    setRegistrationKey(Crypto.randomUUID());
                  }}
                  autoComplete="name"
                />
              </View>
            )}

            <View style={{ gap: 6 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: tokens.color.inkSecondary }}>
                Địa chỉ Email
              </Text>
              <TextInput
                accessibilityLabel="Email"
                testID={screen === "login" ? "student-login-email" : undefined}
                style={styles.input}
                placeholder="name@domain.com"
                placeholderTextColor={tokens.color.muted}
                value={email}
                onChangeText={(v) => {
                  setEmail(v);
                  setRegistrationKey(Crypto.randomUUID());
                }}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
            </View>

            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: tokens.color.inkSecondary }}>
                  Mật khẩu {screen === "register" ? "(tối thiểu 12 ký tự)" : ""}
                </Text>
              </View>
              <TextInput
                accessibilityLabel="Mật khẩu"
                testID={screen === "login" ? "student-login-password" : undefined}
                style={styles.input}
                placeholder="••••••••••••"
                placeholderTextColor={tokens.color.muted}
                value={password}
                onChangeText={(v) => {
                  setPassword(v);
                  setRegistrationKey(Crypto.randomUUID());
                }}
                secureTextEntry
                autoCapitalize="none"
                autoComplete={screen === "register" ? "new-password" : "current-password"}
              />
            </View>

            <View style={{ marginTop: 6 }}>
              <Button
                testID={screen === "login" ? "student-login-submit" : undefined}
                label={busy ? "Đang xử lý…" : screen === "login" ? "Đăng nhập ngay" : "Tạo tài khoản"}
                disabled={
                  busy || !email || !password || (screen === "register" && (!name || password.length < 12))
                }
                size="lg"
                onPress={() => {
                  void submit();
                }}
              />
            </View>

          </View>

          {/* Security badge */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 4 }}>
            <Icon name="check" size={12} color={tokens.color.muted} />
            <Text style={styles.small}>Bảo mật mã hóa đầu cuối TLS & Idempotent Token</Text>
          </View>
        </View>
      )}
      {screen === "account" && snapshot.user && (
        <View style={styles.card}>
          {avatarStatus === "loading" && <Text style={styles.small}>Đang tải ảnh đại diện…</Text>}
          {avatarStatus === "empty" && <Text style={styles.small}>Chưa có ảnh đại diện.</Text>}
          {avatarStatus === "error" && (
            <>
              <Text style={styles.error}>Không tải được ảnh đại diện.</Text>
              <Button label="Tải lại ảnh" onPress={() => setRetry((v) => v + 1)} />
            </>
          )}
          {avatar && (
            <Image
              source={{ uri: avatar }}
              accessibilityLabel="Ảnh đại diện"
              style={{ width: 80, height: 80, borderRadius: 40 }}
            />
          )}
          <Text style={styles.text}>{snapshot.user.displayName}</Text>
          <Text style={styles.text}>{snapshot.user.emailMasked}</Text>
          <Text style={styles.small}>{snapshot.user.role}</Text>
          <Button
            label="Đăng xuất"
            onPress={() => void handleLogout()}
          />
        </View>
      )}
      {screen === "admin" && (
        <Text style={styles.text}>
          Phiên quản trị đã được Gateway xác nhận. Nền tảng mobile hiện hỗ trợ tài khoản và thông báo; các
          thao tác quản trị tiếp tục dùng trên Web.
        </Text>
      )}
      {path && !error && data === null && (
        <Text accessibilityRole="alert" style={styles.text}>
          Đang tải…
        </Text>
      )}
      {path && data?.length === 0 && <Text style={styles.text}>Chưa có dữ liệu để hiển thị.</Text>}
      {data?.map((item, index) => (
        <View key={`${item.id}-${index}`} style={styles.card}>
          <Text style={styles.text}>{item.title}</Text>
          {item.description && <Text style={styles.small}>{item.description}</Text>}
        </View>
      ))}
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {path && error && <Button label="Thử lại" onPress={() => setRetry((value) => value + 1)} />}
      <Button label="Về trang chủ" onPress={() => router.replace("/")} />
    </Page>
  );
}
