import { useLanguage } from "../../../../../src/use-language";
import { useUiText } from "../../../../../src/use-language";
import { useEffect, useState, useCallback } from "react";
import { Text, View, StyleSheet } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSyncExternalStore } from "react";
import { ApiError } from "../../../../../src/api";
import { runtime } from "../../../../../src/runtime";
import {
  ownedClass,
  classSessions,
  rangeForMonth,
  type OwnedClass,
  type ClassSession,
} from "../../../../../src/teaching";
import { Page, Button, ScreenHeader, Icon, NonVirtualizedList, styles, tokens } from "../../../../../src/ui";
import { ScalePressable, FadeSlideIn } from "../../../../../src/motion";

export default function ClassSessionsList() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const { classId } = useLocalSearchParams<{ classId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [cls, setCls] = useState<OwnedClass | null>(null);
  const [items, setItems] = useState<ClassSession[] | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  const fetchData = useCallback(
    async (signal?: AbortSignal) => {
      if (!classId) return;
      setError("");
      try {
        const classVal = await session.request(`/api/v1/classes/${classId}`, { signal });
        setCls(ownedClass(classVal));

        const range = rangeForMonth();
        const sessionsVal = await session.request(
          `/api/v1/classes/${classId}/sessions?from=${range.from}&to=${range.to}`,
          { signal },
        );
        setItems(classSessions(sessionsVal));
      } catch (e: unknown) {
        if (!signal?.aborted) {
          setCls(null);
          setItems(null);
          setError(e instanceof ApiError ? e.message : "Không thể tải lịch học từ máy chủ.");
        }
      }
    },
    [classId, session],
  );

  useEffect(() => {
    if (!classId || snapshot.user?.role !== "LECTURER") return;
    const abort = new AbortController();
    void fetchData(abort.signal);
    return () => abort.abort();
  }, [classId, snapshot.user?.role, retry, fetchData]);

  if (snapshot.user?.role !== "LECTURER") {
    return (
      <Page>
        <ScreenHeader title={uiText("Lịch buổi học")} onBack={() => router.replace("/")} />
        <Text style={styles.error}>{uiText("Bạn không có quyền truy cập.")}</Text>
        <Button label={uiText("Về trang chủ")} onPress={() => router.replace("/")} />
      </Page>
    );
  }

  const formatDateTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(uiLocale, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  const renderItem = ({ item }: { item: ClassSession }) => {
    const isOnline = item.mode === "ONLINE";
    return (
      <ScalePressable
        accessibilityRole="button"
        accessibilityLabel={uiText("Buổi học: {0}", [item.title])}
        onPress={() => router.push(`/teaching/classes/${classId}/sessions/${item.sessionId}` as const)}
        style={sl.card}
      >
        <View style={[sl.cardSideStripe, { backgroundColor: isOnline ? "#0284C7" : "#D97706" }]} />
        <View style={sl.cardContent}>
          <View style={sl.cardHeader}>
            <View style={sl.cardIconWrap}>
              <Icon name={isOnline ? "sparkles" : "class"} size={16} color={tokens.color.brand} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={sl.cardTitle}>{item.title}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Icon name="clock" size={13} color={tokens.color.muted} />
                <Text style={sl.cardTimeText}>
                  {formatDateTime(item.startAt)} — {formatDateTime(item.endAt)}
                </Text>
              </View>
            </View>
            <View
              style={[
                sl.badge,
                item.status === "SCHEDULED"
                  ? sl.badgeScheduled
                  : item.status === "COMPLETED"
                    ? sl.badgeCompleted
                    : item.status === "CANCELLED"
                      ? sl.badgeCancelled
                      : sl.badgeDraft,
              ]}
            >
              <Text
                style={[
                  sl.badgeText,
                  item.status === "SCHEDULED"
                    ? { color: "#0369A1" }
                    : item.status === "COMPLETED"
                      ? { color: "#047857" }
                      : item.status === "CANCELLED"
                        ? { color: "#B91C1C" }
                        : { color: "#B45309" },
                ]}
              >
                {item.status}
              </Text>
            </View>
          </View>

          <View style={sl.metaRow}>
            <View style={[sl.modePill, isOnline ? sl.modeOnline : sl.modeOffline]}>
              <Text style={[sl.modeText, isOnline ? { color: "#0284C7" } : { color: "#0D9488" }]}>
                {isOnline ? uiText("Trực tuyến") : uiText("Trực tiếp")}
              </Text>
            </View>
            {item.location ? (
              <View style={sl.metaItem}>
                <Icon name="mapPin" size={13} color="#64748B" />
                <Text style={sl.metaText} numberOfLines={1}>
                  {item.location}
                </Text>
              </View>
            ) : null}
            <View style={{ marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 2 }}>
              <Text style={sl.detailActionText}>{uiText("Chi tiết")}</Text>
              <Icon name="chevronRight" size={14} color={tokens.color.brand} />
            </View>
          </View>
        </View>
      </ScalePressable>
    );
  };

  return (
    <Page>
      <ScreenHeader
        title={uiText("Lịch buổi học")}
        subtitle={cls ? uiText("Lớp: {0}", [cls.name]) : uiText("Danh sách các buổi học giảng dạy")}
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace(`/teaching/classes/${classId}` as const)
        }
      />

      {cls && (
        <FadeSlideIn duration={280}>
          <View style={sl.classBanner}>
            <View style={sl.classIconBox}>
              <Icon name="class" size={24} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={sl.classNameText}>{cls.name}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <View
                  style={[
                    sl.statusBadge,
                    cls.scheduleState === "PUBLISHED" ? sl.statusBadgePublished : sl.statusBadgeDraft,
                  ]}
                >
                  <View
                    style={[
                      sl.statusDot,
                      {
                        backgroundColor: cls.scheduleState === "PUBLISHED" ? tokens.color.success : "#D97706",
                      },
                    ]}
                  />
                  <Text
                    style={[
                      sl.statusBadgeText,
                      cls.scheduleState === "PUBLISHED" ? { color: "#166534" } : { color: "#92400E" },
                    ]}
                  >
                    {uiText("Lịch: ")}
                    {cls.scheduleState === "PUBLISHED" ? uiText("ĐÃ XUẤT BẢN") : uiText("BẢN NHÁP")}
                  </Text>
                </View>
                {items && (
                  <View style={sl.countPill}>
                    <Icon name="calendar" size={12} color={tokens.color.muted} />
                    <Text style={{ fontSize: 12, color: tokens.color.inkSecondary, fontWeight: "700" }}>
                      {items.length} {uiText(" buổi học")}
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>
        </FadeSlideIn>
      )}

      {cls?.scheduleState === "DRAFT" && (
        <View style={{ marginBottom: 12 }}>
          <Button
            label={uiText("Thêm buổi học mới")}
            variant="primary"
            icon={<Icon name="add" size={16} color="#FFFFFF" />}
            onPress={() => router.push(`/teaching/classes/${classId}/sessions/create` as const)}
          />
        </View>
      )}

      {items && items.length === 0 && (
        <FadeSlideIn duration={320}>
          <View style={sl.emptyCard}>
            <View style={sl.emptyIconRing}>
              <View style={sl.emptyIconCircle}>
                <Icon name="calendar" size={28} color="#FFFFFF" />
              </View>
            </View>
            <Text style={sl.emptyTitle}>{uiText("Chưa có buổi học nào trong lịch")}</Text>
            <Text style={sl.emptySubtitle}>
              {cls?.scheduleState === "DRAFT"
                ? uiText("Hãy tạo buổi học đầu tiên trước khi xuất bản lịch cho học viên.")
                : uiText("Lịch đã xuất bản hoặc không có buổi học trong khoảng thời gian này.")}
            </Text>

            <View style={sl.tipBox}>
              <Icon name="sparkles" size={16} color={tokens.color.brand} />
              <Text style={sl.tipText}>
                {uiText(
                  "Khi tạo buổi học, bạn có thể thiết lập hình thức Trực tuyến (kèm link Meet/Zoom) hoặc Tại lớp, thời gian và địa điểm chi tiết.",
                )}
              </Text>
            </View>

            {cls?.scheduleState === "DRAFT" && (
              <Button
                label={uiText("Tạo buổi học đầu tiên")}
                icon={<Icon name="add" size={16} color="#FFFFFF" />}
                onPress={() => router.push(`/teaching/classes/${classId}/sessions/create` as const)}
              />
            )}
          </View>
        </FadeSlideIn>
      )}

      {items && items.length > 0 && (
        <FadeSlideIn duration={320}>
          <NonVirtualizedList
            data={items}
            keyExtractor={(item) => item.sessionId}
            renderItem={renderItem}
            contentContainerStyle={{ gap: 10, paddingBottom: 14 }}
          />
        </FadeSlideIn>
      )}

      {error ? (
        <View style={sl.errorCard}>
          <Icon name="alert" size={18} color="#DC2626" />
          <Text accessibilityRole="alert" style={styles.error}>
            {uiText(error)}
          </Text>
          <Button label={uiText("Thử lại")} variant="outline" onPress={() => setRetry((v) => v + 1)} />
        </View>
      ) : null}

      <View style={{ marginTop: 8 }}>
        <Button
          label={uiText("Quay lại chi tiết lớp")}
          variant="outline"
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace(`/teaching/classes/${classId}` as const)
          }
        />
      </View>
    </Page>
  );
}

const sl = StyleSheet.create({
  classBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 12,
    ...tokens.shadow.subtle,
  },
  classIconBox: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: tokens.color.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  classNameText: {
    fontSize: 17,
    fontWeight: "800",
    color: "#0F172A",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  statusBadgeDraft: {
    backgroundColor: "#FEF3C7",
    borderColor: "#FDE68A",
  },
  statusBadgePublished: {
    backgroundColor: "#DCFCE7",
    borderColor: "#BBF7D0",
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  countPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  card: {
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    overflow: "hidden",
    ...tokens.shadow.subtle,
  },
  cardSideStripe: {
    width: 4,
  },
  cardContent: {
    flex: 1,
    padding: 14,
    gap: 8,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  cardIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#E6F7F7",
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0F172A",
    lineHeight: 20,
  },
  cardTimeText: {
    fontSize: 12,
    color: tokens.color.muted,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeScheduled: {
    backgroundColor: "#E0F2FE",
  },
  badgeCompleted: {
    backgroundColor: "#D1FAE5",
  },
  badgeCancelled: {
    backgroundColor: "#FEE2E2",
  },
  badgeDraft: {
    backgroundColor: "#FEF3C7",
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: tokens.color.border,
    paddingTop: 8,
    marginTop: 2,
  },
  modePill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
  },
  modeOnline: {
    backgroundColor: "#E0F2FE",
  },
  modeOffline: {
    backgroundColor: "#CCFBF1",
  },
  modeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flex: 1,
  },
  metaText: {
    fontSize: 12,
    color: "#64748B",
  },
  detailActionText: {
    fontSize: 12,
    fontWeight: "700",
    color: tokens.color.brand,
  },
  emptyCard: {
    alignItems: "center",
    padding: 24,
    borderRadius: 18,
    backgroundColor: tokens.color.surface,
    borderWidth: 1,
    borderColor: tokens.color.border,
    gap: 12,
    marginVertical: 4,
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
  emptyTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: tokens.color.ink,
  },
  emptySubtitle: {
    fontSize: 13,
    color: tokens.color.muted,
    textAlign: "center",
    lineHeight: 19,
  },
  tipBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: tokens.color.surfaceSubtle,
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: 12,
    padding: 12,
    marginVertical: 4,
  },
  tipText: {
    flex: 1,
    fontSize: 12,
    color: tokens.color.inkSecondary,
    lineHeight: 18,
  },
  errorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    backgroundColor: "#FEE2E2",
    borderRadius: 12,
    marginVertical: 8,
  },
});
