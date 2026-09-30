import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Text, View, Linking } from "react-native";
import { router } from "expo-router";
import { ApiError, record } from "../../../src/api";
import { runtime } from "../../../src/runtime";
import { Button, Page, ScreenHeader, styles } from "../../../src/ui";

type Monitoring = {
  prometheus: { available: boolean; url: string };
  grafana: { available: boolean; url: string };
  metrics: { requestRate: number | null; errorPercent: number | null; p95Ms: number | null };
  services: { job: string; up: boolean }[];
  alerts: { name: string; state: string; summary: string }[] | null;
};
const number = (value: number | null, suffix = "") =>
  value === null ? "Chưa có dữ liệu" : `${value.toFixed(2)}${suffix}`;
export default function AdminMonitoring() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [data, setData] = useState<Monitoring | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (snapshot.user?.role !== "ADMIN") return;
    try {
      const response = record(await session.request("/api/v1/admin/monitoring"));
      if (!Array.isArray(response.services) || !response.metrics || !response.prometheus || !response.grafana)
        throw new ApiError("invalid");
      setData(response as unknown as Monitoring);
      setError("");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Không thể tải giám sát.");
    }
  }, [session, snapshot.user?.role]);
  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 30_000);
    return () => clearInterval(interval);
  }, [load]);
  const open = async (url: string) => {
    if (!/^https?:\/\//u.test(url)) return;
    try {
      await Linking.openURL(url);
    } catch {
      setError("Không thể mở trang giám sát.");
    }
  };
  if (snapshot.user?.role !== "ADMIN")
    return (
      <Page>
        <Text style={styles.error}>Chỉ quản trị viên được xem giám sát.</Text>
      </Page>
    );
  return (
    <Page>
      <ScreenHeader
        title="Prometheus & Grafana"
        subtitle="Giám sát hệ thống · cập nhật mỗi 30 giây"
        onBack={() => router.back()}
      />
      <Button label="Làm mới" onPress={() => void load()} />
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {data && (
        <>
          <View style={styles.card}>
            <Text style={styles.text}>
              Prometheus: {data.prometheus.available ? "Đã kết nối" : "Không kết nối được"}
            </Text>
            <Text style={styles.text}>
              Grafana: {data.grafana.available ? "Đã kết nối" : "Không kết nối được"}
            </Text>
            <Button label="Mở Prometheus" variant="outline" onPress={() => void open(data.prometheus.url)} />
            <Button label="Mở Grafana" variant="outline" onPress={() => void open(data.grafana.url)} />
          </View>
          <View style={styles.card}>
            <Text style={styles.text}>Lưu lượng: {number(data.metrics.requestRate, " yêu cầu/giây")}</Text>
            <Text style={styles.text}>Lỗi 5xx: {number(data.metrics.errorPercent, "%")}</Text>
            <Text style={styles.text}>Độ trễ p95: {number(data.metrics.p95Ms, " ms")}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.text}>Tình trạng dịch vụ</Text>
            {data.services.map((service) => (
              <Text key={service.job} style={styles.text}>
                {service.job}: {service.up ? "Hoạt động" : "Mất kết nối"}
              </Text>
            ))}
            {!data.services.length && <Text style={styles.text}>Chưa có dữ liệu dịch vụ.</Text>}
          </View>
          <View style={styles.card}>
            <Text style={styles.text}>Cảnh báo</Text>
            {data.alerts === null ? (
              <Text style={styles.text}>Không thể tải cảnh báo.</Text>
            ) : data.alerts.length ? (
              data.alerts.map((alert, index) => (
                <Text key={`${alert.name}-${index}`} style={styles.text}>
                  {alert.name} · {alert.state}: {alert.summary}
                </Text>
              ))
            ) : (
              <Text style={styles.text}>Không có cảnh báo đang hoạt động.</Text>
            )}
          </View>
        </>
      )}
    </Page>
  );
}
