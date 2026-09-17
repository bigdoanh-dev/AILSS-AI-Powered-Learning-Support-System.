import { useState, useEffect, useCallback } from "react";
import { Text, View, StyleSheet, ScrollView } from "react-native";
import { router, type Href } from "expo-router";
import { useSyncExternalStore } from "react";
import { ApiError } from "../../../src/api";
import { runtime } from "../../../src/runtime";
import { Page, Button, Icon, Badge, ScreenHeader, BottomNavBar, styles, tokens } from "../../../src/ui";
import { AnimatedNumber, AnimatedProgressBar, StaggerPop, FadeSlideIn } from "../../../src/motion";

const COGNITIVE_STATS = [
  { level: "Nhận biết (Recognition)", rate: 86, color: "#0284C7" },
  { level: "Thông hiểu (Understanding)", rate: 78, color: "#7C3AED" },
  { level: "Vận dụng (Application)", rate: 64, color: "#D97706" },
  { level: "Vận dụng cao (Advanced)", rate: 48, color: "#059669" },
];

export default function AdminStatsDashboard() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (snapshot.user?.role !== "ADMIN") return;
    setLoading(true);
    setError(null);
    try {
      const res = await session.request("/api/v1/admin/dashboard/stats");
      setData((res as any)?.data ?? res);
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError("Không thể tải dữ liệu thống kê thời gian thực.");
      }
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
        <ScreenHeader title="Dashboard Thống kê" onBack={() => router.replace("/")} />
        <Text style={styles.error}>Chức năng này yêu cầu quyền Quản trị viên (ADMIN).</Text>
        <Button label="Về trang chủ" onPress={() => router.replace("/")} />
      </Page>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <Page>
        <ScreenHeader
          title="Dashboard Người dùng & Học tập"
          subtitle="Thống kê tài khoản, tỷ lệ học viên & năng lực AI"
          onBack={() => router.replace("/admin")}
        />

        {error ? (
          <View style={{ backgroundColor: "#FEE2E2", padding: 12, borderRadius: 8, marginHorizontal: 16, marginBottom: 12 }}>
            <Text style={{ color: "#991B1B", fontSize: 13, fontWeight: "500", marginBottom: 6 }}>⚠️ {error}</Text>
            <Button label="Thử lại" onPress={() => void loadData()} />
          </View>
        ) : null}

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 24 }}>
          {/* User Roles 4-Card Summary */}
          <View style={st.card}>
            <View style={st.cardHeaderRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Icon name="people" size={18} color={tokens.color.brand} />
                <Text style={st.cardHeading}>Cơ cấu người dùng hệ thống</Text>
              </View>
              <Badge label="1.292 TỔNG SỐ" variant="neutral" />
            </View>

            <View style={st.userRow}>
              <View style={st.userCol}>
                <AnimatedNumber value={1240} style={[st.userNum, { color: "#0284C7" }]} />
                <Text style={st.userRole}>Học viên</Text>
                <Text style={st.userSub}>94.2% Active</Text>
              </View>
              <View style={st.userCol}>
                <AnimatedNumber value={48} style={[st.userNum, { color: "#7C3AED" }]} />
                <Text style={st.userRole}>Giảng viên</Text>
                <Text style={st.userSub}>3 chờ duyệt</Text>
              </View>
              <View style={st.userCol}>
                <AnimatedNumber value={4} style={[st.userNum, { color: "#059669" }]} />
                <Text style={st.userRole}>Quản trị viên</Text>
                <Text style={st.userSub}>Root/Security</Text>
              </View>
              <View style={st.userCol}>
                <AnimatedNumber value={2} style={[st.userNum, { color: "#DC2626" }]} />
                <Text style={st.userRole}>Tạm khóa</Text>
                <Text style={st.userSub}>Vi phạm quy chế</Text>
              </View>
            </View>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <Button
                label="Tra cứu người dùng"
                size="sm"
                variant="outline"
                onPress={() => router.push("/admin/users" as Href)}
              />
              <Button
                label="Duyệt giảng viên"
                size="sm"
                variant="outline"
                onPress={() => router.push("/admin/lecturers" as Href)}
              />
            </View>
          </View>

          {/* Learning & AI Examination KPIs */}
          <FadeSlideIn delay={100} duration={500}>
            <View style={st.kpiGrid}>
              <View style={st.kpiCard}>
                <View style={[st.kpiIconWrap, { backgroundColor: "#FEF3C7" }]}>
                  <Icon name="sparkles" size={20} color="#D97706" />
                </View>
                <AnimatedNumber value={3820} suffix=" lượt" style={st.kpiValue} />
                <Text style={st.kpiLabel}>Luyện đề thi AI</Text>
                <Text style={st.kpiSub}>Thích ứng năng lực</Text>
              </View>

              <View style={st.kpiCard}>
                <View style={[st.kpiIconWrap, { backgroundColor: "#DCFCE7" }]}>
                  <Icon name="award" size={20} color="#15803D" />
                </View>
                <AnimatedNumber value={7.8} suffix=" / 10" decimals={1} style={st.kpiValue} />
                <Text style={st.kpiLabel}>Điểm TB toàn hệ thống</Text>
                <Text style={st.kpiSub}>+0.4 so với kỳ trước</Text>
              </View>

              <View style={st.kpiCard}>
                <View style={[st.kpiIconWrap, { backgroundColor: "#EDE9FE" }]}>
                  <Icon name="book" size={20} color="#7C3AED" />
                </View>
                <AnimatedNumber value={74.5} suffix="%" decimals={1} style={st.kpiValue} />
                <Text style={st.kpiLabel}>Tỷ lệ hoàn thành khóa</Text>
                <Text style={st.kpiSub}>Trên 80 khóa học</Text>
              </View>

              <View style={st.kpiCard}>
                <View style={[st.kpiIconWrap, { backgroundColor: "#E0F2FE" }]}>
                  <Icon name="clock" size={20} color="#0284C7" />
                </View>
                <AnimatedNumber value={12450} suffix=" giờ" style={st.kpiValue} />
                <Text style={st.kpiLabel}>Thời gian học tập</Text>
                <Text style={st.kpiSub}>Live Classroom & Video</Text>
              </View>
            </View>
          </FadeSlideIn>

          {/* AI Cognitive Mastery Chart */}
          <FadeSlideIn delay={200} duration={500}>
            <View style={st.card}>
              <View style={st.cardHeaderRow}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Icon name="stats" size={18} color={tokens.color.brand} />
                  <Text style={st.cardHeading}>Đánh giá theo thang nhận thức AI</Text>
                </View>
                <Badge label="OBJECTIVE-V1" variant="ai" />
              </View>
              <Text style={st.cardDesc}>Tỷ lệ học viên đạt điểm chuẩn theo 4 cấp độ tư duy</Text>

              <View style={{ gap: 12, marginTop: 4 }}>
                {COGNITIVE_STATS.map((c) => (
                  <View key={c.level} style={{ gap: 6 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={st.levelName}>{c.level}</Text>
                      <Text style={[st.levelRate, { color: c.color }]}>{c.rate}% đạt</Text>
                    </View>
                    <AnimatedProgressBar progress={c.rate} color={c.color} height={6} />
                  </View>
                ))}
              </View>
            </View>
          </FadeSlideIn>
        </ScrollView>
      </Page>

      <BottomNavBar
        currentRoute="admin"
        role={snapshot.user?.role}
        onNavigate={(path) => router.push(path as Href)}
      />
    </View>
  );
}

const st = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: tokens.color.border,
    gap: 12,
    ...tokens.shadow.subtle,
  },
  cardHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardHeading: {
    fontSize: 15,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  cardDesc: {
    fontSize: 12,
    color: tokens.color.muted,
    marginTop: -4,
  },
  userRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    backgroundColor: "#F8FAFC",
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderRadius: 12,
  },
  userCol: {
    alignItems: "center",
    gap: 2,
  },
  userNum: {
    fontSize: 18,
    fontWeight: "800",
  },
  userRole: {
    fontSize: 12,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  userSub: {
    fontSize: 10,
    color: tokens.color.muted,
  },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  kpiCard: {
    width: "48%",
    backgroundColor: tokens.color.surface,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: tokens.color.border,
    gap: 4,
    ...tokens.shadow.subtle,
  },
  kpiIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  kpiValue: {
    fontSize: 18,
    fontWeight: "800",
    color: tokens.color.ink,
  },
  kpiLabel: {
    fontSize: 11,
    color: tokens.color.muted,
    fontWeight: "600",
  },
  kpiSub: {
    fontSize: 11,
    color: tokens.color.muted,
    marginTop: 2,
  },
  levelName: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.color.ink,
  },
  levelRate: {
    fontSize: 13,
    fontWeight: "800",
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "#E2E8F0",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 3,
  },
});
