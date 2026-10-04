import { useUiText } from "../../../../src/use-language";
import { useState, useMemo } from "react";
import { Share, StyleSheet, Text, TextInput, View, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { record, string } from "../../../../src/api";
import { useMobileQuery } from "../../../../src/queries";
import { Page, ScreenHeader, Button, Icon, tokens, styles } from "../../../../src/ui";
import { FadeSlideIn } from "../../../../src/motion";

function roster(value: unknown) {
  const items = Array.isArray(value) ? value : record(value).items;
  if (!Array.isArray(items)) throw new Error("Dữ liệu không hợp lệ.");
  return items.map((value) => {
    const r = record(value);
    return {
      studentId: string(r.studentId),
      name: typeof r.studentName === "string" ? r.studentName : "—",
      email: typeof r.email === "string" ? r.email : "—",
      enrolledAt: typeof r.enrolledAt === "string" ? r.enrolledAt : "",
      progress: r.progressPercent ?? "—",
      state: string(r.state),
    };
  });
}

export default function CourseRoster() {
  const uiText = useUiText();
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const query = useMobileQuery(courseId ? `/api/v1/courses/${courseId}/roster` : null, roster);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const items = useMemo(() => {
    if (!query.data) return [];
    if (!search.trim()) return query.data;
    const s = search.toLocaleLowerCase("vi").trim();
    return query.data.filter((r) =>
      [r.studentId, r.name, r.email].some((v) => v.toLocaleLowerCase("vi").includes(s)),
    );
  }, [query.data, search]);

  const activeEnrolled =
    query.data?.filter((i) => i.state === "ENROLLED" || i.state === "ACTIVE").length ??
    query.data?.length ??
    0;

  async function share() {
    const cell = (value: unknown) => `"${String(value).replaceAll('"', '""')}"`;
    try {
      await Share.share({
        title: uiText("Danh sách học viên khóa học"),
        message: [
          ["Mã học viên", "Họ tên", "Email", "Ngày ghi danh", "Tiến độ", "Trạng thái"].map((source) =>
            uiText(source),
          ),
          ...items.map((r) => [r.studentId, r.name, r.email, r.enrolledAt, r.progress, r.state]),
        ]
          .map((r) => r.map(cell).join(","))
          .join("\n"),
      });
    } catch {
      setError("Không thể chia sẻ CSV.");
    }
  }

  return (
    <Page>
      <ScreenHeader
        title={uiText("Học viên khóa học")}
        subtitle={uiText("{0} học viên đã ghi danh", [query.data?.length ?? 0])}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/teaching/courses"))}
        rightElement={
          items.length > 0 ? (
            <Button
              label={uiText("Chia sẻ CSV")}
              size="sm"
              variant="outline"
              icon={<Icon name="document" size={14} color={tokens.color.brand} />}
              onPress={() => void share()}
            />
          ) : undefined
        }
      />

      {query.data && query.data.length > 0 && (
        <FadeSlideIn duration={280}>
          {/* Quick Stats Strip */}
          <View style={rs.statsStrip}>
            <View style={rs.statItem}>
              <View style={[rs.statIconBox, { backgroundColor: "#E6F7F7" }]}>
                <Icon name="people" size={16} color={tokens.color.brand} />
              </View>
              <View>
                <Text style={rs.statValue}>{query.data.length}</Text>
                <Text style={rs.statLabel}>{uiText("Tổng ghi danh")}</Text>
              </View>
            </View>

            <View style={rs.statDivider} />

            <View style={rs.statItem}>
              <View style={[rs.statIconBox, { backgroundColor: "#DCFCE7" }]}>
                <Icon name="checkCircle" size={16} color="#15803D" />
              </View>
              <View>
                <Text style={[rs.statValue, { color: "#15803D" }]}>{activeEnrolled}</Text>
                <Text style={rs.statLabel}>{uiText("Đang hoạt động")}</Text>
              </View>
            </View>

            <View style={rs.statDivider} />

            <View style={rs.statItem}>
              <View style={[rs.statIconBox, { backgroundColor: "#EFF6FF" }]}>
                <Icon name="award" size={16} color="#2563EB" />
              </View>
              <View>
                <Text style={[rs.statValue, { color: "#2563EB" }]}>{items.length}</Text>
                <Text style={rs.statLabel}>{uiText("Kết quả lọc")}</Text>
              </View>
            </View>
          </View>

          {/* Search bar */}
          <View style={rs.searchBar}>
            <Icon name="search" size={16} color={tokens.color.muted} />
            <TextInput
              accessibilityLabel={uiText("Tìm học viên")}
              style={rs.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder={uiText("Tên, email hoặc mã học viên...")}
              placeholderTextColor={tokens.color.muted}
            />
            {search ? (
              <Pressable onPress={() => setSearch("")} style={{ padding: 4 }}>
                <Icon name="close" size={14} color={tokens.color.muted} />
              </Pressable>
            ) : null}
          </View>
        </FadeSlideIn>
      )}

      {query.loading ? (
        <View style={rs.loadingBox}>
          <Text style={styles.text}>{uiText("Đang tải danh sách học viên…")}</Text>
        </View>
      ) : null}

      {query.error || error ? (
        <View style={rs.errorCard}>
          <Text style={styles.error}>{query.error || error}</Text>
          <Button label={uiText("Thử lại")} size="sm" onPress={query.retry} />
        </View>
      ) : null}

      {query.data?.length === 0 ? (
        <View style={rs.emptyCard}>
          <View style={rs.emptyIconBox}>
            <Icon name="people" size={32} color={tokens.color.brand} />
          </View>
          <Text style={rs.emptyTitle}>{uiText("Chưa có học viên ghi danh")}</Text>
          <Text style={rs.emptyDesc}>
            {uiText(
              "Khi có học viên mua hoặc đăng ký khóa học, danh sách và tiến độ học tập sẽ hiển thị tại đây.",
            )}
          </Text>
          <Button label={uiText("Tải lại danh sách")} size="sm" variant="outline" onPress={query.retry} />
        </View>
      ) : null}

      {items.map((r) => {
        const initial = (r.name.trim().charAt(0) || "U").toUpperCase();
        return (
          <View key={r.studentId} style={rs.studentCard}>
            <View style={rs.studentAvatar}>
              <Text style={rs.studentAvatarText}>{initial}</Text>
            </View>
            <View style={rs.studentBody}>
              <View style={rs.studentHeader}>
                <Text style={rs.studentName}>{r.name}</Text>
                <View style={rs.stateBadge}>
                  <Text style={rs.stateBadgeText}>{r.state}</Text>
                </View>
              </View>

              <Text style={rs.studentEmail}>{r.email}</Text>

              <View style={rs.studentMetaRow}>
                <View style={rs.metaItem}>
                  <Icon name="calendar" size={12} color={tokens.color.muted} />
                  <Text style={rs.metaText}>
                    {r.enrolledAt ? r.enrolledAt.slice(0, 10) : uiText("Mới ghi danh")}
                  </Text>
                </View>
                <View style={rs.metaItem}>
                  <Icon name="award" size={12} color={tokens.color.brand} />
                  <Text style={[rs.metaText, { color: tokens.color.brand, fontWeight: "700" }]}>
                    {uiText("Tiến độ: ")}
                    {String(r.progress)}%
                  </Text>
                </View>
              </View>
            </View>
          </View>
        );
      })}
    </Page>
  );
}

const rs = StyleSheet.create({
  statsStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: tokens.color.surface,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginBottom: 12,
    ...tokens.shadow.subtle,
  },
  statItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  statValue: {
    fontSize: 14,
    fontWeight: "800",
    color: tokens.color.ink,
  },
  statLabel: {
    fontSize: 10,
    color: tokens.color.muted,
    fontWeight: "500",
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: tokens.color.border,
    marginHorizontal: 8,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: tokens.color.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1.5,
    borderColor: tokens.color.border,
    minHeight: 46,
    gap: 10,
    marginBottom: 14,
    ...tokens.shadow.subtle,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: tokens.color.ink,
    paddingVertical: 8,
  },
  studentCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: tokens.color.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginBottom: 10,
    ...tokens.shadow.subtle,
  },
  studentAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: tokens.color.brandLight,
    borderWidth: 1.5,
    borderColor: tokens.color.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  studentAvatarText: {
    fontSize: 16,
    fontWeight: "800",
    color: tokens.color.brand,
  },
  studentBody: {
    flex: 1,
    gap: 3,
  },
  studentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  studentName: {
    fontSize: 15,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  stateBadge: {
    backgroundColor: "#F0FDFA",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#CCFBF1",
  },
  stateBadgeText: {
    fontSize: 10.5,
    fontWeight: "700",
    color: "#0F766E",
  },
  studentEmail: {
    fontSize: 13,
    color: tokens.color.muted,
  },
  studentMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 4,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: {
    fontSize: 11.5,
    color: tokens.color.muted,
  },
  loadingBox: {
    padding: 24,
    alignItems: "center",
  },
  errorCard: {
    backgroundColor: tokens.color.surface,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tokens.color.danger,
    gap: 8,
    marginBottom: 12,
  },
  emptyCard: {
    alignItems: "center",
    backgroundColor: tokens.color.surface,
    borderRadius: 16,
    padding: 28,
    borderWidth: 1,
    borderColor: tokens.color.border,
    gap: 12,
    ...tokens.shadow.subtle,
  },
  emptyIconBox: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: tokens.color.brandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: tokens.color.ink,
    textAlign: "center",
  },
  emptyDesc: {
    fontSize: 13,
    color: tokens.color.muted,
    textAlign: "center",
    lineHeight: 19,
    maxWidth: 280,
    marginBottom: 4,
  },
});
