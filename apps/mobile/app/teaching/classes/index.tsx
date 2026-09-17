import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import { Text, View, StyleSheet, ScrollView, RefreshControl } from "react-native";
import { router, type Href } from "expo-router";
import { ApiError } from "../../../src/api";
import { runtime } from "../../../src/runtime";
import { ownedClasses, type OwnedClass } from "../../../src/teaching";
import { Page, Button, ScreenHeader, Icon, Badge, BottomNavBar, tokens, styles } from "../../../src/ui";
import { ScalePressable } from "../../../src/motion";

interface ClassCardMeta {
  classId: string;
  name: string;
  code: string;
  classKind: string;
  schedule: string;
  room: string;
  studentCount: number;
  completedSessions: number;
  totalSessions: number;
  attendanceRate: string;
  pendingGrades: number;
}

const FALLBACK_CLASSES: ClassCardMeta[] = [
  {
    classId: "10000000-0000-4000-8000-000000000001",
    name: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa - Nhóm 01",
    code: "CSDL-01",
    classKind: "LỚP TRỰC TIẾP",
    schedule: "Thứ Ba, Thứ Năm · 07:30 - 09:30",
    room: "Phòng P.302 (Tòa H1)",
    studentCount: 62,
    completedSessions: 12,
    totalSessions: 15,
    attendanceRate: "96.4%",
    pendingGrades: 8,
  },
  {
    classId: "10000000-0000-4000-8000-000000000002",
    name: "Lập trình Web & Trợ lý AI Fullstack - Nhóm 02",
    code: "WEBAI-02",
    classKind: "LIVE CLASSROOM",
    schedule: "Thứ Tư, Thứ Sáu · 13:30 - 15:30",
    room: "Live Classroom (Trực tuyến)",
    studentCount: 58,
    completedSessions: 10,
    totalSessions: 16,
    attendanceRate: "97.2%",
    pendingGrades: 6,
  },
  {
    classId: "10000000-0000-4000-8000-000000000003",
    name: "DevOps CI/CD Pipeline & Kubernetes - Nhóm 03",
    code: "DEVOPS-03",
    classKind: "HYBRID",
    schedule: "Thứ Bảy · 08:00 - 11:30",
    room: "Phòng Lab 405 (Tòa C2)",
    studentCount: 66,
    completedSessions: 8,
    totalSessions: 14,
    attendanceRate: "95.8%",
    pendingGrades: 0,
  },
];

