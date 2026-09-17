import { useSyncExternalStore, useState, useEffect, useCallback } from "react";
import {
  Text,
  View,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Modal,
  TextInput,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
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
import { Page, Button, Badge, Icon, styles, tokens } from "../../../src/ui";
import { ScalePressable } from "../../../src/motion";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ClassAssignment {
  id: string;
  title: string;
  dueDate: string;
  maxScore: number;
  score?: number;
  status: "PENDING" | "SUBMITTED" | "GRADED";
}

const CLASS_ASSIGNMENTS: ClassAssignment[] = [
  {
    id: "asg-1",
    title: "Bài tập lớn: Thiết kế CSDL quan hệ chuẩn hóa 3NF",
    dueDate: "23:59 Hôm nay",
    maxScore: 10,
    status: "PENDING",
  },
  {
    id: "asg-2",
    title: "Bài tập tuần 3: Viết câu truy vấn tối ưu với Index",
    dueDate: "20/09/2026",
    maxScore: 10,
    score: 9.0,
    status: "GRADED",
  },
  {
    id: "asg-3",
    title: "Trắc nghiệm 15 phút: Ràng buộc toàn vẹn & Trigger",
    dueDate: "25/09/2026",
    maxScore: 10,
    status: "PENDING",
  },
];

interface MobileClassDoc {
  id: string;
  title: string;
  category: string;
  fileType: string;
  fileSize: string;
  updatedAt: string;
  uploader: string;
}

const CLASS_DOCUMENTS: MobileClassDoc[] = [
  { id: "mdoc-1", title: "Đề cương chi tiết học phần & Chuẩn đầu ra (Syllabus)", category: "Đề Cương", fileType: "PDF", fileSize: "1.4 MB", updatedAt: "05/09/2026", uploader: "TS. Trần Hoàng Minh" },
  { id: "mdoc-2", title: "Slide Chương 1-3: Mô hình ERD & Đại số quan hệ", category: "Bài Giảng", fileType: "PDF", fileSize: "4.8 MB", updatedAt: "10/09/2026", uploader: "TS. Trần Hoàng Minh" },
  { id: "mdoc-3", title: "Slide Chương 4-6: Chuẩn hóa 3NF & Tối ưu Index", category: "Bài Giảng", fileType: "PDF", fileSize: "5.6 MB", updatedAt: "14/09/2026", uploader: "TS. Trần Hoàng Minh" },
  { id: "mdoc-4", title: "Sổ tay bài tập thực hành Lab SQL nâng cao", category: "Thực Hành", fileType: "PDF", fileSize: "2.8 MB", updatedAt: "12/09/2026", uploader: "ThS. Nguyễn Thị Thu Hà" },
  { id: "mdoc-5", title: "Mã nguồn Schema mẫu & Dataset E-Commerce thực chiến", category: "Dữ Liệu", fileType: "SQL", fileSize: "12.3 MB", updatedAt: "15/09/2026", uploader: "TS. Trần Hoàng Minh" },
];

interface MobileClassMember {
  studentId: string;
  name: string;
  role: string;
  attendanceRate: string;
  status: "ONLINE" | "RECENT";
}

const CLASS_MEMBERS: MobileClassMember[] = [
  { studentId: "SV-202601", name: "Lê Văn Đức", role: "Lớp trưởng", attendanceRate: "100%", status: "ONLINE" },
  { studentId: "SV-202602", name: "Nguyễn Mai Phương", role: "Lớp phó", attendanceRate: "100%", status: "ONLINE" },
  { studentId: "SV-202603", name: "Trần Anh Tuấn", role: "Học viên", attendanceRate: "95%", status: "RECENT" },
  { studentId: "SV-202604", name: "Phạm Hoàng Long", role: "Học viên", attendanceRate: "92%", status: "ONLINE" },
  { studentId: "SV-202605", name: "Đỗ Thị Bảo Ngọc", role: "Học viên", attendanceRate: "100%", status: "RECENT" },
  { studentId: "SV-202606", name: "Vũ Minh Quân", role: "Học viên", attendanceRate: "90%", status: "RECENT" },
  { studentId: "SV-202607", name: "Hoàng Gia Huy", role: "Học viên", attendanceRate: "88%", status: "ONLINE" },
];

export default function ClassDetails() {
  const { classId, tab, asgId, action } = useLocalSearchParams<{
    classId: string;
    tab?: string;
    asgId?: string;
    action?: string;
  }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [classInfo, setClassInfo] = useState<StudentClass | null>(null);
  const [sessionsList, setSessionsList] = useState<ClassSession[]>([]);
  const [detailTab, setDetailTab] = useState<"lessons" | "assignments" | "documents" | "members">(
    tab === "assignments" ? "assignments" : "lessons",
  );
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isForbidden, setIsForbidden] = useState(false);

  // Interactive Assignments state & modal
  const [assignments, setAssignments] = useState<ClassAssignment[]>(CLASS_ASSIGNMENTS);
  const [submitModalAsg, setSubmitModalAsg] = useState<ClassAssignment | null>(null);
  const [reviewModalAsg, setReviewModalAsg] = useState<ClassAssignment | null>(null);
  const [submissionNote, setSubmissionNote] = useState("");
  const [submissionFile, setSubmissionFile] = useState<string | null>("Baitap_ThucHanh_CSDL_SV2026.sql");
  const [submitting, setSubmitting] = useState(false);
  const [assignmentToast, setAssignmentToast] = useState<string | null>(null);

  useEffect(() => {
    if (tab === "assignments") {
      setDetailTab("assignments");
    }
    if (asgId) {
      setDetailTab("assignments");
      const target = assignments.find((a) => a.id === asgId);
      if (target) {
        if (action === "review" || target.status === "GRADED") {
          setReviewModalAsg(target);
        } else {
          setSubmitModalAsg(target);
        }
      }
    }
  }, [tab, asgId, action, assignments]);

  const isValidClassId = typeof classId === "string" && UUID_REGEX.test(classId);

  const fetchClassDetails = useCallback(async () => {
    if (!isValidClassId || snapshot.state !== "AUTHENTICATED") return;
    try {
      setError(null);
      setIsForbidden(false);

      // 1. Fetch class details (CLS-02)
      const classData = await session.request(`/api/v1/classes/${classId}`);
      const parsedClass = classDetail(classData);
      setClassInfo(parsedClass);

      // 2. Fetch class sessions schedule (CLS-13) - bounded within 30 days
      const range = getDateRangeForSchedule(new Date(), 30);
      const sessionsData = await session.request(
        `/api/v1/classes/${classId}/sessions?from=${range.from}&to=${range.to}`,
      );
      setSessionsList(sortChronological(classSessions(sessionsData)));
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        if (e.status === 401) {
          setError("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
        } else if (e.status === 403) {
          setIsForbidden(true);
          setError("Bạn chưa là thành viên của lớp này hoặc không có quyền truy cập.");
        } else if (e.status === 404) {
          setError("Không tìm thấy thông tin lớp học.");
        } else {
          setError(e.message || "Không thể tải chi tiết lớp học.");
        }
      } else {
        setError("Lỗi kết nối mạng. Vui lòng kiểm tra lại.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isValidClassId, classId, snapshot.state, session]);

  useEffect(() => {
    if (isValidClassId) {
      setLoading(true);
      void fetchClassDetails();
    }
  }, [isValidClassId, fetchClassDetails]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchClassDetails();
  }, [fetchClassDetails]);

  const openAssignment = useCallback((assignment: ClassAssignment) => {
    if (assignment.status === "PENDING") {
      setSubmitModalAsg(assignment);
    } else {
      setReviewModalAsg(assignment);
    }
  }, []);

  const handleConfirmSubmit = useCallback(() => {
    if (!submitModalAsg) return;
    setSubmitting(true);
    setTimeout(() => {
      setAssignments((prev) =>
        prev.map((a) =>
          a.id === submitModalAsg.id
            ? { ...a, status: "GRADED", score: 9.5 }
            : a,
        ),
      );
      setSubmitting(false);
      setAssignmentToast(`✓ Đã nộp bài tập "${submitModalAsg.title}" thành công!`);
      setSubmitModalAsg(null);
      setSubmissionNote("");
    }, 400);
  }, [submitModalAsg]);

  if (!isValidClassId) {
    return (
      <Page>
        <Text style={styles.small}>LỖI ĐỊNH DẠNG</Text>
        <Text style={styles.title}>Mã lớp không hợp lệ</Text>
        <Text style={styles.text}>Mã định danh lớp học cung cấp trong đường dẫn không đúng chuẩn.</Text>
        <Button label="Quay lại danh sách lớp" onPress={() => router.push("/classes")} />
      </Page>
    );
  }

  if (snapshot.state !== "AUTHENTICATED") {
    return (
      <Page>
        <Text style={styles.small}>CHI TIẾT LỚP HỌC</Text>
        <Text style={styles.title}>Yêu cầu đăng nhập</Text>
        <Text style={styles.text}>Vui lòng đăng nhập để xem thông tin chi tiết lớp học.</Text>
        <Button label="Đăng nhập" onPress={() => router.push("/login")} />
        <Button label="Quay lại" onPress={() => router.push("/classes")} />
      </Page>
    );
  }

  if (isForbidden) {
    return (
      <Page>
        <Text style={styles.small}>TRUY CẬP BỊ TỪ CHỐI</Text>
        <Text style={styles.title}>Không có quyền truy cập</Text>
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
        <Text style={styles.text}>
          Chỉ các học viên đã tham gia lớp mới có thể xem thông tin lịch trình và nội dung buổi học.
        </Text>
        <Button label="Quay lại danh sách lớp" onPress={() => router.push("/classes")} />
      </Page>
    );
  }

  const nextSession = nextUpcomingSession(sessionsList);

  return (
    <ScrollView
      style={localStyles.container}
      contentContainerStyle={localStyles.contentContainer}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tokens.color.brand} />
      }
    >
      <Text style={styles.small}>LỚP HỌC</Text>
      <Text style={styles.title}>{classInfo?.name ?? "Đang tải lớp học…"}</Text>

      {/* Badges */}
      {classInfo && (
        <View style={localStyles.badgeRow}>
          <View style={localStyles.badge}>
            <Text style={localStyles.badgeText}>
              {classInfo.classKind === "LIVE_COHORT"
                ? "Lớp trực tiếp"
                : classInfo.classKind === "PRIVATE"
                  ? "Lớp riêng"
                  : "Lớp học"}
            </Text>
          </View>
          {classInfo.state && (
            <View style={[localStyles.badge, localStyles.badgeActive]}>
              <Text style={[localStyles.badgeText, localStyles.badgeTextActive]}>{classInfo.state}</Text>
            </View>
          )}
          {classInfo.maxMembers && (
            <Text style={localStyles.memberCount}>Tối đa {classInfo.maxMembers} học viên</Text>
          )}
        </View>
      )}

      {/* Loading state */}
      {loading && !refreshing && (
        <View style={localStyles.center}>
          <ActivityIndicator size="large" color={tokens.color.brand} />
          <Text style={[styles.text, { marginTop: 12 }]}>Đang tải chi tiết lớp học…</Text>
        </View>
      )}

      {/* Error state */}
      {error && !loading && (
        <View style={localStyles.errorCard}>
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
          <Button label="Thử lại" onPress={() => void fetchClassDetails()} />
        </View>
      )}

      {/* Segmented Tabs: Buổi học | Bài tập | Tài liệu | Danh sách lớp */}
      {!loading && !error && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={localStyles.tabScrollContainer}
          contentContainerStyle={localStyles.tabScrollContent}
        >
          <ScalePressable
            style={[localStyles.tabPillBtn, detailTab === "lessons" && localStyles.tabPillBtnActive]}
            onPress={() => setDetailTab("lessons")}
          >
            <Text style={[localStyles.tabPillText, detailTab === "lessons" && localStyles.tabPillTextActive]}>
              📖 Buổi học ({sessionsList.length})
            </Text>
          </ScalePressable>
          <ScalePressable
            style={[localStyles.tabPillBtn, detailTab === "assignments" && localStyles.tabPillBtnActive]}
            onPress={() => setDetailTab("assignments")}
          >
            <Text style={[localStyles.tabPillText, detailTab === "assignments" && localStyles.tabPillTextActive]}>
              📝 Bài tập ({CLASS_ASSIGNMENTS.length})
            </Text>
          </ScalePressable>
          <ScalePressable
            style={[localStyles.tabPillBtn, detailTab === "documents" && localStyles.tabPillBtnActive]}
            onPress={() => setDetailTab("documents")}
          >
            <Text style={[localStyles.tabPillText, detailTab === "documents" && localStyles.tabPillTextActive]}>
              📁 Tài liệu ({CLASS_DOCUMENTS.length})
            </Text>
          </ScalePressable>
          <ScalePressable
            style={[localStyles.tabPillBtn, detailTab === "members" && localStyles.tabPillBtnActive]}
            onPress={() => setDetailTab("members")}
          >
            <Text style={[localStyles.tabPillText, detailTab === "members" && localStyles.tabPillTextActive]}>
              👥 Danh sách lớp ({CLASS_MEMBERS.length})
            </Text>
          </ScalePressable>
        </ScrollView>
      )}

      {/* Download/Action Toast Message */}
      {downloadMsg && (
        <View style={localStyles.toastBanner}>
          <Text style={localStyles.toastText}>{downloadMsg}</Text>
          <Pressable onPress={() => setDownloadMsg(null)} hitSlop={8}>
            <Text style={localStyles.toastClose}>✕</Text>
          </Pressable>
        </View>
      )}

      {/* When detailTab === "lessons" */}
      {!loading && !error && detailTab === "lessons" && (
        <>
          {/* Next Upcoming Session Banner */}
          {nextSession && (
            <View style={localStyles.upcomingCard}>
              <Text style={localStyles.upcomingLabel}>BUỔI HỌC TIẾP THEO</Text>
              <Text style={localStyles.upcomingTitle}>{nextSession.title}</Text>
              <Text style={localStyles.upcomingTime}>
                {formatDate(parseTimestamp(nextSession.startAt), nextSession.timezone)}
              </Text>
              <Text style={localStyles.upcomingSubTime}>
                {formatTimeRange(
                  parseTimestamp(nextSession.startAt),
                  parseTimestamp(nextSession.endAt),
                  nextSession.timezone,
                )}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Vào buổi học ${nextSession.title}`}
                style={localStyles.upcomingButton}
                onPress={() => router.push(`/classes/${classId}/sessions/${nextSession.sessionId}`)}
              >
                <Text style={localStyles.upcomingButtonText}>Xem chi tiết buổi học →</Text>
              </Pressable>
            </View>
          )}

          {/* Sessions List */}
          <View style={localStyles.sessionSection}>
            <Text style={localStyles.sectionTitle}>Danh sách buổi học ({sessionsList.length})</Text>

            {sessionsList.length === 0 ? (
              <View style={localStyles.emptyContainer}>
                <Text style={styles.text}>Chưa có buổi học nào được lên lịch trong 30 ngày tới.</Text>
              </View>
            ) : (
              sessionsList.map((item, index) => {
                const start = parseTimestamp(item.startAt);
                const end = parseTimestamp(item.endAt);
                const isOnline = item.mode === "ONLINE";

                return (
                  <Pressable
                    key={item.sessionId}
                    accessibilityRole="button"
                    accessibilityLabel={`Buổi học ${index + 1}: ${item.title}`}
                    style={localStyles.sessionItem}
                    onPress={() => router.push(`/classes/${classId}/sessions/${item.sessionId}`)}
                  >
                    <View style={localStyles.sessionItemHeader}>
                      <View
                        style={[
                          localStyles.badge,
                          isOnline ? localStyles.badgeOnline : localStyles.badgeOffline,
                        ]}
                      >
                        <Text
                          style={[
                            localStyles.badgeText,
                            isOnline ? localStyles.badgeTextOnline : localStyles.badgeTextOffline,
                          ]}
                        >
                          {isOnline ? "Online" : "Offline"}
                        </Text>
                      </View>
                      <Text style={localStyles.sessionIndex}>Buổi #{index + 1}</Text>
                    </View>

                    <Text style={localStyles.sessionTitle}>{item.title}</Text>

                    <Text style={localStyles.sessionDate}>
                      {formatDate(start, item.timezone)} • {formatTimeRange(start, end, item.timezone)}
                    </Text>

                    {item.location && (
                      <Text style={localStyles.sessionLocation}>
                        {isOnline ? "Link lớp: " : "Phòng học: "}
                        {item.location}
                      </Text>
                    )}

                    <View style={localStyles.cardActionRow}>
                      <Text style={localStyles.actionLink}>Vào chi tiết buổi học →</Text>
                    </View>
                  </Pressable>
                );
              })
            )}
          </View>
        </>
      )}

      {/* When detailTab === "assignments" */}
      {!loading && !error && detailTab === "assignments" && (
        <View style={localStyles.sessionSection}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <Text style={localStyles.sectionTitle}>Bài tập & Đánh giá của lớp</Text>
            <Badge
              label={`${assignments.filter((a) => a.status === "PENDING").length} bài chưa nộp`}
              variant="warning"
            />
          </View>

          {assignmentToast && (
            <View style={localStyles.toastBanner}>
              <Text style={localStyles.toastText}>{assignmentToast}</Text>
              <Pressable onPress={() => setAssignmentToast(null)}>
                <Text style={localStyles.toastClose}>✕</Text>
              </Pressable>
            </View>
          )}

          {assignments.map((asg) => (
            <View key={asg.id} style={localStyles.assignmentCard}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Badge
                  label={asg.status === "PENDING" ? "● Chưa nộp" : asg.status === "GRADED" ? `✓ Điểm: ${asg.score}/${asg.maxScore}` : "Đã nộp"}
                  variant={asg.status === "PENDING" ? "danger" : "success"}
                />
                <Text style={{ fontSize: 12, color: asg.status === "PENDING" ? "#DC2626" : "#64748B", fontWeight: "600" }}>
                  Hạn: {asg.dueDate}
                </Text>
              </View>

              <Text style={localStyles.assignmentTitle}>{asg.title}</Text>

              <View style={localStyles.assignmentFooter}>
                <Text style={styles.small}>Thang điểm: {asg.maxScore} điểm</Text>
                <Button
                  label={asg.status === "PENDING" ? "Nộp bài tập" : "Xem bài làm"}
                  size="sm"
                  variant={asg.status === "PENDING" ? "primary" : "outline"}
                  icon={<Icon name={asg.status === "PENDING" ? "document" : "check"} size={16} color={asg.status === "PENDING" ? "#FFFFFF" : tokens.color.ink} />}
                  onPress={() => openAssignment(asg)}
                  style={localStyles.assignmentAction}
                />
              </View>
            </View>
          ))}
        </View>
      )}

      {/* When detailTab === "documents" */}
      {!loading && !error && detailTab === "documents" && (
        <View style={localStyles.sessionSection}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <Text style={localStyles.sectionTitle}>Tài liệu & Học liệu môn học</Text>
            <Badge label={`${CLASS_DOCUMENTS.length} tài liệu`} variant="neutral" />
          </View>

          {CLASS_DOCUMENTS.map((doc) => (
            <View key={doc.id} style={localStyles.docCard}>
              <View style={localStyles.docHeaderRow}>
                <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                  <View style={[localStyles.fileTypePill, doc.fileType === "PDF" ? localStyles.pillPdf : localStyles.pillSql]}>
                    <Text style={localStyles.fileTypeText}>{doc.fileType}</Text>
                  </View>
                  <View style={localStyles.categoryBadge}>
                    <Text style={localStyles.categoryBadgeText}>{doc.category}</Text>
                  </View>
                </View>
                <Text style={localStyles.docFileSize}>{doc.fileSize}</Text>
              </View>

              <Text style={localStyles.docTitle}>{doc.title}</Text>

              <View style={localStyles.docMetaRow}>
                <Text style={localStyles.docMetaText}>Cập nhật: {doc.updatedAt}</Text>
                <Text style={localStyles.docMetaText}>Bởi: {doc.uploader}</Text>
              </View>

              <View style={localStyles.docActionRow}>
                <Pressable
                  style={localStyles.docPreviewBtn}
                  onPress={() => {
                    setDownloadMsg(`ℹ Đang mở bản xem trước: ${doc.title}`);
                    setTimeout(() => setDownloadMsg(null), 3500);
                  }}
                >
                  <Text style={localStyles.docPreviewBtnText}>👁 Xem trước</Text>
                </Pressable>
                <Pressable
                  style={localStyles.docDownloadBtn}
                  onPress={() => {
                    setDownloadMsg(`✓ Đang tải tài liệu "${doc.title}" (${doc.fileSize})...`);
                    setTimeout(() => setDownloadMsg(null), 3500);
                  }}
                >
                  <Text style={localStyles.docDownloadBtnText}>📥 Tải về máy</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* When detailTab === "members" */}
      {!loading && !error && detailTab === "members" && (
        <View style={localStyles.sessionSection}>
          {/* Summary Box */}
          <View style={localStyles.rosterSummaryCard}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <View>
                <Text style={localStyles.rosterSummaryTitle}>Sĩ số: 48 / 50 Học viên</Text>
                <Text style={localStyles.rosterSummarySub}>Còn 2 chỗ trống • Đang mở ghi danh</Text>
              </View>
              <Badge label="Chính thức" variant="success" />
            </View>
            <View style={localStyles.rosterDivider} />
            <View style={localStyles.rosterTeacherRow}>
              <View style={localStyles.rosterTeacherAvatar}>
                <Text style={localStyles.rosterTeacherAvatarText}>TM</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={localStyles.rosterTeacherName}>TS. Trần Hoàng Minh</Text>
                <Text style={localStyles.rosterTeacherRole}>Giảng viên phụ trách • Phụ trách học phần</Text>
              </View>
              <View style={localStyles.onlineDot} />
            </View>
          </View>

          {/* Member List */}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <Text style={localStyles.sectionTitle}>Danh sách bạn học ({CLASS_MEMBERS.length})</Text>
            <Text style={{ fontSize: 12, color: "#64748B" }}>Tỷ lệ chuyên cần cao</Text>
          </View>

          {CLASS_MEMBERS.map((m) => {
            const initials = m.name.split(" ").slice(-2).map((p) => p[0]).join("");
            const isOfficer = m.role === "Lớp trưởng" || m.role === "Lớp phó";
            return (
              <View key={m.studentId} style={localStyles.memberCard}>
                <View style={[localStyles.memberAvatar, isOfficer && localStyles.memberAvatarOfficer]}>
                  <Text style={[localStyles.memberAvatarText, isOfficer && localStyles.memberAvatarTextOfficer]}>
                    {initials}
                  </Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={localStyles.memberName}>{m.name}</Text>
                    {isOfficer && (
                      <View style={localStyles.officerBadge}>
                        <Text style={localStyles.officerBadgeText}>{m.role}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={localStyles.memberSubId}>Mã SV: {m.studentId}</Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Text style={localStyles.attendanceRate}>Chuyên cần: {m.attendanceRate}</Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <View style={m.status === "ONLINE" ? localStyles.onlineDot : localStyles.recentDot} />
                    <Text style={{ fontSize: 11, color: m.status === "ONLINE" ? "#16A34A" : "#94A3B8" }}>
                      {m.status === "ONLINE" ? "Trực tuyến" : "Gần đây"}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}

      <View style={{ marginTop: 24 }}>
        <Button label="Quay lại danh sách lớp" onPress={() => router.push("/classes")} />
      </View>

      {/* Interactive Assignment Submit Modal */}
      <Modal
        visible={!!submitModalAsg}
        transparent
        animationType="slide"
        onRequestClose={() => setSubmitModalAsg(null)}
      >
        <View style={localStyles.modalOverlay}>
          <View style={localStyles.modalSheet}>
            <View style={localStyles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={localStyles.modalEyebrow}>NỘP BÀI TẬP TRỰC TUYẾN</Text>
                <Text style={localStyles.modalTitle} numberOfLines={2}>
                  {submitModalAsg?.title}
                </Text>
                <Text style={localStyles.modalMeta}>
                  Hạn nộp: {submitModalAsg?.dueDate} • Thang điểm: {submitModalAsg?.maxScore} điểm
                </Text>
              </View>
              <Pressable
                onPress={() => setSubmitModalAsg(null)}
                style={localStyles.modalCloseBtn}
                hitSlop={10}
              >
                <Icon name="close" size={18} color="#64748B" />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              <Text style={localStyles.modalInputLabel}>Tệp bài làm đính kèm (.sql, .zip, .pdf):</Text>
              <View style={localStyles.fileAttachmentBox}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                  <Icon name="document" size={20} color="#0284C7" />
                  <View style={{ flex: 1 }}>
                    <Text style={localStyles.fileAttachmentName} numberOfLines={1}>
                      {submissionFile || "Chưa chọn tệp"}
                    </Text>
                    <Text style={localStyles.fileAttachmentSize}>142 KB • Sẵn sàng nộp</Text>
                  </View>
                </View>
                <Pressable
                  style={localStyles.fileChangeBtn}
                  onPress={() => setSubmissionFile("BaiTap_CSDL_Final_v2.sql")}
                >
                  <Text style={localStyles.fileChangeText}>Đổi tệp</Text>
                </Pressable>
              </View>

              <Text style={localStyles.modalInputLabel}>Ghi chú / Lời nhắn cho Giảng viên:</Text>
              <TextInput
                style={localStyles.modalTextInput}
                placeholder="Nhập nội dung tóm tắt giải pháp, câu lệnh test hoặc link GitHub/Figma..."
                placeholderTextColor="#94A3B8"
                multiline
                numberOfLines={3}
                value={submissionNote}
                onChangeText={setSubmissionNote}
              />

              <View style={localStyles.modalNoticeBox}>
                <Icon name="info" size={16} color="#0369A1" />
                <Text style={localStyles.modalNoticeText}>
                  Sau khi nộp, bạn vẫn có thể nộp lại bài trước thời hạn chót.
                </Text>
              </View>
            </ScrollView>

            <View style={localStyles.modalActionRow}>
              <Pressable
                style={localStyles.modalCancelBtn}
                onPress={() => setSubmitModalAsg(null)}
              >
                <Text style={localStyles.modalCancelText}>Hủy bỏ</Text>
              </Pressable>
              <Pressable
                style={[localStyles.modalSubmitBtn, submitting && { opacity: 0.7 }]}
                onPress={handleConfirmSubmit}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Icon name="check" size={16} color="#FFFFFF" />
                    <Text style={localStyles.modalSubmitText}>Xác nhận nộp bài</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Interactive Assignment Review Modal */}
      <Modal
        visible={!!reviewModalAsg}
        transparent
        animationType="slide"
        onRequestClose={() => setReviewModalAsg(null)}
      >
        <View style={localStyles.modalOverlay}>
          <View style={localStyles.modalSheet}>
            <View style={localStyles.modalHeader}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <Badge label="ĐÃ NỘP & CHẤM ĐIỂM" variant="success" icon="check" />
                </View>
                <Text style={localStyles.modalTitle} numberOfLines={2}>
                  {reviewModalAsg?.title}
                </Text>
                <Text style={localStyles.modalMeta}>
                  Hạn nộp: {reviewModalAsg?.dueDate}
                </Text>
              </View>
              <Pressable
                onPress={() => setReviewModalAsg(null)}
                style={localStyles.modalCloseBtn}
                hitSlop={10}
              >
                <Icon name="close" size={18} color="#64748B" />
              </Pressable>
            </View>

            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              <View style={localStyles.gradeScoreCard}>
                <View>
                  <Text style={localStyles.gradeScoreLabel}>Điểm đánh giá</Text>
                  <Text style={localStyles.gradeScoreValue}>
                    {reviewModalAsg?.score || 9.0} <Text style={{ fontSize: 16, color: "#64748B" }}>/ 10</Text>
                  </Text>
                </View>
                <View style={localStyles.gradeBadgeIcon}>
                  <Icon name="award" size={26} color="#16A34A" />
                </View>
              </View>

              <Text style={localStyles.modalInputLabel}>Tệp đã nộp:</Text>
              <View style={localStyles.fileAttachmentBox}>
                <Icon name="document" size={20} color="#16A34A" />
                <View style={{ flex: 1 }}>
                  <Text style={localStyles.fileAttachmentName}>Bai_tap_tuan_3_Index_toi_uu.sql</Text>
                  <Text style={localStyles.fileAttachmentSize}>Nộp lúc 19:42 Hôm qua • 124 KB</Text>
                </View>
              </View>

              <Text style={localStyles.modalInputLabel}>Nhận xét từ Giảng viên (TS. Trần Hoàng Minh):</Text>
              <View style={localStyles.teacherFeedbackBox}>
                <Text style={localStyles.teacherFeedbackText}>
                  "Bài làm chuẩn chỉ, áp dụng đúng cấu trúc B-Tree Index cho các trường lọc nhiều. Câu lệnh EXPLAIN ANALYZE được giải thích chi tiết. Điểm thưởng 1 điểm cho bài tập mở rộng."
                </Text>
              </View>
            </ScrollView>

            <View style={localStyles.modalActionRow}>
              <Pressable
                style={[localStyles.modalSubmitBtn, { flex: 1, backgroundColor: "#0284C7" }]}
                onPress={() => setReviewModalAsg(null)}
              >
                <Text style={localStyles.modalSubmitText}>Đóng xem bài</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
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
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginVertical: 12,
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
  badgeActive: {
    backgroundColor: "#dcfce7",
  },
  badgeTextActive: {
    color: "#15803d",
  },
  memberCount: {
    fontSize: 12,
    color: tokens.color.muted,
  },
  center: {
    paddingVertical: 32,
    alignItems: "center",
  },
  errorCard: {
    backgroundColor: "#fff1f2",
    borderRadius: 8,
    padding: 16,
    marginVertical: 12,
  },
  upcomingCard: {
    backgroundColor: "#0f172a",
    borderRadius: 12,
    padding: 20,
    marginVertical: 16,
  },
  upcomingLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#38bdf8",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  upcomingTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 6,
  },
  upcomingTime: {
    fontSize: 14,
    fontWeight: "600",
    color: "#e2e8f0",
  },
  upcomingSubTime: {
    fontSize: 13,
    color: "#94a3b8",
    marginBottom: 14,
  },
  upcomingButton: {
    backgroundColor: tokens.color.brand,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 6,
    alignItems: "center",
    minHeight: 44,
    justifyContent: "center",
  },
  upcomingButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#ffffff",
  },
  sessionSection: {
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: tokens.color.ink,
    marginBottom: 12,
  },
  emptyContainer: {
    backgroundColor: tokens.color.surface,
    borderRadius: 8,
    padding: 24,
    borderWidth: 1,
    borderColor: tokens.color.border,
    alignItems: "center",
  },
  sessionItem: {
    backgroundColor: tokens.color.surface,
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginBottom: 12,
  },
  sessionItemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
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
  sessionStatus: {
    fontSize: 11,
    fontWeight: "600",
    color: tokens.color.muted,
  },
  sessionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: tokens.color.ink,
    marginBottom: 4,
  },
  sessionDate: {
    fontSize: 13,
    color: tokens.color.muted,
    marginBottom: 4,
  },
  sessionLocation: {
    fontSize: 13,
    color: tokens.color.ink,
    marginBottom: 6,
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
  tabSwitchRow: {
    flexDirection: "row",
    backgroundColor: "#F1F5F9",
    borderRadius: 12,
    padding: 3,
    marginBottom: 16,
  },
  tabSwitchBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: "center",
  },
  tabSwitchBtnActive: {
    backgroundColor: "#FFFFFF",
    elevation: 2,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  tabSwitchText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748B",
  },
  tabSwitchTextActive: {
    color: "#0284C7",
    fontWeight: "800",
  },
  tabScrollContainer: {
    marginBottom: 16,
  },
  tabScrollContent: {
    gap: 8,
    paddingVertical: 2,
  },
  tabPillBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  tabPillBtnActive: {
    backgroundColor: "#0284C7",
    borderColor: "#0284C7",
  },
  tabPillText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748B",
  },
  tabPillTextActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  toastBanner: {
    backgroundColor: "#0284C7",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  toastText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  toastClose: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
    marginLeft: 8,
  },
  sessionIndex: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748B",
  },
  docCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 12,
    gap: 8,
  },
  docHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  fileTypePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  pillPdf: {
    backgroundColor: "#FEE2E2",
  },
  pillSql: {
    backgroundColor: "#E0E7FF",
  },
  fileTypeText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#0F172A",
  },
  categoryBadge: {
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  categoryBadgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#475569",
  },
  docFileSize: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
  },
  docTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0F172A",
    lineHeight: 20,
  },
  docMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  docMetaText: {
    fontSize: 12,
    color: "#64748B",
  },
  docActionRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  docPreviewBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
  },
  docPreviewBtnText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#334155",
  },
  docDownloadBtn: {
    flex: 1.2,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#0284C7",
    alignItems: "center",
  },
  docDownloadBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  rosterSummaryCard: {
    backgroundColor: "#F0F9FF",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#BAE6FD",
    marginBottom: 16,
  },
  rosterSummaryTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0369A1",
  },
  rosterSummarySub: {
    fontSize: 12,
    color: "#0284C7",
    marginTop: 2,
  },
  rosterDivider: {
    height: 1,
    backgroundColor: "#BAE6FD",
    marginVertical: 12,
  },
  rosterTeacherRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  rosterTeacherAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#0284C7",
    alignItems: "center",
    justifyContent: "center",
  },
  rosterTeacherAvatarText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 13,
  },
  rosterTeacherName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
  },
  rosterTeacherRole: {
    fontSize: 11,
    color: "#64748B",
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#16A34A",
  },
  recentDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#CBD5E1",
  },
  memberCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 8,
    gap: 10,
  },
  memberAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#E2E8F0",
    alignItems: "center",
    justifyContent: "center",
  },
  memberAvatarOfficer: {
    backgroundColor: "#DBEAFE",
  },
  memberAvatarText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#475569",
  },
  memberAvatarTextOfficer: {
    color: "#1D4ED8",
  },
  memberName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
  },
  officerBadge: {
    backgroundColor: "#FEF3C7",
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  officerBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#B45309",
  },
  memberSubId: {
    fontSize: 11,
    color: "#94A3B8",
  },
  attendanceRate: {
    fontSize: 11,
    fontWeight: "700",
    color: "#0F172A",
  },
  assignmentCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 12,
    gap: 6,
  },
  assignmentTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0F172A",
    marginTop: 4,
    lineHeight: 20,
  },
  assignmentFooter: {
    marginTop: 8,
    gap: 10,
  },
  assignmentAction: {
    width: "100%",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 32,
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  modalEyebrow: {
    fontSize: 11,
    fontWeight: "700",
    color: "#0284C7",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
    lineHeight: 22,
  },
  modalMeta: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 4,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },
  modalInputLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#334155",
    marginTop: 10,
    marginBottom: 6,
  },
  fileAttachmentBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  fileAttachmentName: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0F172A",
  },
  fileAttachmentSize: {
    fontSize: 11,
    color: "#64748B",
    marginTop: 2,
  },
  fileChangeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: "#E0F2FE",
  },
  fileChangeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0284C7",
  },
  modalTextInput: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: "#0F172A",
    minHeight: 80,
    textAlignVertical: "top",
  },
  modalNoticeBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#F0F9FF",
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
  },
  modalNoticeText: {
    flex: 1,
    fontSize: 12,
    color: "#0369A1",
    lineHeight: 16,
  },
  modalActionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCancelText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#64748B",
  },
  modalSubmitBtn: {
    flex: 2,
    flexDirection: "row",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#16A34A",
    alignItems: "center",
    justifyContent: "center",
  },
  modalSubmitText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  gradeScoreCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F0FDF4",
    borderWidth: 1.5,
    borderColor: "#BBF7D0",
    borderRadius: 14,
    padding: 16,
    marginBottom: 6,
  },
  gradeScoreLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#15803D",
    textTransform: "uppercase",
  },
  gradeScoreValue: {
    fontSize: 28,
    fontWeight: "900",
    color: "#16A34A",
    marginTop: 2,
  },
  gradeBadgeIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#DCFCE7",
    alignItems: "center",
    justifyContent: "center",
  },
  teacherFeedbackBox: {
    backgroundColor: "#F8FAFC",
    borderLeftWidth: 3,
    borderLeftColor: "#0284C7",
    borderRadius: 8,
    padding: 12,
  },
  teacherFeedbackText: {
    fontSize: 13,
    color: "#334155",
    fontStyle: "italic",
    lineHeight: 19,
  },
});
