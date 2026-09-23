import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { runtime } from "../../../src/runtime";
import {
  classDetail,
  classSessions,
  sortChronological,
  nextUpcomingSession,
  formatDate,
  formatTimeRange,
  parseTimestamp,
  getDateRangeForSchedule,
  type StudentClass,
  type ClassSession,
} from "../../../src/classroom";
import { ApiError } from "../../../src/api";
import { Button, Icon, Page, ScreenHeader, styles, tokens } from "../../../src/ui";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sessionStatusLabel(status: string): string {
  switch (status) {
    case "SCHEDULED": return "Đã lên lịch";
    case "COMPLETED": return "Đã kết thúc";
    case "CANCELLED": return "Đã hủy";
    case "DRAFT": return "Bản nháp";
    default: return status;
  }
}

export default function ClassDetails() {
  const { classId } = useLocalSearchParams<{ classId: string }>();
  const session = runtime!;
  const auth = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [classInfo, setClassInfo] = useState<StudentClass | null>(null);
  const [sessions, setSessions] = useState<ClassSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedScope, setLoadedScope] = useState("");

  const validId = typeof classId === "string" && UUID_REGEX.test(classId);
  const requestScope = `${auth.user?.userId ?? ""}:${typeof classId === "string" ? classId : ""}`;
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!validId || auth.state !== "AUTHENTICATED" || auth.user?.role !== "STUDENT") return;
    setError(null);
    try {
      const detail = await session.request(`/api/v1/classes/${classId}`, { signal });
      const parsed = classDetail(detail);
      const range = getDateRangeForSchedule(new Date(), 30);
      const schedule = await session.request(
        `/api/v1/classes/${classId}/sessions?from=${range.from}&to=${range.to}`,
        { signal },
      );
      if (!signal?.aborted) {
        setClassInfo(parsed);
        setSessions(sortChronological(classSessions(schedule)));
        setLoadedScope(requestScope);
      }
    } catch (cause) {
      if (signal?.aborted) return;
      if (cause instanceof ApiError && cause.status === 403) {
        setError("Bạn chưa được cấp quyền xem lớp học này.");
      } else if (cause instanceof ApiError && cause.status === 404) {
        setError("Không tìm thấy lớp học hoặc lịch học.");
      } else {
        setError(cause instanceof Error ? cause.message : "Không tải được dữ liệu lớp học.");
      }
      setLoadedScope(requestScope);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [auth.state, auth.user?.role, classId, requestScope, session, validId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (auth.state !== "AUTHENTICATED") return <Redirect href="/login" />;
  if (auth.user?.role !== "STUDENT") return <Redirect href="/" />;
  if (!validId) {
    return (
      <Page>
        <Text style={styles.title}>Đường dẫn lớp không hợp lệ</Text>
        <Button label="Quay lại lớp học" onPress={() => router.replace("/classes")} />
      </Page>
    );
  }

  const nextSession = nextUpcomingSession(sessions.filter((item) => item.status === "SCHEDULED"));

  return (
    <Page style={screen.page}>
      <ScreenHeader title="Chi tiết lớp học" onBack={() => router.replace("/classes")} />

      {loading || loadedScope !== requestScope ? (
        <View style={screen.center}>
          <ActivityIndicator color={tokens.color.brand} />
          <Text style={styles.text}>Đang tải thông tin lớp…</Text>
        </View>
      ) : error ? (
        <View style={screen.errorCard}>
          <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
          <Button label="Thử lại" onPress={() => { setLoading(true); void load(); }} />
        </View>
      ) : classInfo ? (
        <>
          <View style={screen.hero}>
            <View style={screen.heroIcon}>
              <Icon name="class" size={24} color={tokens.color.brand} />
            </View>
            <Text style={screen.title}>{classInfo.name}</Text>
            <View style={screen.badgeRow}>
              <View style={screen.classBadge}>
                <Text style={screen.classBadgeText}>
                  {classInfo.classKind === "LIVE_COHORT" ? "Lớp trực tiếp" : classInfo.classKind === "PRIVATE" ? "Lớp riêng" : "Lớp học"}
                </Text>
              </View>
              {classInfo.state ? (
                <View style={[screen.stateBadge, classInfo.state !== "ACTIVE" && screen.stateBadgeNeutral]}>
                  <Text style={[screen.stateBadgeText, classInfo.state !== "ACTIVE" && screen.stateBadgeTextNeutral]}>
                    {classInfo.state === "ACTIVE" ? "Đang hoạt động" : classInfo.state === "CLOSED" ? "Đã đóng" : classInfo.state}
                  </Text>
                </View>
              ) : null}
            </View>
            {classInfo.maxMembers ? (
              <Text style={screen.heroMeta}>Sức chứa tối đa: {classInfo.maxMembers} học viên</Text>
            ) : null}
            {classInfo.linkedCourseId ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Mở khóa học liên kết"
                onPress={() => router.push(`/learn/${classInfo.linkedCourseId}`)}
                style={screen.courseLink}
              >
                <Icon name="book" size={16} color={tokens.color.brand} />
                <Text style={screen.courseLinkText}>Mở nội dung khóa học</Text>
                <Icon name="chevronRight" size={15} color={tokens.color.brand} />
              </Pressable>
            ) : null}
          </View>

          {nextSession ? (
            <View style={screen.upcomingCard}>
              <View style={screen.upcomingHeader}>
                <View style={screen.upcomingDot} />
                <Text style={screen.upcomingLabel}>Buổi học tiếp theo</Text>
              </View>
              <Text style={screen.upcomingTitle}>{nextSession.title}</Text>
              <Text style={screen.upcomingDate}>
                {formatDate(parseTimestamp(nextSession.startAt), nextSession.timezone)}
              </Text>
              <Text style={screen.upcomingTime}>
                {formatTimeRange(
                  parseTimestamp(nextSession.startAt),
                  parseTimestamp(nextSession.endAt),
                  nextSession.timezone,
                )}
              </Text>
              {nextSession.location ? (
                <Text style={screen.upcomingLocation} numberOfLines={2}>
                  {nextSession.mode === "ONLINE" ? "Liên kết: " : "Địa điểm: "}{nextSession.location}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Xem chi tiết buổi học ${nextSession.title}`}
                style={screen.upcomingButton}
                onPress={() => router.push(`/classes/${classId}/sessions/${nextSession.sessionId}`)}
              >
                <Text style={screen.upcomingButtonText}>Xem chi tiết buổi học</Text>
                <Icon name="chevronRight" size={17} color="#FFFFFF" />
              </Pressable>
            </View>
          ) : null}

          <View style={screen.sectionHeader}>
            <View>
              <Text style={screen.sectionTitle}>Lịch học</Text>
              <Text style={screen.sectionSubtitle}>Trong 30 ngày tới</Text>
            </View>
            <View style={screen.countBadge}>
              <Text style={screen.count}>{sessions.length} buổi</Text>
            </View>
          </View>

          {sessions.length === 0 ? (
            <View style={screen.emptyCard}>
              <Icon name="calendar" size={25} color={tokens.color.brand} />
              <Text style={screen.emptyTitle}>Chưa có buổi học sắp tới</Text>
              <Text style={styles.text}>Chưa có buổi học nào được xếp lịch trong khoảng thời gian này.</Text>
            </View>
          ) : (
            sessions.map((item, index) => {
              const start = parseTimestamp(item.startAt);
              const end = parseTimestamp(item.endAt);
              const online = item.mode === "ONLINE";
              return (
                <Pressable
                  key={item.sessionId}
                  accessibilityRole="button"
                  accessibilityLabel={`Mở buổi học ${item.title}`}
                  style={screen.sessionCard}
                  onPress={() => router.push(`/classes/${classId}/sessions/${item.sessionId}`)}
                >
                  <View style={screen.sessionHeader}>
                    <View style={[screen.modeBadge, online ? screen.onlineBadge : screen.offlineBadge]}>
                      <Text style={[screen.modeText, online ? screen.onlineText : screen.offlineText]}>
                        {online ? "Trực tuyến" : item.mode === "OFFLINE" ? "Tại lớp" : item.mode}
                      </Text>
                    </View>
                    <Text style={screen.sessionIndex}>Buổi {index + 1}</Text>
                  </View>
                  <Text style={screen.sessionTitle}>{item.title}</Text>
                  <Text style={screen.sessionDate}>
                    {formatDate(start, item.timezone)} · {formatTimeRange(start, end, item.timezone)}
                  </Text>
                  {item.location ? (
                    <Text style={screen.sessionLocation} numberOfLines={2}>
                      {online ? "Liên kết: " : "Địa điểm: "}{item.location}
                    </Text>
                  ) : null}
                  <View style={screen.sessionFooter}>
                    <Text style={screen.sessionStatus}>{sessionStatusLabel(item.status)}</Text>
                    <Text style={screen.sessionAction}>Xem buổi học ›</Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </>
      ) : null}

      {!loading && !error && classInfo ? (
        <Button label="Làm mới lịch học" variant="outline" onPress={() => { setLoading(true); void load(); }} />
      ) : null}
    </Page>
  );
}

const screen = StyleSheet.create({
  page: { gap: 16, paddingBottom: 32 },
  center: { minHeight: 160, alignItems: "center", justifyContent: "center", gap: 12 },
  errorCard: { gap: 14, padding: 18, borderRadius: 12, backgroundColor: tokens.color.dangerLight },
  hero: { padding: 20, gap: 12, borderRadius: 16, backgroundColor: tokens.color.surface, borderWidth: 1, borderColor: tokens.color.border, ...tokens.shadow.subtle },
  heroIcon: { width: 45, height: 45, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: tokens.color.brandLight },
  title: { color: tokens.color.ink, fontSize: 23, fontWeight: "800", lineHeight: 29 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  classBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: tokens.color.brandLight },
  classBadgeText: { color: tokens.color.brandDark, fontSize: 12, fontWeight: "700" },
  stateBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: tokens.color.successLight },
  stateBadgeText: { color: "#065F46", fontSize: 12, fontWeight: "700" },
  stateBadgeNeutral: { backgroundColor: "#F1F5F9" },
  stateBadgeTextNeutral: { color: tokens.color.inkSecondary },
  heroMeta: { color: tokens.color.muted, fontSize: 13 },
  courseLink: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, borderTopWidth: 1, borderTopColor: tokens.color.border, paddingTop: 10 },
  courseLinkText: { flex: 1, color: tokens.color.brand, fontSize: 14, fontWeight: "700" },
  upcomingCard: { gap: 7, padding: 20, borderRadius: 14, backgroundColor: tokens.color.ink },
  upcomingHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  upcomingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#2DD4BF" },
  upcomingLabel: { color: "#67E8F9", fontSize: 12, fontWeight: "700" },
  upcomingTitle: { color: "#FFFFFF", fontSize: 19, fontWeight: "700", lineHeight: 25 },
  upcomingDate: { color: "#E2E8F0", fontSize: 14, fontWeight: "600" },
  upcomingTime: { color: "#CBD5E1", fontSize: 13 },
  upcomingLocation: { color: "#CBD5E1", fontSize: 13, lineHeight: 19 },
  upcomingButton: { minHeight: 46, marginTop: 10, paddingHorizontal: 14, borderRadius: 8, backgroundColor: tokens.color.brand, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  upcomingButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 3 },
  sectionTitle: { color: tokens.color.ink, fontSize: 18, fontWeight: "700" },
  sectionSubtitle: { color: tokens.color.muted, fontSize: 12, marginTop: 3 },
  countBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: tokens.color.brandLight },
  count: { color: tokens.color.brandDark, fontSize: 12, fontWeight: "700" },
  emptyCard: { gap: 8, alignItems: "center", padding: 24, borderRadius: 12, backgroundColor: tokens.color.surface, borderWidth: 1, borderColor: tokens.color.border },
  emptyTitle: { color: tokens.color.ink, fontSize: 16, fontWeight: "700" },
  sessionCard: { gap: 9, padding: 16, borderRadius: 12, backgroundColor: tokens.color.surface, borderWidth: 1, borderColor: tokens.color.border },
  sessionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  modeBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5 },
  onlineBadge: { backgroundColor: "#E0F2FE" },
  offlineBadge: { backgroundColor: "#FEF3C7" },
  modeText: { fontSize: 11, fontWeight: "700" },
  onlineText: { color: "#0369A1" },
  offlineText: { color: "#92400E" },
  sessionIndex: { color: tokens.color.muted, fontSize: 12, fontWeight: "600" },
  sessionTitle: { color: tokens.color.ink, fontSize: 16, fontWeight: "700", lineHeight: 22 },
  sessionDate: { color: tokens.color.muted, fontSize: 13, lineHeight: 19 },
  sessionLocation: { color: tokens.color.inkSecondary, fontSize: 13, lineHeight: 19 },
  sessionFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderTopWidth: 1, borderTopColor: tokens.color.border, paddingTop: 9 },
  sessionStatus: { color: tokens.color.muted, fontSize: 12, fontWeight: "600" },
  sessionAction: { color: tokens.color.brand, fontSize: 13, fontWeight: "700" },
});
