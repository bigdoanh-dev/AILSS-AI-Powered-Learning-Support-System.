import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { ApiError } from "../../../src/api";
import { runtime } from "../../../src/runtime";
import { Button, Page, ScreenHeader, styles, tokens } from "../../../src/ui";

export default function AdminRevenueDashboard() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectionReady, setProjectionReady] = useState(false);

  const loadData = useCallback(async () => {
    if (snapshot.user?.role !== "ADMIN") return;
    setLoading(true);
    setError(null);
    try {
      const response = await session.request("/api/v1/admin/dashboard/revenue?range=30d");
      const envelope = response as { data?: { dataSource?: string }; dataSource?: string };
      const payload = envelope.data ?? envelope;
      setProjectionReady(payload?.dataSource === "AUTHORITATIVE_PAYMENT_REFUND_PROJECTION");
    } catch (cause: unknown) {
      setProjectionReady(false);
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Không thể tải projection thanh toán và hoàn tiền.",
      );
    } finally {
      setLoading(false);
    }
  }, [session, snapshot.user?.role]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (snapshot.user?.role !== "ADMIN") {
    return (
      <Page>
        <ScreenHeader title="Dashboard Doanh thu" onBack={() => router.replace("/")} />
        <Text style={styles.error}>Chức năng này yêu cầu quyền Quản trị viên (ADMIN).</Text>
        <Button label="Về trang chủ" onPress={() => router.replace("/")} />
      </Page>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <Page>
        <ScreenHeader
          title="Dashboard Doanh thu"
          subtitle="Chỉ hiển thị dữ liệu thanh toán và hoàn tiền có thể kiểm toán"
          onBack={() => router.replace("/admin")}
        />
        <View
          accessibilityLiveRegion="polite"
          style={{
            backgroundColor: tokens.color.surface,
            borderColor: tokens.color.border,
            borderRadius: 14,
            borderWidth: 1,
            gap: 10,
            padding: 16,
          }}
        >
          <Text style={{ color: tokens.color.ink, fontSize: 17, fontWeight: "800" }}>
            {projectionReady
              ? "Projection doanh thu đã sẵn sàng"
              : "Chưa có báo cáo doanh thu có thẩm quyền"}
          </Text>
          <Text style={{ color: tokens.color.muted, fontSize: 13, lineHeight: 20 }}>
            {projectionReady
              ? "Nguồn dữ liệu thanh toán và hoàn tiền có thể kiểm toán đã được kết nối."
              : "Ứng dụng không hiển thị KPI, giao dịch hoặc số liệu dự phòng giả. Báo cáo sẽ chỉ xuất hiện sau khi projection thanh toán và hoàn tiền đã sẵn sàng."}
          </Text>
          {error ? <Text style={styles.error}>Máy chủ: {error}</Text> : null}
          <Button
            label={loading ? "Đang kiểm tra…" : "Kiểm tra lại"}
            onPress={() => void loadData()}
            disabled={loading}
          />
        </View>
      </Page>
    </View>
  );
}
