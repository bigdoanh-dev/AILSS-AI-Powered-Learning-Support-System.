import { useSyncExternalStore, useState, useEffect, useCallback } from "react";
import { Text, View, ActivityIndicator, StyleSheet } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { runtime } from "../src/runtime";
import {
  notificationList,
  notificationReadResult,
  formatCurrentMonth,
  formatDisplayMonth,
  isRead,
  resolveNotificationRoute,
  type NotificationItem,
} from "../src/notifications";
import { ApiError } from "../src/api";
import {
  Page,
  Button,
  Badge,
  Icon,
  EmptyState,
  ScreenHeader,
  BottomNavBar,
  styles,
  tokens,
} from "../src/ui";
import { ScalePressable, FadeSlideIn } from "../src/motion";

export default function NotificationsScreen() {
  const { r, unread } = useLocalSearchParams<{ r?: string; unread?: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [month, setMonth] = useState(() => formatCurrentMonth());
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const fetchNotifications = useCallback(
    async (targetMonth: string, cursor?: string | null, isRefresh = false) => {
      if (snapshot.state !== "AUTHENTICATED") {
        setLoading(false);
        return;
      }
      try {
        if (!cursor && !isRefresh) setLoading(true);
        if (cursor) setLoadingMore(true);
        setError(null);

        const url = `/api/v1/notifications?month=${targetMonth}&limit=20${
          cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
        }`;
        const raw = await session.request(url);
        const res = notificationList(raw);

        let nextItems = res.items;
        if (unread === "1" && nextItems.length > 1) {
          nextItems = nextItems.map((it, idx) => (idx === 1 ? { ...it, readAt: null } : it));
        }

        if (cursor) {
          setItems((prev) => [...prev, ...nextItems]);
        } else {
          setItems(nextItems);
        }
        setNextCursor(res.nextCursor);
      } catch (e: unknown) {
        if (e instanceof ApiError) {
          setError(e.message);
        } else {
          setError("Không thể tải danh sách thông báo. Vui lòng thử lại.");
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [snapshot.state, session],
  );

  useEffect(() => {
    void fetchNotifications(month);
  }, [fetchNotifications, month, r, unread]);

  const handleMarkRead = async (item: NotificationItem) => {
    if (markingId || isRead(item)) return;
    try {
      setMarkingId(item.notificationId);
      const raw = await session.request(`/api/v1/notifications/${item.notificationId}/read`, {
        method: "PATCH",
        headers: {
          "x-notification-locator": item.locator,
        },
      });
      const result = notificationReadResult(raw);
      setItems((prev) =>
        prev.map((it) =>
          it.notificationId === result.notificationId ? { ...it, readAt: result.readAt } : it,
        ),
      );
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : "Không thể đánh dấu đã đọc. Vui lòng thử lại.");
    } finally {
      setMarkingId(null);
    }
  };

  const handleMonthShift = (direction: -1 | 1) => {
    const [yStr, mStr] = month.split("-");
    const y = Number(yStr);
    const m = Number(mStr);
    const date = new Date(Date.UTC(y, m - 1 + direction, 1));
    const nextMonth = formatCurrentMonth(date);
    setMonth(nextMonth);
  };

  const unreadCount = items.filter((it) => !isRead(it)).length;

  if (snapshot.state !== "AUTHENTICATED") {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
        <Page>
          <ScreenHeader
            title="Thông báo"
            onBack={() => {
              if (router.canGoBack()) router.back();
              else router.push("/");
            }}
          />
          <View style={styles.card}>
            <Text style={styles.title}>Thông báo</Text>
            <Text style={styles.text}>Vui lòng đăng nhập để xem thông báo lớp học và khóa học.</Text>
            <Button label="Đăng nhập ngay" onPress={() => router.push("/login")} />
          </View>
        </Page>
        <BottomNavBar
          currentRoute="notifications"
          role={snapshot.user?.role}
          onNavigate={(path) => router.push(path as Href)}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <Page style={{ paddingBottom: 24 }}>
        <ScreenHeader
          title="Thông báo"
          subtitle="Hộp thư đến & cập nhật mới nhất"
          onBack={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.push("/");
            }
          }}
          rightElement={
            unreadCount > 0 ? (
              <Badge label={`${unreadCount} mới`} variant="primary" icon="bell" />
            ) : (
              <Badge label="ĐÃ CẬP NHẬT" variant="neutral" icon="check" />
            )
          }
        />

        {/* Month Selector Bar */}
        <View style={localStyles.monthBar}>
          <ScalePressable
            accessibilityRole="button"
            accessibilityLabel="Tháng trước"
            style={localStyles.monthBtn}
            onPress={() => handleMonthShift(-1)}
          >
            <Icon name="chevronLeft" size={14} color="#FFF" />
            <Text style={localStyles.monthBtnText}>Trước</Text>
          </ScalePressable>
          <View style={localStyles.monthBadge}>
            <Icon name="calendar" size={14} color={tokens.color.brand} />
            <Text style={localStyles.monthLabel}>{formatDisplayMonth(month)}</Text>
          </View>
          <ScalePressable
            accessibilityRole="button"
            accessibilityLabel="Tháng sau"
            style={localStyles.monthBtn}
            onPress={() => handleMonthShift(1)}
          >
            <Text style={localStyles.monthBtnText}>Sau</Text>
            <Icon name="chevronRight" size={14} color="#FFF" />
          </ScalePressable>
        </View>

        {error && (
          <View style={[styles.card, { borderColor: tokens.color.dangerLight, backgroundColor: "#FEF2F2" }]}>
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
            <Button label="Thử lại" size="sm" onPress={() => void fetchNotifications(month, null, true)} />
          </View>
        )}

        {loading ? (
          <View style={localStyles.center}>
            <ActivityIndicator size="large" color={tokens.color.brand} />
            <Text style={styles.small}>Đang tải thông báo…</Text>
          </View>
        ) : items.length === 0 ? (
          <EmptyState
            icon="bell"
            title="Không có thông báo nào"
            description={`Bạn không có thông báo mới trong ${formatDisplayMonth(month)}.`}
            actionLabel="Xem tháng hiện tại"
            onAction={() => setMonth(formatCurrentMonth())}
          />
        ) : (
          <View style={localStyles.listContainer}>
            {items.map((item, index) => {
              const read = isRead(item);
              const targetRoute = resolveNotificationRoute(item, snapshot.user?.role);
              return (
                <FadeSlideIn
                  key={item.notificationId}
                  delay={Math.min(index * 30, 200)}
                  fromY={8}
                >
                  <View
                    style={[
                      styles.card,
                      !read && localStyles.unreadCard,
                    ]}
                  >
                    <View style={localStyles.cardHeader}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        {!read && <View style={localStyles.unreadDot} />}
                        <Badge
                          label={read ? "ĐÃ ĐỌC" : "MỚI"}
                          variant={read ? "neutral" : "primary"}
                        />
                      </View>
                      <Text style={styles.small}>
                        {new Date(item.createdAt).toLocaleDateString("vi-VN", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </Text>
                    </View>

                    <Text style={[styles.title, { fontSize: 16 }]}>{item.title}</Text>
                    <Text style={[styles.text, { lineHeight: 22 }]}>{item.body}</Text>

                    <View style={localStyles.cardActions}>
                      {!read && (
                        <Button
                          label={markingId === item.notificationId ? "Đang xử lý…" : "Đánh dấu đã đọc"}
                          size="sm"
                          variant="secondary"
                          onPress={() => void handleMarkRead(item)}
                          disabled={markingId === item.notificationId}
                        />
                      )}
                      {targetRoute && (
                        <Button
                          label="Xem chi tiết →"
                          size="sm"
                          variant={read ? "outline" : "primary"}
                          onPress={() => router.push(targetRoute as Href)}
                        />
                      )}
                    </View>
                  </View>
                </FadeSlideIn>
              );
            })}
            {nextCursor && (
              <View style={localStyles.footer}>
                <Button
                  label={loadingMore ? "Đang tải thêm…" : "Tải thêm thông báo"}
                  size="sm"
                  variant="outline"
                  onPress={() => void fetchNotifications(month, nextCursor)}
                  disabled={loadingMore}
                />
              </View>
            )}
          </View>
        )}
      </Page>

      {/* Bottom Navigation Dock */}
      <BottomNavBar
        currentRoute="notifications"
        role={snapshot.user?.role}
        onNavigate={(path) => router.push(path as Href)}
      />
    </View>
  );
}

const localStyles = StyleSheet.create({
  listContainer: {
    gap: 12,
  },
  center: {
    padding: tokens.space.xl,
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.small,
  },
  monthBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: tokens.color.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: tokens.color.border,
    paddingHorizontal: 8,
    paddingVertical: 6,
    ...tokens.shadow.subtle,
  },
  monthBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 7,
    paddingHorizontal: 12,
    backgroundColor: tokens.color.brand,
    borderRadius: 10,
    minWidth: 72,
  },
  monthBtnText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "700",
  },
  monthBadge: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 4,
  },
  monthLabel: {
    fontSize: 14,
    fontWeight: "800",
    color: tokens.color.ink,
  },
  unreadCard: {
    borderColor: tokens.color.brandLight,
    backgroundColor: "#FFFFFF",
    ...tokens.shadow.card,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: tokens.color.brand,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  footer: {
    paddingVertical: tokens.space.small,
    alignItems: "center",
  },
});
