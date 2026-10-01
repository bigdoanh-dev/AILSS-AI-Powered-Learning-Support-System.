import { useEffect, useState, useMemo, useCallback } from "react";
import { Text, Pressable, StyleSheet, View, TextInput } from "react-native";
import { router, type Href } from "expo-router";
import { useSyncExternalStore } from "react";
import { ApiError } from "../../../src/api";
import { runtime } from "../../../src/runtime";
import { lecturerCourse } from "../../../src/teaching";
import {
  Page,
  Button,
  ScreenHeader,
  Icon,
  NonVirtualizedList,
  BottomNavBar,
  styles,
  tokens,
} from "../../../src/ui";
import { ScalePressable, FadeSlideIn } from "../../../src/motion";

export default function OwnedCoursesList() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [courses, setCourses] = useState<{ courseId: string; title: string }[] | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (snapshot.user?.role !== "LECTURER") return;
    const abort = new AbortController();
    setError("");
    setCourses(null);
    void session
      .request("/api/v1/me/owned-courses", { signal: abort.signal })
      .then((value) => {
        if (!abort.signal.aborted) {
          setCourses(Array.isArray(value) ? value.map((item) => lecturerCourse(item)) : []);
        }
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted)
          setError(e instanceof ApiError ? e.message : "Không thể tải danh sách khóa học.");
      });
    return () => abort.abort();
  }, [session, snapshot.user?.userId, retry]);

  const handleRetry = useCallback(() => setRetry((v) => v + 1), []);

  const filteredCourses = useMemo(() => {
    if (!courses) return [];
    if (!search.trim()) return courses;
    return courses.filter((c) => c.title.toLowerCase().includes(search.toLowerCase().trim()));
  }, [courses, search]);

  if (snapshot.user?.role !== "LECTURER") {
    return (
      <Page>
        <Text style={styles.error}>Chức năng này chỉ dành cho Giảng viên.</Text>
        <Button label="Về trang chủ" onPress={() => router.replace("/")} />
      </Page>
    );
  }

  const renderCourse = ({ item }: { item: { courseId: string; title: string } }) => (
    <ScalePressable
      accessibilityRole="button"
      accessibilityLabel={`Khóa học ${item.title}`}
      style={cs.card}
      onPress={() => router.push(`/teaching/courses/${item.courseId}` as Href)}
    >
      <View style={cs.iconBox}>
        <Icon name="book" size={20} color={tokens.color.brand} />
      </View>
      <View style={cs.cardBody}>
        <Text style={cs.name} numberOfLines={2}>
          {item.title}
        </Text>
        <View style={cs.metaRow}>
          <View style={cs.badge}>
            <Text style={cs.badgeText}>Khóa giảng dạy</Text>
          </View>
          <Text style={cs.actionText}>Quản trị bài giảng ›</Text>
        </View>
      </View>
      <Icon name="chevronRight" size={18} color={tokens.color.muted} />
    </ScalePressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <Page>
        <ScreenHeader
          title="Khóa giảng dạy"
          subtitle={`${courses?.length ?? 0} khóa học đang quản lý`}
          onBack={() => (router.canGoBack() ? router.back() : router.replace("/teaching"))}
          rightElement={
            <Button
              label="+ Tạo mới"
              size="sm"
              icon={<Icon name="add" size={14} color="#FFFFFF" />}
              onPress={() => router.push("/teaching/courses/create" as Href)}
            />
          }
        />

        {courses && courses.length > 0 && (
          <FadeSlideIn duration={280}>
            {/* Quick Stats Strip */}
            <View style={cs.statsStrip}>
              <View style={cs.statItem}>
                <View style={[cs.statIconBox, { backgroundColor: "#E6F7F7" }]}>
                  <Icon name="book" size={16} color={tokens.color.brand} />
                </View>
                <View>
                  <Text style={cs.statValue}>{courses.length}</Text>
                  <Text style={cs.statLabel}>Khóa học</Text>
                </View>
              </View>

              <View style={cs.statDivider} />

              <View style={cs.statItem}>
                <View style={[cs.statIconBox, { backgroundColor: "#CCFBF1" }]}>
                  <Icon name="academic" size={16} color="#0D9488" />
                </View>
                <View>
                  <Text style={cs.statValue}>Giảng dạy</Text>
                  <Text style={cs.statLabel}>Chế độ mở</Text>
                </View>
              </View>

              <View style={cs.statDivider} />

              <View style={cs.statItem}>
                <View style={[cs.statIconBox, { backgroundColor: "#FEF3C7" }]}>
                  <Icon name="sparkles" size={16} color="#D97706" />
                </View>
                <View>
                  <Text style={cs.statValue}>Trợ lý AI</Text>
                  <Text style={cs.statLabel}>Đồng hành</Text>
                </View>
              </View>
            </View>

            {/* Search Input Bar */}
            <View style={cs.searchContainer}>
              <Icon name="search" size={16} color={tokens.color.muted} />
              <TextInput
                style={cs.searchInput}
                placeholder="Tìm kiếm khóa học theo tên..."
                placeholderTextColor={tokens.color.muted}
                value={search}
                onChangeText={setSearch}
              />
              {search ? (
                <Pressable onPress={() => setSearch("")} style={{ padding: 4 }}>
                  <Icon name="close" size={14} color={tokens.color.muted} />
                </Pressable>
              ) : null}
            </View>
          </FadeSlideIn>
        )}

        {!error && courses === null && (
          <View style={cs.loadingBox}>
            <Text accessibilityRole="alert" style={styles.text}>
              Đang tải danh sách khóa học…
            </Text>
          </View>
        )}

        {courses && courses.length === 0 && (
          <View style={cs.emptyCard}>
            <View style={cs.emptyIconRing}>
              <Icon name="academic" size={32} color={tokens.color.brand} />
            </View>
            <Text style={cs.emptyTitle}>Bạn chưa có khóa học nào</Text>
            <Text style={cs.emptySubtitle}>
              Bắt đầu tạo khóa học mới để xây dựng giáo trình bài giảng và mở bán cho học viên.
            </Text>
            <Button
              label="Tạo khóa học đầu tiên"
              icon={<Icon name="add" size={16} color="#FFFFFF" />}
              onPress={() => router.push("/teaching/courses/create" as Href)}
            />
          </View>
        )}

        {courses && courses.length > 0 && (
          <FadeSlideIn duration={320}>
            {filteredCourses.length === 0 ? (
              <View style={cs.emptyCard}>
                <Icon name="search" size={24} color={tokens.color.muted} />
                <Text style={cs.emptyTitle}>Không tìm thấy kết quả</Text>
                <Text style={cs.emptySubtitle}>Không có khóa học nào khớp với từ khóa "{search}".</Text>
              </View>
            ) : (
              <NonVirtualizedList
                data={filteredCourses}
                keyExtractor={(item) => item.courseId}
                renderItem={renderCourse}
                contentContainerStyle={{ gap: 10 }}
              />
            )}
          </FadeSlideIn>
        )}

        {error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        {error && <Button label="Thử lại" onPress={handleRetry} />}
        <View style={{ marginTop: 12 }}>
          <Button
            label="Về trang chủ giảng viên"
            variant="outline"
            onPress={() => router.replace("/teaching")}
          />
        </View>
      </Page>
      <BottomNavBar
        currentRoute="courses"
        role={snapshot.user.role}
        onNavigate={(path) => router.push(path as Href)}
      />
    </View>
  );
}

