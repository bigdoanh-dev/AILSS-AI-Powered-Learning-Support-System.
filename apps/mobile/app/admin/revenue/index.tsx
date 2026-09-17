import { useState, useEffect, useCallback } from "react";
import { Text, View, StyleSheet, ScrollView } from "react-native";
import { router, type Href } from "expo-router";
import { useSyncExternalStore } from "react";
import { ApiError } from "../../../src/api";
import { runtime } from "../../../src/runtime";
import { Page, Button, Icon, Badge, ScreenHeader, BottomNavBar, styles, tokens } from "../../../src/ui";
import { ScalePressable, AnimatedNumber, AnimatedProgressBar, StaggerPop, FadeSlideIn } from "../../../src/motion";

const TIME_RANGES = [
  { id: "today", label: "Hôm nay" },
  { id: "7d", label: "7 ngày" },
  { id: "30d", label: "Tháng này" },
  { id: "all", label: "Toàn bộ" },
];

const COURSE_REVENUE = [
  { id: "c1", title: "Lập trình Web & Trợ lý AI Fullstack", revenue: "58.200.000 ₫", percent: 39, orders: 165 },
  { id: "c2", title: "Cơ sở dữ liệu Nâng cao & Ngôn ngữ kịch bản", revenue: "46.500.000 ₫", percent: 31, orders: 132 },
  { id: "c3", title: "Trí tuệ nhân tạo & Mô hình LLM thực chiến", revenue: "28.800.000 ₫", percent: 19, orders: 82 },
  { id: "c4", title: "Kiểm thử tự động & CI/CD Cloud", revenue: "15.000.000 ₫", percent: 11, orders: 47 },
];

