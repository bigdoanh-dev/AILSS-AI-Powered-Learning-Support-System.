import { useUiText } from "../../src/use-language";
import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import { Text, View, StyleSheet, ScrollView, RefreshControl } from "react-native";
import { router, type Href } from "expo-router";
import { ApiError } from "../../src/api";
import { runtime } from "../../src/runtime";
import {
  ownedClasses,
  lecturerCourses,
  ownedOfferings,
  type LecturerCourse,
  type OwnedClass,
  type OwnedOffering,
} from "../../src/teaching";
import { Page, Button, Icon, Badge, ScreenHeader, BottomNavBar, styles, tokens } from "../../src/ui";
import { ScalePressable } from "../../src/motion";

export default function TeachingDashboard() {
  const uiText = useUiText();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [items, setItems] = useState<OwnedOffering[] | null>(null);
  const [courses, setCourses] = useState<LecturerCourse[] | null>(null);
  const [classes, setClasses] = useState<OwnedClass[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [retry, setRetry] = useState(0);

  const loadData = useCallback(
    async (signal?: AbortSignal) => {
      if (snapshot.user?.role !== "LECTURER") return;
      setError("");
      try {
        const [offeringsResult, coursesResult, classesResult] = await Promise.allSettled([
          session.request("/api/v1/me/owned-offerings", { signal }),
          session.request("/api/v1/me/owned-courses", { signal }),
          session.request("/api/v1/me/owned-classes", { signal }),
        ]);
        if (!signal?.aborted) {
          setItems(offeringsResult.status === "fulfilled" ? ownedOfferings(offeringsResult.value) : null);
          setCourses(coursesResult.status === "fulfilled" ? lecturerCourses(coursesResult.value) : null);
          setClasses(classesResult.status === "fulfilled" ? ownedClasses(classesResult.value) : null);
          if (
            offeringsResult.status === "rejected" ||
            coursesResult.status === "rejected" ||
            classesResult.status === "rejected"
          ) {
            setError("Một số dữ liệu giảng dạy chưa tải được. Kéo xuống để thử lại.");
          }
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
    [session, snapshot.user?.role, snapshot.user?.userId],
  );

  useEffect(() => {
    if (snapshot.user?.role !== "LECTURER") {
      return;
    }
    setItems(null);
    setCourses(null);
    setClasses(null);
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
        <ScreenHeader title={uiText("Giảng dạy")} onBack={() => router.replace("/")} />
        <Text style={styles.error}>{uiText("Chức năng này chỉ dành cho Giảng viên.")}</Text>
        <Button
          label={uiText("Đăng nhập bằng tài khoản Giảng viên")}
          onPress={() => router.push("/login?role=lecturer" as Href)}
        />
        <Button label={uiText("Về trang chủ")} onPress={() => router.replace("/")} />
      </Page>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <Page scroll={false}>
        <ScreenHeader
          title={uiText("Tổng quan giảng dạy")}
          subtitle={uiText("{0} · Giảng viên AILSS", [snapshot.user.displayName])}
          rightElement={
            <ScalePressable
              onPress={() => router.push("/teaching/courses/create" as Href)}
              style={ds.addBtnHeader}
              accessibilityRole="button"
              accessibilityLabel={uiText("Tạo khóa học")}
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
          <View style={ds.hero}>
            <Text style={ds.heroEyebrow}>{uiText("GIẢNG VIÊN · TỔNG QUAN HOẠT ĐỘNG")}</Text>
            <Text style={ds.heroTitle}>{uiText("Điều hành lớp học của bạn")}</Text>
            <Text style={ds.heroDescription}>
              {uiText("Quản lý khóa học, lớp phụ trách, lịch dạy và công việc giảng dạy tại một nơi.")}
            </Text>
            <ScalePressable
              style={ds.heroAction}
              onPress={() => router.push("/teaching/courses" as Href)}
              accessibilityRole="button"
              accessibilityLabel={uiText("Quản lý khóa học")}
            >
              <Text style={ds.heroActionText}>{uiText("Quản lý khóa học")}</Text>
              <Icon name="chevronRight" size={16} color="#063B4A" />
            </ScalePressable>
          </View>

          <View style={ds.kpiGrid}>
            <ScalePressable
              style={ds.kpiCard}
              onPress={() => router.push("/teaching/courses" as Href)}
              accessibilityRole="button"
              accessibilityLabel={uiText("Xem khóa học")}
            >
              <Icon name="book" size={20} color={tokens.color.brand} />
              <Text style={ds.kpiNumber}>{courses?.length ?? "—"}</Text>
              <Text style={ds.kpiTitle}>{uiText("Khóa học")}</Text>
            </ScalePressable>
            <ScalePressable
              style={ds.kpiCard}
              onPress={() => router.push("/teaching/classes" as Href)}
              accessibilityRole="button"
              accessibilityLabel={uiText("Xem lớp phụ trách")}
            >
              <Icon name="class" size={20} color="#0891B2" />
              <Text style={ds.kpiNumber}>{classes?.length ?? "—"}</Text>
              <Text style={ds.kpiTitle}>{uiText("Lớp phụ trách")}</Text>
            </ScalePressable>
            <ScalePressable
              style={ds.kpiCard}
              onPress={() => router.push("/teaching/courses" as Href)}
              accessibilityRole="button"
              accessibilityLabel={uiText("Xem gói giảng dạy")}
            >
              <Icon name="award" size={20} color="#7C3AED" />
              <Text style={ds.kpiNumber}>{items?.length ?? "—"}</Text>
              <Text style={ds.kpiTitle}>{uiText("Gói giảng dạy")}</Text>
            </ScalePressable>
            <ScalePressable
              style={ds.kpiCard}
              onPress={() => router.push("/teaching/schedule" as Href)}
              accessibilityRole="button"
              accessibilityLabel={uiText("Xem lịch dạy")}
            >
              <Icon name="calendar" size={20} color="#15803D" />
              <Text style={ds.kpiNumber}>→</Text>
              <Text style={ds.kpiTitle}>{uiText("Lịch dạy")}</Text>
            </ScalePressable>
          </View>
          <Text style={ds.sectionHeader}>{uiText("Thao tác giảng dạy nhanh")}</Text>
          <Button label={uiText("Đợt mở bán")} onPress={() => router.push("/teaching/offerings" as Href)} />
          <View style={ds.actionGrid}>
            <ScalePressable
              style={ds.actionItem}
              scaleTo={0.94}
              onPress={() => router.push("/teaching/courses/create" as Href)}
              accessibilityRole="button"
              accessibilityLabel={uiText("Tạo khóa học mới")}
            >
              <View style={[ds.actionIcon, { backgroundColor: "#E0F2FE" }]}>
                <Icon name="add" size={22} color="#0284C7" />
              </View>
              <Text style={ds.actionText}>{uiText("Tạo khóa học")}</Text>
            </ScalePressable>

            <ScalePressable
              style={ds.actionItem}
              scaleTo={0.94}
              onPress={() => router.push("/teaching/classes" as Href)}
              accessibilityRole="button"
              accessibilityLabel={uiText("Lớp phụ trách")}
            >
              <View style={[ds.actionIcon, { backgroundColor: "#CFFAFE" }]}>
                <Icon name="class" size={22} color="#0891B2" />
              </View>
              <Text style={ds.actionText}>{uiText("Lớp phụ trách")}</Text>
            </ScalePressable>

            <ScalePressable
              style={ds.actionItem}
              scaleTo={0.94}
              onPress={() => router.push("/teaching/schedule" as Href)}
              accessibilityRole="button"
              accessibilityLabel={uiText("Lịch giảng dạy")}
            >
              <View style={[ds.actionIcon, { backgroundColor: "#DCFCE7" }]}>
                <Icon name="calendar" size={22} color="#15803D" />
              </View>
              <Text style={ds.actionText}>{uiText("Lịch dạy")}</Text>
            </ScalePressable>

            <ScalePressable
              style={ds.actionItem}
              scaleTo={0.94}
              onPress={() => router.push("/teaching/assessments" as Href)}
              accessibilityRole="button"
              accessibilityLabel={uiText("Quản lý bài kiểm tra")}
            >
              <View style={[ds.actionIcon, { backgroundColor: "#D1FAE5" }]}>
                <Icon name="award" size={22} color="#059669" />
              </View>
              <Text style={ds.actionText}>{uiText("Đề & Bài thi")}</Text>
            </ScalePressable>

            <ScalePressable
              style={ds.actionItem}
              scaleTo={0.94}
              onPress={() => router.push("/teaching/ai" as Href)}
              accessibilityRole="button"
              accessibilityLabel={uiText("AI soạn đề kiểm tra")}
            >
              <View style={[ds.actionIcon, { backgroundColor: "#FEF3C7" }]}>
                <Icon name="sparkles" size={22} color="#D97706" />
              </View>
              <Text style={ds.actionText}>{uiText("AI soạn đề")}</Text>
            </ScalePressable>

            <ScalePressable
              style={ds.actionItem}
              scaleTo={0.94}
              onPress={() => router.push("/teaching/copilot" as Href)}
              accessibilityRole="button"
              accessibilityLabel={uiText("Trợ lý AI giảng viên")}
            >
              <View style={[ds.actionIcon, { backgroundColor: "#EDE9FE" }]}>
                <Icon name="sparkles" size={22} color="#7C3AED" />
              </View>
              <Text style={ds.actionText}>{uiText("AI giảng viên")}</Text>
            </ScalePressable>

            <ScalePressable
              style={ds.actionItem}
              scaleTo={0.94}
              onPress={() => router.push("/teaching/revenue" as Href)}
              accessibilityRole="button"
              accessibilityLabel={uiText("Doanh thu và tài khoản nhận tiền")}
            >
              <View style={[ds.actionIcon, { backgroundColor: "#DCFCE7" }]}>
                <Icon name="trending" size={22} color="#15803D" />
              </View>
              <Text style={ds.actionText}>Doanh thu</Text>
            </ScalePressable>
            <ScalePressable
              style={ds.actionItem}
              scaleTo={0.94}
              onPress={() => router.push("/teaching/reports" as Href)}
              accessibilityRole="button"
              accessibilityLabel={uiText("Báo cáo kết quả giảng dạy")}
            >
              <View style={[ds.actionIcon, { backgroundColor: "#DBEAFE" }]}>
                <Icon name="trending" size={22} color="#1D4ED8" />
              </View>
              <Text style={ds.actionText}>{uiText("Báo cáo")}</Text>
            </ScalePressable>
            <ScalePressable
              style={ds.actionItem}
              scaleTo={0.94}
              onPress={() => router.push("/teaching/profile" as Href)}
              accessibilityRole="button"
              accessibilityLabel={uiText("Hồ sơ giảng viên công khai")}
            >
              <View style={[ds.actionIcon, { backgroundColor: "#E0F2FE" }]}>
                <Icon name="people" size={22} color="#0284C7" />
              </View>
              <Text style={ds.actionText}>{uiText("Hồ sơ")}</Text>
            </ScalePressable>
          </View>

          <View style={ds.listHeaderRow}>
            <Text style={ds.sectionHeader}>
              {uiText("Lớp phụ trách (")}
              {classes?.length ?? "—"})
            </Text>
            <ScalePressable
              scaleTo={0.92}
              onPress={() => router.push("/teaching/classes" as Href)}
              accessibilityRole="button"
              accessibilityLabel={uiText("Xem tất cả lớp phụ trách")}
            >
              <Text style={ds.viewAllText}>{uiText("Xem tất cả →")}</Text>
            </ScalePressable>
          </View>
          {classes && classes.length === 0 && (
            <View style={ds.emptyBox}>
              <Text style={styles.text}>{uiText("Bạn chưa phụ trách lớp học nào.")}</Text>
            </View>
          )}
          {classes?.slice(0, 3).map((item) => (
            <ScalePressable
              key={item.classId}
              style={ds.card}
              onPress={() => router.push("/teaching/classes" as Href)}
              accessibilityRole="button"
              accessibilityLabel={uiText("Xem lớp {0}", [item.name])}
            >
              <View style={ds.classCardRow}>
                <View style={ds.classIcon}>
                  <Icon name="class" size={20} color={tokens.color.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={ds.cardTitle} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <Text style={ds.meta}>
                    {item.scheduleState === "PUBLISHED"
                      ? uiText("Đã có lịch dạy")
                      : uiText("Chưa công bố lịch dạy")}
                  </Text>
                </View>
                <Icon name="chevronRight" size={17} color={tokens.color.muted} />
              </View>
            </ScalePressable>
          ))}

          {/* Offerings and Courses List */}
          <View style={ds.listHeaderRow}>
            <Text style={ds.sectionHeader}>
              {uiText("Danh sách gói giảng dạy (")}
              {items?.length ?? "—"})
            </Text>
            <ScalePressable
              scaleTo={0.92}
              onPress={() => router.push("/teaching/courses" as Href)}
              accessibilityRole="button"
              accessibilityLabel={uiText("Xem tất cả khóa học")}
            >
              <Text style={ds.viewAllText}>{uiText("Khóa học →")}</Text>
            </ScalePressable>
          </View>

          {error ? (
            <View style={styles.card}>
              <Text style={styles.error}>{uiText(error)}</Text>
              <Button label={uiText("Thử lại")} onPress={() => setRetry((v) => v + 1)} />
            </View>
          ) : null}

          {items === null && courses === null && classes === null && !error && (
            <Text accessibilityRole="alert" style={styles.text}>
              {uiText("Đang tải dữ liệu giảng dạy…")}
            </Text>
          )}

          {items && items.length === 0 && (
            <View style={ds.emptyBox}>
              <Icon name="book" size={36} color={tokens.color.muted} />
              <Text style={styles.text}>{uiText("Bạn chưa có gói giảng dạy nào.")}</Text>
              <Text style={styles.small}>
                {uiText("Hãy tạo khóa học đầu tiên để bắt đầu thu hút học viên.")}
              </Text>
              <Button
                label={uiText("Tạo khóa học đầu tiên")}
                onPress={() => router.push("/teaching/courses/create" as Href)}
              />
            </View>
          )}

          {items && items.length > 0 && (
            <View style={{ gap: 10 }}>
              {items.slice(0, 3).map((item) => (
                <ScalePressable
                  key={item.offeringId}
                  style={ds.card}
                  scaleTo={0.97}
                  onPress={() => router.push(`/teaching/offerings/${item.offeringId}` as Href)}
                  accessibilityRole="button"
                  accessibilityLabel={uiText("Xem gói giảng dạy {0}", [item.title ?? item.offeringId])}
                >
                  <View style={ds.cardTop}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={ds.cardTitle} numberOfLines={2}>
                        {item.title ?? `Khóa ${item.offeringId.slice(0, 8)}`}
                      </Text>
                      <Text style={ds.meta}>
                        {uiText("Loại: ")}
                        <Text style={{ fontWeight: "600" }}>{item.offeringType}</Text> {uiText(" · Giá:")}{" "}
                        <Text style={{ fontWeight: "700", color: tokens.color.brand }}>
                          {item.price ? `${item.price} ${item.currency ?? ""}`.trim() : uiText("Miễn phí")}
                        </Text>
                      </Text>
                    </View>
                    <Badge
                      label={item.state === "PUBLISHED" ? uiText("ĐÃ XUẤT BẢN") : uiText("BẢN NHÁP")}
                      variant={item.state === "PUBLISHED" ? "success" : "neutral"}
                    />
                  </View>

                  <View style={ds.cardFooter}>
                    <Text style={ds.footerLink}>{uiText("Chi tiết gói giảng dạy →")}</Text>
                  </View>
                </ScalePressable>
              ))}
            </View>
          )}
        </ScrollView>
      </Page>

      <BottomNavBar
        currentRoute="home"
        role={snapshot.user?.role}
        onNavigate={(path) => router.push(path as Href)}
      />
    </View>
  );
}

const ds = StyleSheet.create({
  hero: {
    backgroundColor: "#073B4C",
    borderRadius: 22,
    padding: 22,
    gap: 10,
  },
  heroEyebrow: { color: "#89E7DA", fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  heroTitle: { color: "#FFFFFF", fontSize: 24, lineHeight: 30, fontWeight: "800" },
  heroDescription: { color: "#D3E6E9", fontSize: 13, lineHeight: 19 },
  heroAction: {
    backgroundColor: "#C8F7E8",
    borderRadius: 11,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 4,
  },
  heroActionText: { color: "#063B4A", fontSize: 13, fontWeight: "800" },
  classCardRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  classIcon: {
    width: 40,
    height: 40,
    borderRadius: 11,
    backgroundColor: "#E0F2FE",
    alignItems: "center",
    justifyContent: "center",
  },
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
    alignItems: "flex-start",
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
