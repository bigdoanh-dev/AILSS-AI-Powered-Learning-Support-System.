import { useEffect, useSyncExternalStore } from "react";
import { AppState, StatusBar, Text } from "react-native";
import * as Network from "expo-network";
import { router, Stack, usePathname } from "expo-router";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { offlineStore, restoreMobilePreferences, runtime } from "../src/runtime";
import { getSystemSettings } from "../src/settings";
import { Button, Page, styles, tokens } from "../src/ui";
import { syncPendingLessonCompletions } from "../src/lesson-sync";
import { phase41RouteAvailable } from "../src/features";
function Shell() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const pathname = usePathname();
  useEffect(() => {
    let mounted = true;
    // Run TTL cleanup on cold start; the store also purges before cache reads/writes.
    void offlineStore?.purgeExpiredCache().catch(() => {});
    void (async () => {
      // Resolve the persisted security choice before deciding whether to restore credentials.
      await restoreMobilePreferences();
      if (!mounted) return;
      if (getSystemSettings().requireLoginOnColdStart) {
        void session.requireLoginAfterColdStart();
      } else {
        void session.restore();
      }
    })();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void offlineStore?.purgeExpiredCache().catch(() => {});
        void session.revalidate();
        const current = session.snapshot;
        if (current.state === "AUTHENTICATED" && current.user?.role === "STUDENT") {
          void Network.getNetworkStateAsync().then((network) => {
            if (network.isConnected && network.isInternetReachable !== false)
              return syncPendingLessonCompletions(session, current.user!.userId, offlineStore);
          });
        }
      }
    });
    return () => {
      mounted = false;
      listener.remove();
    };
  }, [session]);
  useEffect(() => {
    if (snapshot.state !== "AUTHENTICATED" || snapshot.user?.role !== "STUDENT" || !snapshot.user.userId) return;
    const userId = snapshot.user.userId;
    const syncIfOnline = async () => {
      const network = await Network.getNetworkStateAsync();
      if (network.isConnected && network.isInternetReachable !== false)
        await syncPendingLessonCompletions(session, userId, offlineStore);
    };
    const subscription = Network.addNetworkStateListener((network) => {
      if (network.isConnected && network.isInternetReachable !== false) void syncIfOnline();
    });
    void syncIfOnline();
    return () => subscription.remove();
  }, [session, snapshot.state, snapshot.user?.role, snapshot.user?.userId]);
  if (snapshot.state === "BOOTING")
    return (
      <Page>
        <Text style={styles.title}>AILSS</Text>
        <Text accessibilityRole="alert" style={styles.text}>
          Đang khôi phục phiên…
        </Text>
      </Page>
    );
  if (!phase41RouteAvailable(pathname, snapshot.user?.role))
    return (
      <Page>
        <Text style={styles.title}>Tính năng chưa khả dụng trên Mobile</Text>
        <Text accessibilityRole="alert" style={styles.text}>
          Phase 41 hiện chỉ hỗ trợ trải nghiệm Học viên. Các màn hình Giảng viên và Quản trị được giữ ngoài phạm vi phát hành này.
        </Text>
        <Button
          label={snapshot.state === "AUTHENTICATED" ? "Đăng xuất" : "Đến đăng nhập"}
          onPress={() =>
            snapshot.state === "AUTHENTICATED"
              ? void session.logout().catch(() => {})
              : router.replace("/login")
          }
        />
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
  const pathname = usePathname();
  const tutorAppearance = pathname === "/student/tutor";
  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={tutorAppearance ? "light-content" : "dark-content"}
        backgroundColor={tutorAppearance ? "#073C60" : tokens.color.canvas}
      />
      <SafeAreaView
        style={{ flex: 1, backgroundColor: tutorAppearance ? "#073C60" : tokens.color.canvas }}
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
