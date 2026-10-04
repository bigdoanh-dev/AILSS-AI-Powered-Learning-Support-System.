import { useLanguage, useUiText } from "../../../src/use-language";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from "react-native";
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
import { FadeSlideIn, ScalePressable } from "../../../src/motion";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sessionStatusLabel(status: string): string {
  switch (status) {
    case "SCHEDULED":
      return "Đã lên lịch";
    case "COMPLETED":
      return "Đã kết thúc";
    case "CANCELLED":
      return "Đã hủy";
    case "DRAFT":
      return "Bản nháp";
    default:
      return status;
  }
}

type ClassTab = "schedule" | "materials" | "info";

export default function ClassDetails() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const { classId } = useLocalSearchParams<{ classId: string }>();
  const session = runtime!;
  const auth = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [classInfo, setClassInfo] = useState<StudentClass | null>(null);
  const [sessions, setSessions] = useState<ClassSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedScope, setLoadedScope] = useState("");
  const [activeTab, setActiveTab] = useState<ClassTab>("schedule");
  const [toastNotice, setToastNotice] = useState<string | null>(null);

  const validId = typeof classId === "string" && UUID_REGEX.test(classId);
  const requestScope = `${auth.user?.userId ?? ""}:${typeof classId === "string" ? classId : ""}`;

  const load = useCallback(
    async (signal?: AbortSignal) => {
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
    },
    [auth.state, auth.user?.role, classId, requestScope, session, validId],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
    setToastNotice("✓ Đã cập nhật lịch học mới nhất");
    setTimeout(() => setToastNotice(null), 3500);
  };

  if (auth.state !== "AUTHENTICATED") return <Redirect href="/login" />;
  if (auth.user?.role !== "STUDENT") return <Redirect href="/" />;
  if (!validId) {
    return (
      <Page>
        <Text style={styles.title}>{uiText("Đường dẫn lớp không hợp lệ")}</Text>
        <Button label={uiText("Quay lại lớp học")} onPress={() => router.replace("/classes")} />
      </Page>
    );
  }

  const nextSession = nextUpcomingSession(sessions.filter((item) => item.status === "SCHEDULED"));

  return (
    <Page style={screen.page}>
      <ScreenHeader
        title={uiText("Chi tiết lớp học")}
        subtitle={classInfo?.name ? classInfo.name : uiText("Thông tin lớp & Lịch học")}
        onBack={() => router.replace("/classes")}
        rightElement={
          <ScalePressable
            accessibilityRole="button"
            accessibilityLabel={uiText("Làm mới lịch học")}
            onPress={handleRefresh}
            style={screen.headerRefreshBtn}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color={tokens.color.brand} />
            ) : (
              <Icon name="refresh" size={18} color={tokens.color.brand} />
            )}
          </ScalePressable>
        }
      />

      {classInfo?.coverDataUrl && (
        <Image
          source={{ uri: classInfo.coverDataUrl }}
          style={{ width: "100%", height: 180, borderRadius: 16 }}
          resizeMode="cover"
        />
      )}
      {classInfo?.photoDataUrl && (
        <Image
          source={{ uri: classInfo.photoDataUrl }}
          style={{ width: 72, height: 72, borderRadius: 14 }}
          resizeMode="cover"
        />
      )}

      {toastNotice && (
        <FadeSlideIn duration={250} fromY={-10}>
          <View style={screen.toastBar}>
            <Icon name="checkCircle" size={16} color="#065F46" />
            <Text style={screen.toastText}>{toastNotice}</Text>
          </View>
        </FadeSlideIn>
      )}

      {loading || loadedScope !== requestScope ? (
        <View style={screen.center}>
          <ActivityIndicator size="large" color={tokens.color.brand} />
          <Text style={screen.loadingText}>{uiText("Đang tải thông tin lớp học…")}</Text>
        </View>
      ) : error ? (
        <View style={screen.errorCard}>
          <View style={screen.errorHeader}>
            <Icon name="alert" size={24} color={tokens.color.danger} />
            <Text style={screen.errorTitle}>{uiText("Có lỗi xảy ra")}</Text>
          </View>
          <Text accessibilityRole="alert" style={screen.errorText}>
            {uiText(error)}
          </Text>
          <Button
            label={uiText("Thử lại")}
            onPress={() => {
              setLoading(true);
              void load();
            }}
          />
        </View>
      ) : classInfo ? (
        <FadeSlideIn duration={380}>
          {/* Hero Card */}
          <View style={screen.hero}>
            <View style={screen.heroAccentStripe} />
            <View style={screen.heroTopRow}>
              <View style={screen.heroIconBox}>
                <Icon name="class" size={26} color="#FFFFFF" />
              </View>
              <View style={screen.heroTitleContainer}>
                <View style={screen.badgeRow}>
                  <View style={screen.classBadge}>
                    <Text style={screen.classBadgeText}>
                      {classInfo.classKind === "LIVE_COHORT"
                        ? uiText("Lớp trực tiếp")
                        : classInfo.classKind === "PRIVATE"
                          ? uiText("Lớp riêng")
                          : uiText("Lớp học")}
                    </Text>
                  </View>
                  {classInfo.state ? (
                    <View
                      style={[screen.stateBadge, classInfo.state !== "ACTIVE" && screen.stateBadgeNeutral]}
                    >
                      <View
                        style={[
                          screen.stateDot,
                          {
                            backgroundColor: classInfo.state === "ACTIVE" ? tokens.color.success : "#94A3B8",
                          },
                        ]}
                      />
                      <Text
                        style={[
                          screen.stateBadgeText,
                          classInfo.state !== "ACTIVE" && screen.stateBadgeTextNeutral,
                        ]}
                      >
                        {classInfo.state === "ACTIVE"
                          ? uiText("Đang hoạt động")
                          : classInfo.state === "CLOSED"
                            ? uiText("Đã đóng")
                            : classInfo.state}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={screen.title}>{classInfo.name}</Text>
              </View>
            </View>

            {/* Quick Metrics Bar */}
            <View style={screen.metricsStrip}>
              <View style={screen.metricItem}>
                <Text style={screen.metricIcon}>👥</Text>
                <View>
                  <Text style={screen.metricLabel}>{uiText("Sức chứa")}</Text>
                  <Text style={screen.metricValue}>
                    {classInfo.maxMembers ? uiText("{0} bạn", [classInfo.maxMembers]) : uiText("Tự do")}
                  </Text>
                </View>
              </View>

              <View style={screen.metricDivider} />

              <View style={screen.metricItem}>
                <Text style={screen.metricIcon}>📅</Text>
                <View>
                  <Text style={screen.metricLabel}>{uiText("Lịch học")}</Text>
                  <Text style={screen.metricValue}>
                    {sessions.length} {uiText(" buổi")}
                  </Text>
                </View>
              </View>

              <View style={screen.metricDivider} />

              <View style={screen.metricItem}>
                <Text style={screen.metricIcon}>✨</Text>
                <View>
                  <Text style={screen.metricLabel}>{uiText("Hình thức")}</Text>
                  <Text style={screen.metricValue}>
                    {classInfo.classKind === "LIVE_COHORT" ? uiText("Trực tiếp") : uiText("Trực tuyến")}
                  </Text>
                </View>
              </View>
            </View>

            {classInfo.maxMembers ? (
              <Text style={screen.heroMeta}>
                {uiText("Sức chứa tối đa: ")}
                {classInfo.maxMembers} {uiText(" học viên")}
              </Text>
            ) : null}

            {classInfo.linkedCourseId ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={uiText("Mở khóa học liên kết")}
                onPress={() => router.push(`/learn/${classInfo.linkedCourseId}`)}
                style={screen.courseLink}
              >
                <View style={screen.courseLinkIconBox}>
                  <Icon name="book" size={16} color={tokens.color.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={screen.courseLinkSub}>{uiText("GIÁO TRÌNH KHOÁ HỌC")}</Text>
                  <Text style={screen.courseLinkText}>{uiText("Mở nội dung khóa học")}</Text>
                </View>
                <Icon name="chevronRight" size={16} color={tokens.color.brand} />
              </Pressable>
            ) : null}
          </View>

          {/* Next upcoming session spotlight */}
          {nextSession ? (
            <View style={screen.upcomingCard}>
              <View style={screen.upcomingHeader}>
                <View style={screen.upcomingDot} />
                <Text style={screen.upcomingLabel}>{uiText("BUỔI HỌC KẾ TIẾP")}</Text>
                <View style={screen.upcomingLiveBadge}>
                  <Text style={screen.upcomingLiveText}>{uiText("Sắp diễn ra")}</Text>
                </View>
              </View>
              <Text style={screen.upcomingTitle}>{nextSession.title}</Text>

              <View style={screen.upcomingMetaGrid}>
                <View style={screen.upcomingMetaItem}>
                  <Icon name="calendar" size={15} color="#67E8F9" />
                  <Text style={screen.upcomingDate}>
                    {formatDate(parseTimestamp(nextSession.startAt), nextSession.timezone, uiLocale)}
                  </Text>
                </View>
                <View style={screen.upcomingMetaItem}>
                  <Icon name="clock" size={15} color="#67E8F9" />
                  <Text style={screen.upcomingTime}>
                    {formatTimeRange(
                      parseTimestamp(nextSession.startAt),
                      parseTimestamp(nextSession.endAt),
                      nextSession.timezone,
                      uiLocale,
                    )}
                  </Text>
                </View>
              </View>

              {nextSession.location ? (
                <View style={screen.upcomingLocationBox}>
                  <Icon name="mapPin" size={14} color="#CBD5E1" />
                  <Text style={screen.upcomingLocation} numberOfLines={2}>
                    {nextSession.mode === "ONLINE" ? uiText("Liên kết: ") : uiText("Địa điểm: ")}
                    {nextSession.location}
                  </Text>
                </View>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={uiText("Xem chi tiết buổi học {0}", [nextSession.title])}
                style={screen.upcomingButton}
                onPress={() => router.push(`/classes/${classId}/sessions/${nextSession.sessionId}`)}
              >
                <Text style={screen.upcomingButtonText}>{uiText("Xem chi tiết buổi học")}</Text>
                <Icon name="chevronRight" size={17} color="#FFFFFF" />
              </Pressable>
            </View>
          ) : null}

          {/* Modern Segmented Navigation Tabs */}
          <View style={screen.segmentedNav} role="tablist">
            <Pressable
              style={[screen.segmentedTab, activeTab === "schedule" && screen.segmentedTabActive]}
              onPress={() => setActiveTab("schedule")}
            >
              <Icon
                name="calendar"
                size={15}
                color={activeTab === "schedule" ? tokens.color.brand : tokens.color.muted}
              />
              <Text
                style={[screen.segmentedTabText, activeTab === "schedule" && screen.segmentedTabTextActive]}
              >
                {uiText("Lịch học (")}
                {sessions.length})
              </Text>
            </Pressable>

            <Pressable
              style={[screen.segmentedTab, activeTab === "materials" && screen.segmentedTabActive]}
              onPress={() => setActiveTab("materials")}
            >
              <Icon
                name="book"
                size={15}
                color={activeTab === "materials" ? tokens.color.brand : tokens.color.muted}
              />
              <Text
                style={[screen.segmentedTabText, activeTab === "materials" && screen.segmentedTabTextActive]}
              >
                {uiText("Học liệu")}
              </Text>
            </Pressable>

            <Pressable
              style={[screen.segmentedTab, activeTab === "info" && screen.segmentedTabActive]}
              onPress={() => setActiveTab("info")}
            >
              <Icon
                name="info"
                size={15}
                color={activeTab === "info" ? tokens.color.brand : tokens.color.muted}
              />
              <Text style={[screen.segmentedTabText, activeTab === "info" && screen.segmentedTabTextActive]}>
                {uiText("Nội quy")}
              </Text>
            </Pressable>
          </View>

          {/* TAB 1: SCHEDULE */}
          {activeTab === "schedule" && (
            <>
              <View style={screen.sectionHeader}>
                <View>
                  <Text style={screen.sectionTitle}>{uiText("Lịch học")}</Text>
                  <Text style={screen.sectionSubtitle}>{uiText("Trong 30 ngày tới")}</Text>
                </View>
                <View style={screen.countBadge}>
                  <Text style={screen.count}>
                    {sessions.length} {uiText(" buổi")}
                  </Text>
                </View>
              </View>

              {sessions.length === 0 ? (
                <View style={screen.emptyCard}>
                  <View style={screen.emptyIconRing}>
                    <View style={screen.emptyIconCircle}>
                      <Icon name="calendar" size={28} color="#FFFFFF" />
                    </View>
                  </View>
                  <Text style={screen.emptyTitle}>{uiText("Chưa có buổi học sắp tới")}</Text>
                  <Text style={[styles.text, screen.emptyDesc]}>
                    {uiText("Chưa có buổi học nào được xếp lịch trong khoảng thời gian này.")}
                  </Text>

                  <View style={screen.emptyNoticeBanner}>
                    <Icon name="sparkles" size={16} color={tokens.color.brand} />
                    <Text style={screen.emptyNoticeText}>
                      {uiText(
                        "Giảng viên sẽ công bố lịch học các buổi tiếp theo khi lớp bắt đầu đợt mới. Bạn có thể bấm nút bên dưới để cập nhật lại.",
                      )}
                    </Text>
                  </View>

                  <Button
                    label={uiText("Làm mới lịch học")}
                    variant="primary"
                    icon={<Icon name="refresh" size={16} color="#FFFFFF" />}
                    onPress={handleRefresh}
                    style={{ marginTop: 6 }}
                  />
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
                      accessibilityLabel={uiText("Mở buổi học {0}", [item.title])}
                      style={screen.sessionCard}
                      onPress={() => router.push(`/classes/${classId}/sessions/${item.sessionId}`)}
                    >
                      <View
                        style={[
                          screen.sessionSideStripe,
                          { backgroundColor: online ? "#0284C7" : "#D97706" },
                        ]}
                      />
                      <View style={screen.sessionContent}>
                        <View style={screen.sessionHeader}>
                          <View style={screen.sessionIndexPill}>
                            <Text style={screen.sessionIndexText}>
                              {uiText("Buổi ")}
                              {index + 1}
                            </Text>
                          </View>
                          <View style={[screen.modeBadge, online ? screen.onlineBadge : screen.offlineBadge]}>
                            <Text style={[screen.modeText, online ? screen.onlineText : screen.offlineText]}>
                              {online
                                ? uiText("Trực tuyến")
                                : item.mode === "OFFLINE"
                                  ? uiText("Tại lớp")
                                  : item.mode}
                            </Text>
                          </View>
                        </View>

                        <Text style={screen.sessionTitle}>{item.title}</Text>

                        <View style={screen.sessionInfoRow}>
                          <Icon name="calendar" size={14} color={tokens.color.muted} />
                          <Text style={screen.sessionDate}>
                            {formatDate(start, item.timezone, uiLocale)} ·{" "}
                            {formatTimeRange(start, end, item.timezone, uiLocale)}
                          </Text>
                        </View>

                        {item.location ? (
                          <View style={screen.sessionLocationRow}>
                            <Icon name="mapPin" size={14} color={tokens.color.muted} />
                            <Text style={screen.sessionLocation} numberOfLines={2}>
                              {online ? uiText("Liên kết: ") : uiText("Địa điểm: ")}
                              {item.location}
                            </Text>
                          </View>
                        ) : null}

                        <View style={screen.sessionFooter}>
                          <View style={screen.statusTag}>
                            <View
                              style={[
                                screen.statusDot,
                                {
                                  backgroundColor:
                                    item.status === "SCHEDULED" ? tokens.color.success : "#94A3B8",
                                },
                              ]}
                            />
                            <Text style={screen.sessionStatus}>{sessionStatusLabel(item.status)}</Text>
                          </View>
                          <View style={screen.sessionActionContainer}>
                            <Text style={screen.sessionAction}>{uiText("Xem buổi học ›")}</Text>
                          </View>
                        </View>
                      </View>
                    </Pressable>
                  );
                })
              )}
            </>
          )}

          {/* TAB 2: MATERIALS */}
          {activeTab === "materials" && (
            <View style={screen.tabContentCard}>
              <View style={screen.tabContentHeader}>
                <Icon name="book" size={20} color={tokens.color.brand} />
                <Text style={screen.tabContentTitle}>{uiText("Tài Liệu & Học Liệu Lớp Học")}</Text>
              </View>

              {classInfo.linkedCourseId ? (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={uiText("Mở khóa học liên kết")}
                  onPress={() => router.push(`/learn/${classInfo.linkedCourseId}`)}
                  style={screen.materialItem}
                >
                  <View style={screen.materialIconBox}>
                    <Icon name="book" size={18} color={tokens.color.brand} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={screen.materialTitle}>{uiText("Giáo trình khóa học chính")}</Text>
                    <Text style={screen.materialSub}>
                      {uiText("Bao gồm slide bài giảng, video ghi hình và bài tập")}
                    </Text>
                  </View>
                  <Icon name="chevronRight" size={16} color={tokens.color.brand} />
                </Pressable>
              ) : null}

              <View style={screen.materialItem}>
                <View style={[screen.materialIconBox, { backgroundColor: "#FEF3C7" }]}>
                  <Icon name="assignment" size={18} color="#D97706" />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={screen.materialTitle}>{uiText("Bài tập thực hành & Quiz")}</Text>
                  <Text style={screen.materialSub}>
                    {uiText("Được giao theo tiến độ từng buổi học trực tuyến")}
                  </Text>
                </View>
                <Icon name="chevronRight" size={16} color={tokens.color.muted} />
              </View>

              <View style={screen.materialItem}>
                <View style={[screen.materialIconBox, { backgroundColor: "#EDE9FE" }]}>
                  <Icon name="sparkles" size={18} color="#7C3AED" />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={screen.materialTitle}>{uiText("Trợ lý AI đồng hành")}</Text>
                  <Text style={screen.materialSub}>
                    {uiText("Hỗ trợ giải đáp thắc mắc và chữa bài tập 24/7")}
                  </Text>
                </View>
                <Icon name="chevronRight" size={16} color={tokens.color.muted} />
              </View>
            </View>
          )}

          {/* TAB 3: INFO */}
          {activeTab === "info" && (
            <View style={screen.tabContentCard}>
              <View style={screen.tabContentHeader}>
                <Icon name="info" size={20} color={tokens.color.brand} />
                <Text style={screen.tabContentTitle}>{uiText("Nội Quy & Thông Tin Lớp Học")}</Text>
              </View>

              <View style={screen.infoRowItem}>
                <Text style={screen.infoBullet}>1.</Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={screen.infoHeading}>{uiText("Điểm danh & Chuyên cần")}</Text>
                  <Text style={screen.infoText}>
                    {uiText(
                      "Yêu cầu chuyên cần và điều kiện hoàn thành lớp do giảng viên công bố trong thông báo lớp học.",
                    )}
                  </Text>
                </View>
              </View>

              <View style={screen.infoRowItem}>
                <Text style={screen.infoBullet}>2.</Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={screen.infoHeading}>{uiText("Chuẩn bị trước buổi học")}</Text>
                  <Text style={screen.infoText}>
                    {uiText(
                      "Vui lòng vào phòng học trực tuyến trước 5-10 phút để kiểm tra micro và đường truyền Internet.",
                    )}
                  </Text>
                </View>
              </View>

              <View style={screen.infoRowItem}>
                <Text style={screen.infoBullet}>3.</Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={screen.infoHeading}>{uiText("Hỗ trợ học tập")}</Text>
                  <Text style={screen.infoText}>
                    {uiText(
                      "Mọi thắc mắc về giáo trình có thể trao đổi trực tiếp với giảng viên hoặc trợ giảng AI trong phần thảo luận.",
                    )}
                  </Text>
                </View>
              </View>
            </View>
          )}
        </FadeSlideIn>
      ) : null}

      {!loading && !error && classInfo && sessions.length > 0 ? (
        <Button
          label={uiText("Làm mới lịch học")}
          variant="outline"
          icon={<Icon name="refresh" size={16} color={tokens.color.brand} />}
          onPress={handleRefresh}
        />
      ) : null}
    </Page>
  );
}

