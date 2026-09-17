import { useSyncExternalStore, useState, useEffect, useCallback } from "react";
import {
  Text,
  View,
  Alert,
  Linking,
  ActivityIndicator,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { runtime } from "../../../../src/runtime";
import {
  sessionDetail,
  studentAttendance,
  safeMeetingUrl,
  formatDate,
  formatTimeRange,
  parseTimestamp,
  type ClassSession,
  type StudentAttendanceEntry,
} from "../../../../src/classroom";
import { ApiError } from "../../../../src/api";
import { Page, Button, styles, tokens } from "../../../../src/ui";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function SessionDetailScreen() {
  const { classId, sessionId } = useLocalSearchParams<{ classId: string; sessionId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [sessionInfo, setSessionInfo] = useState<ClassSession | null>(null);
  const [attendanceInfo, setAttendanceInfo] = useState<StudentAttendanceEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isValidClassId = typeof classId === "string" && UUID_REGEX.test(classId);
  const isValidSessionId = typeof sessionId === "string" && UUID_REGEX.test(sessionId);

  const fetchSessionDetails = useCallback(async () => {
    if (!isValidSessionId || snapshot.state !== "AUTHENTICATED") return;
    try {
      setError(null);

      // 1. Fetch session detail (CLS-14)
      const data = await session.request(`/api/v1/class-sessions/${sessionId}`);
      const parsed = sessionDetail(data);
      setSessionInfo(parsed);

      // 2. Fetch student attendance for this month (CLS-17)
      try {
        const sessionMonth = parsed.startAt.slice(0, 7); // YYYY-MM
        const attData = await session.request(`/api/v1/me/attendance?month=${sessionMonth}`);
        const attendanceList = studentAttendance(attData);
        const match = attendanceList.find((a) => a.sessionId === sessionId);
        if (match) {
          setAttendanceInfo(match);
        }
      } catch {
        // Attendance history is non-fatal for session viewing
      }
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        if (e.status === 401) {
          setError("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.");
        } else if (e.status === 403) {
          setError("Bạn không có quyền truy cập buổi học này.");
        } else if (e.status === 404) {
          setError("Không tìm thấy thông tin buổi học.");
        } else {
          setError(e.message || "Không thể tải chi tiết buổi học.");
        }
      } else {
        setError("Lỗi kết nối mạng. Vui lòng thử lại.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isValidSessionId, sessionId, snapshot.state, session]);

  useEffect(() => {
    if (isValidSessionId) {
      setLoading(true);
      void fetchSessionDetails();
    }
  }, [isValidSessionId, fetchSessionDetails]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchSessionDetails();
  }, [fetchSessionDetails]);

  const handleOpenMeeting = (url: string) => {
    const validated = safeMeetingUrl(url);
    if (!validated) {
      Alert.alert("Đường dẫn không an toàn", "Liên kết phòng họp không hợp lệ hoặc không an toàn để mở.");
      return;
    }

    Alert.alert(
      "Mở phòng học trực tuyến",
      "Bạn sắp rời ứng dụng AILSS để chuyển tới nền tảng phòng học bên ngoài. Bạn có muốn tiếp tục?",
      [
        { text: "Hủy", style: "cancel" },
        {
          text: "Mở liên kết",
          onPress: () => {
            void Linking.openURL(validated).catch(() => {
              Alert.alert("Lỗi", "Không thể mở ứng dụng họp trực tuyến trên thiết bị này.");
            });
          },
        },
      ],
    );
  };

  if (!isValidClassId || !isValidSessionId) {
    return (
      <Page>
        <Text style={styles.small}>LỖI ĐỊNH DẠNG</Text>
        <Text style={styles.title}>Đường dẫn không hợp lệ</Text>
        <Text style={styles.text}>Mã định danh buổi học hoặc lớp học không đúng chuẩn.</Text>
        <Button label="Quay lại lớp học" onPress={() => router.push(`/classes/${classId}`)} />
      </Page>
    );
  }

  if (snapshot.state !== "AUTHENTICATED") {
    return (
      <Page>
        <Text style={styles.small}>CHI TIẾT BUỔI HỌC</Text>
        <Text style={styles.title}>Yêu cầu đăng nhập</Text>
        <Text style={styles.text}>Vui lòng đăng nhập để xem thông tin chi tiết buổi học.</Text>
        <Button label="Đăng nhập" onPress={() => router.push("/login")} />
        <Button label="Quay lại" onPress={() => router.push(`/classes/${classId}`)} />
      </Page>
    );
  }

  const start = sessionInfo ? parseTimestamp(sessionInfo.startAt) : null;
  const end = sessionInfo ? parseTimestamp(sessionInfo.endAt) : null;
  const isOnline = sessionInfo?.mode === "ONLINE";

  // Attendance status mapping
  let attendanceLabel = "Chưa ghi nhận";
  let attendanceBadgeStyle = localStyles.badgeSlate;
  let attendanceTextStyle = localStyles.badgeTextSlate;

  if (attendanceInfo) {
    switch (attendanceInfo.attendanceStatus) {
      case "PRESENT":
        attendanceLabel = "Có mặt";
        attendanceBadgeStyle = localStyles.badgeGreen;
        attendanceTextStyle = localStyles.badgeTextGreen;
        break;
      case "ABSENT":
        attendanceLabel = "Vắng mặt";
        attendanceBadgeStyle = localStyles.badgeRed;
        attendanceTextStyle = localStyles.badgeTextRed;
        break;
      case "EXCUSED":
        attendanceLabel = "Có phép";
        attendanceBadgeStyle = localStyles.badgeAmber;
        attendanceTextStyle = localStyles.badgeTextAmber;
        break;
    }
  }

  return (
    <ScrollView
      style={localStyles.container}
      contentContainerStyle={localStyles.contentContainer}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tokens.color.brand} />
      }
    >
      <Text style={styles.small}>THÔNG TIN BUỔI HỌC</Text>
      <Text style={styles.title}>{sessionInfo?.title ?? "Đang tải…"}</Text>

      {/* Badges */}
      {sessionInfo && (
        <View style={localStyles.badgeRow}>
          <View style={[localStyles.badge, isOnline ? localStyles.badgeOnline : localStyles.badgeOffline]}>
            <Text
              style={[
                localStyles.badgeText,
                isOnline ? localStyles.badgeTextOnline : localStyles.badgeTextOffline,
              ]}
            >
              {isOnline ? "TRỰC TUYẾN" : "TRỰC TIẾP"}
            </Text>
          </View>
          <View style={[localStyles.badge, localStyles.badgeStatus]}>
            <Text style={localStyles.badgeTextStatus}>{sessionInfo.status}</Text>
          </View>
        </View>
      )}

      {/* Loading state */}
      {loading && !refreshing && (
        <View style={localStyles.center}>
          <ActivityIndicator size="large" color={tokens.color.brand} />
          <Text style={[styles.text, { marginTop: 12 }]}>Đang tải chi tiết buổi học…</Text>
        </View>
      )}

      {/* Error state */}
      {error && !loading && (
        <View style={localStyles.errorCard}>
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
          <Button label="Thử lại" onPress={() => void fetchSessionDetails()} />
        </View>
      )}

      {/* Session Details Card */}
      {!loading && !error && sessionInfo && start && end && (
        <View style={localStyles.card}>
          <Text style={localStyles.cardHeader}>Thời gian & Địa điểm</Text>

          <View style={localStyles.infoRow}>
            <Text style={localStyles.infoLabel}>Ngày học:</Text>
            <Text style={localStyles.infoValue}>{formatDate(start, sessionInfo.timezone)}</Text>
          </View>

          <View style={localStyles.infoRow}>
            <Text style={localStyles.infoLabel}>Khung giờ:</Text>
            <Text style={localStyles.infoValue}>{formatTimeRange(start, end, sessionInfo.timezone)}</Text>
          </View>

          <View style={localStyles.infoRow}>
            <Text style={localStyles.infoLabel}>Múi giờ:</Text>
            <Text style={localStyles.infoValue}>{sessionInfo.timezone}</Text>
          </View>

          {isOnline ? (
            <View style={localStyles.infoBlock}>
              <Text style={localStyles.infoLabel}>Hình thức trực tuyến:</Text>
              <Text style={localStyles.infoValue}>
                Nền tảng: {sessionInfo.meetingProvider || "Phòng học trực tuyến"}
              </Text>

              {sessionInfo.meetingUrl ? (
                <View style={{ marginTop: 14 }}>
                  <Button
                    label="Tham gia phòng học trực tuyến"
                    onPress={() => handleOpenMeeting(sessionInfo.meetingUrl!)}
                  />
                </View>
              ) : (
                <View style={localStyles.noticeBox}>
                  <Text style={localStyles.noticeText}>
                    Đường dẫn phòng học sẽ được hệ thống hiển thị khi đến khung giờ diễn ra buổi học.
                  </Text>
                </View>
              )}
            </View>
          ) : (
            <View style={localStyles.infoBlock}>
              <Text style={localStyles.infoLabel}>Địa điểm lớp học trực tiếp:</Text>
              <Text style={[localStyles.infoValue, { fontWeight: "700" }]}>
                {sessionInfo.location || "Chưa cập nhật địa điểm cụ thể"}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Attendance Record Card */}
      {!loading && !error && sessionInfo && (
        <View style={localStyles.card}>
          <Text style={localStyles.cardHeader}>Trạng thái điểm danh</Text>

          <View style={localStyles.attendanceRow}>
            <Text style={localStyles.infoLabel}>Kết quả ghi nhận:</Text>
            <View style={[localStyles.badge, attendanceBadgeStyle]}>
              <Text style={[localStyles.badgeText, attendanceTextStyle]}>{attendanceLabel}</Text>
            </View>
          </View>

          {attendanceInfo && attendanceInfo.connectedDurationSeconds > 0 && (
            <View style={localStyles.infoRow}>
              <Text style={localStyles.infoLabel}>Thời gian tham gia:</Text>
              <Text style={localStyles.infoValue}>
                {Math.round(attendanceInfo.connectedDurationSeconds / 60)} phút
              </Text>
            </View>
          )}

          <Text style={localStyles.attendanceNote}>
            Dữ liệu điểm danh được đồng bộ tự động từ hệ thống hoặc do giảng viên phụ trách xác nhận.
          </Text>
        </View>
      )}

      <View style={{ marginTop: 24 }}>
        <Button label="Quay lại chi tiết lớp" onPress={() => router.push(`/classes/${classId}`)} />
      </View>
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
    gap: 8,
    marginVertical: 12,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
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
  badgeStatus: {
    backgroundColor: "#f1f5f9",
  },
  badgeTextStatus: {
    fontSize: 11,
    fontWeight: "600",
    color: tokens.color.muted,
  },
  badgeGreen: {
    backgroundColor: "#dcfce7",
  },
  badgeTextGreen: {
    color: "#15803d",
  },
  badgeRed: {
    backgroundColor: "#fee2e2",
  },
  badgeTextRed: {
    color: "#b91c1c",
  },
  badgeAmber: {
    backgroundColor: "#fef3c7",
  },
  badgeTextAmber: {
    color: "#b45309",
  },
  badgeSlate: {
    backgroundColor: "#f1f5f9",
  },
  badgeTextSlate: {
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
  card: {
    backgroundColor: tokens.color.surface,
    borderRadius: 10,
    padding: 20,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginBottom: 16,
  },
  cardHeader: {
    fontSize: 16,
    fontWeight: "700",
    color: tokens.color.ink,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
    paddingBottom: 10,
    marginBottom: 14,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  infoBlock: {
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#f8fafc",
  },
  infoLabel: {
    fontSize: 13,
    color: tokens.color.muted,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.color.ink,
  },
  noticeBox: {
    backgroundColor: "#f8fafc",
    padding: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    marginTop: 10,
  },
  noticeText: {
    fontSize: 12,
    color: tokens.color.muted,
    lineHeight: 18,
  },
  attendanceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  attendanceNote: {
    fontSize: 12,
    color: tokens.color.muted,
    lineHeight: 16,
    marginTop: 10,
  },
});
