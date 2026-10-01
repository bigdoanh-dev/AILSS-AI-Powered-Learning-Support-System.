import { useEffect, useState, useCallback } from "react";
import { Text, View, Pressable, StyleSheet } from "react-native";
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

export default function ClassSessionsList() {
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
        <ScreenHeader title="Lịch buổi học" onBack={() => router.replace("/")} />
        <Text style={styles.error}>Bạn không có quyền truy cập.</Text>
        <Button label="Về trang chủ" onPress={() => router.replace("/")} />
      </Page>
    );
  }

  const formatDateTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  const renderItem = ({ item }: { item: ClassSession }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Buổi học: ${item.title}`}
      onPress={() => router.push(`/teaching/classes/${classId}/sessions/${item.sessionId}` as const)}
      style={({ pressed }) => [sl.card, pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] }]}
    >
      <View style={sl.cardHeader}>
        <View style={sl.cardIconWrap}>
          <Icon name={item.mode === "ONLINE" ? "sparkles" : "class"} size={18} color={tokens.color.brand} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={sl.cardTitle}>{item.title}</Text>
          <Text style={sl.cardTimeText}>
            {formatDateTime(item.startAt)} — {formatDateTime(item.endAt)}
          </Text>
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
        <View style={[sl.modePill, item.mode === "ONLINE" ? sl.modeOnline : sl.modeOffline]}>
          <Text style={[sl.modeText, item.mode === "ONLINE" ? { color: "#0284C7" } : { color: "#0D9488" }]}>
            {item.mode === "ONLINE" ? "Trực tuyến" : "Trực tiếp"}
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
      </View>
    </Pressable>
  );

  return (
    <Page>
      <ScreenHeader
        title="Lịch buổi học"
        subtitle={cls ? `Lớp: ${cls.name}` : "Danh sách các buổi học giảng dạy"}
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace(`/teaching/classes/${classId}` as const)
        }
      />

      {cls && (
        <View style={sl.classBanner}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={sl.classNameText}>{cls.name}</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={sl.statusBadge}>
                <Text style={sl.statusBadgeText}>Lịch: {cls.scheduleState ?? "PUBLISHED"}</Text>
              </View>
              {items && (
                <Text style={{ fontSize: 12, color: "#64748B", fontWeight: "600" }}>
                  {items.length} buổi học
                </Text>
              )}
            </View>
          </View>
        </View>
      )}

      {cls?.scheduleState === "DRAFT" && (
        <View style={{ marginBottom: 12 }}>
          <Button
            label="Thêm buổi học mới"
            variant="primary"
            icon={<Icon name="add" size={16} color="#FFFFFF" />}
            onPress={() => router.push(`/teaching/classes/${classId}/sessions/create` as const)}
          />
        </View>
      )}

      {items && items.length === 0 && (
        <View style={styles.card}>
          <Text style={styles.text}>Chưa có buổi học nào trong lịch.</Text>
          <Text style={styles.small}>
            {cls?.scheduleState === "DRAFT"
              ? "Hãy tạo buổi học đầu tiên trước khi xuất bản lịch."
              : "Lịch đã xuất bản hoặc không có buổi học trong khoảng thời gian này."}
          </Text>
        </View>
      )}

      {items && items.length > 0 && (
        <NonVirtualizedList
          data={items}
          keyExtractor={(item) => item.sessionId}
          renderItem={renderItem}
          contentContainerStyle={{ gap: 10, paddingBottom: 14 }}
        />
      )}

      {error ? (
        <View style={sl.errorCard}>
          <Icon name="alert" size={18} color="#DC2626" />
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
          <Button label="Thử lại" variant="outline" onPress={() => setRetry((v) => v + 1)} />
        </View>
      ) : null}

      <Button
        label="Quay lại chi tiết lớp"
        variant="outline"
        onPress={() =>
          router.canGoBack() ? router.back() : router.replace(`/teaching/classes/${classId}` as const)
        }
      />
    </Page>
  );
}

const sl = StyleSheet.create({
  classBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 12,
    ...tokens.shadow.subtle,
  },
  classNameText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
  },
  statusBadge: {
    backgroundColor: "#F0FDF4",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#BBF7D0",
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#16A34A",
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 10,
    ...tokens.shadow.subtle,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  cardIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: "#E0F2FE",
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0F172A",
  },
  cardTimeText: {
    fontSize: 12,
    color: "#64748B",
    fontWeight: "500",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: "#F8FAFC",
  },
  modePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
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
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeDraft: {
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#FDE68A",
  },
  badgeScheduled: {
    backgroundColor: "#F0F9FF",
    borderWidth: 1,
    borderColor: "#BAE6FD",
  },
  badgeCompleted: {
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  badgeCancelled: {
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  errorCard: {
    backgroundColor: "#FEF2F2",
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#FECACA",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
});