const cs = StyleSheet.create({
  statsStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: tokens.color.surface,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginBottom: 10,
    ...tokens.shadow.subtle,
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  statIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  statValue: {
    fontSize: 13,
    fontWeight: "800",
    color: tokens.color.ink,
  },
  statLabel: {
    fontSize: 11,
    color: tokens.color.muted,
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: tokens.color.border,
    marginHorizontal: 4,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: tokens.color.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: tokens.color.ink,
    padding: 0,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: tokens.color.border,
    ...tokens.shadow.subtle,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: tokens.color.brandLight,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontSize: 15,
    fontWeight: "700",
    color: tokens.color.ink,
    lineHeight: 21,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  badge: {
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
    color: tokens.color.inkSecondary,
  },
  actionText: {
    fontSize: 12,
    fontWeight: "700",
    color: tokens.color.brand,
  },
  loadingBox: {
    alignItems: "center",
    paddingVertical: 30,
  },
  emptyCard: {
    alignItems: "center",
    padding: 24,
    borderRadius: 16,
    backgroundColor: tokens.color.surface,
    borderWidth: 1,
    borderColor: tokens.color.border,
    gap: 10,
    marginVertical: 12,
    ...tokens.shadow.subtle,
  },
  emptyIconRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: tokens.color.brandLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
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
    marginBottom: 4,
  },
});
