import { useState } from "react";
import { Text, View, StyleSheet, ScrollView } from "react-native";
import { router, type Href } from "expo-router";
import { Page, ScreenHeader, Icon, Badge, BottomNavBar, tokens } from "../../src/ui";
import { ScalePressable } from "../../src/motion";

export interface ScheduleSession {
  id: string;
  classId: string;
  className: string;
  courseCode: string;
  dayLabel: string;
  dayOfWeek: number;
  dateStr: string;
  timeRange: string;
  shift: "MORNING" | "AFTERNOON" | "EVENING";
  room: string;
  isOnline: boolean;
  topic: string;
  studentCount: number;
  attendedCount: number;
  status: "UPCOMING" | "IN_PROGRESS" | "COMPLETED";
}

const SCHEDULE_DATA: ScheduleSession[] = [
  {
    id: "sess-1",
    classId: "10000000-0000-4000-8000-000000000001",
    className: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa - Nhóm 01",
    courseCode: "CSDL-01",
    dayLabel: "Hôm nay (Thứ Năm)",
    dayOfWeek: 5,
    dateStr: "2026-09-17",
    timeRange: "07:30 - 09:30 (Tiết 1 - 3)",
    shift: "MORNING",
    room: "Phòng P.302 (Tòa H1)",
    isOnline: false,
    topic: "Chương 4: Chỉ mục B-Tree & Tối ưu truy vấn EXPLAIN ANALYZE",
    studentCount: 62,
    attendedCount: 60,
    status: "UPCOMING",
  },
  {
    id: "sess-2",
    classId: "10000000-0000-4000-8000-000000000002",
    className: "Lập trình Web & Trợ lý AI Fullstack - Nhóm 02",
    courseCode: "WEBAI-02",
    dayLabel: "Hôm nay (Thứ Năm)",
    dayOfWeek: 5,
    dateStr: "2026-09-17",
    timeRange: "13:30 - 15:30 (Tiết 7 - 9)",
    shift: "AFTERNOON",
    room: "Live Classroom (Trực tuyến AILSS)",
    isOnline: true,
    topic: "Thực hành REST API với FastAPI & Vector DB Pinecone",
    studentCount: 58,
    attendedCount: 57,
    status: "UPCOMING",
  },
  {
    id: "sess-3",
    classId: "10000000-0000-4000-8000-000000000003",
    className: "DevOps CI/CD Pipeline & Kubernetes - Nhóm 03",
    courseCode: "DEVOPS-03",
    dayLabel: "Ngày mai (Thứ Sáu)",
    dayOfWeek: 6,
    dateStr: "2026-09-18",
    timeRange: "09:45 - 11:45 (Tiết 4 - 6)",
    shift: "MORNING",
    room: "Phòng Lab 405 (Tòa C2)",
    isOnline: false,
    topic: "Thiết lập GitHub Actions & Tự động chạy Unit Test với Docker",
    studentCount: 66,
    attendedCount: 64,
    status: "UPCOMING",
  },
  {
    id: "sess-4",
    classId: "10000000-0000-4000-8000-000000000001",
    className: "Cơ sở dữ liệu Nâng cao & Tối ưu hóa - Nhóm 01",
    courseCode: "CSDL-01",
    dayLabel: "Thứ Bảy (19/09)",
    dayOfWeek: 7,
    dateStr: "2026-09-19",
    timeRange: "14:00 - 16:30 (Tiết 7 - 10)",
    shift: "AFTERNOON",
    room: "Phòng P.302 (Tòa H1)",
    isOnline: false,
    topic: "Thực hành Sharding & Replica Set với PostgreSQL",
    studentCount: 62,
    attendedCount: 61,
    status: "UPCOMING",
  },
  {
    id: "sess-5",
    classId: "10000000-0000-4000-8000-000000000002",
    className: "Lập trình Web & Trợ lý AI Fullstack - Nhóm 02",
    courseCode: "WEBAI-02",
    dayLabel: "Hôm qua (Thứ Tư)",
    dayOfWeek: 4,
    dateStr: "2026-09-16",
    timeRange: "15:45 - 17:45 (Tiết 10 - 12)",
    shift: "AFTERNOON",
    room: "Live Classroom (Trực tuyến AILSS)",
    isOnline: true,
    topic: "Kiến trúc Prompt Engineering & Retrieval Augmented Generation (RAG)",
    studentCount: 58,
    attendedCount: 58,
    status: "COMPLETED",
  },
];

type ScheduleViewMode = "LIST" | "DAY" | "WEEK" | "MONTH";

