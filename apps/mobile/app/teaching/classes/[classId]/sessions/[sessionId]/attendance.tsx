import { useEffect, useState, useCallback } from "react";
import { Text, View, StyleSheet, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSyncExternalStore } from "react";
import * as Crypto from "expo-crypto";
import { runtime } from "../../../../../../src/runtime";
import {
  sessionDetail,
  attendanceRoster,
  type ClassSession,
  type AttendanceEntry,
} from "../../../../../../src/teaching";
import { Page, Button, NonVirtualizedList, styles, tokens } from "../../../../../../src/ui";

const STATUS_LABELS: Record<string, string> = {
  PRESENT: "Có mặt",
  ABSENT: "Vắng",
  EXCUSED: "Có phép",
  NOT_RECORDED: "Chưa ghi nhận",
};

export default function AttendanceScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [classSessionItem, setClassSessionItem] = useState<ClassSession | null>(null);
  const [roster, setRoster] = useState<AttendanceEntry[] | null>(null);
  const [busyStudentId, setBusyStudentId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  const fetchData = useCallback(
    async (signal?: AbortSignal) => {
      if (!sessionId) return;
      setError("");
      try {
        const sVal = await session.request(`/api/v1/class-sessions/${sessionId}`, { signal });
        const sess = sessionDetail(sVal);
        setClassSessionItem(sess);

        const aVal = await session.request(`/api/v1/class-sessions/${sessionId}/attendance`, { signal });
        setRoster(attendanceRoster(aVal));
      } catch {
        if (!signal?.aborted) {
          setClassSessionItem(null);
          setRoster(null);
          setError("Không thể xác minh buổi học và danh sách điểm danh từ máy chủ.");
        }
      }
    },
    [sessionId, session],
  );

  useEffect(() => {
    if (!sessionId || snapshot.user?.role !== "LECTURER") return;
    const abort = new AbortController();
    void fetchData(abort.signal);
    return () => abort.abort();
  }, [sessionId, snapshot.user?.role, retry, fetchData]);

  const handleMarkAttendance = async (
    studentId: string,
    status: "PRESENT" | "ABSENT" | "EXCUSED",
    currentVersion: number,
  ) => {
    if (!sessionId) return;
    setBusyStudentId(studentId);
    setMsg("");
    try {
      await session.request(`/api/v1/class-sessions/${sessionId}/attendance/${studentId}`, {
        method: "PUT",
        headers: {
          "Idempotency-Key": Crypto.randomUUID(),
          "If-Match": `"v${currentVersion}"`,
        },
        body: {
          attendanceStatus: status,
        },
      });
      setMsg(`✓ Đã cập nhật trạng thái ${STATUS_LABELS[status]} cho học viên.`);
      await fetchData();
    } catch {
      setMsg("Không thể cập nhật điểm danh; dữ liệu cục bộ không được thay đổi khi máy chủ chưa xác nhận.");
    } finally {
      setBusyStudentId(null);
    }
  };

  const handleMarkAllPresent = async () => {
    if (!sessionId || !roster) return;
    setMsg("");
    setBusyStudentId("ALL");
    try {
      await Promise.all(
        roster
          .filter((item) => item.attendanceStatus !== "PRESENT")
          .map((item) =>
            session.request(`/api/v1/class-sessions/${sessionId}/attendance/${item.studentId}`, {
              method: "PUT",
              headers: { "Idempotency-Key": Crypto.randomUUID(), "If-Match": `"v${item.attendanceVersion}"` },
              body: { attendanceStatus: "PRESENT" },
            }),
          ),
      );
      await fetchData();
      setMsg("✓ Máy chủ đã xác nhận điểm danh Có mặt cho toàn bộ học viên.");
    } catch {
      setMsg("Không thể điểm danh hàng loạt; màn hình sẽ tải lại dữ liệu đã được máy chủ xác nhận.");
      await fetchData();
    } finally {
      setBusyStudentId(null);
    }
  };

  if (snapshot.user?.role !== "LECTURER") {
    return (
      <Page>
        <Text style={styles.error}>Bạn không có quyền truy cập.</Text>
        <Button label="Về trang chủ" onPress={() => router.replace("/")} />
      </Page>
    );
  }

  const renderAttendanceRow = ({ item, index }: { item: AttendanceEntry; index: number }) => {
    const isBusy = busyStudentId === item.studentId;
    const studentLabel = `${index + 1}. Học viên ${item.studentId.slice(0, 8)}…`;

    return (
      <View style={at.rowCard}>
        <View style={at.rowHeader}>
          <Text style={[styles.text, { fontWeight: "700", color: "#0F172A", flex: 1 }]}>
            {studentLabel}
          </Text>
          <View
            style={[
              at.statusChip,
              item.attendanceStatus === "PRESENT"
                ? at.statusPresent
                : item.attendanceStatus === "ABSENT"
                  ? at.statusAbsent
                  : item.attendanceStatus === "EXCUSED"
                    ? at.statusExcused
                    : at.statusNotRecorded,
            ]}
          >
            <Text style={at.statusText}>{STATUS_LABELS[item.attendanceStatus] ?? item.attendanceStatus}</Text>
          </View>
        </View>

        <Text style={styles.small}>
          Nguồn: {item.source} · Hiện diện: {item.presenceState}
          {item.connectedDurationSeconds > 0 ? ` · ${Math.round(item.connectedDurationSeconds / 60)} phút` : ""}
        </Text>

        <View style={at.actionButtons}>
          <Pressable
            accessibilityRole="button"
            disabled={isBusy || item.attendanceStatus === "PRESENT"}
            onPress={() => handleMarkAttendance(item.studentId, "PRESENT", item.attendanceVersion)}
            style={[
              at.btnStatus,
              at.btnPresent,
              (isBusy || item.attendanceStatus === "PRESENT") && at.btnDisabled,
            ]}
          >
            <Text style={at.btnText}>✓ Có mặt</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={isBusy || item.attendanceStatus === "ABSENT"}
            onPress={() => handleMarkAttendance(item.studentId, "ABSENT", item.attendanceVersion)}
            style={[
              at.btnStatus,
              at.btnAbsent,
              (isBusy || item.attendanceStatus === "ABSENT") && at.btnDisabled,
            ]}
          >
            <Text style={at.btnText}>✕ Vắng</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            disabled={isBusy || item.attendanceStatus === "EXCUSED"}
            onPress={() => handleMarkAttendance(item.studentId, "EXCUSED", item.attendanceVersion)}
            style={[
              at.btnStatus,
              at.btnExcused,
              (isBusy || item.attendanceStatus === "EXCUSED") && at.btnDisabled,
            ]}
          >
            <Text style={at.btnText}>⏳ Có phép</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <Page>
      <Text style={styles.title}>Điểm danh buổi học</Text>
      {classSessionItem && (
        <Text style={[styles.small, { marginBottom: 8 }]}>
          {classSessionItem.title} · {classSessionItem.mode === "ONLINE" ? "Trực tuyến" : "Trực tiếp"} ·{" "}
          {classSessionItem.status}
        </Text>
      )}

      {/* Quick Summary Strip */}
      {roster && roster.length > 0 && (
        <View style={at.statsStrip}>
          <View style={at.statCol}>
            <Text style={at.statNum}>{roster.length}</Text>
            <Text style={at.statLbl}>Sĩ số</Text>
          </View>
          <View style={at.statCol}>
            <Text style={[at.statNum, { color: "#16A34A" }]}>
              {roster.filter((r) => r.attendanceStatus === "PRESENT").length}
            </Text>
            <Text style={at.statLbl}>Có mặt</Text>
          </View>
          <View style={at.statCol}>
            <Text style={[at.statNum, { color: "#DC2626" }]}>
              {roster.filter((r) => r.attendanceStatus === "ABSENT").length}
            </Text>
            <Text style={at.statLbl}>Vắng</Text>
          </View>
          <View style={at.statCol}>
            <Text style={[at.statNum, { color: "#D97706" }]}>
              {roster.filter((r) => r.attendanceStatus === "EXCUSED").length}
            </Text>
            <Text style={at.statLbl}>Có phép</Text>
          </View>
        </View>
      )}

      {/* Quick Action Button */}
      {roster && roster.length > 0 && (
        <View style={{ marginBottom: 10 }}>
          <Pressable
            accessibilityRole="button"
            disabled={busyStudentId !== null}
            style={at.quickAllBtn}
            onPress={handleMarkAllPresent}
          >
            <Text style={at.quickAllBtnText}>✓ Đánh dấu tất cả Có mặt</Text>
          </Pressable>
        </View>
      )}

      {msg ? (
        <View style={at.msgBox}>
          <Text style={at.msgText}>{msg}</Text>
        </View>
      ) : null}

      {roster && roster.length === 0 && (
        <View style={styles.card}>
          <Text style={styles.text}>Chưa có bản ghi điểm danh nào.</Text>
          <Text style={styles.small}>
            Học viên trong lớp sẽ xuất hiện trong danh sách điểm danh của buổi học.
          </Text>
        </View>
      )}

      {roster && roster.length > 0 && (
        <NonVirtualizedList
          data={roster}
          keyExtractor={(item) => item.studentId}
          renderItem={renderAttendanceRow}
          contentContainerStyle={{ gap: 8, paddingBottom: 16 }}
        />
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {error ? <Button label="Thử lại" onPress={() => setRetry((v) => v + 1)} /> : null}

      <Button label="Quay lại" onPress={() => (router.canGoBack() ? router.back() : router.replace("/teaching/schedule"))} />
    </Page>
  );
}

const at = StyleSheet.create({
  noticeCard: {
    backgroundColor: "#F9FAFB",
    borderWidth: 1,
    borderColor: tokens.color.border,
    padding: 10,
    marginBottom: 8,
  },
  rowCard: {
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: tokens.color.border,
    padding: 12,
    gap: 8,
  },
  rowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statusChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  statusPresent: {
    backgroundColor: "#DCFCE7",
  },
  statusAbsent: {
    backgroundColor: "#FEE2E2",
  },
  statusExcused: {
    backgroundColor: "#FEF3C7",
  },
  statusNotRecorded: {
    backgroundColor: "#F3F4F6",
  },
  statusText: {
    fontSize: 11,
    fontWeight: "700",
    color: tokens.color.brand,
  },
  actionButtons: {
    flexDirection: "row",
    gap: 6,
    marginTop: 4,
  },
  btnStatus: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  btnPresent: {
    backgroundColor: "#16A34A",
  },
  btnAbsent: {
    backgroundColor: "#DC2626",
  },
  btnExcused: {
    backgroundColor: "#D97706",
  },
  btnDisabled: {
    opacity: 0.35,
  },
  btnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  statsStrip: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 10,
    justifyContent: "space-between",
  },
  statCol: {
    alignItems: "center",
    flex: 1,
  },
  statNum: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0F172A",
  },
  statLbl: {
    fontSize: 11,
    color: "#64748B",
    fontWeight: "600",
    marginTop: 2,
  },
  quickAllBtn: {
    backgroundColor: "#E0F2FE",
    borderWidth: 1,
    borderColor: "#0284C7",
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  quickAllBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0284C7",
  },
  msgBox: {
    backgroundColor: "#DCFCE7",
    borderWidth: 1,
    borderColor: "#86EFAC",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 10,
  },
  msgText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#15803D",
  },
});
