import { useEffect, useState, useCallback } from "react";
import { Text, View, StyleSheet, ScrollView } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSyncExternalStore } from "react";
import * as Crypto from "expo-crypto";
import { ApiError } from "../../../../../../src/api";
import { runtime } from "../../../../../../src/runtime";
import {
  sessionDetail,
  presenceTicket,
  type ClassSession,
  type PresenceTicket,
} from "../../../../../../src/teaching";
import { Page, Button, styles, tokens } from "../../../../../../src/ui";

export default function SessionDetailScreen() {
  const { classId, sessionId } = useLocalSearchParams<{ classId: string; sessionId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [item, setItem] = useState<ClassSession | null>(null);
  const [ticket, setTicket] = useState<PresenceTicket | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  const fetchDetail = useCallback(
    async (signal?: AbortSignal) => {
      if (!sessionId) return;
      setError("");
      try {
        const val = await session.request(`/api/v1/class-sessions/${sessionId}`, { signal });
        setItem(sessionDetail(val));
      } catch (e: unknown) {
        if (!signal?.aborted) {
          setError(e instanceof ApiError ? e.message : "Không thể tải chi tiết buổi học.");
        }
      }
    },
    [sessionId, session],
  );

  useEffect(() => {
    if (!sessionId || snapshot.user?.role !== "LECTURER") return;
    const abort = new AbortController();
    void fetchDetail(abort.signal);
    return () => abort.abort();
  }, [sessionId, snapshot.user?.role, retry, fetchDetail]);

  const handleIssueTicket = async () => {
    if (!sessionId) return;
    setBusy(true);
    setMsg("");
    try {
      const val = await session.request(`/api/v1/class-sessions/${sessionId}/presence-tickets`, {
        method: "POST",
      });
      const pt = presenceTicket(val);
      setTicket(pt);
      setMsg("Đã cấp vé hiện diện thành công (hiệu lực 30 giây).");
    } catch (e: unknown) {
      setMsg(e instanceof ApiError ? e.message : "Không thể cấp vé hiện diện.");
    } finally {
      setBusy(false);
    }
  };

  const handleCancelSession = async () => {
    if (!classId || !sessionId) return;
    setBusy(true);
    setMsg("");
    try {
      await session.request(`/api/v1/classes/${classId}/sessions/${sessionId}`, {
        method: "PATCH",
        headers: {
          "Idempotency-Key": Crypto.randomUUID(),
        },
        body: { status: "CANCELLED" },
      });
      setMsg("Đã hủy buổi học.");
      setRetry((v) => v + 1);
    } catch (e: unknown) {
      setMsg(e instanceof ApiError ? e.message : "Không thể hủy buổi học.");
    } finally {
      setBusy(false);
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

  const formatDateTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("vi-VN", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  return (
    <Page>
      <ScrollView contentContainerStyle={{ gap: 12 }}>
        {!item && !error && <Text style={styles.text}>Đang tải chi tiết buổi học…</Text>}

        {item && (
          <>
            <Text style={styles.title}>{item.title}</Text>

            <View style={styles.card}>
              <View style={sdt.statusRow}>
                <Text style={styles.small}>Trạng thái:</Text>
                <View
                  style={[
                    sdt.badge,
                    item.status === "SCHEDULED"
                      ? sdt.badgeScheduled
                      : item.status === "COMPLETED"
                        ? sdt.badgeCompleted
                        : item.status === "CANCELLED"
                          ? sdt.badgeCancelled
                          : sdt.badgeDraft,
                  ]}
                >
                  <Text style={sdt.badgeText}>{item.status}</Text>
                </View>
              </View>

              <Text style={styles.small}>
                Hình thức: {item.mode === "ONLINE" ? "Trực tuyến (Online)" : "Trực tiếp (Offline)"}
              </Text>
              <Text style={styles.small}>Bắt đầu: {formatDateTime(item.startAt)}</Text>
              <Text style={styles.small}>Kết thúc: {formatDateTime(item.endAt)}</Text>
              <Text style={styles.small}>Múi giờ: {item.timezone}</Text>

              {item.location && <Text style={styles.small}>Địa điểm: {item.location}</Text>}
              {item.meetingUrl && <Text style={styles.small}>Phòng họp: {item.meetingUrl}</Text>}
            </View>

            {/* Attendance CTA */}
            <Button
              label="Danh sách điểm danh"
              onPress={() =>
                router.push(`/teaching/classes/${classId}/sessions/${sessionId}/attendance` as const)
              }
            />

            {/* Online Presence Ticket Generation (CLS-18) */}
            {item.mode === "ONLINE" && (
              <View style={styles.card}>
                <Text style={[styles.text, { fontWeight: "600" }]}>Vé hiện diện trực tuyến (CLS-18)</Text>
                <Text style={styles.small}>
                  Cấp vé phiên realtime ngắn hạn 30 giây để xác thực học viên có mặt trong phòng họp.
                </Text>
                <Button
                  label={busy ? "Đang cấp…" : "Cấp vé hiện diện realtime"}
                  onPress={handleIssueTicket}
                />
                {ticket && (
                  <View style={sdt.ticketBox}>
                    <Text style={[styles.small, { fontWeight: "600" }]}>Mã vé (30s):</Text>
                    <Text style={styles.small}>
                      Hết hạn:{" "}
                      {ticket.expiresAt ? formatDateTime(ticket.expiresAt) : `${ticket.expiresIn} giây`}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* Cancel Session (CLS-12) */}
            {item.status !== "CANCELLED" && (
              <Button label={busy ? "Đang xử lý…" : "Hủy buổi học này"} onPress={handleCancelSession} />
            )}

            {msg ? <Text style={[styles.small, { color: tokens.color.brand }]}>{msg}</Text> : null}
          </>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {error ? <Button label="Thử lại" onPress={() => setRetry((v) => v + 1)} /> : null}

        <Button label="Quay lại danh sách buổi học" onPress={() => router.back()} />
      </ScrollView>
    </Page>
  );
}

const sdt = StyleSheet.create({
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeDraft: {
    backgroundColor: "#F3F4F6",
  },
  badgeScheduled: {
    backgroundColor: "#EFF6FF",
  },
  badgeCompleted: {
    backgroundColor: "#ECFDF5",
  },
  badgeCancelled: {
    backgroundColor: "#FEF2F2",
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: tokens.color.brand,
  },
  ticketBox: {
    backgroundColor: "#F9FAFB",
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginTop: 8,
    gap: 4,
  },
  ticketCode: {
    fontFamily: "Courier",
    fontSize: 12,
    color: tokens.color.brand,
  },
});
