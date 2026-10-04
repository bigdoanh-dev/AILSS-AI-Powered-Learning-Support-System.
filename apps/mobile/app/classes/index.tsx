import { useLanguage, useUiText } from "../../src/use-language";
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
import { loadAssignedQuizzes, type AssignedQuiz } from "../../src/assigned-quizzes";
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

function formatDeadline(isoDate?: string) {
  if (!isoDate) return "Không có hạn nộp";
  try {
    const d = new Date(isoDate);
    const now = new Date();
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const isTomorrow =
      d.getDate() === tomorrow.getDate() &&
      d.getMonth() === tomorrow.getMonth() &&
      d.getFullYear() === tomorrow.getFullYear();
    const timeStr = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    if (isToday) return `Hôm nay, ${timeStr}`;
    if (isTomorrow) return `Ngày mai, ${timeStr}`;
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  } catch {
    return isoDate;
  }
}

function formatDueLabel(isoDate?: string) {
  if (!isoDate) return "sắp tới";
  try {
    const d = new Date(isoDate);
    const now = new Date();
    if (
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear()
    ) {
      return "hôm nay";
    }
    return "sắp tới";
  } catch {
    return "sắp tới";
  }
}

function getClassVisualTheme(title: string) {
  if (/dữ liệu|database|sql|cassandra/i.test(title)) {
    return {
      gradientBg: "#0C4A6E",
      accent: "#38BDF8",
      subAccent: "#0284C7",
      icon: "database" as const,
      category: "Cơ sở dữ liệu",
    };
  }
  if (/trí tuệ|\bai\b|máy học|llm|copilot/i.test(title)) {
    return {
      gradientBg: "#2E1065",
      accent: "#C084FC",
      subAccent: "#7C3AED",
      icon: "sparkles" as const,
      category: "Trí tuệ nhân tạo",
    };
  }
  if (/web|react|frontend|javascript|typescript|lập trình/i.test(title)) {
    return {
      gradientBg: "#0F172A",
      accent: "#60A5FA",
      subAccent: "#2563EB",
      icon: "academic" as const,
      category: "Lập trình Web & AI",
    };
  }
  return {
    gradientBg: "#064E3B",
    accent: "#34D399",
    subAccent: "#059669",
    icon: "book" as const,
    category: "Lớp học chính khoá",
  };
}