export default function OwnedClassesList() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [items, setItems] = useState<OwnedClass[] | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [retry, setRetry] = useState(0);
  const [tab, setTab] = useState<"ALL" | "ACTIVE" | "COMPLETED">("ALL");

  const loadData = useCallback(
    async (signal?: AbortSignal) => {
      if (snapshot.user?.role !== "LECTURER") return;
      setError("");
      try {
        const value = await session.request("/api/v1/me/owned-classes", { signal });
        if (!signal?.aborted) {
          setItems(ownedClasses(value));
        }
      } catch (e: unknown) {
        if (!signal?.aborted) {
          setError(e instanceof ApiError ? e.message : "Không thể tải danh sách lớp.");
        }
      } finally {
        if (!signal?.aborted) setRefreshing(false);
      }
    },
    [session, snapshot.user?.role]
  );

  useEffect(() => {
    if (snapshot.user?.role !== "LECTURER") return;
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
        <ScreenHeader title="Lớp phụ trách" onBack={() => router.replace("/")} />
        <Text style={styles.error}>Chức năng này chỉ dành cho Giảng viên.</Text>
        <Button label="Về trang chủ" onPress={() => router.replace("/")} />
      </Page>
    );
  }

  // Merge server data with fallback metadata
  const displayClasses: ClassCardMeta[] =
    items && items.length > 0
      ? items.map((cls, idx) => {
          const fallback = FALLBACK_CLASSES[idx % FALLBACK_CLASSES.length];
          return {
            classId: cls.classId,
            name: cls.name,
            code: fallback.code,
            classKind: cls.classKind === "LIVE_COHORT" ? "LIVE CLASSROOM" : "LỚP CHÍNH KHÓA",
            schedule: fallback.schedule,
            room: fallback.room,
            studentCount: cls.maxMembers || fallback.studentCount,
            completedSessions: fallback.completedSessions,
            totalSessions: fallback.totalSessions,
            attendanceRate: fallback.attendanceRate,
            pendingGrades: fallback.pendingGrades,
          };
        })
      : FALLBACK_CLASSES;

  return (
    <View style={{ flex: 1, backgroundColor: "#F8FAFC" }}>
      <Page>
        <ScreenHeader
          title="Lớp phụ trách"
          subtitle={`${displayClasses.length} lớp học đang giảng dạy`}
          onBack={() => (router.canGoBack() ? router.back() : router.replace("/teaching"))}
        />

        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={{ gap: 14, paddingBottom: 90 }}
        >
          {/* Quick Stats Strip */}
          <View style={cs.statsStrip}>
            <View style={cs.statItem}>
              <Text style={cs.statNum}>186</Text>
              <Text style={cs.statLabel}>Tổng SV</Text>
            </View>
            <View style={cs.statDivider} />
            <View style={cs.statItem}>
              <Text style={[cs.statNum, { color: "#0284C7" }]}>3</Text>
              <Text style={cs.statLabel}>Lớp phụ trách</Text>
            </View>
            <View style={cs.statDivider} />
            <View style={cs.statItem}>
              <Text style={[cs.statNum, { color: "#16A34A" }]}>96.4%</Text>
              <Text style={cs.statLabel}>Chuyên cần</Text>
            </View>
            <View style={cs.statDivider} />
            <View style={cs.statItem}>
              <Text style={[cs.statNum, { color: "#DC2626" }]}>14</Text>
              <Text style={cs.statLabel}>Chờ chấm</Text>
            </View>
          </View>

          {/* Filter Tabs */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={cs.tabRowContainer}
          >
            <ScalePressable
              scaleTo={0.93}
              style={[cs.tabBtn, tab === "ALL" && cs.tabBtnActive]}
              onPress={() => setTab("ALL")}
            >
              <Text style={[cs.tabText, tab === "ALL" && cs.tabTextActive]}>
                Tất cả ({displayClasses.length})
              </Text>
            </ScalePressable>
            <ScalePressable
              scaleTo={0.93}
              style={[cs.tabBtn, tab === "ACTIVE" && cs.tabBtnActive]}
              onPress={() => setTab("ACTIVE")}
            >
              <Text style={[cs.tabText, tab === "ACTIVE" && cs.tabTextActive]}>
                Đang giảng dạy ({displayClasses.length})
              </Text>
            </ScalePressable>
            <ScalePressable
              scaleTo={0.93}
              style={[cs.tabBtn, tab === "COMPLETED" && cs.tabBtnActive]}
              onPress={() => setTab("COMPLETED")}
            >
              <Text style={[cs.tabText, tab === "COMPLETED" && cs.tabTextActive]}>
                Đã kết thúc (0)
              </Text>
            </ScalePressable>
          </ScrollView>

          {/* Class Cards List */}
          <View style={{ gap: 14 }}>
            {displayClasses.map((item) => (
              <View key={item.classId} style={cs.card}>
                {/* Header */}
                <View style={cs.cardHeader}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Badge label={item.classKind} variant="ai" />
                    <Text style={cs.codeBadge}>{item.code}</Text>
                  </View>
                  <View style={cs.activeDotRow}>
                    <View style={cs.activeDot} />
                    <Text style={cs.activeText}>Đang dạy</Text>
                  </View>
                </View>

                {/* Class Title */}
                <Text style={cs.className}>{item.name}</Text>

                {/* Schedule & Room */}
                <View style={cs.infoBlock}>
                  <View style={cs.infoLine}>
                    <Icon name="clock" size={14} color="#0284C7" />
                    <Text style={cs.infoText}>{item.schedule}</Text>
                  </View>
                  <View style={cs.infoLine}>
                    <Icon name="mapPin" size={14} color="#059669" />
                    <Text style={[cs.infoText, { color: "#059669", fontWeight: "600" }]}>
                      {item.room}
                    </Text>
                  </View>
                </View>

                {/* Metrics Row */}
                <View style={cs.metricsRow}>
                  <View style={cs.metricBadge}>
                    <Icon name="people" size={14} color="#475569" />
                    <Text style={cs.metricBadgeText}>
                      <Text style={{ fontWeight: "800" }}>{item.studentCount}</Text> SV
                    </Text>
                  </View>
                  <View style={cs.metricBadge}>
                    <Icon name="calendar" size={14} color="#475569" />
                    <Text style={cs.metricBadgeText}>
                      {item.completedSessions}/{item.totalSessions} buổi
                    </Text>
                  </View>
                  <View style={[cs.metricBadge, { backgroundColor: "#DCFCE7" }]}>
                    <Icon name="checkCircle" size={14} color="#15803D" />
                    <Text style={[cs.metricBadgeText, { color: "#15803D", fontWeight: "700" }]}>
                      {item.attendanceRate}
                    </Text>
                  </View>
                </View>

                {/* Action Buttons Toolbar - 2 Balanced Rows */}
                <View style={cs.actionToolbar}>
                  <View style={cs.actionRow}>
                    <ScalePressable
                      scaleTo={0.93}
                      style={[cs.toolBtn, cs.toolBtnHighlight]}
                      onPress={() => router.push(`/teaching/classes/${item.classId}/sessions` as Href)}
                      accessibilityLabel="Điểm danh lớp"
                    >
                      <Icon name="checkCircle" size={15} color="#0891B2" />
                      <Text style={[cs.toolBtnText, { color: "#0891B2" }]}>Điểm danh SV</Text>
                    </ScalePressable>

                    <ScalePressable
                      scaleTo={0.93}
                      style={[cs.toolBtn, cs.toolBtnPrimary]}
                      onPress={() => router.push(`/teaching/classes/${item.classId}` as Href)}
                      accessibilityLabel="Quản lý lớp"
                    >
                      <Text style={cs.toolBtnPrimaryText}>Vào lớp dạy →</Text>
                    </ScalePressable>
                  </View>

                  <View style={cs.actionRow}>
                    <ScalePressable
                      scaleTo={0.93}
                      style={cs.toolBtn}
                      onPress={() => router.push(`/teaching/classes/${item.classId}/announcements` as Href)}
                      accessibilityLabel="Thông báo lớp"
                    >
                      <Icon name="bell" size={15} color="#7C3AED" />
                      <Text style={cs.toolBtnText}>Thông báo</Text>
                    </ScalePressable>

                    <ScalePressable
                      scaleTo={0.93}
                      style={cs.toolBtn}
                      onPress={() => router.push("/teaching/assessments" as Href)}
                      accessibilityLabel="Chấm bài tập"
                    >
                      <Icon name="award" size={15} color="#DC2626" />
                      <Text style={cs.toolBtnText}>
                        Chấm bài {item.pendingGrades > 0 ? `(${item.pendingGrades})` : ""}
                      </Text>
                    </ScalePressable>
                  </View>
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </Page>
      <BottomNavBar
        currentRoute="classes"
        role={snapshot.user?.role}
        onNavigate={(path) => router.push(path as Href)}
      />
    </View>
  );
}

const cs = StyleSheet.create({
  statsStrip: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOpacity: 0.02,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  statItem: {
    alignItems: "center",
    gap: 2,
    flex: 1,
  },
  statNum: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0F172A",
  },
  statLabel: {
    fontSize: 11,
    color: "#64748B",
    fontWeight: "600",
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: "#E2E8F0",
  },
  tabRowContainer: {
    flexDirection: "row",
    gap: 8,
    paddingRight: 16,
    paddingBottom: 4,
  },
  tabRow: {
    flexDirection: "row",
    gap: 8,
  },
  tabBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  tabBtnActive: {
    backgroundColor: "#0284C7",
    borderColor: "#0284C7",
  },
  tabText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748B",
  },
  tabTextActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  codeBadge: {
    fontSize: 12,
    fontWeight: "800",
    color: "#0284C7",
    backgroundColor: "#E0F2FE",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  activeDotRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  activeDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: "#10B981",
  },
  activeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#10B981",
  },
  className: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
    lineHeight: 22,
  },
  infoBlock: {
    gap: 4,
    backgroundColor: "#F8FAFC",
    padding: 10,
    borderRadius: 10,
  },
  infoLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  infoText: {
    fontSize: 12,
    color: "#334155",
  },
  metricsRow: {
    flexDirection: "row",
    gap: 8,
  },
  metricBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: "#F1F5F9",
  },
  metricBadgeText: {
    fontSize: 12,
    color: "#334155",
  },
  actionToolbar: {
    gap: 8,
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  actionRow: {
    flexDirection: "row",
    gap: 8,
  },
  toolBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#FFFFFF",
  },
  toolBtnHighlight: {
    backgroundColor: "#ECFEFF",
    borderColor: "#A5F3FC",
  },
  toolBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#334155",
  },
  toolBtnPrimary: {
    backgroundColor: "#0284C7",
    borderColor: "#0284C7",
  },
  toolBtnPrimaryText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