const DAYS_OF_WEEK = [
  { dayNumber: 2, label: "Thứ 2", dateStr: "2026-09-14", fullLabel: "Thứ Hai, 14/09" },
  { dayNumber: 3, label: "Thứ 3", dateStr: "2026-09-15", fullLabel: "Thứ Ba, 15/09" },
  { dayNumber: 4, label: "Thứ 4", dateStr: "2026-09-16", fullLabel: "Thứ Tư, 16/09" },
  { dayNumber: 5, label: "Thứ 5", dateStr: "2026-09-17", fullLabel: "Thứ Năm, 17/09 (Hôm nay)" },
  { dayNumber: 6, label: "Thứ 6", dateStr: "2026-09-18", fullLabel: "Thứ Sáu, 18/09" },
  { dayNumber: 7, label: "Thứ 7", dateStr: "2026-09-19", fullLabel: "Thứ Bảy, 19/09" },
  { dayNumber: 8, label: "CN", dateStr: "2026-09-20", fullLabel: "Chủ Nhật, 20/09" },
];

export default function TeachingScheduleScreen() {
  const [viewMode, setViewMode] = useState<ScheduleViewMode>("LIST");
  const [selectedDateStr, setSelectedDateStr] = useState("2026-09-17");
  const [listFilter, setListFilter] = useState<"ALL" | "TODAY" | "UPCOMING" | "COMPLETED">("ALL");

  const filteredListSessions = SCHEDULE_DATA.filter((item) => {
    if (listFilter === "TODAY") return item.dateStr === "2026-09-17";
    if (listFilter === "UPCOMING") return item.status === "UPCOMING" && item.dateStr !== "2026-09-17";
    if (listFilter === "COMPLETED") return item.status === "COMPLETED";
    return true;
  });

  const daySessions = SCHEDULE_DATA.filter((s) => s.dateStr === selectedDateStr);
  const selectedDayInfo = DAYS_OF_WEEK.find((d) => d.dateStr === selectedDateStr);

  const handlePrevDay = () => {
    const idx = DAYS_OF_WEEK.findIndex((d) => d.dateStr === selectedDateStr);
    if (idx > 0) setSelectedDateStr(DAYS_OF_WEEK[idx - 1].dateStr);
  };

  const handleNextDay = () => {
    const idx = DAYS_OF_WEEK.findIndex((d) => d.dateStr === selectedDateStr);
    if (idx < DAYS_OF_WEEK.length - 1) setSelectedDateStr(DAYS_OF_WEEK[idx + 1].dateStr);
  };

  const renderSessionCard = (session: ScheduleSession) => (
    <View key={session.id} style={sc.card}>
      <View style={sc.cardHeader}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Badge
            label={session.isOnline ? "ONLINE LIVE" : "TRỰC TIẾP"}
            variant={session.isOnline ? "ai" : "neutral"}
          />
          <Text style={sc.courseCode}>{session.courseCode}</Text>
        </View>
        <Text style={[sc.dayLabel, session.status === "COMPLETED" && { color: "#16A34A" }]}>
          {session.status === "COMPLETED" ? "✓ Đã hoàn thành" : session.dayLabel}
        </Text>
      </View>

      <Text style={sc.className}>{session.className}</Text>

      <View style={sc.infoRow}>
        <Icon name="clock" size={14} color="#0284C7" />
        <Text style={sc.infoText}>{session.timeRange}</Text>
      </View>

      <View style={sc.infoRow}>
        <Icon name="mapPin" size={14} color="#059669" />
        <Text style={[sc.infoText, { color: "#059669", fontWeight: "600" }]}>
          {session.room}
        </Text>
      </View>

      <View style={sc.topicBox}>
        <Text style={sc.topicLabel}>Nội dung bài giảng:</Text>
        <Text style={sc.topicText}>{session.topic}</Text>
      </View>

      <View style={sc.metaRow}>
        <Text style={sc.metaStat}>
          👥 Sĩ số: <Text style={{ fontWeight: "800" }}>{session.studentCount} SV</Text> ({session.attendedCount} đã điểm danh)
        </Text>
      </View>

      <View style={sc.cardActions}>
        <ScalePressable
          scaleTo={0.94}
          style={sc.actionBtnOutline}
          onPress={() =>
            router.push(
              `/teaching/classes/${session.classId}/sessions/${session.id}/attendance` as Href,
            )
          }
        >
          <Icon name="checkCircle" size={14} color="#0891B2" />
          <Text style={sc.actionBtnOutlineText}>Điểm danh SV</Text>
        </ScalePressable>

        <ScalePressable
          scaleTo={0.94}
          style={sc.actionBtnPrimary}
          onPress={() =>
            router.push(`/teaching/classes/${session.classId}` as Href)
          }
        >
          <Text style={sc.actionBtnPrimaryText}>Vào lớp dạy →</Text>
        </ScalePressable>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: "#F8FAFC" }}>
      <Page>
        <ScreenHeader
          title="Lịch giảng dạy"
          subtitle="Thời khóa biểu các buổi học & điểm danh"
          onBack={() => (router.canGoBack() ? router.back() : router.replace("/teaching"))}
        />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: 14, paddingBottom: 90 }}
        >
          {/* Main 4-Mode Selector Tabs */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={sc.viewTabsRow}
          >
            <ScalePressable
              scaleTo={0.93}
              style={[sc.viewTabBtn, viewMode === "LIST" && sc.viewTabBtnActive]}
              onPress={() => setViewMode("LIST")}
            >
              <Text style={[sc.viewTabText, viewMode === "LIST" && sc.viewTabTextActive]}>
                📋 Theo danh sách
              </Text>
            </ScalePressable>

            <ScalePressable
              scaleTo={0.93}
              style={[sc.viewTabBtn, viewMode === "DAY" && sc.viewTabBtnActive]}
              onPress={() => setViewMode("DAY")}
            >
              <Text style={[sc.viewTabText, viewMode === "DAY" && sc.viewTabTextActive]}>
                📅 Theo ngày
              </Text>
            </ScalePressable>

            <ScalePressable
              scaleTo={0.93}
              style={[sc.viewTabBtn, viewMode === "WEEK" && sc.viewTabBtnActive]}
              onPress={() => setViewMode("WEEK")}
            >
              <Text style={[sc.viewTabText, viewMode === "WEEK" && sc.viewTabTextActive]}>
                🗓️ Theo tuần
              </Text>
            </ScalePressable>

            <ScalePressable
              scaleTo={0.93}
              style={[sc.viewTabBtn, viewMode === "MONTH" && sc.viewTabBtnActive]}
              onPress={() => setViewMode("MONTH")}
            >
              <Text style={[sc.viewTabText, viewMode === "MONTH" && sc.viewTabTextActive]}>
                📆 Theo tháng
              </Text>
            </ScalePressable>
          </ScrollView>

          {/* 1. LIST MODE */}
          {viewMode === "LIST" && (
            <View style={{ gap: 12 }}>
              <View style={sc.noticeBanner}>
                <Icon name="calendar" size={18} color="#0284C7" />
                <Text style={sc.noticeText}>
                  Hôm nay bạn có 2 ca dạy. Buổi đầu tiên bắt đầu lúc 07:30 tại Phòng P.302.
                </Text>
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                <ScalePressable
                  scaleTo={0.93}
                  style={[sc.filterPill, listFilter === "ALL" && sc.filterPillActive]}
                  onPress={() => setListFilter("ALL")}
                >
                  <Text style={[sc.filterText, listFilter === "ALL" && sc.filterTextActive]}>
                    Tất cả ({SCHEDULE_DATA.length})
                  </Text>
                </ScalePressable>
                <ScalePressable
                  scaleTo={0.93}
                  style={[sc.filterPill, listFilter === "TODAY" && sc.filterPillActive]}
                  onPress={() => setListFilter("TODAY")}
                >
                  <Text style={[sc.filterText, listFilter === "TODAY" && sc.filterTextActive]}>
                    Hôm nay (2 buổi)
                  </Text>
                </ScalePressable>
                <ScalePressable
                  scaleTo={0.93}
                  style={[sc.filterPill, listFilter === "UPCOMING" && sc.filterPillActive]}
                  onPress={() => setListFilter("UPCOMING")}
                >
                  <Text style={[sc.filterText, listFilter === "UPCOMING" && sc.filterTextActive]}>
                    Sắp tới (2 buổi)
                  </Text>
                </ScalePressable>
                <ScalePressable
                  scaleTo={0.93}
                  style={[sc.filterPill, listFilter === "COMPLETED" && sc.filterPillActive]}
                  onPress={() => setListFilter("COMPLETED")}
                >
                  <Text style={[sc.filterText, listFilter === "COMPLETED" && sc.filterTextActive]}>
                    Đã học (1 buổi)
                  </Text>
                </ScalePressable>
              </ScrollView>

              <View style={{ gap: 12 }}>
                {filteredListSessions.map(renderSessionCard)}
              </View>
            </View>
          )}

          {/* 2. DAY MODE */}
          {viewMode === "DAY" && (
            <View style={{ gap: 12 }}>
              <View style={sc.dayNavBox}>
                <ScalePressable scaleTo={0.9} style={sc.dayNavBtn} onPress={handlePrevDay}>
                  <Text style={sc.dayNavBtnText}>◀ Trước</Text>
                </ScalePressable>
                <View style={{ alignItems: "center" }}>
                  <Text style={sc.dayNavTitle}>{selectedDayInfo?.fullLabel}</Text>
                  <Text style={sc.dayNavSubtitle}>
                    {daySessions.length > 0 ? `${daySessions.length} ca giảng dạy` : "Không có lịch giảng dạy"}
                  </Text>
                </View>
                <ScalePressable scaleTo={0.9} style={sc.dayNavBtn} onPress={handleNextDay}>
                  <Text style={sc.dayNavBtnText}>Sau ▶</Text>
                </ScalePressable>
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
                {DAYS_OF_WEEK.map((d) => {
                  const isSelected = d.dateStr === selectedDateStr;
                  const isToday = d.dateStr === "2026-09-17";
                  const count = SCHEDULE_DATA.filter((s) => s.dateStr === d.dateStr).length;

                  return (
                    <ScalePressable
                      key={d.dateStr}
                      scaleTo={0.92}
                      style={[
                        sc.dayChip,
                        isSelected && sc.dayChipSelected,
                        isToday && !isSelected && sc.dayChipToday,
                      ]}
                      onPress={() => setSelectedDateStr(d.dateStr)}
                    >
                      <Text style={[sc.dayChipLabel, isSelected && sc.dayChipLabelSelected]}>
                        {d.label}
                      </Text>
                      <Text style={[sc.dayChipDate, isSelected && sc.dayChipDateSelected]}>
                        {d.dateStr.slice(8)}/09
                      </Text>
                      {count > 0 && (
                        <View style={[sc.dayChipBadge, isSelected && { backgroundColor: "#FFFFFF" }]}>
                          <Text style={[sc.dayChipBadgeText, isSelected && { color: "#0284C7" }]}>
                            {count} ca
                          </Text>
                        </View>
                      )}
                    </ScalePressable>
                  );
                })}
              </ScrollView>

              {daySessions.length === 0 ? (
                <View style={sc.emptyDayBox}>
                  <Icon name="calendar" size={32} color="#94A3B8" />
                  <Text style={sc.emptyDayTitle}>Không có lịch dạy trong ngày này</Text>
                  <Text style={sc.emptyDaySub}>
                    Bạn có thể sử dụng thời gian này để chuẩn bị giáo án hoặc chấm bài tập.
                  </Text>
                </View>
              ) : (
                <View style={{ gap: 12 }}>
                  {daySessions.map(renderSessionCard)}
                </View>
              )}
            </View>
          )}

          {/* 3. WEEK MODE */}
          {viewMode === "WEEK" && (
            <View style={{ gap: 14 }}>
              <View style={sc.weekHeaderCard}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={sc.weekTitle}>Tuần 38 (14/09 – 20/09/2026)</Text>
                  <Badge label="5 BUỔI DẠY" variant="ai" />
                </View>
                <Text style={sc.weekSubtitle}>
                  Kế hoạch giảng dạy học kỳ 1 năm học 2026 - 2027
                </Text>
              </View>

              {DAYS_OF_WEEK.map((day) => {
                const sessionsInDay = SCHEDULE_DATA.filter((s) => s.dateStr === day.dateStr);
                const isToday = day.dateStr === "2026-09-17";

                return (
                  <View key={day.dateStr} style={[sc.weekDayBlock, isToday && sc.weekDayBlockToday]}>
                    <View style={sc.weekDayHeader}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <View style={[sc.dayCircle, isToday && sc.dayCircleToday]}>
                          <Text style={[sc.dayCircleText, isToday && { color: "#FFFFFF" }]}>
                            {day.label}
                          </Text>
                        </View>
                        <Text style={[sc.weekDayTitle, isToday && { color: "#0284C7" }]}>
                          {day.fullLabel}
                        </Text>
                      </View>
                      <Badge
                        label={sessionsInDay.length > 0 ? `${sessionsInDay.length} ca dạy` : "Nghỉ"}
                        variant={sessionsInDay.length > 0 ? (isToday ? "danger" : "ai") : "neutral"}
                      />
                    </View>

                    {sessionsInDay.length === 0 ? (
                      <Text style={sc.noSessionText}>Không có tiết giảng dạy</Text>
                    ) : (
                      <View style={{ gap: 8, marginTop: 8 }}>
                        {sessionsInDay.map((s) => (
                          <ScalePressable
                            key={s.id}
                            scaleTo={0.96}
                            style={sc.weekMiniCard}
                            onPress={() =>
                              router.push(
                                `/teaching/classes/${s.classId}/sessions/${s.id}/attendance` as Href,
                              )
                            }
                          >
                            <View style={{ flex: 1, gap: 2 }}>
                              <Text style={sc.weekMiniTitle}>{s.className}</Text>
                              <Text style={sc.weekMiniTime}>
                                ⏰ {s.timeRange} · 📍 {s.room}
                              </Text>
                            </View>
                            <View style={sc.miniActionBtn}>
                              <Text style={sc.miniActionBtnText}>Điểm danh →</Text>
                            </View>
                          </ScalePressable>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {/* 4. MONTH MODE */}
          {viewMode === "MONTH" && (
            <View style={{ gap: 14 }}>
              <View style={sc.monthSummaryCard}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={sc.monthTitle}>Tháng 09/2026</Text>
                  <Badge label="16 BUỔI THÁNG NÀY" variant="success" />
                </View>
                <View style={sc.monthGrid}>
                  <View style={sc.monthStatBox}>
                    <Text style={sc.monthStatNum}>16</Text>
                    <Text style={sc.monthStatLbl}>Tổng số buổi</Text>
                  </View>
                  <View style={sc.monthStatBox}>
                    <Text style={[sc.monthStatNum, { color: "#16A34A" }]}>12</Text>
                    <Text style={sc.monthStatLbl}>Đã hoàn thành</Text>
                  </View>
                  <View style={sc.monthStatBox}>
                    <Text style={[sc.monthStatNum, { color: "#0284C7" }]}>4</Text>
                    <Text style={sc.monthStatLbl}>Sắp diễn ra</Text>
                  </View>
                  <View style={sc.monthStatBox}>
                    <Text style={[sc.monthStatNum, { color: "#7C3AED" }]}>96.8%</Text>
                    <Text style={sc.monthStatLbl}>Chuyên cần SV</Text>
                  </View>
                </View>
              </View>

              <Text style={sc.sectionHeading}>Tiến độ theo tuần trong tháng</Text>

              <View style={sc.weekProgressCard}>
                <View style={sc.progressRow}>
                  <Text style={sc.progressTitle}>Tuần 1 (01/09 – 07/09)</Text>
                  <Text style={[sc.progressStatus, { color: "#16A34A" }]}>✓ 4/4 buổi (100%)</Text>
                </View>
                <Text style={sc.progressDetail}>Đã hoàn thành đầy đủ điểm danh và bài tập tuần 1.</Text>
              </View>

              <View style={sc.weekProgressCard}>
                <View style={sc.progressRow}>
                  <Text style={sc.progressTitle}>Tuần 2 (08/09 – 14/09)</Text>
                  <Text style={[sc.progressStatus, { color: "#16A34A" }]}>✓ 4/4 buổi (100%)</Text>
                </View>
                <Text style={sc.progressDetail}>Đã hoàn thành đầy đủ điểm danh và bài tập tuần 2.</Text>
              </View>

              <View style={[sc.weekProgressCard, { borderColor: "#0284C7", backgroundColor: "#F0F9FF" }]}>
                <View style={sc.progressRow}>
                  <Text style={[sc.progressTitle, { color: "#0284C7" }]}>Tuần 3 (15/09 – 21/09) ★ ĐANG DẠY</Text>
                  <Text style={[sc.progressStatus, { color: "#0284C7" }]}>2/4 buổi (Hôm nay: 2 ca)</Text>
                </View>
                <Text style={sc.progressDetail}>Hôm nay có 2 ca dạy: CSDL Nhóm 01 (07:30) & Web AI (13:30).</Text>
              </View>

              <View style={sc.weekProgressCard}>
                <View style={sc.progressRow}>
                  <Text style={sc.progressTitle}>Tuần 4 (22/09 – 30/09)</Text>
                  <Text style={sc.progressStatus}>0/4 buổi (Sắp diễn ra)</Text>
                </View>
                <Text style={sc.progressDetail}>Lịch thi giữa kỳ và báo cáo bài tập lớn đồ án chuyên đề.</Text>
              </View>
            </View>
          )}
        </ScrollView>
      </Page>
      <BottomNavBar
        currentRoute="teaching"
        role="LECTURER"
        onNavigate={(path) => router.push(path as Href)}
      />
    </View>
  );
}

const sc = StyleSheet.create({
  viewTabsRow: {
    flexDirection: "row",
    gap: 8,
    paddingVertical: 4,
    paddingRight: 16,
  },
  viewTabBtn: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  viewTabBtnActive: {
    backgroundColor: "#0284C7",
    borderColor: "#0284C7",
  },
  viewTabText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748B",
  },
  viewTabTextActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  filterPill: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  filterPillActive: {
    backgroundColor: "#E0F2FE",
    borderColor: "#0284C7",
  },
  filterText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
  },
  filterTextActive: {
    color: "#0284C7",
    fontWeight: "700",
  },
  noticeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#E0F2FE",
    borderWidth: 1,
    borderColor: "#BAE6FD",
  },
  noticeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: "#0369A1",
    fontWeight: "500",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 8,
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
  courseCode: {
    fontSize: 11,
    fontWeight: "800",
    color: "#64748B",
  },
  dayLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0284C7",
  },
  className: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0F172A",
    marginVertical: 2,
    lineHeight: 20,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  infoText: {
    fontSize: 13,
    color: "#334155",
  },
  topicBox: {
    backgroundColor: "#F8FAFC",
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#F1F5F9",
    marginTop: 2,
  },
  topicLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#64748B",
    marginBottom: 2,
  },
  topicText: {
    fontSize: 12,
    color: "#1E293B",
    lineHeight: 17,
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 2,
  },
  metaStat: {
    fontSize: 12,
    color: "#64748B",
  },
  cardActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  actionBtnOutline: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#0891B2",
    backgroundColor: "#F0FDFA",
  },
  actionBtnOutlineText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0891B2",
  },
  actionBtnPrimary: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#0284C7",
  },
  actionBtnPrimaryText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  dayNavBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  dayNavBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "#F1F5F9",
  },
  dayNavBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0F172A",
  },
  dayNavTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
  },
  dayNavSubtitle: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  dayChip: {
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    minWidth: 64,
  },
  dayChipSelected: {
    backgroundColor: "#0284C7",
    borderColor: "#0284C7",
  },
  dayChipToday: {
    borderColor: "#0284C7",
  },
  dayChipLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748B",
  },
  dayChipLabelSelected: {
    color: "#FFFFFF",
  },
  dayChipDate: {
    fontSize: 11,
    color: "#94A3B8",
    marginTop: 2,
  },
  dayChipDateSelected: {
    color: "#E0F2FE",
  },
  dayChipBadge: {
    marginTop: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "#E0F2FE",
  },
  dayChipBadgeText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#0284C7",
  },
  emptyDayBox: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 32,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 8,
  },
  emptyDayTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#334155",
  },
  emptyDaySub: {
    fontSize: 12,
    color: "#64748B",
    textAlign: "center",
    lineHeight: 18,
  },
  weekHeaderCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 4,
  },
  weekTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0F172A",
  },
  weekSubtitle: {
    fontSize: 12,
    color: "#64748B",
  },
  weekDayBlock: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  weekDayBlockToday: {
    borderColor: "#0284C7",
    borderWidth: 1.5,
  },
  weekDayHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  dayCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  dayCircleToday: {
    backgroundColor: "#0284C7",
  },
  dayCircleText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#334155",
  },
  weekDayTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1E293B",
  },
  noSessionText: {
    fontSize: 12,
    color: "#94A3B8",
    fontStyle: "italic",
    marginTop: 8,
    marginLeft: 40,
  },
  weekMiniCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F8FAFC",
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  weekMiniTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A",
  },
  weekMiniTime: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  miniActionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: "#0284C7",
  },
  miniActionBtnText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  monthSummaryCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 12,
  },
  monthTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0F172A",
  },
  monthGrid: {
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between",
  },
  monthStatBox: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#F1F5F9",
  },
  monthStatNum: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0F172A",
  },
  monthStatLbl: {
    fontSize: 10,
    color: "#64748B",
    fontWeight: "600",
    marginTop: 3,
    textAlign: "center",
  },
  sectionHeading: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
    marginTop: 4,
  },
  weekProgressCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 4,
  },
  progressRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A",
  },
  progressStatus: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748B",
  },
  progressDetail: {
    fontSize: 12,
    color: "#64748B",
    lineHeight: 17,
  },
});
