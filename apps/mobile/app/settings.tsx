import { useUiText } from "../src/use-language";
import { useState, useSyncExternalStore } from "react";
import { Text, View, Switch, StyleSheet, ScrollView } from "react-native";
import { router, type Href } from "expo-router";
import { runtime, setRequireLoginOnColdStart } from "../src/runtime";
import { getSystemSettings, updateSystemSettings, subscribeSystemSettings } from "../src/settings";
import { Page, Button, Icon, Badge, ScreenHeader, BottomNavBar, tokens } from "../src/ui";

export default function SettingsScreen() {
  const uiText = useUiText();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const settings = useSyncExternalStore(subscribeSystemSettings, getSystemSettings);
  const configuredApiOrigin = process.env.EXPO_PUBLIC_AILSS_API_BASE_URL;
  const configuredEnvironment = process.env.EXPO_PUBLIC_AILSS_ENV?.toLowerCase();
  const connectionSecurity = configuredApiOrigin?.startsWith("https://")
    ? "HTTPS (theo cấu hình môi trường)"
    : configuredApiOrigin?.startsWith("http://") && configuredEnvironment !== "production"
      ? "HTTP (chỉ môi trường development)"
      : "Chưa xác định";

  const [busyLogout, setBusyLogout] = useState(false);
  const [savingColdStartPreference, setSavingColdStartPreference] = useState(false);
  const [coldStartPreferenceError, setColdStartPreferenceError] = useState("");

  const handleToggleLoginOnColdStart = async (val: boolean) => {
    setSavingColdStartPreference(true);
    setColdStartPreferenceError("");
    try {
      await setRequireLoginOnColdStart(val);
    } catch {
      setColdStartPreferenceError("Không thể lưu lựa chọn bảo mật trên thiết bị. Vui lòng thử lại.");
    } finally {
      setSavingColdStartPreference(false);
    }
  };

  const handleToggleContrast = (val: boolean) => {
    updateSystemSettings({ highContrast: val });
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
          title={uiText("Cài đặt hệ thống")}
          subtitle={uiText("Bảo mật phiên, thông báo & ứng dụng")}
          onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))}
        />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: 16, paddingBottom: 24 }}
        >
          {/* Section 1: Session Security */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <Icon name="shield" size={18} color={tokens.color.brand} />
              <Text style={s.sectionTitle}>{uiText("Bảo mật & Phiên làm việc")}</Text>
            </View>

            <View style={s.card}>
              <View style={s.rowBetween}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={s.rowLabel}>{uiText("Đăng nhập lại khi thoát app")}</Text>
                  <Text style={s.rowSub}>
                    {settings.requireLoginOnColdStart
                      ? uiText(
                          "Yêu cầu đăng nhập lại khi mở ứng dụng. Hàng đợi ngoại tuyến sẽ chỉ đồng bộ sau khi đăng nhập.",
                        )
                      : uiText(
                          "Khôi phục phiên đã mã hóa khi mở ứng dụng; nếu mất mạng, dữ liệu đã đồng bộ và hàng đợi học tập có thể tiếp tục ngoại tuyến.",
                        )}
                  </Text>
                </View>
                <Switch
                  value={settings.requireLoginOnColdStart}
                  onValueChange={handleToggleLoginOnColdStart}
                  disabled={savingColdStartPreference}
                  trackColor={{ false: "#CBD5E1", true: tokens.color.brand }}
                  thumbColor="#FFFFFF"
                  accessibilityLabel={uiText("Yêu cầu đăng nhập lại khi thoát app")}
                />
              </View>

              {coldStartPreferenceError ? (
                <Text accessibilityRole="alert" style={{ color: "#B42318", fontSize: 13, marginTop: 8 }}>
                  {uiText(coldStartPreferenceError)}
                </Text>
              ) : null}

              <View style={s.divider} />

              <View style={s.rowBetween}>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowLabel}>{uiText("Cơ chế xác thực")}</Text>
                  <Text style={s.rowSub}>
                    {uiText(
                      "Token được lưu bằng SecureStore của hệ điều hành; bản này chưa xác minh phần cứng lưu khóa.",
                    )}
                  </Text>
                </View>
                <Badge label="SECURESTORE" variant="success" icon="check" />
              </View>

              {snapshot.state === "AUTHENTICATED" && (
                <>
                  <View style={s.divider} />
                  <Button
                    label={busyLogout ? uiText("Đang đăng xuất…") : uiText("Đăng xuất tài khoản hiện tại")}
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
              <Text style={s.sectionTitle}>{uiText("Thông báo & Nhắc nhở")}</Text>
            </View>

            <View style={s.card}>
              <View style={s.rowBetween}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={s.rowLabel}>{uiText("Thông báo trong ứng dụng")}</Text>
                  <Text style={s.rowSub}>
                    {uiText(
                      "Danh sách thông báo được đồng bộ khi mở ứng dụng. Push và nhắc lịch chưa khả dụng trong bản này.",
                    )}
                  </Text>
                </View>
                <Badge label="IN-APP ONLY" variant="neutral" />
              </View>
            </View>
          </View>

          {/* Section 3: Display Preferences */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <Icon name="grid" size={18} color={tokens.color.brand} />
              <Text style={s.sectionTitle}>{uiText("Giao diện & Trợ năng")}</Text>
            </View>

            <View style={s.card}>
              <View style={s.rowBetween}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={s.rowLabel}>{uiText("Tăng cường độ tương phản")}</Text>
                  <Text style={s.rowSub}>{uiText("Tối ưu độ rõ nét của chữ và đường viền thẻ bài học")}</Text>
                </View>
                <Switch
                  value={settings.highContrast}
                  onValueChange={handleToggleContrast}
                  trackColor={{ false: "#CBD5E1", true: tokens.color.brand }}
                  thumbColor="#FFFFFF"
                  accessibilityLabel={uiText("Độ tương phản cao")}
                />
              </View>
            </View>
          </View>

          {/* Section 4: Cache & Data */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <Icon name="trash" size={18} color={tokens.color.brand} />
              <Text style={s.sectionTitle}>{uiText("Dữ liệu & Bộ nhớ đệm")}</Text>
            </View>

            <View style={s.card}>
              <View style={s.rowBetween}>
                <View>
                  <Text style={s.rowLabel}>{uiText("Bộ nhớ đệm (Cache)")}</Text>
                  <Text style={s.rowSub}>{uiText("Chưa có thông tin dung lượng bộ nhớ đệm.")}</Text>
                </View>
                <Text style={s.rowSub}>{uiText("Chưa hỗ trợ dọn bộ nhớ đệm tại đây.")}</Text>
              </View>
            </View>
          </View>

          {/* Section 5: App Information */}
          <View style={s.section}>
            <View style={s.sectionHeaderRow}>
              <Icon name="info" size={18} color={tokens.color.brand} />
              <Text style={s.sectionTitle}>{uiText("Thông tin ứng dụng")}</Text>
            </View>

            <View style={s.card}>
              <View style={s.infoRow}>
                <Text style={s.infoKey}>{uiText("Phiên bản:")}</Text>
                <Text style={s.infoVal}>v14.1.0 · Phase 41</Text>
              </View>
              <View style={s.infoRow}>
                <Text style={s.infoKey}>{uiText("Môi trường:")}</Text>
                <Text style={s.infoVal}>
                  {typeof process.env.EXPO_PUBLIC_AILSS_ENV !== "undefined"
                    ? process.env.EXPO_PUBLIC_AILSS_ENV.toUpperCase()
                    : "DEVELOPMENT"}
                </Text>
              </View>
              <View style={s.infoRow}>
                <Text style={s.infoKey}>{uiText("Kết nối API:")}</Text>
                <Text style={s.infoVal}>{connectionSecurity}</Text>
              </View>
              <View style={s.infoRow}>
                <Text style={s.infoKey}>{uiText("Trạng thái tài khoản:")}</Text>
                <Text style={s.infoVal}>
                  {snapshot.user
                    ? `${snapshot.user.displayName} (${snapshot.user.role})`
                    : uiText("Khách vãng lai")}
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