export default function StudentClassesScreen() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
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
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [classQuizzes, setClassQuizzes] = useState<AssignedQuiz[]>([]);
  const [quizzesLoading, setQuizzesLoading] = useState(false);
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
      setShowJoinForm(false);
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
        setQuizzesLoading(true);
        const data = await session.request("/api/v1/me/classes");
        const parsedClasses = studentClasses(data);
        setClassesList(parsedClasses);

        // Fetch assigned quizzes for these classes
        try {
          const controller = new AbortController();
          const allAssigned = await loadAssignedQuizzes(
            (path, opts) => session.request(path, opts),
            controller.signal,
          );
          const classOnlyQuizzes = allAssigned.filter((q) => q.targetType === "CLASS");
          setClassQuizzes(classOnlyQuizzes);
        } catch {
          // Non-critical if quizzes fail to load
        } finally {
          setQuizzesLoading(false);
        }
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
            <Text style={styles.title}>{uiText("Lớp học & Lịch học")}</Text>
            <Text style={[styles.text, { textAlign: "center", maxWidth: 300 }]}>
              {uiText("Vui lòng đăng nhập tài khoản học viên để xem danh sách lớp và lịch học của bạn.")}
            </Text>
            <Button label={uiText("Đăng nhập ngay")} size="lg" onPress={() => router.push("/login")} />
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
              ? uiText("Điểm danh học tập")
              : activeTab === "schedule"
                ? uiText("Lịch học của bạn")
                : uiText("Lớp học của bạn")
          }
          subtitle={
            activeTab === "attendance"
              ? uiText("Theo dõi chuyên cần và lịch sử điểm danh")
              : uiText("Theo dõi thời khóa biểu và tham gia các buổi học trực tuyến")
          }
          onBack={() => {
            if (router.canGoBack()) router.back();
            else router.push("/");
          }}
          rightElement={
            activeTab === "attendance" ? (
              <Badge
                label={
                  presentRate >= 80
                    ? uiText("{0}% ĐẠT", [presentRate])
                    : uiText("{0}% CẦN CỐ GẮNG", [presentRate])
                }
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
                {uiText("Lớp học (")}
                {classesList.length})
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
                {uiText("Lịch học (")}
                {scheduleList.length})
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
                {uiText("Điểm danh (")}
                {attendanceList.length})
              </Text>
            </View>
          </ScalePressable>
        </View>

        {/* Loading state */}
        {loading && !refreshing && (
          <View style={localStyles.center}>
            <ActivityIndicator size="large" color={tokens.color.brand} />
            <Text style={[styles.small, { marginTop: 8 }]}>{uiText("Đang tải dữ liệu…")}</Text>
          </View>
        )}

        {/* Error state */}
        {error && !loading && (
          <View style={[styles.card, { borderColor: tokens.color.dangerLight, backgroundColor: "#FEF2F2" }]}>
            <Text accessibilityRole="alert" style={styles.error}>
              {uiText(error)}
            </Text>
            <Button label={uiText("Thử lại")} size="sm" onPress={() => void fetchData()} />
          </View>
        )}

        {/* Tab Content: Classes */}
        {!loading && !error && activeTab === "classes" && (
          <View style={localStyles.list}>
            {/* 1. Sắp đến hạn / Việc cần phải làm - CHỈ BÀI TẬP THUỘC LỚP HỌC */}
            <View style={localStyles.todoCard}>
              <View style={localStyles.todoHeader}>
                <View style={localStyles.todoHeaderLeft}>
                  <View style={localStyles.todoIconWrap}>
                    <Icon name="quiz" size={20} color="#0284C7" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={localStyles.todoTitle}>{uiText("Sắp đến hạn")}</Text>
                    <Text style={localStyles.todoSubtitle}>
                      {uiText("Việc cần làm và bài tập được giao trong các lớp học bạn đang tham gia.")}
                    </Text>
                  </View>
                </View>
                <ScalePressable
                  accessibilityRole="button"
                  accessibilityLabel={uiText("Xem tất cả việc cần làm")}
                  style={localStyles.todoViewAllBtn}
                  onPress={() => router.push("/assessments")}
                >
                  <Text style={localStyles.todoViewAllText}>{uiText("Xem tất cả")}</Text>
                  <Icon name="chevronRight" size={12} color="#0284C7" />
                </ScalePressable>
              </View>

              {quizzesLoading ? (
                <View style={localStyles.todoLoadingRow}>
                  <ActivityIndicator size="small" color="#0284C7" />
                  <Text style={localStyles.todoLoadingText}>{uiText("Đang kiểm tra bài tập lớp học…")}</Text>
                </View>
              ) : classQuizzes.length > 0 ? (
                <View style={localStyles.todoList}>
                  {classQuizzes.slice(0, 4).map((quiz) => {
                    const deadlineText = formatDeadline(quiz.closesAt);
                    const isUrgent =
                      Boolean(quiz.closesAt) &&
                      new Date(quiz.closesAt!).getTime() - Date.now() < 24 * 3600 * 1000 &&
                      new Date(quiz.closesAt!).getTime() > Date.now();

                    return (
                      <ScalePressable
                        key={quiz.quizId}
                        style={[localStyles.todoItem, isUrgent && localStyles.todoItemUrgent]}
                        onPress={() => router.push(`/assessments/${quiz.quizId}` as Href)}
                      >
                        <View style={localStyles.todoItemMain}>
                          <View
                            style={[
                              localStyles.todoDocIcon,
                              isUrgent ? { backgroundColor: "#FEE2E2" } : { backgroundColor: "#EFF6FF" },
                            ]}
                          >
                            <Icon name="quiz" size={16} color={isUrgent ? "#DC2626" : "#2563EB"} />
                          </View>
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text numberOfLines={1} style={localStyles.todoQuizTitle}>
                              {quiz.title}
                            </Text>
                            <View style={localStyles.todoMetaRow}>
                              <Text style={localStyles.todoMetaLabel}>{uiText("Lớp:")}</Text>
                              <Text numberOfLines={1} style={localStyles.todoMetaClass}>
                                {quiz.targetName || "Lớp học trực tuyến"}
                              </Text>
                              {quiz.questionCount ? (
                                <>
                                  <Text style={localStyles.todoMetaDot}>•</Text>
                                  <Text style={localStyles.todoMetaCount}>
                                    {quiz.questionCount} {uiText(" câu")}
                                  </Text>
                                </>
                              ) : null}
                            </View>
                          </View>
                        </View>

                        <View style={localStyles.todoItemRight}>
                          <View style={{ alignItems: "flex-end" }}>
                            <Text style={localStyles.todoDueCaption}>{uiText("Hạn nộp")}</Text>
                            <Text
                              style={[localStyles.todoDueDate, isUrgent && localStyles.todoDueDateUrgent]}
                            >
                              {deadlineText}
                            </Text>
                          </View>
                          <View style={localStyles.todoActionBtn}>
                            <Text style={localStyles.todoActionBtnText}>{uiText("Làm bài")}</Text>
                            <Icon name="chevronRight" size={11} color="#0284C7" />
                          </View>
                        </View>
                      </ScalePressable>
                    );
                  })}
                </View>
              ) : (
                <View style={localStyles.todoEmptyBox}>
                  <View style={localStyles.todoEmptyIconWrap}>
                    <Icon name="checkCircle" size={22} color="#10B981" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={localStyles.todoEmptyTitle}>{uiText("Không có bài tập nào cần nộp")}</Text>
                    <Text style={localStyles.todoEmptySub}>
                      {uiText(
                        "Hiện không có bài kiểm tra hoặc bài tập nào sắp đến hạn trong các lớp học của bạn.",
                      )}
                    </Text>
                  </View>
                </View>
              )}
            </View>

            {/* 2. Danh sách lớp header with "+ Thêm lớp học" toggle button */}
            <View style={localStyles.classesSectionHeader}>
              <View>
                <Text style={localStyles.classesSectionEyebrow}>{uiText("DANH SÁCH LỚP")}</Text>
                <Text style={localStyles.classesSectionTitle}>{uiText("Lớp học của tôi")}</Text>
              </View>
              <ScalePressable
                accessibilityRole="button"
                accessibilityLabel={showJoinForm ? uiText("Ẩn khung tham gia") : uiText("Thêm lớp học")}
                style={[localStyles.joinToggleBtn, showJoinForm && localStyles.joinToggleBtnActive]}
                onPress={() => setShowJoinForm((v) => !v)}
              >
                <Icon
                  name={showJoinForm ? "checkCircle" : "add"}
                  size={14}
                  color={showJoinForm ? "#0284C7" : "#FFFFFF"}
                />
                <Text
                  style={[localStyles.joinToggleBtnText, showJoinForm && localStyles.joinToggleBtnTextActive]}
                >
                  {showJoinForm ? uiText("Ẩn khung") : uiText("+ Thêm lớp")}
                </Text>
              </ScalePressable>
            </View>

            {/* 3. Khung Tham gia lớp bằng mã (collapsible or shown when no classes) */}
            {(showJoinForm || classesList.length === 0) && (
              <View style={localStyles.joinBoxCard}>
                <View style={localStyles.joinBoxHeader}>
                  <View style={localStyles.joinBoxIcon}>
                    <Icon name="class" size={18} color="#0284C7" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={localStyles.joinBoxTitle}>{uiText("Tham gia lớp học mới")}</Text>
                    <Text style={localStyles.joinBoxSub}>
                      {uiText(
                        "Nhập mã tham gia 6 ký tự do giảng viên cung cấp để tự động ghi danh vào lớp học.",
                      )}
                    </Text>
                  </View>
                </View>

                <View style={localStyles.joinInputRow}>
                  <TextInput
                    style={localStyles.joinTextInput}
                    value={joinCode}
                    onChangeText={setJoinCode}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    maxLength={32}
                    placeholder="VD: K26A2B"
                    placeholderTextColor="#94A3B8"
                    accessibilityLabel={uiText("Mã tham gia lớp")}
                  />
                  <ScalePressable
                    style={[localStyles.joinSubmitBtn, joinBusy && { opacity: 0.7 }]}
                    disabled={joinBusy}
                    onPress={() => void joinClass()}
                  >
                    {joinBusy ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <Text style={localStyles.joinSubmitBtnText}>{uiText("Vào lớp")}</Text>
                        <Icon name="chevronRight" size={12} color="#FFFFFF" />
                      </>
                    )}
                  </ScalePressable>
                </View>
                {joinMessage ? (
                  <Text
                    accessibilityRole="alert"
                    style={[
                      styles.small,
                      {
                        color: joinMessage.includes("Đã tham gia") ? "#16A34A" : tokens.color.danger,
                        marginTop: 4,
                      },
                    ]}
                  >
                    {joinMessage}
                  </Text>
                ) : null}
              </View>
            )}

            {/* 4. Danh sách Class Cards */}
            {classesList.length === 0 ? (
              <EmptyState
                icon="calendar"
                title={uiText("Chưa tham gia lớp học nào")}
                description={uiText(
                  "Đăng ký khóa học hoặc sử dụng mã tham gia do giảng viên cung cấp để vào lớp.",
                )}
                actionLabel="Khám phá khóa học"
                onAction={() => router.push("/courses")}
              />
            ) : (
              classesList.map((item) => {
                const isLive = item.classKind === "LIVE_COHORT";
                const isPrivate = item.classKind === "PRIVATE";
                const theme = getClassVisualTheme(item.name);
                const hasSchedule = item.scheduleState === "PUBLISHED";
                const classPendingQuizzes = classQuizzes.filter((q) => q.targetId === item.classId);
                const firstDueQuiz = classPendingQuizzes[0];

                return (
                  <View key={item.classId} style={localStyles.richClassCard}>
                    {/* Top Artwork Media Header */}
                    <View style={[localStyles.classArtworkBanner, { backgroundColor: theme.gradientBg }]}>
                      <View style={localStyles.artworkDecorCircle} />
                      <View style={localStyles.artworkDecorCircleSmall} />

                      <View style={localStyles.artworkContentRow}>
                        <View style={localStyles.artworkIconPill}>
                          <Icon name="class" size={13} color="#FFFFFF" />
                          <Text style={localStyles.artworkPillText}>{uiText("Lớp học")}</Text>
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
                            {hasSchedule ? uiText("ĐÃ CÓ LỊCH") : uiText("CHỜ LỊCH")}
                          </Text>
                        </View>
                      </View>

                      <View style={localStyles.artworkTitleOverlay}>
                        <View style={localStyles.artworkCategoryTag}>
                          <Text style={localStyles.artworkCategoryText}>{theme.category}</Text>
                        </View>
                        <Text numberOfLines={1} style={localStyles.artworkHeroTitle}>
                          {item.name}
                        </Text>
                      </View>
                    </View>

                    {/* Card Body */}
                    <View style={localStyles.classCardBody}>
                      <View style={localStyles.classHeadingRow}>
                        <Text style={localStyles.classCategoryChip}>{uiText("Lớp theo lịch")}</Text>
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
                            size={11}
                            color={isLive ? "#0D9488" : isPrivate ? "#7C3AED" : "#2563EB"}
                          />
                          <Text
                            style={[
                              localStyles.classKindText,
                              { color: isLive ? "#0D9488" : isPrivate ? "#7C3AED" : "#2563EB" },
                            ]}
                          >
                            {isLive ? uiText("LIVE") : isPrivate ? uiText("Kèm 1-1") : uiText("Trực tuyến")}
                          </Text>
                        </View>
                      </View>

                      <Text style={localStyles.richCardTitle}>{item.name}</Text>

                      {/* Meta Row: Lịch học trực tiếp • Có điểm danh • Sĩ số */}
                      <View style={localStyles.richClassMetaRow}>
                        <View style={localStyles.classMetaItem}>
                          <Icon name="calendar" size={13} color="#0284C7" />
                          <Text style={localStyles.classMetaText}>{uiText("Lịch học trực tiếp")}</Text>
                        </View>
                        <Text style={localStyles.classMetaDot}>•</Text>
                        <View style={localStyles.classMetaItem}>
                          <Icon name="attendance" size={13} color="#10B981" />
                          <Text style={localStyles.classMetaText}>{uiText("Có điểm danh")}</Text>
                        </View>
                        {item.maxMembers ? (
                          <>
                            <Text style={localStyles.classMetaDot}>•</Text>
                            <View style={localStyles.classMetaItem}>
                              <Icon name="people" size={13} color={tokens.color.muted} />
                              <Text style={localStyles.classMetaText}>
                                {uiText("Tối đa ")}
                                {item.maxMembers} {uiText(" bạn")}
                              </Text>
                            </View>
                          </>
                        ) : null}
                      </View>

                      {/* Due Assignment Snippet or Benefits Checklist */}
                      {firstDueQuiz ? (
                        <ScalePressable
                          style={localStyles.classDueSnippetBox}
                          onPress={() => router.push(`/assessments/${firstDueQuiz.quizId}` as Href)}
                        >
                          <View style={localStyles.dueSnippetHeader}>
                            <Icon name="alert" size={12} color="#DC2626" />
                            <Text style={localStyles.dueSnippetLabel}>
                              {uiText("Đến hạn ")}
                              {formatDueLabel(firstDueQuiz.closesAt)}
                            </Text>
                          </View>
                          <Text numberOfLines={1} style={localStyles.dueSnippetTitle}>
                            {firstDueQuiz.title}
                          </Text>
                        </ScalePressable>
                      ) : (
                        <View style={localStyles.classBenefitsBox}>
                          <View style={localStyles.benefitItem}>
                            <Icon name="check" size={12} color="#10B981" />
                            <Text style={localStyles.benefitText}>{uiText("Thảo luận cùng giảng viên")}</Text>
                          </View>
                          <View style={localStyles.benefitItem}>
                            <Icon name="check" size={12} color="#10B981" />
                            <Text style={localStyles.benefitText}>
                              {uiText("Bài tập & tài liệu lớp học")}
                            </Text>
                          </View>
                          <View style={localStyles.benefitItem}>
                            <Icon name="check" size={12} color="#10B981" />
                            <Text style={localStyles.benefitText}>
                              {uiText("Theo dõi chuyên cần & tiến độ")}
                            </Text>
                          </View>
                        </View>
                      )}

                      <View style={localStyles.classCardDivider} />

                      {/* Dual Action Buttons (Xem lịch & Vào lớp học) */}
                      <View style={localStyles.richClassCardActions}>
                        <ScalePressable
                          accessibilityRole="button"
                          accessibilityLabel={uiText("Xem lịch học")}
                          style={localStyles.classActionSecondaryBtn}
                          onPress={() => setActiveTab("schedule")}
                        >
                          <Icon name="calendar" size={14} color="#334155" />
                          <Text style={localStyles.classActionSecondaryText}>{uiText("Xem lịch")}</Text>
                        </ScalePressable>

                        <ScalePressable
                          accessibilityRole="button"
                          accessibilityLabel={uiText("Vào lớp học {0}", [item.name])}
                          style={localStyles.classActionPrimaryBtn}
                          onPress={() => router.push(`/classes/${item.classId}`)}
                        >
                          <Icon name="class" size={14} color="#FFFFFF" />
                          <Text style={localStyles.classActionPrimaryText}>{uiText("Vào lớp học")}</Text>
                          <Icon name="chevronRight" size={12} color="#FFFFFF" />
                        </ScalePressable>
                      </View>
                    </View>
                  </View>
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
                  { id: "day", label: uiText("Theo Ngày") },
                  { id: "week", label: uiText("Theo Tuần") },
                  { id: "month", label: uiText("Theo Tháng") },
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
                title={uiText("Không có lịch học nào")}
                description={uiText(
                  "Lịch học của các lớp bạn tham gia trong 30 ngày tới sẽ tự động hiển thị tại đây khi giảng viên công bố.",
                )}
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
                    {uiText("Lịch học ngày ")}
                    {selectedDateStr.slice(8, 10)}/{selectedDateStr.slice(5, 7)}/{selectedDateStr.slice(0, 4)}
                  </Text>
                  <Badge
                    label={uiText("{0} buổi học", [daySessions.length])}
                    variant={daySessions.length > 0 ? "success" : "neutral"}
                  />
                </View>

                {/* Day Sessions List */}
                {daySessions.length === 0 ? (
                  <View style={localStyles.emptyDayBox}>
                    <Icon name="calendar" size={32} color={tokens.color.muted} />
                    <Text style={{ fontSize: 14, fontWeight: "700", color: tokens.color.ink }}>
                      {uiText("Không có tiết học nào trong ngày này")}
                    </Text>
                    <Text style={[styles.small, { textAlign: "center", maxWidth: 260 }]}>
                      {uiText("Bạn có thể chọn ngày khác trên dải lịch hoặc chuyển sang chế độ xem Tuần.")}
                    </Text>
                  </View>
                ) : (
                  daySessions.map((sess) => {
                    const start = parseTimestamp(sess.startAt);
                    const end = parseTimestamp(sess.endAt);
                    const timeStr = formatTimeRange(start, end, sess.timezone, uiLocale);
                    const isOnline = sess.mode === "ONLINE";

                    return (
                      <Pressable
                        key={sess.sessionId}
                        accessibilityRole="button"
                        accessibilityLabel={uiText("Xem buổi học {0}", [sess.title])}
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
                            label={isOnline ? uiText("TRỰC TUYẾN • LIVE") : uiText("TRỰC TIẾP")}
                            variant={isOnline ? "success" : "neutral"}
                          />
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                            <Icon name="clock" size={12} color={tokens.color.muted} />
                            <Text style={localStyles.sessionTime}>{timeStr}</Text>
                          </View>
                        </View>

                        <Text style={localStyles.sessionTitle}>{sess.title}</Text>
                        <Text style={localStyles.sessionClassName}>
                          {uiText("Lớp: ")}
                          {sess.className}
                        </Text>

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
                            {uiText("Vào chi tiết")}
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
                    <Text style={localStyles.monthOverviewLabel}>{uiText("Tổng số buổi")}</Text>
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
                    <Text style={localStyles.monthOverviewLabel}>{uiText("Trực tiếp")}</Text>
                  </View>
                </View>

                {/* All Month Sessions Grouped */}
                {Array.from(groupedSchedule.entries()).map(([dateKey, sessions]) => {
                  const sampleDate = parseTimestamp(sessions[0].startAt);
                  const formattedDay = formatDate(sampleDate, sessions[0].timezone, uiLocale);
                  return (
                    <View key={dateKey} style={localStyles.daySection}>
                      <View style={localStyles.dayHeader}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                          <Icon name="calendar" size={15} color={tokens.color.brand} />
                          <Text style={localStyles.dayTitle}>{formattedDay}</Text>
                        </View>
                        <Badge label={uiText("{0} buổi", [sessions.length])} variant="neutral" />
                      </View>

                      {sessions.map((sess) => {
                        const start = parseTimestamp(sess.startAt);
                        const end = parseTimestamp(sess.endAt);
                        const timeStr = formatTimeRange(start, end, sess.timezone, uiLocale);
                        const isOnline = sess.mode === "ONLINE";

                        return (
                          <Pressable
                            key={sess.sessionId}
                            accessibilityRole="button"
                            accessibilityLabel={uiText("Xem buổi học {0}", [sess.title])}
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
                                label={isOnline ? uiText("TRỰC TUYẾN • LIVE") : uiText("TRỰC TIẾP")}
                                variant={isOnline ? "success" : "neutral"}
                              />
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                                <Icon name="clock" size={12} color={tokens.color.muted} />
                                <Text style={localStyles.sessionTime}>{timeStr}</Text>
                              </View>
                            </View>

                            <Text style={localStyles.sessionTitle}>{sess.title}</Text>
                            <Text style={localStyles.sessionClassName}>
                              {uiText("Lớp: ")}
                              {sess.className}
                            </Text>

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
                                {uiText("Vào chi tiết")}
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
                const formattedDay = formatDate(sampleDate, sessions[0].timezone, uiLocale);
                return (
                  <View key={dateKey} style={localStyles.daySection}>
                    <View style={localStyles.dayHeader}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Icon name="calendar" size={15} color={tokens.color.brand} />
                        <Text style={localStyles.dayTitle}>{formattedDay}</Text>
                      </View>
                      <Badge label={uiText("{0} buổi", [sessions.length])} variant="neutral" />
                    </View>

                    {sessions.map((sess) => {
                      const start = parseTimestamp(sess.startAt);
                      const end = parseTimestamp(sess.endAt);
                      const timeStr = formatTimeRange(start, end, sess.timezone, uiLocale);
                      const isOnline = sess.mode === "ONLINE";

                      return (
                        <Pressable
                          key={sess.sessionId}
                          accessibilityRole="button"
                          accessibilityLabel={uiText("Xem buổi học {0}", [sess.title])}
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
                              label={isOnline ? uiText("TRỰC TUYẾN • LIVE") : uiText("TRỰC TIẾP")}
                              variant={isOnline ? "success" : "neutral"}
                            />
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                              <Icon name="clock" size={12} color={tokens.color.muted} />
                              <Text style={localStyles.sessionTime}>{timeStr}</Text>
                            </View>
                          </View>

                          <Text style={localStyles.sessionTitle}>{sess.title}</Text>
                          <Text style={localStyles.sessionClassName}>
                            {uiText("Lớp: ")}
                            {sess.className}
                          </Text>

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
                              {uiText("Vào chi tiết")}
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
                <Text style={localStyles.kpiLabel}>{uiText("Có mặt")}</Text>
              </View>
              <View style={[localStyles.kpiCard, { borderColor: "#FDE68A", backgroundColor: "#FFFBEB" }]}>
                <Text style={[localStyles.kpiNumber, { color: "#D97706" }]}>{excusedCount}</Text>
                <Text style={localStyles.kpiLabel}>{uiText("Có phép")}</Text>
              </View>
              <View style={[localStyles.kpiCard, { borderColor: "#FECACA", backgroundColor: "#FEF2F2" }]}>
                <Text style={[localStyles.kpiNumber, { color: "#DC2626" }]}>{absentCount}</Text>
                <Text style={localStyles.kpiLabel}>{uiText("Vắng")}</Text>
              </View>
              <View style={[localStyles.kpiCard, { borderColor: "#BAE6FD", backgroundColor: "#F0F9FF" }]}>
                <Text style={[localStyles.kpiNumber, { color: "#0284C7" }]}>{presentRate}%</Text>
                <Text style={localStyles.kpiLabel}>{uiText("Chuyên cần")}</Text>
              </View>
            </View>

            {/* Month Selector Bar */}
            <View style={localStyles.monthBar}>
              <ScalePressable
                accessibilityRole="button"
                accessibilityLabel={uiText("Tháng trước")}
                style={localStyles.monthBtn}
                onPress={() => handleAttendanceMonthShift(-1)}
              >
                <Icon name="chevronLeft" size={14} color="#FFF" />
                <Text style={localStyles.monthBtnText}>{uiText("Trước")}</Text>
              </ScalePressable>
              <View style={localStyles.monthBadge}>
                <Icon name="calendar" size={14} color={tokens.color.brand} />
                <Text style={localStyles.monthLabel}>{formatDisplayMonth(attendanceMonth)}</Text>
              </View>
              <ScalePressable
                accessibilityRole="button"
                accessibilityLabel={uiText("Tháng sau")}
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
                title={uiText("Không có lịch điểm danh")}
                description={uiText("Bạn không có buổi học nào ghi nhận điểm danh trong {0}.", [
                  formatDisplayMonth(attendanceMonth),
                ])}
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
                        <Text style={styles.small}>
                          {formatDate(parseTimestamp(item.startAt), undefined, uiLocale)}
                        </Text>
                      </View>
                      <Text style={[styles.title, { fontSize: 16, marginTop: 6 }]}>{item.title}</Text>
                      {item.connectedDurationSeconds > 0 && (
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
                          <Icon name="clock" size={12} color={tokens.color.muted} />
                          <Text style={styles.small}>
                            {uiText("Đã tham gia: ")}
                            {Math.round(item.connectedDurationSeconds / 60)} {uiText(" phút")}
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
                          {uiText("Chi tiết buổi học")}
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
  // --- New Web-Aligned Classes Tab Styles ---
  todoCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 16,
    ...tokens.shadow.subtle,
  },
  todoHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  todoHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
    marginRight: 8,
  },
  todoIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#E0F2FE",
    alignItems: "center",
    justifyContent: "center",
  },
  todoTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: tokens.color.ink,
  },
  todoSubtitle: {
    fontSize: 11.5,
    color: tokens.color.muted,
    marginTop: 2,
  },
  todoViewAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: "#F0F9FF",
  },
  todoViewAllText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: "#0284C7",
  },
  todoLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    justifyContent: "center",
  },
  todoLoadingText: {
    fontSize: 12,
    color: tokens.color.muted,
  },
  todoList: {
    gap: 8,
  },
  todoItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 10,
    borderRadius: 12,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  todoItemUrgent: {
    backgroundColor: "#FFF5F5",
    borderColor: "#FECACA",
  },
  todoItemMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
    marginRight: 10,
  },
  todoDocIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  todoQuizTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  todoMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  todoMetaLabel: {
    fontSize: 11,
    color: tokens.color.muted,
  },
  todoMetaClass: {
    fontSize: 11,
    fontWeight: "600",
    color: "#0284C7",
    maxWidth: 120,
  },
  todoMetaDot: {
    fontSize: 10,
    color: tokens.color.borderStrong,
  },
  todoMetaCount: {
    fontSize: 11,
    color: tokens.color.muted,
  },
  todoItemRight: {
    alignItems: "flex-end",
    gap: 4,
  },
  todoDueCaption: {
    fontSize: 10,
    color: tokens.color.muted,
    textTransform: "uppercase",
  },
  todoDueDate: {
    fontSize: 11.5,
    fontWeight: "700",
    color: tokens.color.inkSecondary,
  },
  todoDueDateUrgent: {
    color: "#DC2626",
    fontWeight: "800",
  },
  todoActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: "#E0F2FE",
  },
  todoActionBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#0284C7",
  },
  todoEmptyBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#F0FDF4",
    borderWidth: 1,
    borderColor: "#DCFCE7",
  },
  todoEmptyIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: "#DCFCE7",
    alignItems: "center",
    justifyContent: "center",
  },
  todoEmptyTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#166534",
  },
  todoEmptySub: {
    fontSize: 11.5,
    color: "#15803D",
    marginTop: 2,
  },
  classesSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    marginTop: 4,
  },
  classesSectionEyebrow: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    color: "#64748B",
  },
  classesSectionTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: tokens.color.ink,
  },
  joinToggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: tokens.color.brand,
  },
  joinToggleBtnActive: {
    backgroundColor: "#F1F5F9",
  },
  joinToggleBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  joinToggleBtnTextActive: {
    color: "#0284C7",
  },
  joinBoxCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 16,
    ...tokens.shadow.subtle,
  },
  joinBoxHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 12,
  },
  joinBoxIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#E0F2FE",
    alignItems: "center",
    justifyContent: "center",
  },
  joinBoxTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: tokens.color.ink,
  },
  joinBoxSub: {
    fontSize: 11.5,
    color: tokens.color.muted,
    marginTop: 2,
  },
  joinInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  joinTextInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 13,
    fontWeight: "600",
    color: tokens.color.ink,
    backgroundColor: "#F8FAFC",
  },
  joinSubmitBtn: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 14,
    backgroundColor: tokens.color.brand,
    borderRadius: 10,
  },
  joinSubmitBtnText: {
    color: "#FFFFFF",
    fontSize: 12.5,
    fontWeight: "700",
  },
  richClassCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 16,
    ...tokens.shadow.card,
  },
  classArtworkBanner: {
    height: 110,
    padding: 12,
    justifyContent: "space-between",
    position: "relative",
    overflow: "hidden",
  },
  artworkDecorCircle: {
    position: "absolute",
    right: -20,
    top: -20,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  artworkDecorCircleSmall: {
    position: "absolute",
    right: 50,
    bottom: -30,
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
  },
  artworkContentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 2,
  },
  artworkIconPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  artworkPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  artworkTitleOverlay: {
    zIndex: 2,
    gap: 3,
  },
  artworkCategoryTag: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  artworkCategoryText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },
  artworkHeroTitle: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  classCardBody: {
    padding: 14,
    gap: 8,
  },
  classHeadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  classCategoryChip: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748B",
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 5,
  },
  richCardTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: tokens.color.ink,
    lineHeight: 22,
  },
  richClassMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginVertical: 2,
  },
  classDueSnippetBox: {
    backgroundColor: "#FEF2F2",
    borderRadius: 10,
    padding: 9,
    borderWidth: 1,
    borderColor: "#FEE2E2",
    gap: 2,
    marginVertical: 2,
  },
  dueSnippetHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  dueSnippetLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: "#DC2626",
    textTransform: "uppercase",
  },
  dueSnippetTitle: {
    fontSize: 12.5,
    fontWeight: "700",
    color: "#991B1B",
  },
  classBenefitsBox: {
    gap: 4,
    marginVertical: 2,
  },
  benefitItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  benefitText: {
    fontSize: 12,
    color: "#475569",
    fontWeight: "500",
  },
  classCardDivider: {
    height: 1,
    backgroundColor: "#F1F5F9",
    marginVertical: 4,
  },
  richClassCardActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  classActionSecondaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    height: 38,
    borderRadius: 10,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  classActionSecondaryText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: "#334155",
  },
  classActionPrimaryBtn: {
    flex: 1.3,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    height: 38,
    borderRadius: 10,
    backgroundColor: tokens.color.brand,
  },
  classActionPrimaryText: {
    fontSize: 12.5,
    fontWeight: "700",
    color: "#FFFFFF",
  },
});
