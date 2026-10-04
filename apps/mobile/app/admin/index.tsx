import { useUiText } from "../../src/use-language";
import { useEffect, useState, useCallback } from "react";
import {
  Text,
  View,
  Pressable,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { router, type Href } from "expo-router";
import { useSyncExternalStore } from "react";
import { ApiError, record } from "../../src/api";
import { runtime } from "../../src/runtime";
import { Page, Button, Icon, ScreenHeader, BottomNavBar, styles, tokens } from "../../src/ui";

export default function AdminDashboard() {
  const uiText = useUiText();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [lecturerCount, setLecturerCount] = useState<number | null>(null);
  const [studentCount, setStudentCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadData = useCallback(
    async (signal?: AbortSignal) => {
      if (snapshot.user?.role !== "ADMIN") return;
      setError("");
      try {
        const stats = record(await session.request("/api/v1/admin/dashboard/stats", { signal }));
        if (signal?.aborted) return;
        if (typeof stats.students !== "number" || typeof stats.lecturers !== "number")
          throw new ApiError("invalid");
        setLecturerCount(stats.lecturers);
        setStudentCount(stats.students);
      } catch (e: unknown) {
        if (!signal?.aborted) {
          setLecturerCount(null);
          setStudentCount(null);
          setError(e instanceof ApiError ? e.message : "Không thể tải số liệu tổng quan.");
        }
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [session, snapshot.user?.role, snapshot.user?.userId],
  );

  useEffect(() => {
    setLecturerCount(null);
    setStudentCount(null);
    setLoading(true);
    const abort = new AbortController();
    void loadData(abort.signal);
    return () => abort.abort();
  }, [loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadData();
  }, [loadData]);

  if (snapshot.user?.role !== "ADMIN") {
    return (
      <Page>
        <ScreenHeader title={uiText("Quản trị hệ thống")} onBack={() => router.replace("/")} />
        <View style={[styles.card, { alignItems: "center", paddingVertical: 32, gap: 14, marginTop: 12 }]}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: "#FEE2E2",
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 2,
              borderColor: "#FECACA",
            }}
          >
            <Icon name="shield" size={36} color="#DC2626" />
          </View>
          <Text style={[styles.title, { textAlign: "center" }]}>{uiText("Trung tâm Quản trị AILSS")}</Text>
          <Text style={[styles.text, { textAlign: "center", maxWidth: 300 }]}>
            {uiText(
              "Khu vực dành riêng cho Quản trị viên hệ thống (ADMIN) để duyệt giảng viên, kiểm duyệt báo cáo và giám sát vận hành.",
            )}
          </Text>

          <View style={{ width: "100%", gap: 10, marginTop: 12 }}>
            <Button
              label={uiText("Đăng nhập bằng tài khoản quản trị")}
              variant="primary"
              size="lg"
              onPress={() => router.push("/login?role=admin" as Href)}
            />
            <Button
              label={uiText("Nhập tài khoản khác tại trang đăng nhập")}
              variant="secondary"
              size="md"
              onPress={() => router.push("/login?role=admin" as Href)}
            />
            <Button
              label={uiText("← Về trang chủ")}
              variant="outline"
              size="md"
              onPress={() => router.replace("/")}
            />
          </View>
        </View>
      </Page>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <Page scroll={false}>
        <ScreenHeader
          title={uiText("Bảng điều khiển quản trị")}
          subtitle={uiText("Chào {0} · Quản trị viên hệ thống", [snapshot.user.displayName])}
          onBack={() => router.replace("/account")}
        />

        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{ gap: 14, paddingBottom: 24 }}
        >
          {error ? <Text style={styles.error}>{uiText(error)}</Text> : null}

          {loading && !refreshing ? (
            <ActivityIndicator
              size="small"
              color={tokens.color.brand}
              style={{ marginVertical: tokens.space.small }}
            />
          ) : null}

          {/* Operational Overview KPIs */}
          <View style={ds.kpiGrid}>
            <View style={ds.kpiCard}>
              <View style={ds.kpiIconWrap}>
                <Icon name="academic" size={24} color={tokens.color.brand} />
              </View>
              <Text style={ds.kpiValue}>{lecturerCount !== null ? `${lecturerCount}` : "—"}</Text>
              <Text style={ds.kpiLabel}>{uiText("Giảng viên đang hoạt động")}</Text>
            </View>
            <View style={ds.kpiCard}>
              <View style={ds.kpiIconWrap}>
                <Icon name="shield" size={24} color={tokens.color.brand} />
              </View>
              <Text style={ds.kpiValue}>{studentCount !== null ? `${studentCount}` : "—"}</Text>
              <Text style={ds.kpiLabel}>{uiText("Học viên đang hoạt động")}</Text>
            </View>
          </View>

          {/* Dedicated Specialized Dashboards */}
          <Text style={[styles.text, { fontWeight: "700", marginTop: tokens.space.small }]}>
            {uiText("Phân hệ Dashboard chuyên biệt")}
          </Text>

          <View style={ds.actionStack}>
            <Button
              label={uiText("Xuất bản và lưu trữ khóa học")}
              onPress={() => router.push("/admin/courses" as Href)}
            />
            <Button
              label="Prometheus & Grafana"
              variant="outline"
              onPress={() => router.push("/admin/monitoring" as Href)}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={uiText("Dashboard Doanh thu & Thương mại")}
              style={ds.queueCard}
              onPress={() => router.push("/admin/revenue" as Href)}
            >
              <View style={ds.queueHeader}>
                <View style={[ds.queueIconWrap, { backgroundColor: "#DCFCE7" }]}>
                  <Icon name="trending" size={20} color="#15803D" />
                </View>
                <View style={ds.queueText}>
                  <Text style={ds.queueTitle}>{uiText("Dashboard Doanh thu & Thương mại")}</Text>
                  <Text style={ds.queueDesc}>
                    {uiText("Báo cáo tài chính, cổng thanh toán VietQR, tăng trưởng & đối soát đơn hàng")}
                  </Text>
                </View>
              </View>
              <Icon name="chevronRight" size={18} color={tokens.color.muted} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={uiText("AI quản trị")}
              style={ds.queueCard}
              onPress={() => router.push("/admin/ai" as Href)}
            >
              <View style={ds.queueHeader}>
                <View style={[ds.queueIconWrap, { backgroundColor: "#FEF3C7" }]}>
                  <Icon name="sparkles" size={20} color="#D97706" />
                </View>
                <View style={ds.queueText}>
                  <Text style={ds.queueTitle}>{uiText("AI quản trị")}</Text>
                  <Text style={ds.queueDesc}>
                    {uiText("Hỏi về báo cáo, kiểm duyệt và quy trình vận hành")}
                  </Text>
                </View>
              </View>
              <Icon name="chevronRight" size={18} color={tokens.color.muted} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={uiText("Thống kê tài khoản")}
              style={ds.queueCard}
              onPress={() => router.push("/admin/stats" as Href)}
            >
              <View style={ds.queueHeader}>
                <View style={[ds.queueIconWrap, { backgroundColor: "#E0F2FE" }]}>
                  <Icon name="stats" size={20} color="#0284C7" />
                </View>
                <View style={ds.queueText}>
                  <Text style={ds.queueTitle}>{uiText("Thống kê tài khoản")}</Text>
                  <Text style={ds.queueDesc}>
                    {uiText("Số tài khoản theo vai trò và trạng thái tạm khóa")}
                  </Text>
                </View>
              </View>
              <Icon name="chevronRight" size={18} color={tokens.color.muted} />
            </Pressable>
          </View>

          {/* Operational Queues & Modules */}
          <Text style={[styles.text, { fontWeight: "700", marginTop: tokens.space.small }]}>
            {uiText("Hàng đợi vận hành")}
          </Text>

          <View style={ds.actionStack}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={uiText("Tra cứu người dùng")}
              style={ds.queueCard}
              onPress={() => router.push("/admin/users" as Href)}
            >
              <View style={ds.queueHeader}>
                <View style={ds.queueIconWrap}>
                  <Icon name="people" size={20} color={tokens.color.brand} />
                </View>
                <View style={ds.queueText}>
                  <Text style={ds.queueTitle}>{uiText("Tra cứu người dùng")}</Text>
                  <Text style={ds.queueDesc}>
                    {uiText("Tìm kiếm, xem chi tiết và quản lý trạng thái tài khoản")}
                  </Text>
                </View>
              </View>
              <Icon name="chevronRight" size={18} color={tokens.color.muted} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={uiText("Xác minh giảng viên")}
              style={ds.queueCard}
              onPress={() => router.push("/admin/lecturers" as Href)}
            >
              <View style={ds.queueHeader}>
                <View style={ds.queueIconWrap}>
                  <Icon name="academic" size={20} color={tokens.color.brand} />
                </View>
                <View style={ds.queueText}>
                  <Text style={ds.queueTitle}>{uiText("Xác minh giảng viên")}</Text>
                  <Text style={ds.queueDesc}>{uiText("Thẩm định hồ sơ và xác minh quyền giảng dạy")}</Text>
                </View>
              </View>
              <Icon name="chevronRight" size={18} color={tokens.color.muted} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={uiText("Trung tâm kiểm duyệt")}
              style={ds.queueCard}
              onPress={() => router.push("/admin/moderation" as Href)}
            >
              <View style={ds.queueHeader}>
                <View style={ds.queueIconWrap}>
                  <Icon name="shield" size={20} color={tokens.color.brand} />
                </View>
                <View style={ds.queueText}>
                  <Text style={ds.queueTitle}>{uiText("Trung tâm kiểm duyệt")}</Text>
                  <Text style={ds.queueDesc}>{uiText("Xử lý báo cáo bình luận và đánh giá vi phạm")}</Text>
                </View>
              </View>
              <Icon name="chevronRight" size={18} color={tokens.color.muted} />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={uiText("Giám sát thương mại")}
              style={ds.queueCard}
              onPress={() => router.push("/admin/commerce" as Href)}
            >
              <View style={ds.queueHeader}>
                <View style={ds.queueIconWrap}>
                  <Icon name="card" size={20} color={tokens.color.brand} />
                </View>
                <View style={ds.queueText}>
                  <Text style={ds.queueTitle}>{uiText("Giám sát thương mại")}</Text>
                  <Text style={ds.queueDesc}>
                    {uiText("Tra cứu đơn hàng, phân tách trạng thái thanh toán và quyền học")}
                  </Text>
                </View>
              </View>
              <Icon name="chevronRight" size={18} color={tokens.color.muted} />
            </Pressable>
          </View>

          {/* System Operations & Governance Info */}
          <View style={ds.governanceSection}>
            <Text style={[styles.text, { fontWeight: "700" }]}>{uiText("Chính sách vận hành")}</Text>
            <View style={ds.infoBox}>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: tokens.space.xs }}
              >
                <Icon name="scale" size={16} color={tokens.color.brand} />
                <Text style={ds.infoTitle}>{uiText("Phân quyền máy chủ chuẩn hóa")}</Text>
              </View>
              <Text style={ds.infoText}>
                {uiText(
                  "Trạng thái quyền hạn và kiểm duyệt được xác thực tuyệt đối tại máy chủ. Thao tác tác động cao yêu cầu xác thực lại mật khẩu hiện tại.",
                )}
              </Text>
            </View>
          </View>
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

const ds = StyleSheet.create({
  kpiGrid: {
    flexDirection: "row",
    gap: tokens.space.small,
    marginTop: tokens.space.medium,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: tokens.color.surface,
    padding: tokens.space.medium,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tokens.color.border,
    alignItems: "center",
  },
  kpiIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: tokens.color.brandLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  kpiValue: {
    fontSize: 24,
    fontWeight: "700",
    color: tokens.color.brand,
  },
  kpiLabel: {
    fontSize: 12,
    color: tokens.color.muted,
    textAlign: "center",
    marginTop: 2,
  },
  actionStack: {
    gap: tokens.space.small,
    marginTop: tokens.space.small,
  },
  queueCard: {
    backgroundColor: tokens.color.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tokens.color.border,
    padding: tokens.space.medium,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 64,
  },
  queueHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.small,
    flex: 1,
  },
  queueIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: tokens.color.brandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  queueText: {
    flex: 1,
  },
  queueTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: tokens.color.ink,
  },
  queueDesc: {
    fontSize: 13,
    color: tokens.color.muted,
    marginTop: 2,
  },
  arrow: {
    fontSize: 18,
    color: tokens.color.muted,
    fontWeight: "700",
    marginLeft: tokens.space.small,
  },
  governanceSection: {
    marginTop: tokens.space.large,
    marginBottom: tokens.space.large,
  },
  infoBox: {
    backgroundColor: tokens.color.surface,
    padding: tokens.space.medium,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginTop: tokens.space.small,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.color.ink,
    marginBottom: 4,
  },
  infoText: {
    fontSize: 13,
    color: tokens.color.muted,
    lineHeight: 18,
  },
});
