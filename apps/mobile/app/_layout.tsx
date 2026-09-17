import { useEffect, useSyncExternalStore } from "react";
import { AppState, StatusBar, Text } from "react-native";
import { Stack } from "expo-router";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { runtime } from "../src/runtime";
import { getSystemSettings } from "../src/settings";
import { Page, styles, tokens } from "../src/ui";
function Shell() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEffect(() => {
    const settings = getSystemSettings();
    if (settings.requireLoginOnColdStart) {
      void session.logout().catch(() => {});
    } else {
      void session.restore();
    }
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void session.revalidate();
    });
    return () => listener.remove();
  }, [session]);
  if (snapshot.state === "BOOTING")
    return (
      <Page>
        <Text style={styles.title}>AILSS</Text>
        <Text accessibilityRole="alert" style={styles.text}>
          Đang khôi phục phiên…
        </Text>
      </Page>
    );
  return (
    <Stack
      initialRouteName="index"
      screenOptions={{ headerShown: false, animation: "none" }}
    />
  );
}
export default function Layout() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={tokens.color.canvas} />
      <SafeAreaView
        style={{ flex: 1, backgroundColor: tokens.color.canvas }}
        edges={["top", "bottom", "left", "right"]}
      >
        {runtime ? (
          <Shell />
        ) : (
          <Page>
            <Text style={styles.title}>Cần cấu hình ứng dụng</Text>
            <Text style={styles.text}>
              Chưa có môi trường hoặc địa chỉ Gateway hợp lệ. Hãy kiểm tra cấu hình phát triển.
            </Text>
            <Text style={styles.small}>FATAL_CONFIGURATION_ERROR</Text>
          </Page>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
