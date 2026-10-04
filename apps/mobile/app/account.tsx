import { useLanguage } from "../src/use-language";
import { useUiText } from "../src/use-language";
import { useSyncExternalStore, useState, useEffect, useCallback } from "react";
import { Text, View, TextInput, Image, ActivityIndicator, StyleSheet, Alert } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { runtime } from "../src/runtime";
import {
  userProfile,
  avatarResponse,
  validateDisplayName,
  validatePasswordChange,
  validateAvatarDataUrl,
  type UserProfile,
} from "../src/account";
import { ApiError } from "../src/api";
import { Page, Button, Icon, Badge, BottomNavBar, PasswordInput, styles, tokens } from "../src/ui";
import { ScalePressable } from "../src/motion";

// Minimal valid PNG data URIs for preset avatars (1x1 PNGs in distinct colors)
const PRESET_AVATARS = [
  {
    label: "Xanh dương",
    dataUrl:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  },
  {
    label: "Cam",
    dataUrl:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  },
];

export default function AccountScreen() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit Display Name state
  const [isEditingName, setIsEditingName] = useState(() => edit === "1");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameMessage, setNameMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  // Password Change state
  const [isChangingPass, setIsChangingPass] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passSaving, setPassSaving] = useState(false);
  const [passMessage, setPassMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);

  // Avatar uploading state
  const [avatarSaving, setAvatarSaving] = useState(false);

  const handleLogout = async () => {
    try {
      await session.logout();
    } finally {
      router.replace("/result?type=logout-success" as Href);
    }
  };

  const loadAccountData = useCallback(async () => {
    if (snapshot.state !== "AUTHENTICATED") {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);

      const [profData, avData] = await Promise.all([
        session.request("/api/v1/me"),
        session.request("/api/v1/me/avatar"),
      ]);

      const prof = userProfile(profData);
      setProfile(prof);
      setNewDisplayName(prof.displayName);

      const av = avatarResponse(avData);
      setAvatarUrl(av.dataUrl);
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError("Không thể tải thông tin tài khoản.");
      }
    } finally {
      setLoading(false);
    }
  }, [snapshot.state, session]);

  useEffect(() => {
    void loadAccountData();
  }, [loadAccountData]);

  useEffect(() => {
    if (edit === "1") setIsEditingName(true);
    else if (edit === "0") setIsEditingName(false);
  }, [edit]);

  const handleUpdateDisplayName = async () => {
    setNameMessage(null);
    const validation = validateDisplayName(newDisplayName);
    if (!validation.valid) {
      setNameMessage({ type: "error", text: validation.error ?? "Tên không hợp lệ." });
      return;
    }

    try {
      setNameSaving(true);
      const idempotencyKey = Crypto.randomUUID();
      await session.request("/api/v1/me", {
        method: "PATCH",
        idempotencyKey,
        body: { displayName: newDisplayName.trim() },
      });

      await session.revalidate();
      if (profile) {
        setProfile({ ...profile, displayName: newDisplayName.trim() });
      }
      setIsEditingName(false);
      setNameMessage({ type: "success", text: "Cập nhật họ tên thành công." });
    } catch (e: unknown) {
      setNameMessage({
        type: "error",
        text: e instanceof ApiError ? e.message : "Cập nhật không thành công. Vui lòng thử lại.",
      });
    } finally {
      setNameSaving(false);
    }
  };

  const handleSetAvatar = async (dataUrl: string | null) => {
    try {
      setAvatarSaving(true);
      setError(null);
      const res = await session.request("/api/v1/me/avatar", {
        method: "POST",
        body: { dataUrl },
      });
      const av = avatarResponse(res);
      setAvatarUrl(av.dataUrl);
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : "Không thể cập nhật ảnh đại diện. Vui lòng thử lại.");
    } finally {
      setAvatarSaving(false);
    }
  };

  const handlePickImage = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          uiText("Cần cấp quyền truy cập ảnh"),
          uiText("Vui lòng cho phép ứng dụng truy cập thư viện ảnh trên thiết bị để tải lên ảnh đại diện."),
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
        base64: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      if (!asset.base64) {
        Alert.alert(uiText("Lỗi"), uiText("Không thể đọc dữ liệu ảnh. Vui lòng thử lại với ảnh khác."));
        return;
      }

      let mime = asset.mimeType || "image/jpeg";
      if (mime === "image/jpg") mime = "image/jpeg";
      const cleanBase64 = asset.base64.trim().replace(/[\r\n]/g, "");
      const dataUrl = `data:${mime};base64,${cleanBase64}`;

      const validation = validateAvatarDataUrl(dataUrl);
      if (!validation.valid) {
        Alert.alert(
          uiText("Ảnh không hợp lệ"),
          uiText(validation.error ?? "Dung lượng ảnh vượt quá giới hạn tối đa (256 KiB)."),
        );
        return;
      }

      await handleSetAvatar(dataUrl);
      Alert.alert(uiText("Thành công"), uiText("Đã cập nhật ảnh đại diện của bạn."));
    } catch (e: unknown) {
      Alert.alert(uiText("Lỗi"), uiText(e instanceof Error ? e.message : "Không thể chọn ảnh từ thư viện."));
    }
  };

  const handleTakePhoto = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          uiText("Cần cấp quyền máy ảnh"),
          uiText("Vui lòng cho phép ứng dụng truy cập máy ảnh để chụp ảnh đại diện."),
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
        base64: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      if (!asset.base64) {
        Alert.alert(uiText("Lỗi"), uiText("Không thể đọc dữ liệu từ máy ảnh."));
        return;
      }

      let mime = asset.mimeType || "image/jpeg";
      if (mime === "image/jpg") mime = "image/jpeg";
      const cleanBase64 = asset.base64.trim().replace(/[\r\n]/g, "");
      const dataUrl = `data:${mime};base64,${cleanBase64}`;

      const validation = validateAvatarDataUrl(dataUrl);
      if (!validation.valid) {
        Alert.alert(
          uiText("Ảnh không hợp lệ"),
          uiText(validation.error ?? "Dung lượng ảnh vượt quá giới hạn tối đa."),
        );
        return;
      }

      await handleSetAvatar(dataUrl);
      Alert.alert(uiText("Thành công"), uiText("Đã chụp và cập nhật ảnh đại diện mới."));
    } catch (e: unknown) {
      Alert.alert(uiText("Lỗi"), uiText(e instanceof Error ? e.message : "Không thể chụp ảnh."));
    }
  };

  const handleChangePassword = async () => {
    setPassMessage(null);
    if (newPassword !== confirmPassword) {
      setPassMessage({ type: "error", text: "Mật khẩu xác nhận không khớp." });
      return;
    }
    const val = validatePasswordChange(currentPassword, newPassword);
    if (!val.valid) {
      setPassMessage({ type: "error", text: val.error ?? "Mật khẩu không hợp lệ." });
      return;
    }

    try {
      setPassSaving(true);
      const idempotencyKey = Crypto.randomUUID();
      await session.request("/api/v1/me/password", {
        method: "POST",
        idempotencyKey,
        body: {
          currentPassword,
          newPassword,
        },
      });

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setIsChangingPass(false);

      Alert.alert(
        uiText("Đổi mật khẩu thành công"),
        uiText("Mật khẩu đã được cập nhật. Vui lòng đăng nhập lại với mật khẩu mới."),
        [
          {
            text: uiText("Đăng nhập lại"),
            onPress: () => {
              void session.logout().then(() => router.replace("/login"));
            },
          },
        ],
      );
    } catch (e: unknown) {
      setPassMessage({
        type: "error",
        text:
          e instanceof ApiError
            ? e.kind === "400" || e.kind === "422"
              ? "Mật khẩu hiện tại không chính xác hoặc mật khẩu mới chưa đúng quy định."
              : e.message
            : "Đổi mật khẩu không thành công. Vui lòng thử lại.",
      });
    } finally {
      setPassSaving(false);
    }
  };

  if (snapshot.state !== "AUTHENTICATED") {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
        <Page>
          <View style={[styles.card, { alignItems: "center", paddingVertical: 40, gap: 14 }]}>
            <View
              style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                backgroundColor: tokens.color.brandLight,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name="user" size={36} color={tokens.color.brand} />
            </View>
            <Text style={styles.title}>{uiText("Tài khoản cá nhân")}</Text>
            <Text style={[styles.text, { textAlign: "center", maxWidth: 300 }]}>
              {uiText("Vui lòng đăng nhập để xem hồ sơ, tiến độ học tập và quản lý cài đặt tài khoản.")}
            </Text>
            <Button
              label={uiText("Đăng nhập ngay")}
              variant="primary"
              size="lg"
              onPress={() => router.push("/login" as Href)}
            />
          </View>
        </Page>
        <BottomNavBar currentRoute="account" onNavigate={(path: string) => router.push(path as Href)} />
      </View>
    );
  }

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
        <Page>
          <View style={localStyles.center}>
            <ActivityIndicator size="large" color={tokens.color.brand} />
            <Text style={styles.small}>{uiText("Đang tải hồ sơ người dùng…")}</Text>
          </View>
        </Page>
      </View>
    );
  }

  const roleLabel =
    profile?.role === "LECTURER"
      ? "Giảng viên (Lecturer)"
      : profile?.role === "STUDENT"
        ? "Học viên (Student)"
        : profile?.role === "ADMIN"
          ? "Quản trị viên (Admin)"
          : profile?.role;

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <Page style={{ paddingBottom: 24 }}>
        {/* Profile Header Hero */}
        <View style={localStyles.profileHero}>
          <View style={localStyles.avatarWrapper}>
            {avatarUrl ? (
              <Image
                source={{ uri: avatarUrl }}
                accessibilityLabel={uiText("Ảnh đại diện")}
                style={localStyles.avatarImage}
              />
            ) : (
              <View style={localStyles.avatarFallback}>
                <Text style={localStyles.avatarInitials}>
                  {(profile?.displayName || "AILSS").charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <ScalePressable
              style={localStyles.avatarEditBadge}
              onPress={() => void handlePickImage()}
              accessibilityRole="button"
              accessibilityLabel={uiText("Tải ảnh đại diện mới")}
            >
              <Icon name="pencil" size={14} color="#FFFFFF" />
            </ScalePressable>
          </View>

          <View style={{ alignItems: "center", gap: 4, marginTop: 10 }}>
            <Text style={[styles.title, { fontSize: 22, textAlign: "center" }]}>{profile?.displayName}</Text>
            <Text style={styles.small}>{profile?.emailMasked}</Text>

            <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
              <Badge
                label={roleLabel ?? "Học viên"}
                variant={profile?.role === "LECTURER" ? "ai" : "primary"}
                icon="academic"
              />
              <Badge label={uiText("Đang hoạt động")} variant="success" icon="check" />
            </View>
          </View>
        </View>

        {error && (
          <View style={[styles.card, { borderColor: tokens.color.dangerLight, backgroundColor: "#FEF2F2" }]}>
            <Text accessibilityRole="alert" style={styles.error}>
              {uiText(error)}
            </Text>
            <Button label={uiText("Thử lại")} size="sm" onPress={() => void loadAccountData()} />
          </View>
        )}

        {/* Section 1: Personal Info & Display Name */}
        <View style={styles.card}>
          <View style={localStyles.cardTitleRow}>
            <Icon name="user" size={16} color={tokens.color.brand} />
            <Text style={localStyles.cardSectionTitle}>{uiText("THÔNG TIN CÁ NHÂN")}</Text>
          </View>

          {nameMessage && (
            <Text
              accessibilityRole="alert"
              style={
                nameMessage.type === "error"
                  ? styles.error
                  : { color: tokens.color.success, fontSize: 13, fontWeight: "600" }
              }
            >
              {nameMessage.text}
            </Text>
          )}

          {isEditingName ? (
            <View style={localStyles.editRow}>
              <Text style={styles.small}>{uiText("Họ và tên mới")}</Text>
              <TextInput
                style={styles.input}
                value={newDisplayName}
                onChangeText={setNewDisplayName}
                placeholder={uiText("Nhập họ và tên mới")}
                autoFocus
              />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Button
                  label={nameSaving ? uiText("Đang lưu…") : uiText("Lưu thay đổi")}
                  size="sm"
                  onPress={() => void handleUpdateDisplayName()}
                  disabled={nameSaving}
                />
                <Button
                  label={uiText("Hủy")}
                  variant="outline"
                  size="sm"
                  onPress={() => {
                    setIsEditingName(false);
                    setNewDisplayName(profile?.displayName ?? "");
                  }}
                />
              </View>
            </View>
          ) : (
            <View style={localStyles.infoRow}>
              <View>
                <Text style={styles.small}>{uiText("Họ và tên")}</Text>
                <Text style={[styles.text, { fontWeight: "700" }]}>{profile?.displayName}</Text>
              </View>
              <Button
                label={uiText("Chỉnh sửa")}
                variant="secondary"
                size="sm"
                onPress={() => setIsEditingName(true)}
              />
            </View>
          )}

          <View style={localStyles.infoRow}>
            <View>
              <Text style={styles.small}>{uiText("Email đăng ký")}</Text>
              <Text style={styles.text}>{profile?.emailMasked}</Text>
            </View>
          </View>

          {profile?.createdAt && (
            <View style={localStyles.infoRow}>
              <View>
                <Text style={styles.small}>{uiText("Ngày tham gia")}</Text>
                <Text style={styles.text}>{new Date(profile.createdAt).toLocaleDateString(uiLocale)}</Text>
              </View>
            </View>
          )}
        </View>

        {/* Section 2: Avatar Customization */}
        <View style={styles.card}>
          <View style={localStyles.cardTitleRow}>
            <Icon name="sparkles" size={16} color={tokens.color.brand} />
            <Text style={localStyles.cardSectionTitle}>{uiText("ẢNH ĐẠI DIỆN HỆ THỐNG")}</Text>
          </View>
          <Text style={styles.small}>
            {uiText(
              "Tải ảnh đại diện từ thiết bị hoặc chọn màu đại diện cho hồ sơ của bạn trên toàn hệ thống AILSS (tối đa 256 KiB).",
            )}
          </Text>

          <View style={localStyles.avatarActions}>
            {avatarSaving ? (
              <View style={{ paddingVertical: 16, alignItems: "center", gap: 8 }}>
                <ActivityIndicator size="small" color={tokens.color.brand} />
                <Text style={styles.small}>{uiText("Đang tải lên ảnh đại diện…")}</Text>
              </View>
            ) : (
              <View style={{ gap: 12 }}>
                {/* Upload Buttons Row */}
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      label={uiText("Tải ảnh từ máy")}
                      size="sm"
                      onPress={() => void handlePickImage()}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      label={uiText("Chụp ảnh mới")}
                      variant="outline"
                      size="sm"
                      onPress={() => void handleTakePhoto()}
                    />
                  </View>
                </View>

                {/* Preset & Delete Actions */}
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 8,
                    marginTop: 4,
                  }}
                >
                  <Text style={[styles.small, { fontWeight: "600", width: "100%" }]}>
                    {uiText("Màu sắc mẫu:")}
                  </Text>
                  {PRESET_AVATARS.map((p) => (
                    <Button
                      key={p.label}
                      label={uiText("Màu {0}", [p.label])}
                      variant="secondary"
                      size="sm"
                      onPress={() => void handleSetAvatar(p.dataUrl)}
                    />
                  ))}
                  {avatarUrl && (
                    <Button
                      label={uiText("Xóa avatar")}
                      variant="danger"
                      size="sm"
                      onPress={() => void handleSetAvatar(null)}
                    />
                  )}
                </View>
              </View>
            )}
          </View>
        </View>

        {/* Section 3: Lecturer Verification (if lecturer) */}
        {profile?.role === "LECTURER" && (
          <View style={styles.card}>
            <View style={localStyles.cardTitleRow}>
              <Icon name="award" size={16} color={tokens.color.brand} />
              <Text style={localStyles.cardSectionTitle}>{uiText("XÁC MINH GIẢNG VIÊN & HỒ SƠ")}</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Badge
                label={
                  profile.lecturerVerified ? uiText("Đã xác minh chính thức") : uiText("Đang chờ duyệt xét")
                }
                variant={profile.lecturerVerified ? "success" : "warning"}
              />
            </View>
            <Text style={styles.small}>
              {profile.lecturerVerified
                ? uiText(
                    "Tài khoản của bạn đã được xác minh. Bạn có toàn quyền xuất bản khóa học, công khai hồ sơ và nhận doanh thu.",
                  )
                : uiText(
                    "Tài khoản đang chờ Quản trị viên xét duyệt. Bạn có thể cập nhật hồ sơ chuyên môn và cài đặt tài khoản nhận tiền trước.",
                  )}
            </Text>
            <View style={{ marginTop: 4 }}>
              <Button
                label={uiText("Hồ sơ & Quy trình xác thực")}
                variant="outline"
                onPress={() => router.push("/teaching/profile" as Href)}
              />
            </View>
          </View>
        )}

        {/* Section 4: Security & Password Change */}
        <View style={styles.card}>
          <View style={localStyles.cardTitleRow}>
            <Icon name="check" size={16} color={tokens.color.brand} />
            <Text style={localStyles.cardSectionTitle}>{uiText("BẢO MẬT & MẬT KHẨU")}</Text>
          </View>

          {passMessage && (
            <Text
              accessibilityRole="alert"
              style={
                passMessage.type === "error"
                  ? styles.error
                  : { color: tokens.color.success, fontSize: 13, fontWeight: "600" }
              }
            >
              {passMessage.text}
            </Text>
          )}

          {isChangingPass ? (
            <View style={localStyles.passForm}>
              <View style={{ gap: 4 }}>
                <Text style={styles.small}>{uiText("Mật khẩu hiện tại")}</Text>
                <PasswordInput
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  placeholder="••••••••"
                />
              </View>

              <View style={{ gap: 4 }}>
                <Text style={styles.small}>{uiText("Mật khẩu mới (tối thiểu 8 ký tự)")}</Text>
                <PasswordInput value={newPassword} onChangeText={setNewPassword} placeholder="••••••••" />
              </View>

              <View style={{ gap: 4 }}>
                <Text style={styles.small}>{uiText("Xác nhận mật khẩu mới")}</Text>
                <PasswordInput
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="••••••••"
                />
              </View>

              <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
                <Button
                  label={passSaving ? uiText("Đang cập nhật…") : uiText("Xác nhận đổi")}
                  size="sm"
                  onPress={() => void handleChangePassword()}
                  disabled={passSaving}
                />
                <Button
                  label={uiText("Hủy bỏ")}
                  variant="outline"
                  size="sm"
                  onPress={() => {
                    setIsChangingPass(false);
                    setCurrentPassword("");
                    setNewPassword("");
                    setConfirmPassword("");
                    setPassMessage(null);
                  }}
                />
              </View>
            </View>
          ) : (
            <Button
              label={uiText("Đổi mật khẩu tài khoản")}
              variant="outline"
              size="md"
              onPress={() => setIsChangingPass(true)}
            />
          )}
        </View>

        {/* Section 5: Logout Action */}
        <View style={{ marginTop: 8 }}>
          <Button
            label={uiText("Đăng xuất khỏi thiết bị")}
            variant="danger"
            size="md"
            icon={<Icon name="logout" size={16} color="#FFF" />}
            onPress={() => void handleLogout()}
          />
        </View>
      </Page>

      {/* Bottom Navigation Dock */}
      <BottomNavBar
        currentRoute="account"
        role={snapshot.user?.role}
        onNavigate={(path: string) => router.push(path as Href)}
      />
    </View>
  );
}

const localStyles = StyleSheet.create({
  center: {
    padding: tokens.space.xl,
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.small,
  },
  profileHero: {
    backgroundColor: tokens.color.surface,
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: tokens.color.border,
    ...tokens.shadow.card,
  },
  avatarWrapper: {
    position: "relative",
  },
  avatarImage: {
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 3,
    borderColor: tokens.color.brand,
  },
  avatarFallback: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: tokens.color.brand,
    alignItems: "center",
    justifyContent: "center",
    ...tokens.shadow.subtle,
  },
  avatarInitials: {
    color: "#fff",
    fontSize: 34,
    fontWeight: "800",
  },
  onlineDot: {
    position: "absolute",
    bottom: 2,
    right: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: tokens.color.success,
    borderWidth: 2,
    borderColor: "#FFF",
  },
  avatarEditBadge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: tokens.color.brand,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: "#FFFFFF",
    ...tokens.shadow.subtle,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  cardSectionTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: tokens.color.muted,
    letterSpacing: 0.8,
  },
  avatarActions: {
    marginTop: 8,
    width: "100%",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: tokens.color.border,
  },
  editRow: {
    paddingVertical: 8,
    gap: 10,
  },
  passForm: {
    marginTop: 6,
    gap: 10,
  },
});
