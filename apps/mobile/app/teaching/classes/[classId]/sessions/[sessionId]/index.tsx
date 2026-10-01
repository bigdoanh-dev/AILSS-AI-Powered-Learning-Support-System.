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
import { Page, Button, ScreenHeader, Icon, styles, tokens } from "../../../../../../src/ui";

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
      setMsg("✓ Đã cấp vé hiện diện thành công (hiệu lực 30 giây).");
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
      setMsg("✓ Đã hủy buổi học thành công.");
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
        <ScreenHeader title="Chi tiết buổi học" onBack={() => router.replace("/")} />
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

  const formatTimeOnly = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return iso;
    }
  };

  return (
    <Page>
      <ScreenHeader
        title="Chi tiết buổi học"
        subtitle="Lịch giảng dạy & Quản lý điểm danh"
        onBack={() => router.back()}
      />

      <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        {!item && !error && (
          <View style={sdt.loadingCard}>
            <Text style={styles.text}>Đang tải chi tiết buổi học…</Text>
          </View>
        )}

        {item && (
          <>
            {/* Hero Session Card */}
            <View style={sdt.heroCard}>
              <View style={sdt.heroTopRow}>
                <View style={sdt.heroIconBox}>
                  <Icon
                    name={item.mode === "ONLINE" ? "sparkles" : "class"}
                    size={22}
                    color={tokens.color.brand}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={sdt.heroTitle}>{item.title}</Text>
                  <Text style={sdt.heroSub}>Mã buổi: #{sessionId.slice(0, 10)}</Text>
                </View>
              </View>

              {/* Status Banner */}
              <View
                style={[
                  sdt.statusBanner,
                  item.status === "SCHEDULED"
                    ? sdt.bannerScheduled
                    : item.status === "COMPLETED"
                      ? sdt.bannerCompleted
                      : item.status === "CANCELLED"
                        ? sdt.bannerCancelled
                        : sdt.bannerDraft,
                ]}
              >
                <View
                  style={[
                    sdt.statusDot,
                    item.status === "SCHEDULED"
                      ? { backgroundColor: "#0284C7" }
                      : item.status === "COMPLETED"
                        ? { backgroundColor: "#059669" }
                        : item.status === "CANCELLED"
                          ? { backgroundColor: "#DC2626" }
                          : { backgroundColor: "#D97706" },
                  ]}
                />
                <Text
                  style={[
                    sdt.statusBannerText,
                    item.status === "SCHEDULED"
                      ? { color: "#0369A1" }
                      : item.status === "COMPLETED"
                        ? { color: "#047857" }
                        : item.status === "CANCELLED"
                          ? { color: "#B91C1C" }
                          : { color: "#B45309" },
                  ]}
                >
                  {item.status === "SCHEDULED"
                    ? "SẮP DIỄN RA (SCHEDULED)"
                    : item.status === "COMPLETED"
                      ? "ĐÃ HOÀN THÀNH (COMPLETED)"
                      : item.status === "CANCELLED"
                        ? "ĐÃ HỦY BUỔI HỌC (CANCELLED)"
                        : "BẢN NHÁP (DRAFT)"}
                </Text>
              </View>

              {/* Info Rows Grid */}
              <View style={sdt.infoGrid}>
                <View style={sdt.infoRow}>
                  <Icon name="calendar" size={16} color={tokens.color.muted} />
                  <Text style={sdt.infoLabel}>Thời gian:</Text>
                  <Text style={sdt.infoValue}>
                    {formatDateTime(item.startAt)} — {formatTimeOnly(item.endAt)}
                  </Text>
                </View>

                <View style={sdt.infoRow}>
                  <Icon
                    name={item.mode === "ONLINE" ? "sparkles" : "mapPin"}
                    size={16}
                    color={tokens.color.muted}
                  />
                  <Text style={sdt.infoLabel}>Hình thức:</Text>
                  <View style={[sdt.modeChip, item.mode === "ONLINE" ? sdt.modeOnline : sdt.modeOffline]}>
                    <Text
                      style={[
                        sdt.modeText,
                        item.mode === "ONLINE" ? { color: "#0284C7" } : { color: "#0D9488" },
                      ]}
                    >
                      {item.mode === "ONLINE" ? "Trực tuyến (Online)" : "Trực tiếp (Offline)"}
                    </Text>
                  </View>
                </View>

                <View style={sdt.infoRow}>
                  <Icon name="clock" size={16} color={tokens.color.muted} />
                  <Text style={sdt.infoLabel}>Múi giờ:</Text>
                  <Text style={sdt.infoValue}>{item.timezone}</Text>
                </View>

                {item.location && (
                  <View style={sdt.infoRow}>
                    <Icon name="mapPin" size={16} color={tokens.color.muted} />
                    <Text style={sdt.infoLabel}>Địa điểm:</Text>
                    <Text style={sdt.infoValue}>{item.location}</Text>
                  </View>
                )}

                {item.meetingUrl && (
                  <View style={sdt.infoRow}>
                    <Icon name="sparkles" size={16} color={tokens.color.muted} />
                    <Text style={sdt.infoLabel}>Phòng họp:</Text>
                    <Text style={[sdt.infoValue, { color: tokens.color.brand, fontWeight: "600" }]}>
                      {item.meetingUrl}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Attendance CTA */}
            <Button
              label="Danh sách điểm danh"
              variant="primary"
              icon={<Icon name="checkCircle" size={18} color="#FFFFFF" />}
              onPress={() =>
                router.push(`/teaching/classes/${classId}/sessions/${sessionId}/attendance` as const)
              }
            />

            {/* Online Presence Ticket Generation (CLS-18) */}
            {item.mode === "ONLINE" && (
              <View style={sdt.ticketCard}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Icon name="sparkles" size={18} color="#0284C7" />
                  <Text style={[styles.text, { fontWeight: "700", color: "#0F172A" }]}>
                    Vé hiện diện trực tuyến (CLS-18)
                  </Text>
                </View>
                <Text style={styles.small}>
                  Cấp vé phiên realtime ngắn hạn 30 giây để xác thực học viên có mặt trong phòng họp.
                </Text>
                <Button
                  label={busy ? "Đang cấp…" : "Cấp vé hiện diện realtime"}
                  variant="outline"
                  onPress={handleIssueTicket}
                />
                {ticket && (
                  <View style={sdt.ticketBox}>
                    <Text style={[styles.small, { fontWeight: "700", color: "#0F172A" }]}>Mã vé (30s):</Text>
                    <Text style={sdt.ticketCode}>{ticket.ticket ?? "AUTH-VERIFIED"}</Text>
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
              <Button
                label={busy ? "Đang xử lý…" : "Hủy buổi học này"}
                variant="danger"
                onPress={handleCancelSession}
              />
            )}

            {msg ? (
              <View style={sdt.msgBanner}>
                <Text style={sdt.msgText}>{msg}</Text>
              </View>
            ) : null}
          </>
        )}

        {error ? (
          <View style={sdt.errorCard}>
            <Icon name="alert" size={20} color="#DC2626" />
            <Text style={styles.error}>{error}</Text>
            <Button label="Thử lại" variant="outline" onPress={() => setRetry((v) => v + 1)} />
          </View>
        ) : null}

        <Button label="Quay lại danh sách buổi học" variant="outline" onPress={() => router.back()} />
      </ScrollView>
    </Page>
  );
}

const sdt = StyleSheet.create({
  loadingCard: {
    padding: 24,
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
  },
  heroCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 14,
    ...tokens.shadow.subtle,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  heroIconBox: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: "#E0F2FE",
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#0F172A",
    lineHeight: 22,
  },
  heroSub: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
  },
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  bannerScheduled: {
    backgroundColor: "#F0F9FF",
    borderWidth: 1,
    borderColor: "#BAE6FD",
  },
  bannerCompleted: {
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  bannerCancelled: {
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  bannerDraft: {
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusBannerText: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  infoGrid: {
    gap: 10,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  infoLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748B",
    width: 80,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1E293B",
    flex: 1,
  },
  modeChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  modeOnline: {
    backgroundColor: "#E0F2FE",
  },
  modeOffline: {
    backgroundColor: "#CCFBF1",
  },
  modeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  ticketCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#BAE6FD",
    gap: 10,
    ...tokens.shadow.subtle,
  },
  ticketBox: {
    backgroundColor: "#F0F9FF",
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#BAE6FD",
    marginTop: 4,
    gap: 4,
  },
  ticketCode: {
    fontFamily: "Courier",
    fontSize: 15,
    fontWeight: "800",
    color: "#0369A1",
    letterSpacing: 1,
  },
  msgBanner: {
    backgroundColor: "#ECFDF5",
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  msgText: {
    color: "#047857",
    fontSize: 13,
    fontWeight: "600",
  },
  errorCard: {
    backgroundColor: "#FEF2F2",
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#FECACA",
    alignItems: "center",
    gap: 8,
  },
});
