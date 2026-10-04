import { useUiText } from "../../../src/use-language";
import { useEffect, useState, useCallback } from "react";
import { Text, View, Pressable, FlatList, StyleSheet, ActivityIndicator, TextInput } from "react-native";
import { router, type Href } from "expo-router";
import { useSyncExternalStore } from "react";
import { ApiError } from "../../../src/api";
import { runtime } from "../../../src/runtime";
import {
  adminUserListResponse,
  type AdminUser,
  type AdminRole,
  type AdminUserStatus,
} from "../../../src/admin";
import { Page, Button, Icon, styles, tokens } from "../../../src/ui";

export default function AdminUsersListScreen() {
  const uiText = useUiText();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [search, setSearch] = useState("");
  const [querySearch, setQuerySearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuerySearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const [role, setRole] = useState<AdminRole>("STUDENT");
  const [status, setStatus] = useState<AdminUserStatus>("ACTIVE");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadUsers = useCallback(
    async (isRefresh = false, targetCursor = "") => {
      if (snapshot.user?.role !== "ADMIN") return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError("");

      try {
        const queryParams = new URLSearchParams({
          role,
          status,
          limit: "25",
          ...(querySearch ? { q: querySearch } : {}),
          ...(targetCursor ? { cursor: targetCursor } : {}),
        });
        const res = await session.request(`/api/v1/admin/users?${queryParams.toString()}`, {
          includeMeta: true,
        });
        const parsed = adminUserListResponse(res);
        setUsers(parsed.items);
        setNextCursor(parsed.nextCursor);
      } catch (e: unknown) {
        if (e instanceof ApiError) {
          setError(e.message);
        } else {
          setError("Không thể tải danh sách người dùng.");
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [session, snapshot.user?.role, role, status, querySearch],
  );

  useEffect(() => {
    setCursor("");
    void loadUsers(false, "");
  }, [role, status, loadUsers]);

  const handleNextPage = () => {
    if (nextCursor) {
      setCursor(nextCursor);
      void loadUsers(false, nextCursor);
    }
  };

  const handleResetToFirst = () => {
    setCursor("");
    void loadUsers(false, "");
  };

  if (snapshot.user?.role !== "ADMIN") {
    return (
      <Page>
        <Text style={styles.title}>{uiText("Người dùng")}</Text>
        <Text style={styles.error}>{uiText("Chức năng này yêu cầu quyền Quản trị viên (ADMIN).")}</Text>
        <Button label={uiText("Về trang chủ")} onPress={() => router.replace("/")} />
      </Page>
    );
  }

  const renderItem = ({ item }: { item: AdminUser }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={uiText("Người dùng {0}", [item.displayName])}
      style={us.card}
      onPress={() => router.push(`/admin/users/${item.userId}` as Href)}
    >
      <View style={us.row}>
        <View style={us.avatarFallback}>
          <Icon
            name={item.role === "LECTURER" ? "academic" : item.role === "ADMIN" ? "shield" : "user"}
            size={18}
            color={item.role === "ADMIN" ? tokens.color.danger : tokens.color.brand}
          />
        </View>
        <View style={us.cardContent}>
          <Text style={us.cardTitle} numberOfLines={1}>
            {item.displayName}
          </Text>
          <Text style={us.cardSub} numberOfLines={1}>
            {item.emailMasked ?? `ID: ${item.userId.slice(0, 13)}...`}
          </Text>
          <View style={us.tagsRow}>
            <View style={[us.badge, item.role === "LECTURER" ? us.badgeLecturer : us.badgeRole]}>
              <Text style={us.badgeText}>
                {item.role === "LECTURER"
                  ? uiText("Giảng viên")
                  : item.role === "ADMIN"
                    ? uiText("Quản trị")
                    : uiText("Sinh viên")}
              </Text>
            </View>
            <View style={[us.badge, item.status === "ACTIVE" ? us.badgeActive : us.badgeSuspended]}>
              <Text style={us.badgeText}>
                {item.status === "ACTIVE" ? uiText("Hoạt động") : uiText("Tạm khóa")}
              </Text>
            </View>
            {item.role === "LECTURER" && (
              <View style={[us.badge, item.lecturerVerified ? us.badgeVerified : us.badgeUnverified]}>
                <Text style={us.badgeText}>
                  {item.lecturerVerified ? uiText("Đã xác minh") : uiText("Chưa xác minh")}
                </Text>
              </View>
            )}
            {item.providers?.some((p) => p.toUpperCase() === "GOOGLE") && (
              <View style={[us.badge, { backgroundColor: "#fee2e2" }]}>
                <Text style={[us.badgeText, { color: "#dc2626" }]}>🌐 Google</Text>
              </View>
            )}
          </View>
        </View>
        <Text style={us.arrow}>→</Text>
      </View>
    </Pressable>
  );

  return (
    <Page scroll={false}>
      <TextInput
        style={styles.input}
        accessibilityLabel={uiText("Tìm tài khoản")}
        placeholder={uiText("Tên, email Google hoặc mã tài khoản")}
        value={search}
        onChangeText={setSearch}
      />
      <Text style={styles.title}>{uiText("Tra cứu người dùng")}</Text>
      <Text style={styles.small}>{uiText("Lọc theo vai trò và trạng thái chính thức trên hệ thống")}</Text>

      {/* Role Filters */}
      <Text style={[styles.text, { fontWeight: "600", marginTop: tokens.space.small }]}>
        {uiText("Vai trò:")}
      </Text>
      <View style={us.filterGroup}>
        {(["STUDENT", "LECTURER", "ADMIN"] as AdminRole[]).map((r) => (
          <Pressable
            key={r}
            accessibilityRole="button"
            accessibilityLabel={uiText("Lọc vai trò {0}", [r])}
            style={[us.chip, role === r && us.chipSelected]}
            onPress={() => setRole(r)}
          >
            <Text style={[us.chipText, role === r && us.chipTextSelected]}>
              {r === "STUDENT"
                ? uiText("Sinh viên")
                : r === "LECTURER"
                  ? uiText("Giảng viên")
                  : uiText("Quản trị")}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Status Filters */}
      <Text style={[styles.text, { fontWeight: "600", marginTop: 4 }]}>{uiText("Trạng thái:")}</Text>
      <View style={us.filterGroup}>
        {(["ACTIVE", "SUSPENDED"] as AdminUserStatus[]).map((s) => (
          <Pressable
            key={s}
            accessibilityRole="button"
            accessibilityLabel={uiText("Lọc trạng thái {0}", [s])}
            style={[us.chip, status === s && us.chipSelected]}
            onPress={() => setStatus(s)}
          >
            <Text style={[us.chipText, status === s && us.chipTextSelected]}>
              {s === "ACTIVE" ? uiText("Đang hoạt động") : uiText("Tạm khóa")}
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text style={styles.error}>{uiText(error)}</Text> : null}

      {loading && !refreshing ? (
        <ActivityIndicator size="large" color={tokens.color.brand} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={users}
          keyExtractor={(u) => u.userId}
          renderItem={renderItem}
          refreshing={refreshing}
          onRefresh={() => void loadUsers(true, "")}
          ListEmptyComponent={
            <View style={us.emptyContainer}>
              <Text style={us.emptyText}>{uiText("Không tìm thấy người dùng phù hợp.")}</Text>
            </View>
          }
          ListFooterComponent={
            <View style={us.footerContainer}>
              {nextCursor ? <Button label={uiText("Trang tiếp theo →")} onPress={handleNextPage} /> : null}
              {cursor ? <Button label={uiText("Quay lại trang đầu")} onPress={handleResetToFirst} /> : null}
            </View>
          }
          contentContainerStyle={us.listContent}
        />
      )}
    </Page>
  );
}

const us = StyleSheet.create({
  filterGroup: {
    flexDirection: "row",
    gap: tokens.space.small,
    marginVertical: 4,
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: tokens.color.border,
    backgroundColor: tokens.color.surface,
  },
  chipSelected: {
    borderColor: tokens.color.brand,
    backgroundColor: tokens.color.brand,
  },
  chipText: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.color.ink,
  },
  chipTextSelected: {
    color: "#ffffff",
  },
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
  avatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: tokens.color.border,
    alignItems: "center",
    justifyContent: "center",
    marginRight: tokens.space.small,
  },
  avatarText: {
    fontSize: 20,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: tokens.color.ink,
  },
  cardSub: {
    fontSize: 13,
    color: tokens.color.muted,
    marginTop: 2,
  },
  tagsRow: {
    flexDirection: "row",
    gap: 4,
    marginTop: 6,
    flexWrap: "wrap",
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeRole: {
    backgroundColor: "#e2e8f0",
  },
  badgeLecturer: {
    backgroundColor: "#fef3c7",
  },
  badgeActive: {
    backgroundColor: "#d1fae5",
  },
  badgeSuspended: {
    backgroundColor: "#fee2e2",
  },
  badgeVerified: {
    backgroundColor: "#dbeafe",
  },
  badgeUnverified: {
    backgroundColor: "#ffedd5",
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: tokens.color.ink,
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
