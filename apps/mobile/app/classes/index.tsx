import { useSyncExternalStore, useState, useEffect, useCallback } from "react";
import {
  Text,
  TextInput,
  View,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import * as Crypto from "expo-crypto";
import { runtime } from "../../src/runtime";
import {
  studentClasses,
  studentSchedule,
  studentAttendance,
  groupSessionsByDay,
  formatDate,
  formatTimeRange,
  parseTimestamp,
  getDateRangeForSchedule,
  type StudentClass,
  type StudentScheduleEntry,
  type StudentAttendanceEntry,
} from "../../src/classroom";
import { formatCurrentMonth, formatDisplayMonth } from "../../src/notifications";
import { ApiError } from "../../src/api";
import {
  Page,
  Button,
  Badge,
  Icon,
  EmptyState,
  ScreenHeader,
  BottomNavBar,
  styles,
  tokens,
} from "../../src/ui";
import { ScalePressable, FadeSlideIn } from "../../src/motion";

type ActiveTab = "classes" | "schedule" | "attendance";

export default function StudentClassesScreen() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [activeTab, setActiveTab] = useState<ActiveTab>(
    tab === "schedule" ? "schedule" : tab === "attendance" ? "attendance" : "classes",
  );
  const [scheduleViewMode, setScheduleViewMode] = useState<"day" | "week" | "month">("week");
  const [selectedDateStr, setSelectedDateStr] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [classesList, setClassesList] = useState<StudentClass[]>([]);
  const [scheduleList, setScheduleList] = useState<StudentScheduleEntry[]>([]);
  const [attendanceList, setAttendanceList] = useState<StudentAttendanceEntry[]>([]);
  const [attendanceMonth, setAttendanceMonth] = useState(() => formatCurrentMonth());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joinBusy, setJoinBusy] = useState(false);
  const [joinMessage, setJoinMessage] = useState("");
  const [joinKey, setJoinKey] = useState(() => Crypto.randomUUID());

  async function joinClass() {
    const code = joinCode.trim().toUpperCase();
    if (!/^[A-Z2-9]{6,32}$/.test(code)) {
      setJoinMessage("Mã lớp cần từ 6 đến 32 ký tự chữ và số hợp lệ.");
      return;
    }
    setJoinBusy(true);
    setJoinMessage("");
    try {
      await session.request("/api/v1/classes/join", {
        method: "POST",
        idempotencyKey: joinKey,
        body: { code },
      });
      setJoinCode("");
      setJoinKey(Crypto.randomUUID());
      setJoinMessage("Đã tham gia lớp học.");
      const classes = await session.request("/api/v1/me/classes");
      setClassesList(studentClasses(classes));
    } catch (cause) {
      setJoinMessage(cause instanceof ApiError ? cause.message : "Không thể tham gia lớp.");
    } finally {
      setJoinBusy(false);
    }
  }

  useEffect(() => {
    if (tab === "schedule" || tab === "classes" || tab === "attendance") {
      setActiveTab(tab);
    }
  }, [tab]);

  const fetchData = useCallback(async () => {
    if (snapshot.state !== "AUTHENTICATED") return;
    try {
      setError(null);
      if (activeTab === "classes") {
        const data = await session.request("/api/v1/me/classes");
        setClassesList(studentClasses(data));
      } else if (activeTab === "schedule") {
        const range = getDateRangeForSchedule(new Date(), 30);
        const data = await session.request(`/api/v1/me/schedule?from=${range.from}&to=${range.to}`);
        setScheduleList(studentSchedule(data));
      } else if (activeTab === "attendance") {
        const data = await session.request(`/api/v1/me/attendance?month=${attendanceMonth}`);
        setAttendanceList(studentAttendance(data));
      }
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        if (e.status === 401) {
          setError("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
        } else if (e.status === 403) {
          setError("Bạn không có quyền xem thông tin này.");
        } else {
          setError(e.message || "Không thể tải dữ liệu.");
        }
      } else {
        setError("Lỗi kết nối mạng. Vui lòng thử lại.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeTab, attendanceMonth, snapshot.state, session]);

  const handleAttendanceMonthShift = (direction: -1 | 1) => {
    const [yStr, mStr] = attendanceMonth.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    const date = new Date(Date.UTC(y, m - 1 + direction, 1));
    const nextMonth = formatCurrentMonth(date);
    setAttendanceMonth(nextMonth);
  };

  useEffect(() => {
    setLoading(true);
    void fetchData();
  }, [fetchData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchData();
  }, [fetchData]);

  if (snapshot.state !== "AUTHENTICATED") {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
        <Page>
          <View style={[styles.card, { alignItems: "center", paddingVertical: 40, gap: 14 }]}>
            <Icon name="calendar" size={40} color={tokens.color.brand} />
            <Text style={styles.title}>Lớp học & Lịch học</Text>
            <Text style={[styles.text, { textAlign: "center", maxWidth: 300 }]}>
              Vui lòng đăng nhập tài khoản học viên để xem danh sách lớp và lịch học của bạn.
            </Text>
            <Button label="Đăng nhập ngay" size="lg" onPress={() => router.push("/login")} />
          </View>
        </Page>
        <BottomNavBar currentRoute="classes" onNavigate={(path) => router.push(path as Href)} />
      </View>
    );
  }

  const groupedSchedule = groupSessionsByDay(scheduleList);

  const currentWeekDays = Array.from({ length: 7 }, (_, i) => {
    const today = new Date();
    const dayOfWeek = (today.getDay() + 6) % 7;
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - dayOfWeek + i);
    const dateStr = startOfWeek.toISOString().slice(0, 10);
    const dayName = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"][i];
    const hasSessions = scheduleList.some((s) => s.startAt.slice(0, 10) === dateStr);
    return {
      dateStr,
      dayNum: startOfWeek.getDate(),
      dayName,
      hasSessions,
    };
  });

  const daySessions = scheduleList.filter((s) => s.startAt.slice(0, 10) === selectedDateStr);

  const presentCount = attendanceList.filter((a) => a.attendanceStatus === "PRESENT").length;
  const excusedCount = attendanceList.filter((a) => a.attendanceStatus === "EXCUSED").length;
  const absentCount = attendanceList.filter((a) => a.attendanceStatus === "ABSENT").length;
  const totalRecorded = presentCount + excusedCount + absentCount;
  const presentRate =
    totalRecorded > 0 ? Math.round(((presentCount + excusedCount) / totalRecorded) * 100) : 100;

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <ScrollView
        style={localStyles.container}
        contentContainerStyle={localStyles.contentContainer}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tokens.color.brand} />
        }
      >
        <ScreenHeader
          title={
            activeTab === "attendance"
              ? "Điểm danh học tập"
              : activeTab === "schedule"
                ? "Lịch học của bạn"
                : "Lớp học của bạn"
          }
          subtitle={
            activeTab === "attendance"
              ? "Theo dõi chuyên cần và lịch sử điểm danh"
              : "Theo dõi thời khóa biểu và tham gia các buổi học trực tuyến"
          }
          onBack={() => {
            if (router.canGoBack()) router.back();
            else router.push("/");
          }}
          rightElement={
            activeTab === "attendance" ? (
              <Badge
                label={presentRate >= 80 ? `${presentRate}% ĐẠT` : `${presentRate}% CẦN CỐ GẮNG`}
                variant={presentRate >= 80 ? "success" : "warning"}
                icon="check"
              />
            ) : undefined
          }
        />

        {/* Tab Switcher */}
        <View style={localStyles.tabContainer}>
          <ScalePressable
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === "classes" }}
            style={[localStyles.tabButton, activeTab === "classes" && localStyles.tabButtonActive]}
            onPress={() => setActiveTab("classes")}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Icon
                name="class"
                size={14}
                color={activeTab === "classes" ? tokens.color.brand : tokens.color.muted}
              />
              <Text
                numberOfLines={1}
                style={[localStyles.tabText, activeTab === "classes" && localStyles.tabTextActive]}
              >
                Lớp học ({classesList.length})
              </Text>
            </View>
          </ScalePressable>

          <ScalePressable
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === "schedule" }}
            style={[localStyles.tabButton, activeTab === "schedule" && localStyles.tabButtonActive]}
            onPress={() => setActiveTab("schedule")}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Icon
                name="calendar"
                size={14}
                color={activeTab === "schedule" ? tokens.color.brand : tokens.color.muted}
              />
              <Text
                numberOfLines={1}
                style={[localStyles.tabText, activeTab === "schedule" && localStyles.tabTextActive]}
              >
                Lịch học ({scheduleList.length})
              </Text>
            </View>
          </ScalePressable>

          <ScalePressable
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === "attendance" }}
            style={[localStyles.tabButton, activeTab === "attendance" && localStyles.tabButtonActive]}
            onPress={() => setActiveTab("attendance")}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Icon
                name="checkCircle"
                size={14}
                color={activeTab === "attendance" ? tokens.color.brand : tokens.color.muted}
              />
              <Text
                numberOfLines={1}
                style={[localStyles.tabText, activeTab === "attendance" && localStyles.tabTextActive]}
              >
                Điểm danh ({attendanceList.length})
              </Text>
            </View>
          </ScalePressable>
        </View>

        {/* Loading state */}
        {loading && !refreshing && (
          <View style={localStyles.center}>
            <ActivityIndicator size="large" color={tokens.color.brand} />
            <Text style={[styles.small, { marginTop: 8 }]}>Đang tải dữ liệu…</Text>
          </View>
        )}

        {/* Error state */}
        {error && !loading && (
          <View style={[styles.card, { borderColor: tokens.color.dangerLight, backgroundColor: "#FEF2F2" }]}>
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
            <Button label="Thử lại" size="sm" onPress={() => void fetchData()} />
          </View>
        )}

        {/* Tab Content: Classes */}
        {!loading && !error && activeTab === "classes" && (
          <View style={localStyles.list}>
            <View style={[styles.card, { gap: 10 }]}>
              <Text style={styles.text}>Tham gia lớp bằng mã</Text>
              <TextInput
                style={styles.input}
                value={joinCode}
                onChangeText={setJoinCode}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={32}
                placeholder="Nhập mã giảng viên cung cấp"
                accessibilityLabel="Mã tham gia lớp"
              />
              <Button
                label={joinBusy ? "Đang tham gia…" : "Tham gia lớp"}
                disabled={joinBusy}
                onPress={() => void joinClass()}
              />
              {joinMessage ? (
                <Text accessibilityRole="alert" style={styles.small}>
                  {joinMessage}
                </Text>
              ) : null}
            </View>
            {classesList.length === 0 ? (
              <EmptyState
                icon="calendar"
                title="Chưa tham gia lớp học nào"
                description="Đăng ký khóa học hoặc sử dụng mã tham gia do giảng viên cung cấp để vào lớp."
                actionLabel="Khám phá khóa học"
                onAction={() => router.push("/courses")}
              />
            ) : (
              classesList.map((item) => {
                const isLive = item.classKind === "LIVE_COHORT";
                const isPrivate = item.classKind === "PRIVATE";
                const kindLabel = isLive
                  ? "Lớp trực tiếp LIVE"
                  : isPrivate
                    ? "Lớp riêng kèm 1-1"
                    : "Lớp học trực tuyến";
                const hasSchedule = item.scheduleState === "PUBLISHED";

                return (
                  <ScalePressable
                    key={item.classId}
                    accessibilityRole="button"
                    accessibilityLabel={`Xem lớp ${item.name}`}
                    style={localStyles.classCard}
                    onPress={() => router.push(`/classes/${item.classId}`)}
                  >
                    <View style={localStyles.classCardTopRow}>
                      <View
                        style={[
                          localStyles.classKindBadge,
                          isLive
                            ? localStyles.kindBadgeLive
                            : isPrivate
                              ? localStyles.kindBadgePrivate
                              : localStyles.kindBadgeStandard,
                        ]}
                      >
                        <Icon
                          name={isLive ? "sparkles" : isPrivate ? "user" : "class"}
                          size={12}
                          color={isLive ? "#0D9488" : isPrivate ? "#7C3AED" : "#2563EB"}
                        />
                        <Text
                          style={[
                            localStyles.classKindText,
                            {
                              color: isLive ? "#0D9488" : isPrivate ? "#7C3AED" : "#2563EB",
                            },
                          ]}
                        >
                          {kindLabel}
                        </Text>
                      </View>
                      <View
                        style={[
                          localStyles.scheduleStateBadge,
                          hasSchedule ? localStyles.scheduleBadgeActive : localStyles.scheduleBadgePending,
                        ]}
                      >
                        <Icon
                          name={hasSchedule ? "check" : "clock"}
                          size={11}
                          color={hasSchedule ? "#16A34A" : "#D97706"}
                        />
                        <Text
                          style={[
                            localStyles.scheduleStateText,
                            { color: hasSchedule ? "#16A34A" : "#D97706" },
                          ]}
                        >
                          {hasSchedule ? "ĐÃ CÓ LỊCH" : "CHỜ LỊCH HỌC"}
                        </Text>
                      </View>
                    </View>

                    <Text style={localStyles.cardTitle}>{item.name}</Text>

                    <View style={localStyles.classMetaRow}>
                      <View style={localStyles.classMetaItem}>
                        <Icon name="people" size={13} color={tokens.color.muted} />
                        <Text style={localStyles.classMetaText}>
                          {item.maxMembers ? `Tối đa ${item.maxMembers} thành viên` : "Lớp tiêu chuẩn"}
                        </Text>
                      </View>
                      <Text style={localStyles.classMetaDot}>•</Text>
                      <View style={localStyles.classMetaItem}>
                        <Icon name="calendar" size={13} color={tokens.color.muted} />
                        <Text style={localStyles.classMetaText}>Học trực tuyến</Text>
                      </View>
                    </View>

                    <View style={localStyles.classCardFooter}>
                      <Text style={localStyles.classActionHelper}>Nhấn để xem lịch & tài liệu</Text>
                      <View style={localStyles.enterClassPill}>
                        <Text style={localStyles.enterClassText}>Vào lớp</Text>
                        <Icon name="chevronRight" size={13} color="#FFFFFF" />
                      </View>
                    </View>
                  </ScalePressable>
                );
              })
            )}
          </View>
        )}

        {/* Tab Content: Schedule */}
        {!loading && !error && activeTab === "schedule" && (
          <View style={localStyles.list}>
            {/* View Mode Switcher: Ngày / Tuần / Tháng */}
            <View style={localStyles.viewModeSwitch}>
              {(
                [
                  { id: "day", label: "Theo Ngày" },
                  { id: "week", label: "Theo Tuần" },
                  { id: "month", label: "Theo Tháng" },
                ] as const
              ).map((mode) => (
                <ScalePressable
                  key={mode.id}
                  style={[
                    localStyles.viewModeBtn,
                    scheduleViewMode === mode.id && localStyles.viewModeBtnActive,
                  ]}
                  onPress={() => setScheduleViewMode(mode.id)}
                >
                  <Text
                    style={[
                      localStyles.viewModeBtnText,
                      scheduleViewMode === mode.id && localStyles.viewModeBtnTextActive,
                    ]}
                  >
                    {mode.label}
                  </Text>
                </ScalePressable>
              ))}
            </View>

            {scheduleList.length === 0 ? (
              <EmptyState
                icon="calendar"
                title="Không có lịch học nào"
                description="Lịch học của các lớp bạn tham gia trong 30 ngày tới sẽ tự động hiển thị tại đây khi giảng viên công bố."
              />
            ) : scheduleViewMode === "day" ? (
              <View>
                {/* 7-day horizontal strip */}
                <View style={localStyles.dayStrip}>
                  {currentWeekDays.map((d) => (
                    <ScalePressable
                      key={d.dateStr}
                      style={[
                        localStyles.dayStripItem,
                        selectedDateStr === d.dateStr && localStyles.dayStripItemActive,
                      ]}
                      onPress={() => setSelectedDateStr(d.dateStr)}
                    >
                      <Text
                        style={[
                          localStyles.dayStripName,
                          selectedDateStr === d.dateStr && localStyles.dayStripTextActive,
                        ]}
                      >
                        {d.dayName}
                      </Text>
                      <Text
                        style={[
                          localStyles.dayStripNum,
                          selectedDateStr === d.dateStr && localStyles.dayStripTextActive,
                        ]}
                      >
                        {d.dayNum}
                      </Text>
                      {d.hasSessions && (
                        <View
                          style={[
                            localStyles.dayStripDot,
                            selectedDateStr === d.dateStr && { backgroundColor: "#FFFFFF" },
                          ]}
                        />
                      )}
                    </ScalePressable>
                  ))}
                </View>

                {/* Day Agenda Header */}
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 10,
                  }}
                >
                  <Text style={{ fontSize: 14, fontWeight: "700", color: tokens.color.ink }}>
                    Lịch học ngày {selectedDateStr.slice(8, 10)}/{selectedDateStr.slice(5, 7)}/
                    {selectedDateStr.slice(0, 4)}
                  </Text>
                  <Badge
                    label={`${daySessions.length} buổi học`}
                    variant={daySessions.length > 0 ? "success" : "neutral"}
                  />
                </View>

                {/* Day Sessions List */}
                {daySessions.length === 0 ? (
                  <View style={localStyles.emptyDayBox}>
                    <Icon name="calendar" size={32} color={tokens.color.muted} />
                    <Text style={{ fontSize: 14, fontWeight: "700", color: tokens.color.ink }}>
                      Không có tiết học nào trong ngày này
                    </Text>
                    <Text style={[styles.small, { textAlign: "center", maxWidth: 260 }]}>
                      Bạn có thể chọn ngày khác trên dải lịch hoặc chuyển sang chế độ xem Tuần.
                    </Text>
                  </View>
                ) : (
                  daySessions.map((sess) => {
                    const start = parseTimestamp(sess.startAt);
                    const end = parseTimestamp(sess.endAt);
                    const timeStr = formatTimeRange(start, end, sess.timezone);
                    const isOnline = sess.mode === "ONLINE";

                    return (
                      <Pressable
                        key={sess.sessionId}
                        accessibilityRole="button"
                        accessibilityLabel={`Xem buổi học ${sess.title}`}
                        style={[localStyles.sessionCard, isOnline && localStyles.sessionCardOnline]}
                        onPress={() => router.push(`/classes/${sess.classId}/sessions/${sess.sessionId}`)}
                      >
                        <View
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <Badge
                            label={isOnline ? "TRỰC TUYẾN • LIVE" : "TRỰC TIẾP"}
                            variant={isOnline ? "success" : "neutral"}
                          />
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                            <Icon name="clock" size={12} color={tokens.color.muted} />
                            <Text style={localStyles.sessionTime}>{timeStr}</Text>
                          </View>
                        </View>

                        <Text style={localStyles.sessionTitle}>{sess.title}</Text>
                        <Text style={localStyles.sessionClassName}>Lớp: {sess.className}</Text>

                        <View
                          style={{
                            flexDirection: "row",
                            justifyContent: "flex-end",
                            alignItems: "center",
                            gap: 4,
                            marginTop: 4,
                          }}
                        >
                          <Text style={{ fontSize: 13, fontWeight: "700", color: tokens.color.brand }}>
                            Vào chi tiết
                          </Text>
                          <Icon name="chevronRight" size={14} color={tokens.color.brand} />
                        </View>
                      </Pressable>
                    );
                  })
                )}
              </View>
            ) : scheduleViewMode === "month" ? (
              <View>
                {/* Month Summary Overview */}
                <View style={localStyles.monthOverviewCard}>
                  <View style={localStyles.monthOverviewItem}>
                    <Text style={localStyles.monthOverviewNum}>{scheduleList.length}</Text>
                    <Text style={localStyles.monthOverviewLabel}>Tổng số buổi</Text>
                  </View>
                  <View style={localStyles.monthOverviewItem}>
                    <Text style={[localStyles.monthOverviewNum, { color: "#059669" }]}>
                      {scheduleList.filter((s) => s.mode === "ONLINE").length}
                    </Text>
                    <Text style={localStyles.monthOverviewLabel}>Live Online</Text>
                  </View>
                  <View style={localStyles.monthOverviewItem}>
                    <Text style={[localStyles.monthOverviewNum, { color: "#D97706" }]}>
                      {scheduleList.filter((s) => s.mode !== "ONLINE").length}
                    </Text>
                    <Text style={localStyles.monthOverviewLabel}>Trực tiếp</Text>
                  </View>
                </View>

                {/* All Month Sessions Grouped */}
                {Array.from(groupedSchedule.entries()).map(([dateKey, sessions]) => {
                  const sampleDate = parseTimestamp(sessions[0].startAt);
                  const formattedDay = formatDate(sampleDate, sessions[0].timezone);
                  return (
                    <View key={dateKey} style={localStyles.daySection}>
                      <View style={localStyles.dayHeader}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Icon name="calendar" size={15} color={tokens.color.brand} />
                          <Text style={localStyles.dayTitle}>{formattedDay}</Text>
                        </View>
                        <Badge label={`${sessions.length} buổi`} variant="neutral" />
                      </View>

                      {sessions.map((sess) => {
                        const start = parseTimestamp(sess.startAt);
                        const end = parseTimestamp(sess.endAt);
                        const timeStr = formatTimeRange(start, end, sess.timezone);
                        const isOnline = sess.mode === "ONLINE";

                        return (
                          <Pressable
                            key={sess.sessionId}
                            accessibilityRole="button"
                            accessibilityLabel={`Xem buổi học ${sess.title}`}
                            style={[localStyles.sessionCard, isOnline && localStyles.sessionCardOnline]}
                            onPress={() => router.push(`/classes/${sess.classId}/sessions/${sess.sessionId}`)}
                          >
                            <View
                              style={{
                                flexDirection: "row",
                                justifyContent: "space-between",
                                alignItems: "center",
                              }}
                            >
                              <Badge
                                label={isOnline ? "TRỰC TUYẾN • LIVE" : "TRỰC TIẾP"}
                                variant={isOnline ? "success" : "neutral"}
                              />
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                                <Icon name="clock" size={12} color={tokens.color.muted} />
                                <Text style={localStyles.sessionTime}>{timeStr}</Text>
                              </View>
                            </View>

                            <Text style={localStyles.sessionTitle}>{sess.title}</Text>
                            <Text style={localStyles.sessionClassName}>Lớp: {sess.className}</Text>

                            <View
                              style={{
                                flexDirection: "row",
                                justifyContent: "flex-end",
                                alignItems: "center",
                                gap: 4,
                                marginTop: 4,
                              }}
                            >
                              <Text style={{ fontSize: 13, fontWeight: "700", color: tokens.color.brand }}>
                                Vào chi tiết
                              </Text>
                              <Icon name="chevronRight" size={14} color={tokens.color.brand} />
                            </View>
                          </Pressable>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            ) : (
              /* Week View */
              Array.from(groupedSchedule.entries()).map(([dateKey, sessions]) => {
                const sampleDate = parseTimestamp(sessions[0].startAt);
                const formattedDay = formatDate(sampleDate, sessions[0].timezone);
                return (
                  <View key={dateKey} style={localStyles.daySection}>
                    <View style={localStyles.dayHeader}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Icon name="calendar" size={15} color={tokens.color.brand} />
                        <Text style={localStyles.dayTitle}>{formattedDay}</Text>
                      </View>
                      <Badge label={`${sessions.length} buổi`} variant="neutral" />
                    </View>

                    {sessions.map((sess) => {
                      const start = parseTimestamp(sess.startAt);
                      const end = parseTimestamp(sess.endAt);
                      const timeStr = formatTimeRange(start, end, sess.timezone);
                      const isOnline = sess.mode === "ONLINE";

                      return (
                        <Pressable
                          key={sess.sessionId}
                          accessibilityRole="button"
                          accessibilityLabel={`Xem buổi học ${sess.title}`}
                          style={[localStyles.sessionCard, isOnline && localStyles.sessionCardOnline]}
                          onPress={() => router.push(`/classes/${sess.classId}/sessions/${sess.sessionId}`)}
                        >
                          <View
                            style={{
                              flexDirection: "row",
                              justifyContent: "space-between",
                              alignItems: "center",
                            }}
                          >
                            <Badge
                              label={isOnline ? "TRỰC TUYẾN • LIVE" : "TRỰC TIẾP"}
                              variant={isOnline ? "success" : "neutral"}
                            />
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                              <Icon name="clock" size={12} color={tokens.color.muted} />
                              <Text style={localStyles.sessionTime}>{timeStr}</Text>
                            </View>
                          </View>

                          <Text style={localStyles.sessionTitle}>{sess.title}</Text>
                          <Text style={localStyles.sessionClassName}>Lớp: {sess.className}</Text>

                          <View
                            style={{
                              flexDirection: "row",
                              justifyContent: "flex-end",
                              alignItems: "center",
                              gap: 4,
                              marginTop: 4,
                            }}
                          >
                            <Text style={{ fontSize: 13, fontWeight: "700", color: tokens.color.brand }}>
                              Vào chi tiết
                            </Text>
                            <Icon name="chevronRight" size={14} color={tokens.color.brand} />
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* Tab Content: Attendance */}
        {!loading && !error && activeTab === "attendance" && (
          <View style={localStyles.list}>
            {/* KPI Statistics Overview */}
            <View style={localStyles.kpiGrid}>
              <View style={[localStyles.kpiCard, { borderColor: "#A7F3D0", backgroundColor: "#ECFDF5" }]}>
                <Text style={[localStyles.kpiNumber, { color: "#059669" }]}>{presentCount}</Text>
                <Text style={localStyles.kpiLabel}>Có mặt</Text>
              </View>
              <View style={[localStyles.kpiCard, { borderColor: "#FDE68A", backgroundColor: "#FFFBEB" }]}>
                <Text style={[localStyles.kpiNumber, { color: "#D97706" }]}>{excusedCount}</Text>
                <Text style={localStyles.kpiLabel}>Có phép</Text>
              </View>
              <View style={[localStyles.kpiCard, { borderColor: "#FECACA", backgroundColor: "#FEF2F2" }]}>
                <Text style={[localStyles.kpiNumber, { color: "#DC2626" }]}>{absentCount}</Text>
                <Text style={localStyles.kpiLabel}>Vắng</Text>
              </View>
              <View style={[localStyles.kpiCard, { borderColor: "#BAE6FD", backgroundColor: "#F0F9FF" }]}>
                <Text style={[localStyles.kpiNumber, { color: "#0284C7" }]}>{presentRate}%</Text>
                <Text style={localStyles.kpiLabel}>Chuyên cần</Text>
              </View>
            </View>

            {/* Month Selector Bar */}
            <View style={localStyles.monthBar}>
              <ScalePressable
                accessibilityRole="button"
                accessibilityLabel="Tháng trước"
                style={localStyles.monthBtn}
                onPress={() => handleAttendanceMonthShift(-1)}
              >
                <Icon name="chevronLeft" size={14} color="#FFF" />
                <Text style={localStyles.monthBtnText}>Trước</Text>
              </ScalePressable>
              <View style={localStyles.monthBadge}>
                <Icon name="calendar" size={14} color={tokens.color.brand} />
                <Text style={localStyles.monthLabel}>{formatDisplayMonth(attendanceMonth)}</Text>
              </View>
              <ScalePressable
                accessibilityRole="button"
                accessibilityLabel="Tháng sau"
                style={localStyles.monthBtn}
                onPress={() => handleAttendanceMonthShift(1)}
              >
                <Text style={localStyles.monthBtnText}>Sau</Text>
                <Icon name="chevronRight" size={14} color="#FFF" />
              </ScalePressable>
            </View>

            {/* Attendance Session Cards */}
            {attendanceList.length === 0 ? (
              <EmptyState
                icon="check"
                title="Không có lịch điểm danh"
                description={`Bạn không có buổi học nào ghi nhận điểm danh trong ${formatDisplayMonth(attendanceMonth)}.`}
              />
            ) : (
              attendanceList.map((item, index) => {
                const isPresent = item.attendanceStatus === "PRESENT";
                const isAbsent = item.attendanceStatus === "ABSENT";
                const isExcused = item.attendanceStatus === "EXCUSED";

                const badgeVariant = isPresent
                  ? "success"
                  : isAbsent
                    ? "danger"
                    : isExcused
                      ? "warning"
                      : "neutral";
                const badgeLabel = isPresent
                  ? "CÓ MẶT"
                  : isAbsent
                    ? "VẮNG MẶT"
                    : isExcused
                      ? "CÓ PHÉP"
                      : "CHƯA GHI NHẬN";

                return (
                  <FadeSlideIn key={item.sessionId} delay={Math.min(index * 30, 200)} fromY={8}>
                    <ScalePressable
                      style={localStyles.sessionCard}
                      onPress={() =>
                        router.push(`/classes/${item.classId}/sessions/${item.sessionId}` as Href)
                      }
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <Badge label={badgeLabel} variant={badgeVariant} icon="check" />
                        <Text style={styles.small}>{formatDate(parseTimestamp(item.startAt))}</Text>
                      </View>
                      <Text style={[styles.title, { fontSize: 16, marginTop: 6 }]}>{item.title}</Text>
                      {item.connectedDurationSeconds > 0 && (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
                          <Icon name="clock" size={12} color={tokens.color.muted} />
                          <Text style={styles.small}>
                            Đã tham gia: {Math.round(item.connectedDurationSeconds / 60)} phút
                          </Text>
                        </View>
                      )}
                      <View
                        style={{
                          flexDirection: "row",
                          justifyContent: "flex-end",
                          alignItems: "center",
                          gap: 4,
                          marginTop: 8,
                        }}
                      >
                        <Text style={{ fontSize: 13, fontWeight: "700", color: tokens.color.brand }}>
                          Chi tiết buổi học
                        </Text>
                        <Icon name="chevronRight" size={14} color={tokens.color.brand} />
                      </View>
                    </ScalePressable>
                  </FadeSlideIn>
                );
              })
            )}
          </View>
        )}
      </ScrollView>

      {/* Bottom Navigation Dock */}
      <BottomNavBar
        currentRoute={activeTab === "attendance" ? "attendance" : "classes"}
        role={snapshot.user?.role}
        onNavigate={(path) => router.push(path as Href)}
      />
    </View>
  );
}

const localStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.color.canvas,
  },
  contentContainer: {
    padding: 24,
    paddingBottom: 48,
  },
  tabContainer: {
    flexDirection: "row",
    backgroundColor: "rgba(255, 255, 255, 0.78)",
    borderRadius: 16,
    padding: 5,
    marginVertical: 16,
    gap: 6,
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.9)",
    shadowColor: "#0A7E85",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    minHeight: 44,
  },
  tabButtonActive: {
    backgroundColor: "#FFFFFF",
    elevation: 3,
    shadowColor: "#0A7E85",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(10, 126, 133, 0.2)",
  },
  tabText: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.color.muted,
    textAlign: "center",
  },
  tabTextActive: {
    color: tokens.color.brand,
    fontWeight: "700",
  },
  center: {
    paddingVertical: 32,
    alignItems: "center",
  },
  list: {
    marginTop: 8,
  },
  kpiGrid: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  kpiCard: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  kpiNumber: {
    fontSize: 18,
    fontWeight: "800",
  },
  kpiLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: tokens.color.muted,
    marginTop: 2,
  },
  monthBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: tokens.color.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: tokens.color.border,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 16,
    ...tokens.shadow.subtle,
  },
  monthBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 7,
    paddingHorizontal: 12,
    backgroundColor: tokens.color.brand,
    borderRadius: 10,
    minWidth: 72,
  },
  monthBtnText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "700",
  },
  monthBadge: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 4,
  },
  monthLabel: {
    fontSize: 14,
    fontWeight: "800",
    color: tokens.color.ink,
  },
  errorCard: {
    backgroundColor: "#fff1f2",
    borderRadius: 8,
    padding: 16,
    marginVertical: 12,
  },
  emptyContainer: {
    backgroundColor: tokens.color.surface,
    borderRadius: 8,
    padding: 24,
    borderWidth: 1,
    borderColor: tokens.color.border,
    alignItems: "center",
    marginVertical: 16,
  },
  card: {
    backgroundColor: tokens.color.surface,
    borderRadius: 10,
    padding: 18,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginBottom: 14,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  badge: {
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: tokens.color.ink,
  },
  badgePublished: {
    backgroundColor: "#e0f2fe",
  },
  badgeTextPublished: {
    color: "#0369a1",
  },
  badgeOnline: {
    backgroundColor: "#e0f2fe",
  },
  badgeTextOnline: {
    color: "#0369a1",
  },
  badgeOffline: {
    backgroundColor: "#fef3c7",
  },
  badgeTextOffline: {
    color: "#b45309",
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: tokens.color.ink,
    marginBottom: 6,
  },
  cardMeta: {
    fontSize: 13,
    color: tokens.color.muted,
    marginBottom: 10,
  },
  cardActionRow: {
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
    paddingTop: 8,
  },
  actionLink: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.color.brand,
  },
  daySection: {
    marginBottom: 20,
  },
  dayHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: tokens.color.border,
    marginBottom: 10,
  },
  dayTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  dayCount: {
    fontSize: 12,
    fontWeight: "600",
    color: tokens.color.muted,
  },
  sessionCard: {
    backgroundColor: tokens.color.surface,
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginBottom: 10,
  },
  sessionTime: {
    fontSize: 12,
    fontWeight: "600",
    color: tokens.color.muted,
  },
  sessionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: tokens.color.ink,
    marginTop: 4,
    marginBottom: 4,
  },
  sessionClassName: {
    fontSize: 13,
    color: tokens.color.muted,
    marginBottom: 8,
  },
  classCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginBottom: 14,
    gap: 10,
    ...tokens.shadow.subtle,
  },
  classCardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  classKindBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  kindBadgeLive: {
    backgroundColor: "rgba(13, 148, 136, 0.1)",
  },
  kindBadgePrivate: {
    backgroundColor: "rgba(124, 58, 237, 0.1)",
  },
  kindBadgeStandard: {
    backgroundColor: "rgba(37, 99, 235, 0.1)",
  },
  classKindText: {
    fontSize: 11.5,
    fontWeight: "700",
  },
  scheduleStateBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  scheduleBadgeActive: {
    backgroundColor: "#DCFCE7",
  },
  scheduleBadgePending: {
    backgroundColor: "#FEF3C7",
  },
  scheduleStateText: {
    fontSize: 10.5,
    fontWeight: "800",
  },
  classMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  classMetaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  classMetaText: {
    fontSize: 12,
    color: tokens.color.muted,
  },
  classMetaDot: {
    fontSize: 10,
    color: tokens.color.borderStrong,
  },
  classCardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
    paddingTop: 10,
    marginTop: 2,
  },
  classActionHelper: {
    fontSize: 11.5,
    color: tokens.color.muted,
  },
  enterClassPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: tokens.color.brand,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  enterClassText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  sessionCardOnline: {
    borderColor: tokens.color.brandLight,
    borderLeftWidth: 4,
    borderLeftColor: tokens.color.brand,
  },
  viewModeSwitch: {
    flexDirection: "row",
    backgroundColor: "#F1F5F9",
    borderRadius: 12,
    padding: 3,
    marginBottom: 14,
  },
  viewModeBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 9,
    alignItems: "center",
  },
  viewModeBtnActive: {
    backgroundColor: "#FFFFFF",
    elevation: 2,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  viewModeBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
  },
  viewModeBtnTextActive: {
    color: "#0284C7",
    fontWeight: "800",
  },
  dayStrip: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 6,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  dayStripItem: {
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderRadius: 10,
    minWidth: 42,
  },
  dayStripItemActive: {
    backgroundColor: "#0284C7",
  },
  dayStripName: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748B",
    marginBottom: 2,
  },
  dayStripNum: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
  },
  dayStripTextActive: {
    color: "#FFFFFF",
  },
  dayStripDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#0284C7",
    marginTop: 4,
  },
  emptyDayBox: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 28,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 8,
    marginVertical: 8,
  },
  monthOverviewCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 14,
    flexDirection: "row",
    justifyContent: "space-around",
  },
  monthOverviewItem: {
    alignItems: "center",
    gap: 4,
  },
  monthOverviewNum: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0284C7",
  },
  monthOverviewLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748B",
  },
});
