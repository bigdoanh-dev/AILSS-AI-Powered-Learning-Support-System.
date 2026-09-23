import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import { Text, View, StyleSheet, ScrollView, RefreshControl } from "react-native";
import { router, type Href } from "expo-router";
import { ApiError } from "../../src/api";
import { runtime } from "../../src/runtime";
import { ownedOfferings, uniqueCoursesFromOfferings, type OwnedOffering } from "../../src/teaching";
import { Page, Button, Icon, Badge, ScreenHeader, BottomNavBar, styles, tokens } from "../../src/ui";
import { ScalePressable } from "../../src/motion";

export default function TeachingDashboard() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [items, setItems] = useState<OwnedOffering[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [retry, setRetry] = useState(0);

  const loadData = useCallback(
    async (signal?: AbortSignal) => {
      if (snapshot.user?.role !== "LECTURER") return;
      setError("");
      try {
        const value = await session.request("/api/v1/me/owned-offerings", { signal });
        if (!signal?.aborted) {
          setItems(ownedOfferings(value));
        }
      } catch (e: unknown) {
        if (!signal?.aborted) {
          setError(
            e instanceof ApiError
              ? `${e.message}${e.requestId ? ` Mã yêu cầu: ${e.requestId}` : ""}`
              : "Không thể tải dữ liệu giảng dạy.",
          );
        }
      } finally {
        if (!signal?.aborted) {
          setRefreshing(false);
        }
      }
    },
    [session, snapshot.user?.role]
  );

  useEffect(() => {
    if (snapshot.user?.role !== "LECTURER") {
      return;
    }
    const abort = new AbortController();
    void loadData(abort.signal);
    return () => abort.abort();
  }, [loadData, retry, snapshot.user?.role]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadData();
  }, [loadData]);

  if (snapshot.user?.role !== "LECTURER") {
    return (
      <Page>
        <ScreenHeader title="Giảng dạy" onBack={() => router.replace("/")} />
        <Text style={styles.error}>Chức năng này chỉ dành cho Giảng viên.</Text>
        <Button label="Đăng nhập bằng tài khoản Giảng viên" onPress={() => router.push("/login?role=lecturer" as Href)} />
        <Button label="Về trang chủ" onPress={() => router.replace("/")} />
      </Page>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <Page>
        <ScreenHeader
          title="Bàn làm việc Giảng dạy"
          subtitle={`${snapshot.user.displayName} · Giảng viên AILSS`}
          onBack={() => router.replace("/")}
          rightElement={
            <ScalePressable
              onPress={() => router.push("/teaching/courses/create" as Href)}
              style={ds.addBtnHeader}
              accessibilityRole="button"
              accessibilityLabel="Tạo khóa học"
            >
              <Icon name="add" size={18} color="#FFFFFF" />
            </ScalePressable>
          }
        />

        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{ gap: 14, paddingBottom: 90 }}
        >
          {/* Balanced 2x2 KPI Grid */}
          <View style={ds.kpiGrid}>
            <View style={ds.kpiCard}>
              <View style={[ds.kpiIconWrap, { backgroundColor: "#EDE9FE" }]}>
                <Icon name="people" size={20} color="#7C3AED" />
              </View>
              <Text style={ds.kpiNumber}>186</Text>
              <Text style={ds.kpiTitle}>Học viên (3 lớp)</Text>
            </View>

            <View style={ds.kpiCard}>
              <View style={[ds.kpiIconWrap, { backgroundColor: "#DCFCE7" }]}>
                <Icon name="calendar" size={20} color="#15803D" />
              </View>
              <Text style={[ds.kpiNumber, { color: "#15803D" }]}>96.4%</Text>
              <Text style={ds.kpiTitle}>Chuyên cần</Text>
            </View>

            <View style={ds.kpiCard}>
              <View style={[ds.kpiIconWrap, { backgroundColor: "#FEE2E2" }]}>
                <Icon name="award" size={20} color="#DC2626" />
              </View>
              <Text style={[ds.kpiNumber, { color: "#DC2626" }]}>14</Text>
              <Text style={ds.kpiTitle}>Bài chờ chấm</Text>
            </View>

            <View style={ds.kpiCard}>
              <View style={[ds.kpiIconWrap, { backgroundColor: "#FEF3C7" }]}>
                <Icon name="starFilled" size={20} color="#D97706" />
              </View>
              <Text style={[ds.kpiNumber, { color: "#D97706" }]}>4.9 ★</Text>
              <Text style={ds.kpiTitle}>Đánh giá (142)</Text>
            </View>
          </View>

          {/* Quick Actions 3x2 Grid */}
          <Text style={ds.sectionHeader}>Công cụ quản trị giảng dạy</Text>
          <View style={ds.actionGrid}>
            <ScalePressable
              style={ds.actionItem}
              scaleTo={0.94}
              onPress={() => router.push("/teaching/courses/create" as Href)}
              accessibilityRole="button"
              accessibilityLabel="Tạo khóa học mới"
            >
              <View style={[ds.actionIcon, { backgroundColor: "#E0F2FE" }]}>
                <Icon name="add" size={22} color="#0284C7" />
              </View>
              <Text style={ds.actionText}>Tạo khóa học</Text>
            </ScalePressable>

            <ScalePressable
              style={ds.actionItem}
              scaleTo={0.94}
              onPress={() => router.push("/teaching/classes" as Href)}
              accessibilityRole="button"
              accessibilityLabel="Lớp phụ trách"
            >
              <View style={[ds.actionIcon, { backgroundColor: "#CFFAFE" }]}>
                <Icon name="class" size={22} color="#0891B2" />
              </View>
              <Text style={ds.actionText}>Lớp phụ trách</Text>
            </ScalePressable>

            <ScalePressable
              style={ds.actionItem}
              scaleTo={0.94}
              onPress={() => router.push("/teaching/schedule" as Href)}
              accessibilityRole="button"
              accessibilityLabel="Lịch giảng dạy"
            >
              <View style={[ds.actionIcon, { backgroundColor: "#DCFCE7" }]}>
                <Icon name="calendar" size={22} color="#15803D" />
              </View>
              <Text style={ds.actionText}>Lịch dạy</Text>
            </ScalePressable>

            <ScalePressable
              style={ds.actionItem}
              scaleTo={0.94}
              onPress={() => router.push("/teaching/assessments" as Href)}
              accessibilityRole="button"
              accessibilityLabel="Quản lý bài kiểm tra"
            >
              <View style={[ds.actionIcon, { backgroundColor: "#D1FAE5" }]}>
                <Icon name="award" size={22} color="#059669" />
              </View>
              <Text style={ds.actionText}>Đề & Bài thi</Text>
            </ScalePressable>

            <ScalePressable
              style={ds.actionItem}
              scaleTo={0.94}
              onPress={() => router.push("/teaching/ai" as Href)}
              accessibilityRole="button"
              accessibilityLabel="Trợ lý soạn đề AI"
            >
              <View style={[ds.actionIcon, { backgroundColor: "#FEF3C7" }]}>
                <Icon name="sparkles" size={22} color="#D97706" />
              </View>
              <Text style={ds.actionText}>Trợ lý AI</Text>
            </ScalePressable>

            <ScalePressable
              style={ds.actionItem}
              scaleTo={0.94}
              onPress={() => router.push("/teaching/reports" as Href)}
              accessibilityRole="button"
              accessibilityLabel="Báo cáo & Thống kê giảng dạy"
            >
              <View style={[ds.actionIcon, { backgroundColor: "#F3E8FF" }]}>
                <Icon name="chart" size={22} color="#7C3AED" />
              </View>
              <Text style={ds.actionText}>Báo cáo</Text>
            </ScalePressable>
          </View>

          {/* Pending Grading Queue Widget */}
          <View style={ds.listHeaderRow}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={ds.sectionHeader}>Hàng đợi chấm bài</Text>
              <Badge label="14 bài mới" variant="danger" />
            </View>
            <ScalePressable scaleTo={0.92} onPress={() => router.push("/teaching/assessments" as Href)}>
              <Text style={ds.viewAllText}>Chấm tất cả &gt;</Text>
            </ScalePressable>
          </View>

          <View style={{ gap: 10 }}>
            <View style={ds.card}>
              <View style={ds.cardTop}>
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Badge label="CSDL NÂNG CAO" variant="primary" />
                    <Text style={{ fontSize: 11, color: "#64748B" }}>⏰ Nộp 35 phút trước</Text>
                  </View>
                  <Text style={ds.cardTitle}>Lê Văn Đức (SV-202601)</Text>
                  <Text style={ds.meta}>Bài tập lớn: Thiết kế CSDL quan hệ chuẩn hóa 3NF</Text>
                </View>
              </View>
              <View style={ds.cardFooter}>
                <ScalePressable
                  scaleTo={0.95}
                  style={ds.gradeButton}
                  onPress={() => router.push("/teaching/assessments" as Href)}
                >
                  <Icon name="pencil" size={15} color="#FFFFFF" />
                  <Text style={ds.gradeButtonText}>Chấm bài & Nhận xét</Text>
                </ScalePressable>
              </View>
            </View>

            <View style={ds.card}>
              <View style={ds.cardTop}>
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Badge label="WEB & AI" variant="neutral" />
                    <Text style={{ fontSize: 11, color: "#64748B" }}>⏰ Nộp 2 giờ trước</Text>
                  </View>
                  <Text style={ds.cardTitle}>Nguyễn Mai Phương (SV-202602)</Text>
                  <Text style={ds.meta}>Lab 03: Xây dựng REST API & Tích hợp Vector DB</Text>
                </View>
              </View>
              <View style={ds.cardFooter}>
                <ScalePressable
                  scaleTo={0.95}
                  style={ds.gradeButton}
                  onPress={() => router.push("/teaching/assessments" as Href)}
                >
                  <Icon name="pencil" size={15} color="#FFFFFF" />
                  <Text style={ds.gradeButtonText}>Chấm bài & Nhận xét</Text>
                </ScalePressable>
              </View>
            </View>
          </View>

          {/* At-Risk Warning Widget */}
          <View style={ds.warningBox}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={ds.warningTitle}>⚠️ CẢNH BÁO SINH VIÊN CẦN HỖ TRỢ</Text>
              <Badge label="2 trường hợp" variant="warning" />
            </View>
            <Text style={ds.warningContent}>
              • <Text style={{ fontWeight: "700" }}>Hoàng Gia Huy (SV-202607)</Text>: Vắng 2 buổi liên tiếp môn CSDL.{"\n"}
              • <Text style={{ fontWeight: "700" }}>3 SV chưa nộp bài</Text>: Hạn chót Bài tập lớn CSDL 23:59 đêm nay.
            </Text>
          </View>

          {/* Offerings and Courses List */}
          <View style={ds.listHeaderRow}>
            <Text style={ds.sectionHeader}>Danh sách gói giảng dạy ({items?.length ?? 0})</Text>
            <ScalePressable scaleTo={0.92} onPress={() => router.push("/teaching/courses" as Href)}>
              <Text style={ds.viewAllText}>Xem tất cả &gt;</Text>
            </ScalePressable>
          </View>

          {error ? (
            <View style={styles.card}>
              <Text style={styles.error}>{error}</Text>
              <Button label="Thử lại" onPress={() => setRetry((v) => v + 1)} />
            </View>
          ) : null}

          {items === null && !error && (
            <Text accessibilityRole="alert" style={styles.text}>
              Đang tải dữ liệu giảng dạy…
            </Text>
          )}

          {items && items.length === 0 && (
            <View style={ds.emptyBox}>
              <Icon name="book" size={36} color={tokens.color.muted} />
              <Text style={styles.text}>Bạn chưa có gói giảng dạy nào.</Text>
              <Text style={styles.small}>Hãy tạo khóa học đầu tiên để bắt đầu thu hút học viên.</Text>
              <Button
                label="Tạo khóa học đầu tiên"
                onPress={() => router.push("/teaching/courses/create" as Href)}
              />
            </View>
          )}

          {items && items.length > 0 && (
            <View style={{ gap: 10 }}>
              {items.map((item) => (
                <ScalePressable
                  key={item.offeringId}
                  style={ds.card}
                  scaleTo={0.97}
                  onPress={() => router.push(`/teaching/courses/${item.courseId}` as Href)}
                  accessibilityRole="button"
                  accessibilityLabel={`Khóa học ${item.title ?? item.offeringId}`}
                >
                  <View style={ds.cardTop}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={ds.cardTitle} numberOfLines={2}>
                        {item.title ?? `Khóa ${item.offeringId.slice(0, 8)}`}
                      </Text>
                      <Text style={ds.meta}>
                        Loại: <Text style={{ fontWeight: "600" }}>{item.offeringType}</Text> · Giá:{" "}
                        <Text style={{ fontWeight: "700", color: tokens.color.brand }}>
                          {item.price ? `${item.price} ${item.currency ?? ""}`.trim() : "Miễn phí"}
                        </Text>
                      </Text>
                    </View>
                    <Badge
                      label={item.state === "PUBLISHED" ? "ĐÃ XUẤT BẢN" : "BẢN NHÁP"}
                      variant={item.state === "PUBLISHED" ? "success" : "neutral"}
                    />
                  </View>

                  <View style={ds.cardFooter}>
                    <Text style={ds.footerLink}>Chi tiết khóa học &amp; bài giảng →</Text>
                  </View>
                </ScalePressable>
              ))}
            </View>
          )}
        </ScrollView>
      </Page>

      <BottomNavBar
        currentRoute="teaching"
        role={snapshot.user?.role}
        onNavigate={(path) => router.push(path as Href)}
      />
    </View>
  );
}

