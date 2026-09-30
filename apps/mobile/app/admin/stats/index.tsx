import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { ApiError, record } from "../../../src/api";
import { runtime } from "../../../src/runtime";
import { Button, Page, ScreenHeader, styles, tokens } from "../../../src/ui";

type AccountStats = {
  totalAccounts: number;
  students: number;
  lecturers: number;
  admins: number;
  suspended: number;
};
function accountStats(value: unknown): AccountStats {
  const data = record(value);
  const count = (key: keyof AccountStats) => {
    const number = data[key];
    if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 0)
      throw new ApiError("invalid");
    return number;
  };
  return {
    totalAccounts: count("totalAccounts"),
    students: count("students"),
    lecturers: count("lecturers"),
    admins: count("admins"),
    suspended: count("suspended"),
  };
}

export default function AdminStatsDashboard() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [data, setData] = useState<AccountStats | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (snapshot.user?.role !== "ADMIN") return;
    setError("");
    try {
      setData(accountStats(await session.request("/api/v1/admin/dashboard/stats")));
    } catch (cause) {
      setData(null);
      setError(cause instanceof ApiError ? cause.message : "Không thể tải thống kê tài khoản.");
    }
  }, [session, snapshot.user?.role]);
  useEffect(() => {
    void load();
  }, [load]);
  if (snapshot.user?.role !== "ADMIN")
    return (
      <Page>
        <Text style={styles.error}>Chỉ quản trị viên được xem thống kê.</Text>
      </Page>
    );
  return (
    <Page>
      <ScreenHeader
        title="Thống kê tài khoản"
        subtitle="Số liệu tài khoản hiện tại"
        onBack={() => router.replace("/admin")}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <Button label="Làm mới" onPress={() => void load()} />
      {data ? (
        <View style={{ backgroundColor: tokens.color.surface, borderRadius: 14, padding: 16, gap: 10 }}>
          <Text style={styles.title}>Tổng tài khoản: {data.totalAccounts}</Text>
          <Text style={styles.text}>Học viên đang hoạt động: {data.students}</Text>
          <Text style={styles.text}>Giảng viên đang hoạt động: {data.lecturers}</Text>
          <Text style={styles.text}>Quản trị viên đang hoạt động: {data.admins}</Text>
          <Text style={styles.text}>Tài khoản tạm khóa: {data.suspended}</Text>
        </View>
      ) : (
        <Text style={styles.small}>Chưa có số liệu tài khoản.</Text>
      )}
    </Page>
  );
}
