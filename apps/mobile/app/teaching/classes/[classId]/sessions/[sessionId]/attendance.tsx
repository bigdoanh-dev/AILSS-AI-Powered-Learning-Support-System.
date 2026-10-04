import { useUiText, interfaceMessage, type InterfaceMessage } from "../../../../../../src/use-language";
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
import { Page, Button, ScreenHeader, NonVirtualizedList, styles, tokens } from "../../../../../../src/ui";

const STATUS_LABELS: Record<string, string> = {
  PRESENT: "Có mặt",
  ABSENT: "Vắng",
  EXCUSED: "Có phép",
  NOT_RECORDED: "Chưa ghi nhận",
};

export default function AttendanceScreen() {
  const uiText = useUiText();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [classSessionItem, setClassSessionItem] = useState<ClassSession | null>(null);
  const [roster, setRoster] = useState<AttendanceEntry[] | null>(null);
  const [busyStudentId, setBusyStudentId] = useState<string | null>(null);
  const [msg, setMsg] = useState<InterfaceMessage>("");
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
      } catch (e: unknown) {
        if (!signal?.aborted) {
          setError(e instanceof Error ? e.message : "Không thể tải thông tin buổi học.");
          return;
        }
      }

      try {
        const aVal = await session.request(`/api/v1/class-sessions/${sessionId}/attendance`, { signal });
        setRoster(attendanceRoster(aVal));
      } catch (e: unknown) {
        if (!signal?.aborted) {
          setRoster([]);
          setError(e instanceof Error ? e.message : "Chưa có danh sách điểm danh từ máy chủ.");
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
      setMsg(
        interfaceMessage("✓ Đã cập nhật trạng thái {0} cho học viên.", [
          interfaceMessage(STATUS_LABELS[status]),
        ]),
      );
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
        <Text style={styles.error}>{uiText("Bạn không có quyền truy cập.")}</Text>
        <Button label={uiText("Về trang chủ")} onPress={() => router.replace("/")} />
      </Page>
    );
  }

  const renderAttendanceRow = ({ item, index }: { item: AttendanceEntry; index: number }) => {
    const isBusy = busyStudentId === item.studentId;
    const studentLabel = `${index + 1}. Học viên ${item.studentId.slice(0, 8)}…`;

    return (
      <View style={at.rowCard}>
        <View style={at.rowHeader}>
          <Text style={[styles.text, { fontWeight: "700", color: "#0F172A", flex: 1 }]}>{studentLabel}</Text>
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
          {item.source === "ONLINE_PRESENCE"
            ? uiText("Tự động từ kết nối realtime · {0}", [
                item.presenceState === "ONLINE" ? "đang online" : "đã rời phòng",
              ])
            : item.source === "MANUAL_OFFLINE"
              ? uiText("Thủ công · giảng viên xác nhận")
              : classSessionItem?.mode === "ONLINE"
                ? uiText("Chưa có kết nối realtime · có thể xác nhận thủ công")
                : uiText("Thủ công · chờ giảng viên xác nhận")}
          {item.connectedDurationSeconds > 0
            ? uiText(" · {0} phút", [Math.round(item.connectedDurationSeconds / 60)])
            : ""}
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
            <Text style={at.btnText}>{uiText("✓ Có mặt")}</Text>
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
            <Text style={at.btnText}>{uiText("✕ Vắng")}</Text>
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
            <Text style={at.btnText}>{uiText("⏳ Có phép")}</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <Page>
      <ScreenHeader
        title={uiText("Điểm danh buổi học")}
        subtitle={
          classSessionItem
            ? `${classSessionItem.title} · ${classSessionItem.mode === "ONLINE" ? uiText("Online") : "Offline"}`
            : uiText("Xác nhận chuyên cần học viên")
        }
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/teaching/schedule"))}
      />

      {/* Quick Summary Strip */}
      {roster && roster.length > 0 && (
        <View style={at.statsStrip}>
          <View style={at.statCol}>
            <Text style={at.statNum}>{roster.length}</Text>
            <Text style={at.statLbl}>{uiText("Sĩ số")}</Text>
          </View>
          <View style={at.statCol}>
            <Text style={[at.statNum, { color: "#059669" }]}>
              {roster.filter((r) => r.attendanceStatus === "PRESENT").length}
            </Text>
            <Text style={at.statLbl}>{uiText("Có mặt")}</Text>
          </View>
          <View style={at.statCol}>
            <Text style={[at.statNum, { color: "#DC2626" }]}>
              {roster.filter((r) => r.attendanceStatus === "ABSENT").length}
            </Text>
            <Text style={at.statLbl}>{uiText("Vắng")}</Text>
          </View>
          <View style={at.statCol}>
            <Text style={[at.statNum, { color: "#D97706" }]}>
              {roster.filter((r) => r.attendanceStatus === "EXCUSED").length}
            </Text>
            <Text style={at.statLbl}>{uiText("Có phép")}</Text>
          </View>
        </View>
      )}

      {roster && roster.length > 0 && (
        <View style={at.sourceLegend}>
          <Text style={at.sourceLegendTitle}>
            {classSessionItem?.mode === "ONLINE"
              ? uiText("🌐 Chế độ điểm danh trực tuyến (Online)")
              : uiText("🏫 Chế độ điểm danh trực tiếp (Offline)")}
          </Text>
          <Text style={at.sourceLegendText}>
            {classSessionItem?.mode === "ONLINE"
              ? uiText(
                  "• Tự động: Hệ thống tự động ghi nhận khi học viên vào phòng ({0} học viên).\n• Thủ công: Giảng viên có thể tích chọn Có mặt / Vắng / Có phép bên dưới để ghi đè hoặc bổ sung.",
                  [roster.filter((r) => r.source === "ONLINE_PRESENCE").length],
                )
              : uiText(
                  "• Điểm danh tại lớp: Giảng viên điểm danh thủ công theo danh sách bằng cách tích chọn Có mặt, Vắng hoặc Có phép cho từng học viên.",
                )}
          </Text>
        </View>
      )}

      {/* Quick Action Button */}
      {roster && roster.length > 0 && (
        <View style={{ marginBottom: 12 }}>
          <Pressable
            accessibilityRole="button"
            disabled={busyStudentId !== null}
            style={at.quickAllBtn}
            onPress={handleMarkAllPresent}
          >
            <Text style={at.quickAllBtnText}>{uiText("✓ Đánh dấu tất cả Có mặt")}</Text>
          </Pressable>
        </View>
      )}

      {msg ? (
        <View style={at.msgBox}>
          <Text style={at.msgText}>{uiText(msg)}</Text>
        </View>
      ) : null}

      {roster && roster.length === 0 && (
        <View style={styles.card}>
          <Text style={styles.text}>{uiText("Chưa có bản ghi điểm danh nào.")}</Text>
          <Text style={styles.small}>
            {uiText("Học viên trong lớp sẽ xuất hiện trong danh sách điểm danh của buổi học.")}
          </Text>
        </View>
      )}

      {roster && roster.length > 0 && (
        <NonVirtualizedList
          data={roster}
          keyExtractor={(item) => item.studentId}
          renderItem={renderAttendanceRow}
          contentContainerStyle={{ gap: 10, paddingBottom: 16 }}
        />
      )}

      {error ? (
        <View style={at.errorCard}>
          <View style={at.errorIconBox}>
            <Text style={{ fontSize: 24 }}>⚠️</Text>
          </View>
          <Text style={at.errorTitle}>{uiText("Lỗi kết nối điểm danh")}</Text>
          <Text style={at.errorDesc}>{uiText(error)}</Text>
          <View style={{ flexDirection: "row", gap: 10, marginTop: 6, width: "100%" }}>
            <View style={{ flex: 1 }}>
              <Button label={uiText("Thử lại")} variant="primary" onPress={() => setRetry((v) => v + 1)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label={uiText("Quay lại")}
                variant="outline"
                onPress={() => (router.canGoBack() ? router.back() : router.replace("/teaching/schedule"))}
              />
            </View>
          </View>
        </View>
      ) : (
        <Button
          label={uiText("Quay lại")}
          variant="outline"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/teaching/schedule"))}
        />
      )}
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
  sourceLegend: {
    backgroundColor: "#F0F9FF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#BAE6FD",
    padding: 12,
    marginBottom: 10,
    gap: 4,
  },
  sourceLegendTitle: {
    color: "#075985",
    fontWeight: "800",
    fontSize: 13,
  },
  sourceLegendText: {
    color: "#334155",
    fontSize: 12,
    lineHeight: 18,
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
  errorCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 24,
    borderWidth: 1,
    borderColor: "#FECACA",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
    ...tokens.shadow.subtle,
  },
  errorIconBox: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#991B1B",
    textAlign: "center",
  },
  errorDesc: {
    fontSize: 13,
    color: "#64748B",
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 8,
  },
});