const ds = StyleSheet.create({
  addBtnHeader: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: tokens.color.brand,
    alignItems: "center",
    justifyContent: "center",
    ...tokens.shadow.subtle,
  },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 10,
  },
  kpiCard: {
    width: "48%",
    backgroundColor: "#FFFFFF",
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
    gap: 4,
    shadowColor: "#000",
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  kpiIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  kpiNumber: {
    fontSize: 22,
    fontWeight: "800",
    color: "#0F172A",
  },
  kpiTitle: {
    fontSize: 12,
    color: "#64748B",
    fontWeight: "600",
    textAlign: "center",
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
    marginTop: 6,
  },
  actionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 10,
  },
  actionItem: {
    width: "31%",
    backgroundColor: "#FFFFFF",
    paddingVertical: 14,
    paddingHorizontal: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
    gap: 6,
    shadowColor: "#000",
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0F172A",
    textAlign: "center",
  },
  listHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 6,
  },
  viewAllText: {
    fontSize: 13,
    color: tokens.color.brand,
    fontWeight: "600",
  },
  card: {
    padding: 16,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0F172A",
    lineHeight: 20,
  },
  meta: {
    fontSize: 13,
    color: "#64748B",
    marginTop: 2,
  },
  cardFooter: {
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
    paddingTop: 8,
  },
  gradeButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#0284C7",
    paddingVertical: 10,
    borderRadius: 10,
  },
  gradeButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  warningBox: {
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FED7AA",
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  warningTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#9A3412",
  },
  warningContent: {
    fontSize: 12,
    color: "#C2410C",
    lineHeight: 18,
  },
  footerLink: {
    fontSize: 12,
    fontWeight: "700",
    color: tokens.color.brand,
  },
  emptyBox: {
    padding: 32,
    alignItems: "center",
    gap: 10,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
});