const screen = StyleSheet.create({
  page: { gap: 16, paddingBottom: 36 },
  center: { minHeight: 200, alignItems: "center", justifyContent: "center", gap: 12 },
  loadingText: { color: tokens.color.muted, fontSize: 14, fontWeight: "500" },
  headerRefreshBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.color.surface,
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  toastBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#D1FAE5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  toastText: { color: "#065F46", fontSize: 13, fontWeight: "600" },
  errorCard: {
    gap: 12,
    padding: 20,
    borderRadius: 16,
    backgroundColor: tokens.color.dangerLight,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  errorHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  errorTitle: { color: tokens.color.danger, fontSize: 16, fontWeight: "700" },
  errorText: { color: "#991B1B", fontSize: 13, lineHeight: 19 },

  // Hero Card
  hero: {
    padding: 20,
    gap: 14,
    borderRadius: 20,
    backgroundColor: tokens.color.surface,
    borderWidth: 1,
    borderColor: tokens.color.border,
    overflow: "hidden",
    position: "relative",
    ...tokens.shadow.card,
  },
  heroAccentStripe: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: tokens.color.brand,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
  },
  heroIconBox: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.color.brand,
    ...tokens.shadow.subtle,
  },
  heroTitleContainer: { flex: 1, gap: 6 },
  title: {
    color: tokens.color.ink,
    fontSize: 21,
    fontWeight: "800",
    lineHeight: 27,
    letterSpacing: -0.3,
  },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  classBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: tokens.color.brandLight,
  },
  classBadgeText: { color: tokens.color.brandDark, fontSize: 12, fontWeight: "700" },
  stateBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: tokens.color.successLight,
  },
  stateDot: { width: 6, height: 6, borderRadius: 3 },
  stateBadgeText: { color: "#065F46", fontSize: 12, fontWeight: "700" },
  stateBadgeNeutral: { backgroundColor: "#F1F5F9" },
  stateBadgeTextNeutral: { color: tokens.color.inkSecondary },

  // Metrics Strip
  metricsStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: tokens.color.surfaceSubtle,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  metricItem: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  metricIcon: { fontSize: 18 },
  metricLabel: { color: tokens.color.muted, fontSize: 11, fontWeight: "500" },
  metricValue: { color: tokens.color.ink, fontSize: 13, fontWeight: "700" },
  metricDivider: { width: 1, height: 26, backgroundColor: tokens.color.border, marginHorizontal: 6 },

  heroMeta: { color: tokens.color.muted, fontSize: 12 },
  courseLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
    backgroundColor: "#F0FDFA",
    borderWidth: 1,
    borderColor: "#CCFBF1",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  courseLinkIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#CCFBF1",
    alignItems: "center",
    justifyContent: "center",
  },
  courseLinkSub: { color: "#0D9488", fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  courseLinkText: { color: "#0F766E", fontSize: 13, fontWeight: "700" },

  // Spotlight Next Session
  upcomingCard: {
    gap: 10,
    padding: 20,
    borderRadius: 18,
    backgroundColor: "#0F172A",
    borderWidth: 1,
    borderColor: "#1E293B",
    ...tokens.shadow.card,
  },
  upcomingHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  upcomingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#2DD4BF" },
  upcomingLabel: { color: "#67E8F9", fontSize: 12, fontWeight: "800", letterSpacing: 0.5 },
  upcomingLiveBadge: {
    marginLeft: "auto",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(45, 212, 191, 0.15)",
  },
  upcomingLiveText: { color: "#2DD4BF", fontSize: 11, fontWeight: "700" },
  upcomingTitle: { color: "#FFFFFF", fontSize: 18, fontWeight: "700", lineHeight: 24 },
  upcomingMetaGrid: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 2 },
  upcomingMetaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  upcomingDate: { color: "#E2E8F0", fontSize: 13, fontWeight: "600" },
  upcomingTime: { color: "#CBD5E1", fontSize: 13 },
  upcomingLocationBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 4,
  },
  upcomingLocation: { color: "#94A3B8", fontSize: 12, lineHeight: 18, flex: 1 },
  upcomingButton: {
    minHeight: 44,
    marginTop: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: tokens.color.brand,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    ...tokens.shadow.subtle,
  },
  upcomingButtonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },

  // Segmented Nav Tabs
  segmentedNav: {
    flexDirection: "row",
    backgroundColor: tokens.color.surfaceSubtle,
    padding: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: tokens.color.border,
    gap: 4,
  },
  segmentedTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  segmentedTabActive: {
    backgroundColor: tokens.color.surface,
    ...tokens.shadow.subtle,
  },
  segmentedTabText: {
    color: tokens.color.muted,
    fontSize: 13,
    fontWeight: "600",
  },
  segmentedTabTextActive: {
    color: tokens.color.brand,
    fontWeight: "700",
  },

  // Section Header
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 2,
  },
  sectionTitle: { color: tokens.color.ink, fontSize: 18, fontWeight: "700" },
  sectionSubtitle: { color: tokens.color.muted, fontSize: 12, marginTop: 2 },
  countBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: tokens.color.brandLight,
  },
  count: { color: tokens.color.brandDark, fontSize: 12, fontWeight: "700" },

  // Empty State Card
  emptyCard: {
    gap: 12,
    alignItems: "center",
    padding: 24,
    borderRadius: 18,
    backgroundColor: tokens.color.surface,
    borderWidth: 1,
    borderColor: tokens.color.border,
    ...tokens.shadow.subtle,
  },
  emptyIconRing: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: tokens.color.brandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: tokens.color.brand,
    alignItems: "center",
    justifyContent: "center",
    ...tokens.shadow.subtle,
  },
  emptyTitle: { color: tokens.color.ink, fontSize: 17, fontWeight: "800", marginTop: 4 },
  emptyDesc: { textAlign: "center", color: tokens.color.muted, fontSize: 13, lineHeight: 20 },
  emptyNoticeBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: tokens.color.surfaceSubtle,
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: 12,
    padding: 12,
    marginVertical: 4,
  },
  emptyNoticeText: { flex: 1, color: tokens.color.inkSecondary, fontSize: 12, lineHeight: 18 },

  // Session Card
  sessionCard: {
    flexDirection: "row",
    borderRadius: 16,
    backgroundColor: tokens.color.surface,
    borderWidth: 1,
    borderColor: tokens.color.border,
    overflow: "hidden",
    ...tokens.shadow.subtle,
  },
  sessionSideStripe: { width: 5 },
  sessionContent: { flex: 1, padding: 16, gap: 8 },
  sessionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sessionIndexPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: tokens.color.surfaceSubtle,
  },
  sessionIndexText: { color: tokens.color.muted, fontSize: 11, fontWeight: "700" },
  modeBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  onlineBadge: { backgroundColor: "#E0F2FE" },
  offlineBadge: { backgroundColor: "#FEF3C7" },
  modeText: { fontSize: 11, fontWeight: "700" },
  onlineText: { color: "#0369A1" },
  offlineText: { color: "#92400E" },
  sessionTitle: { color: tokens.color.ink, fontSize: 16, fontWeight: "700", lineHeight: 22 },
  sessionInfoRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  sessionDate: { color: tokens.color.muted, fontSize: 13 },
  sessionLocationRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  sessionLocation: { color: tokens.color.inkSecondary, fontSize: 12, lineHeight: 18, flex: 1 },
  sessionFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: tokens.color.border,
    paddingTop: 10,
    marginTop: 2,
  },
  statusTag: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  sessionStatus: { color: tokens.color.muted, fontSize: 12, fontWeight: "600" },
  sessionActionContainer: { flexDirection: "row", alignItems: "center" },
  sessionAction: { color: tokens.color.brand, fontSize: 13, fontWeight: "700" },

  // Tabs Content: Materials & Info
  tabContentCard: {
    gap: 12,
    padding: 18,
    borderRadius: 16,
    backgroundColor: tokens.color.surface,
    borderWidth: 1,
    borderColor: tokens.color.border,
    ...tokens.shadow.subtle,
  },
  tabContentHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  tabContentTitle: { color: tokens.color.ink, fontSize: 16, fontWeight: "700" },
  materialItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: tokens.color.surfaceSubtle,
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  materialIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: tokens.color.brandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  materialTitle: { color: tokens.color.ink, fontSize: 14, fontWeight: "700" },
  materialSub: { color: tokens.color.muted, fontSize: 12 },
  infoRowItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 6,
  },
  infoBullet: {
    fontSize: 14,
    fontWeight: "800",
    color: tokens.color.brand,
    width: 18,
  },
  infoHeading: { color: tokens.color.ink, fontSize: 14, fontWeight: "700" },
  infoText: { color: tokens.color.muted, fontSize: 13, lineHeight: 19 },
});
