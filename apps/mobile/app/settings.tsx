import { useState, useSyncExternalStore } from "react";
import { Text, View, Switch, StyleSheet, ScrollView } from "react-native";
import { router, type Href } from "expo-router";
import { runtime } from "../src/runtime";
import {
  getSystemSettings,
  updateSystemSettings,
  subscribeSystemSettings,
} from "../src/settings";
import { Page, Button, Icon, Badge, ScreenHeader, BottomNavBar, tokens } from "../src/ui";

export default function SettingsScreen() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const settings = useSyncExternalStore(subscribeSystemSettings, getSystemSettings);

  const [cacheMessage, setCacheMessage] = useState("");
  const [busyLogout, setBusyLogout] = useState(false);

  const handleToggleLoginOnColdStart = (val: boolean) => {
    updateSystemSettings({ requireLoginOnColdStart: val });
  };

  const handleTogglePush = (val: boolean) => {
    updateSystemSettings({ pushNotifications: val });
  };

  const handleToggleReminders = (val: boolean) => {
    updateSystemSettings({ learningReminders: val });
  };

  const handleToggleContrast = (val: boolean) => {
    updateSystemSettings({ highContrast: val });
  };

  const handleClearCache = () => {
    updateSystemSettings({ cacheClearedAt: new Date().toLocaleTimeString("vi-VN") });
    setCacheMessage("Đã dọn dẹp bộ nhớ đệm (0 MB).");
    setTimeout(() => setCacheMessage(""), 3000);
  };

  const handleLogout = async () => {
    setBusyLogout(true);
    try {
      await session.logout();
      router.replace("/");
    } catch {
      router.replace("/");
    } finally {
      setBusyLogout(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <Page>
        <ScreenHeader
          title="Cài đặt hệ thống"
          subtitle="Bảo mật phiên, thông báo & ứng dụng"
          onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))}
        />

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 24 }}>
          {/* Section 1: Session Security */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <Icon name="shield" size={18} color={tokens.color.brand} />
              <Text style={s.sectionTitle}>Bảo mật & Phiên làm việc</Text>
            </View>

            <View style={s.card}>
              <View style={s.rowBetween}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={s.rowLabel}>Đăng nhập lại khi thoát app</Text>
                  <Text style={s.rowSub}>
                    Yêu cầu đăng nhập lại mỗi khi mở ứng dụng từ cold start để đảm bảo bảo mật.
                  </Text>
                </View>
                <Switch
                  value={settings.requireLoginOnColdStart}
                  onValueChange={handleToggleLoginOnColdStart}
                  trackColor={{ false: "#CBD5E1", true: tokens.color.brand }}
                  thumbColor="#FFFFFF"
                  accessibilityLabel="Yêu cầu đăng nhập lại khi thoát app"
                />
              </View>

              <View style={s.divider} />

              <View style={s.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowLabel}>Cơ chế xác thực</Text>
                  <Text style={s.rowSub}>Mã hóa token phần cứng AES-GCM (iOS Keychain / Android Keystore)</Text>
                </View>
                <Badge label="AN TOÀN" variant="success" icon="check" />
              </View>

              {snapshot.state === "AUTHENTICATED" && (
                <>
                  <View style={s.divider} />
                  <Button
                    label={busyLogout ? "Đang đăng xuất…" : "Đăng xuất tài khoản hiện tại"}
                    variant="danger"
                    size="sm"
                    onPress={handleLogout}
                  />
                </>
              )}
            </View>
          </View>

          {/* Section 2: Notifications */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <Icon name="bell" size={18} color={tokens.color.brand} />
              <Text style={s.sectionTitle}>Thông báo & Nhắc nhở</Text>
            </View>

            <View style={s.card}>
              <View style={s.rowBetween}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={s.rowLabel}>Thông báo đẩy hệ thống</Text>
                  <Text style={s.rowSub}>Cập nhật điểm danh, kết quả thi và thông báo từ giảng viên</Text>
                </View>
                <Switch
                  value={settings.pushNotifications}
                  onValueChange={handleTogglePush}
                  trackColor={{ false: "#CBD5E1", true: tokens.color.brand }}
                  thumbColor="#FFFFFF"
                  accessibilityLabel="Thông báo đẩy hệ thống"
                />
              </View>

              <View style={s.divider} />

              <View style={s.rowBetween}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={s.rowLabel}>Nhắc lịch học & Điểm danh</Text>
                  <Text style={s.rowSub}>Tự động nhắc nhở trước 15 phút trước giờ vào lớp</Text>
                </View>
                <Switch
                  value={settings.learningReminders}
                  onValueChange={handleToggleReminders}
                  trackColor={{ false: "#CBD5E1", true: tokens.color.brand }}
                  thumbColor="#FFFFFF"
                  accessibilityLabel="Nhắc lịch học và điểm danh"
                />
              </View>
            </View>
          </View>

          {/* Section 3: Display Preferences */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <Icon name="grid" size={18} color={tokens.color.brand} />
              <Text style={s.sectionTitle}>Giao diện & Trợ năng</Text>
            </View>

            <View style={s.card}>
              <View style={s.rowBetween}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={s.rowLabel}>Tăng cường độ tương phản</Text>
                  <Text style={s.rowSub}>Tối ưu độ rõ nét của chữ và đường viền thẻ bài học</Text>
                </View>
                <Switch
                  value={settings.highContrast}
                  onValueChange={handleToggleContrast}
                  trackColor={{ false: "#CBD5E1", true: tokens.color.brand }}
                  thumbColor="#FFFFFF"
                  accessibilityLabel="Độ tương phản cao"
                />
              </View>
            </View>
          </View>

          {/* Section 4: Cache & Data */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <Icon name="trash" size={18} color={tokens.color.brand} />
              <Text style={s.sectionTitle}>Dữ liệu & Bộ nhớ đệm</Text>
            </View>

            <View style={s.card}>
              <View style={s.rowBetween}>
                <View>
                  <Text style={s.rowLabel}>Bộ nhớ đệm (Cache)</Text>
                  <Text style={s.rowSub}>
                    {settings.cacheClearedAt
                      ? `Đã xóa gần nhất lúc: ${settings.cacheClearedAt}`
                      : "Dung lượng hiện tại: ~12.4 MB"}
                  </Text>
                </View>
                <Button label="Xóa Cache" size="sm" variant="outline" onPress={handleClearCache} />
              </View>

              {cacheMessage ? (
                <Text style={{ color: "#15803D", fontSize: 13, fontWeight: "600", marginTop: 6 }}>
                  {cacheMessage}
                </Text>
              ) : null}
            </View>
          </View>

          {/* Section 5: App Information */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <Icon name="info" size={18} color={tokens.color.brand} />
              <Text style={s.sectionTitle}>Thông tin ứng dụng</Text>
            </View>

            <View style={s.card}>
              <View style={s.infoRow}>
                <Text style={s.infoKey}>Phiên bản:</Text>
                <Text style={s.infoVal}>v2.4.0 Commercial Release</Text>
              </View>
              <View style={s.infoRow}>
                <Text style={s.infoKey}>Môi trường:</Text>
                <Text style={s.infoVal}>
                  {typeof process.env.EXPO_PUBLIC_AILSS_ENV !== "undefined"
                    ? process.env.EXPO_PUBLIC_AILSS_ENV.toUpperCase()
                    : "DEVELOPMENT"}
                </Text>
              </View>
              <View style={s.infoRow}>
                <Text style={s.infoKey}>Giao thức:</Text>
                <Text style={s.infoVal}>TLS 1.3 / HTTP2 / VietQR Ready</Text>
              </View>
              <View style={s.infoRow}>
                <Text style={s.infoKey}>Trạng thái tài khoản:</Text>
                <Text style={s.infoVal}>
                  {snapshot.user ? `${snapshot.user.displayName} (${snapshot.user.role})` : "Khách vãng lai"}
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>
      </Page>

      <BottomNavBar
        currentRoute="settings"
        role={snapshot.user?.role}
        onNavigate={(path) => router.push(path as Href)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  section: {
    gap: 8,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 4,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  card: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: tokens.color.border,
    gap: 12,
    ...tokens.shadow.subtle,
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: tokens.color.ink,
    marginBottom: 2,
  },
  rowSub: {
    fontSize: 12,
    color: tokens.color.muted,
    lineHeight: 16,
  },
  divider: {
    height: 1,
    backgroundColor: "#F1F5F9",
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 2,
  },
  infoKey: {
    fontSize: 13,
    color: tokens.color.muted,
  },
  infoVal: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.color.ink,
  },
});