export default function AdminRevenueDashboard() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [range, setRange] = useState("30d");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (snapshot.user?.role !== "ADMIN") return;
    setLoading(true);
    setError(null);
    try {
      const res = await session.request(`/api/v1/admin/dashboard/revenue?range=${range}`);
      setData((res as any)?.data ?? res);
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError("Không thể tải dữ liệu doanh thu thời gian thực.");
      }
    } finally {
      setLoading(false);
    }
  }, [session, snapshot.user?.role, range]);

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
          subtitle="Báo cáo tài chính, cổng thanh toán VietQR & đối soát đơn hàng"
          onBack={() => router.replace("/admin")}
        />

        {error ? (
          <View style={{ backgroundColor: "#FEE2E2", padding: 12, borderRadius: 8, marginHorizontal: 16, marginBottom: 12 }}>
            <Text style={{ color: "#991B1B", fontSize: 13, fontWeight: "500", marginBottom: 6 }}>⚠️ {error}</Text>
            <Button label="Thử lại" onPress={() => void loadData()} />
          </View>
        ) : null}

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 24 }}>
          {/* Time Range Filter Selector */}
          <View style={rs.filterRow}>
            {TIME_RANGES.map((t) => (
              <ScalePressable
                key={t.id}
                style={[rs.filterChip, range === t.id && rs.filterChipActive]}
                scaleTo={0.93}
                onPress={() => setRange(t.id)}
                accessibilityRole="button"
                accessibilityLabel={t.label}
              >
                <Text style={[rs.filterText, range === t.id && rs.filterTextActive]}>{t.label}</Text>
              </ScalePressable>
            ))}
          </View>

          {/* KPI 4-Card Grid */}
          <FadeSlideIn duration={500}>
            <View style={rs.kpiGrid}>
              <View style={rs.kpiCard}>
                <View style={[rs.kpiIconWrap, { backgroundColor: "#DCFCE7" }]}>
                  <Icon name="trending" size={20} color="#15803D" />
                </View>
                <AnimatedNumber value={148.5} suffix="M ₫" decimals={1} style={rs.kpiValue} />
                <Text style={rs.kpiLabel}>Doanh thu thực tế</Text>
                <Text style={rs.kpiGrowth}>+18.4% tăng trưởng</Text>
              </View>

              <View style={rs.kpiCard}>
                <View style={[rs.kpiIconWrap, { backgroundColor: "#E0F2FE" }]}>
                  <Icon name="receipt" size={20} color="#0284C7" />
                </View>
                <AnimatedNumber value={426} suffix=" đơn" style={rs.kpiValue} />
                <Text style={rs.kpiLabel}>Đơn hoàn tất</Text>
                <Text style={rs.kpiGrowth}>+24 đơn mới</Text>
              </View>

              <View style={rs.kpiCard}>
                <View style={[rs.kpiIconWrap, { backgroundColor: "#FEF3C7" }]}>
                  <Icon name="card" size={20} color="#D97706" />
                </View>
                <AnimatedNumber value={99.4} suffix="%" decimals={1} style={rs.kpiValue} />
                <Text style={rs.kpiLabel}>Tỷ lệ đối soát tự động</Text>
                <Text style={rs.kpiSub}>Webhook 1.2s</Text>
              </View>

              <View style={rs.kpiCard}>
                <View style={[rs.kpiIconWrap, { backgroundColor: "#EDE9FE" }]}>
                  <Icon name="star" size={20} color="#7C3AED" />
                </View>
                <AnimatedNumber value={348} suffix="K ₫" style={rs.kpiValue} />
                <Text style={rs.kpiLabel}>Giá trị TB / đơn (AOV)</Text>
                <Text style={rs.kpiSub}>4.9★ đánh giá</Text>
              </View>
            </View>
          </FadeSlideIn>

          {/* Payment Gateway Entitlement Health Card */}
          <FadeSlideIn delay={120} duration={500}>
            <View style={rs.card}>
              <View style={rs.cardHeaderRow}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Icon name="shield" size={18} color={tokens.color.brand} />
                  <Text style={rs.cardHeading}>Sức khỏe đối soát tự động</Text>
                </View>
                <Badge label="HOẠT ĐỘNG TỐT" variant="success" icon="check" />
              </View>

              <View style={rs.statusRow}>
                <View style={rs.statusCol}>
                  <AnimatedNumber value={418} style={[rs.statusNum, { color: "#15803D" }]} />
                  <Text style={rs.statusDesc}>Đã cấp quyền (ENTITLED)</Text>
                </View>
                <View style={rs.statusCol}>
                  <AnimatedNumber value={2} style={[rs.statusNum, { color: "#D97706" }]} />
                  <Text style={rs.statusDesc}>Chờ cấp quyền (PENDING)</Text>
                </View>
                <View style={rs.statusCol}>
                  <AnimatedNumber value={6} style={[rs.statusNum, { color: "#DC2626" }]} />
                  <Text style={rs.statusDesc}>Thất bại / Hủy (FAILED)</Text>
                </View>
              </View>

              <Button
                label="Tra cứu & Đối soát đơn hàng chi tiết →"
                size="sm"
                variant="outline"
                onPress={() => router.push("/admin/commerce" as Href)}
              />
            </View>
          </FadeSlideIn>

          {/* Top Courses Revenue Breakdown */}
          <FadeSlideIn delay={220} duration={500}>
            <View style={rs.card}>
              <Text style={rs.cardHeading}>Doanh thu theo khóa học hàng đầu</Text>
              <Text style={rs.cardDesc}>Phân bổ tỷ trọng doanh thu các khóa học chính quy</Text>

              <View style={{ gap: 12, marginTop: 4 }}>
                {COURSE_REVENUE.map((c) => (
                  <View key={c.id} style={{ gap: 6 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={rs.courseTitle} numberOfLines={1}>
                        {c.title}
                      </Text>
                      <Text style={rs.courseRev}>{c.revenue}</Text>
                    </View>
                    <AnimatedProgressBar progress={c.percent} color={tokens.color.brand} height={6} />
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={rs.courseMeta}>{c.orders} học viên đăng ký</Text>
                      <Text style={rs.courseMeta}>{c.percent}% doanh thu</Text>
                    </View>
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

const rs = StyleSheet.create({
  filterRow: {
    flexDirection: "row",
    gap: 8,
  },
  filterChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: tokens.color.surface,
    borderWidth: 1,
    borderColor: tokens.color.border,
    alignItems: "center",
  },
  filterChipActive: {
    backgroundColor: tokens.color.brand,
    borderColor: tokens.color.brand,
  },
  filterText: {
    fontSize: 12,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  filterTextActive: {
    color: "#FFFFFF",
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
  kpiGrowth: {
    fontSize: 11,
    color: "#15803D",
    fontWeight: "700",
    marginTop: 2,
  },
  kpiSub: {
    fontSize: 11,
    color: tokens.color.muted,
    marginTop: 2,
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
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    backgroundColor: "#F8FAFC",
    padding: 12,
    borderRadius: 10,
  },
  statusCol: {
    alignItems: "center",
    gap: 2,
  },
  statusNum: {
    fontSize: 18,
    fontWeight: "800",
  },
  statusDesc: {
    fontSize: 10,
    color: tokens.color.muted,
    fontWeight: "600",
    textAlign: "center",
  },
  courseTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: tokens.color.ink,
    flex: 1,
    paddingRight: 8,
  },
  courseRev: {
    fontSize: 13,
    fontWeight: "800",
    color: tokens.color.brand,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "#E2E8F0",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: tokens.color.brand,
    borderRadius: 3,
  },
  courseMeta: {
    fontSize: 11,
    color: tokens.color.muted,
  },
});
