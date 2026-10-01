import { useEffect, useState, useCallback } from "react";
import { Text, View, Pressable, FlatList, StyleSheet, ActivityIndicator } from "react-native";
import { router, type Href } from "expo-router";
import { useSyncExternalStore } from "react";
import { ApiError } from "../../../src/api";
import { runtime } from "../../../src/runtime";
import { moderationListResponse, type ModerationReport } from "../../../src/admin";
import { Page, Button, styles, tokens } from "../../../src/ui";

export default function AdminModerationQueueScreen() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadReports = useCallback(
    async (isRefresh = false, targetCursor = "") => {
      if (snapshot.user?.role !== "ADMIN") return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");

      try {
        const queryParams = new URLSearchParams({
          limit: "20",
          ...(targetCursor ? { cursor: targetCursor } : {}),
        });
        const res = await session.request(`/api/v1/admin/reports?${queryParams.toString()}`, {
          includeMeta: true,
        });
        const parsed = moderationListResponse(res);
        setReports(parsed.items);
        setNextCursor(parsed.nextCursor);
      } catch (e: unknown) {
        if (e instanceof ApiError) {
          setError(e.message);
        } else {
          setError("Không thể tải hàng đợi kiểm duyệt.");
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [session, snapshot.user?.role],
  );

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  const handleNextPage = () => {
    if (nextCursor) {
      setCursor(nextCursor);
      void loadReports(false, nextCursor);
    }
  };

  const handleResetToFirst = () => {
    setCursor("");
    void loadReports(false, "");
  };

  if (snapshot.user?.role !== "ADMIN") {
    return (
      <Page>
        <Text style={styles.title}>Trung tâm kiểm duyệt</Text>
        <Text style={styles.error}>Chức năng này yêu cầu quyền Quản trị viên (ADMIN).</Text>
        <Button label="Về trang chủ" onPress={() => router.replace("/")} />
      </Page>
    );
  }

  const renderReport = ({ item }: { item: ModerationReport }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Báo cáo ${item.targetType} ${item.targetId}`}
      style={ms.card}
      onPress={() => router.push(`/admin/moderation/${item.reportId}` as Href)}
    >
      <View style={ms.row}>
        <View style={ms.content}>
          <View style={ms.tagRow}>
            <View style={[ms.badge, item.targetType === "COMMENT" ? ms.badgeComment : ms.badgeReview]}>
              <Text style={ms.badgeText}>{item.targetType === "COMMENT" ? "BÌNH LUẬN" : "ĐÁNH GIÁ"}</Text>
            </View>
            <View style={[ms.badge, item.state === "OPEN" ? ms.badgeOpen : ms.badgeResolved]}>
              <Text style={ms.badgeText}>{item.state === "OPEN" ? "ĐANG MỞ" : "ĐÃ XỬ LÝ"}</Text>
            </View>
            <Text style={ms.versionTag}>v{item.version}</Text>
          </View>

          <Text style={ms.targetId} numberOfLines={1}>
            Mục: {item.targetId}
          </Text>

          <Text style={ms.dateText}>
            {new Date(item.createdAt).toLocaleString("vi-VN")}
            {item.decision ? ` · Quyết định: ${item.decision}` : ""}
          </Text>
        </View>

        <Text style={ms.arrow}>→</Text>
      </View>
    </Pressable>
  );

  return (
    <Page scroll={false}>
      <Text style={styles.title}>Trung tâm kiểm duyệt</Text>
      <Text style={styles.small}>
        Hàng đợi các báo cáo vi phạm nội dung cộng đồng từ học viên & giảng viên
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading && !refreshing ? (
        <ActivityIndicator size="large" color={tokens.color.brand} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={reports}
          keyExtractor={(r) => r.reportId}
          renderItem={renderReport}
          refreshing={refreshing}
          onRefresh={() => void loadReports(true, "")}
          ListEmptyComponent={
            <View style={ms.emptyContainer}>
              <Text style={ms.emptyText}>Hiện không có báo cáo nào cần xử lý.</Text>
            </View>
          }
          ListFooterComponent={
            <View style={ms.footerContainer}>
              {nextCursor ? <Button label="Trang tiếp theo →" onPress={handleNextPage} /> : null}
              {cursor ? <Button label="Quay lại trang đầu" onPress={handleResetToFirst} /> : null}
            </View>
          }
          contentContainerStyle={ms.listContent}
        />
      )}
    </Page>
  );
}

const ms = StyleSheet.create({
  listContent: {
    paddingBottom: tokens.space.large,
    marginTop: tokens.space.small,
  },
  card: {
    backgroundColor: tokens.color.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tokens.color.border,
    padding: tokens.space.medium,
    marginBottom: tokens.space.small,
    minHeight: 56,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  content: {
    flex: 1,
  },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeComment: {
    backgroundColor: "#dbeafe",
  },
  badgeReview: {
    backgroundColor: "#fef3c7",
  },
  badgeOpen: {
    backgroundColor: "#fee2e2",
  },
  badgeResolved: {
    backgroundColor: "#d1fae5",
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  versionTag: {
    fontSize: 11,
    color: tokens.color.muted,
  },
  targetId: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.color.ink,
  },
  dateText: {
    fontSize: 12,
    color: tokens.color.muted,
    marginTop: 3,
  },
  arrow: {
    fontSize: 18,
    color: tokens.color.muted,
    fontWeight: "700",
    marginLeft: tokens.space.small,
  },
  emptyContainer: {
    padding: tokens.space.large,
    alignItems: "center",
  },
  emptyText: {
    color: tokens.color.muted,
    fontSize: 14,
  },
  footerContainer: {
    marginTop: tokens.space.medium,
    gap: tokens.space.small,
  },
});
