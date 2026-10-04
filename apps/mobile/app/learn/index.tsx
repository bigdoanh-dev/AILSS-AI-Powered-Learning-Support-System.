import { useUiText } from "../../src/use-language";
import { useSyncExternalStore, useState, useEffect, useCallback } from "react";
import { Text, View, ActivityIndicator, Pressable, StyleSheet } from "react-native";
import { router, type Href } from "expo-router";
import { runtime } from "../../src/runtime";
import {
  courses as decodeCourses,
  progress as decodeProgress,
  type Course,
  type Progress,
} from "../../src/learning";
import { ApiError } from "../../src/api";
import {
  Page,
  Button,
  Badge,
  ProgressBar,
  Icon,
  EmptyState,
  BottomNavBar,
  SearchBar,
  tokens,
  styles,
} from "../../src/ui";

type EnrolledCourse = Course & { progress?: Progress };

export default function MyLearningScreen() {
  const uiText = useUiText();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [coursesList, setCoursesList] = useState<EnrolledCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ALL" | "IN_PROGRESS" | "COMPLETED">("ALL");

  const fetchMyLearning = useCallback(async () => {
    if (snapshot.state !== "AUTHENTICATED") return;
    try {
      setLoading(true);
      setError(null);

      const coursesData = await session.request("/api/v1/me/courses");
      const baseCourses = decodeCourses(coursesData);

      const results: EnrolledCourse[] = [...baseCourses];

      // Fetch progress with bounded concurrency (3 items)
      const fetchProgress = async (c: EnrolledCourse) => {
        try {
          const pData = await session.request(`/api/v1/courses/${c.courseId}/progress`);
          c.progress = decodeProgress(pData);
        } catch {
          // Non-blocking: progress hydration failure leaves progress undefined
        }
      };

      for (let i = 0; i < results.length; i += 3) {
        const batch = results.slice(i, i + 3);
        await Promise.all(batch.map(fetchProgress));
      }

      setCoursesList(results);
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError("Không thể tải danh sách khóa học của bạn.");
      }
    } finally {
      setLoading(false);
    }
  }, [snapshot.state, snapshot.user?.userId, session]);

  useEffect(() => {
    void fetchMyLearning();
  }, [fetchMyLearning]);

  if (snapshot.state !== "AUTHENTICATED") {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
        <Page>
          <View style={[styles.card, { alignItems: "center", paddingVertical: 40, gap: 14 }]}>
            <Icon name="book" size={40} color={tokens.color.brand} />
            <Text style={styles.title}>{uiText("Không gian học tập")}</Text>
            <Text style={[styles.text, { textAlign: "center", maxWidth: 300 }]}>
              {uiText("Vui lòng đăng nhập tài khoản học viên để xem các khóa học đang theo học.")}
            </Text>
            <Button label={uiText("Đăng nhập ngay")} size="lg" onPress={() => router.push("/login")} />
          </View>
        </Page>
        <BottomNavBar currentRoute="learn" onNavigate={(path) => router.push(path as Href)} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <Page style={{ paddingBottom: 24 }}>
        <View style={{ gap: 4 }}>
          <Badge label={uiText("TIẾN ĐỘ HỌC TẬP")} variant="primary" icon="sparkles" />
          <Text style={styles.title}>{uiText("Khóa học của tôi")}</Text>
          <Text style={styles.text}>
            {uiText("Tiếp tục các bài học dở dang và theo dõi mục tiêu học tập.")}
          </Text>
        </View>

        {error ? (
          <View style={[styles.card, { borderColor: tokens.color.dangerLight, backgroundColor: "#FEF2F2" }]}>
            <Text accessibilityRole="alert" style={styles.error}>
              {uiText(error)}
            </Text>
            <Button label={uiText("Thử lại")} size="sm" onPress={() => void fetchMyLearning()} />
          </View>
        ) : loading ? (
          <View style={localStyles.center}>
            <ActivityIndicator size="large" color={tokens.color.brand} />
            <Text style={styles.small}>{uiText("Đang tải tiến độ học tập…")}</Text>
          </View>
        ) : coursesList.length === 0 ? (
          <EmptyState
            icon="book"
            title={uiText("Chưa tham gia khóa học nào")}
            description={uiText(
              "Bạn chưa đăng ký khóa học nào. Hãy bắt đầu khám phá thư viện khóa học phong phú của AILSS ngay!",
            )}
            actionLabel="Khám phá khóa học ngay"
            onAction={() => router.push("/courses")}
          />
        ) : (
          <View style={localStyles.list}>
            {/* Quick summary strip */}
            <View style={localStyles.summaryRow}>
              <View style={localStyles.summaryItem}>
                <Text style={localStyles.summaryNum}>{coursesList.length}</Text>
                <Text style={localStyles.summaryLabel}>{uiText("Khóa đang học")}</Text>
              </View>
              <View style={localStyles.summaryDivider} />
              <View style={localStyles.summaryItem}>
                <Text style={[localStyles.summaryNum, { color: tokens.color.brand }]}>
                  {coursesList.length > 0
                    ? Math.round(
                        coursesList.reduce((acc, c) => acc + (c.progress?.percent ?? 0), 0) /
                          coursesList.length,
                      )
                    : 0}
                  %
                </Text>
                <Text style={localStyles.summaryLabel}>{uiText("Tiến độ TB")}</Text>
              </View>
              <View style={localStyles.summaryDivider} />
              <View style={localStyles.summaryItem}>
                <Text style={[localStyles.summaryNum, { color: tokens.color.brand }]}>
                  {coursesList.filter((c) => c.progress?.completed).length}
                </Text>
                <Text style={localStyles.summaryLabel}>{uiText("Khóa hoàn thành")}</Text>
              </View>
            </View>

            {/* Search Bar */}
            <SearchBar
              value={search}
              onChangeText={setSearch}
              placeholder={uiText("Tìm kiếm khóa học của tôi...")}
              onClear={() => setSearch("")}
            />

            {/* Filter Chips */}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                onPress={() => setFilter("ALL")}
                style={[localStyles.filterChip, filter === "ALL" && localStyles.filterChipActive]}
              >
                <Text
                  style={[localStyles.filterChipText, filter === "ALL" && localStyles.filterChipTextActive]}
                >
                  {uiText("Tất cả (")}
                  {coursesList.length})
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setFilter("IN_PROGRESS")}
                style={[localStyles.filterChip, filter === "IN_PROGRESS" && localStyles.filterChipActive]}
              >
                <Text
                  style={[
                    localStyles.filterChipText,
                    filter === "IN_PROGRESS" && localStyles.filterChipTextActive,
                  ]}
                >
                  {uiText("Đang học (")}
                  {coursesList.filter((c) => !(c.progress?.completed ?? false)).length})
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setFilter("COMPLETED")}
                style={[localStyles.filterChip, filter === "COMPLETED" && localStyles.filterChipActive]}
              >
                <Text
                  style={[
                    localStyles.filterChipText,
                    filter === "COMPLETED" && localStyles.filterChipTextActive,
                  ]}
                >
                  {uiText("Đã xong (")}
                  {coursesList.filter((c) => c.progress?.completed ?? false).length})
                </Text>
              </Pressable>
            </View>

            {coursesList
              .filter((item) => {
                const isDone = item.progress?.completed ?? false;
                const matchesFilter = filter === "ALL" || (filter === "COMPLETED" ? isDone : !isDone);
                const matchesSearch = item.title.toLowerCase().includes(search.toLowerCase());
                return matchesFilter && matchesSearch;
              })
              .map((item, index) => {
                const pct = item.progress?.percent ?? 0;
                const isDone = item.progress?.completed ?? false;
                const bgGradient = isDone ? "#10B981" : index % 2 === 0 ? "#0A7E85" : "#6366F1";
                const category = /dữ liệu|sql|database/i.test(item.title)
                  ? "Cơ sở dữ liệu"
                  : /ai|trí tuệ|máy học/i.test(item.title)
                    ? "Trí tuệ nhân tạo"
                    : /web|react|javascript/i.test(item.title)
                      ? "Lập trình Web"
                      : "Công nghệ phần mềm";

                return (
                  <Pressable
                    key={item.courseId}
                    style={localStyles.courseCard}
                    onPress={() => router.push(`/learn/${item.courseId}` as Href)}
                    accessibilityRole="button"
                    accessibilityLabel={uiText("Tiếp tục học {0}", [item.title])}
                  >
                    <View style={{ flexDirection: "row", gap: 14, alignItems: "flex-start" }}>
                      <View style={[localStyles.courseThumb, { backgroundColor: bgGradient }]}>
                        <Icon name={isDone ? "award" : "book"} size={26} color="#FFF" />
                      </View>
                      <View style={{ flex: 1, gap: 4 }}>
                        <View
                          style={{ flexDirection: "row", gap: 6, flexWrap: "wrap", alignItems: "center" }}
                        >
                          <Badge label={category.toUpperCase()} variant="neutral" />
                          <Badge
                            label={isDone ? uiText("HOÀN THÀNH") : uiText("{0}% HOÀN TẤT", [pct])}
                            variant={isDone ? "success" : "ai"}
                          />
                        </View>
                        <Text style={localStyles.courseTitle} numberOfLines={2}>
                          {item.title}
                        </Text>
                      </View>
                    </View>

                    <View style={{ gap: 6, marginTop: 4 }}>
                      <ProgressBar progress={pct} color={isDone ? tokens.color.success : "#6366F1"} />
                      <View
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <Text style={styles.small}>
                          {item.progress
                            ? uiText("Đã học {0}/{1} bài", [
                                item.progress.completedCount,
                                item.progress.publishedTotal,
                              ])
                            : uiText("Đang cập nhật tiến độ")}
                        </Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                          <Text style={{ fontSize: 13, fontWeight: "700", color: tokens.color.brand }}>
                            {isDone ? uiText("Ôn tập lại") : uiText("Học tiếp")}
                          </Text>
                          <Icon name="chevronRight" size={14} color={tokens.color.brand} />
                        </View>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
          </View>
        )}
      </Page>

      {/* Bottom Navigation Dock */}
      <BottomNavBar
        currentRoute="learn"
        role={snapshot.user?.role}
        onNavigate={(path) => router.push(path as Href)}
      />
    </View>
  );
}

const localStyles = StyleSheet.create({
  center: {
    padding: tokens.space.xl,
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.small,
  },
  list: {
    gap: 14,
  },
  summaryRow: {
    flexDirection: "row",
    backgroundColor: tokens.color.surface,
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "space-around",
    ...tokens.shadow.subtle,
  },
  summaryItem: {
    alignItems: "center",
    gap: 3,
  },
  summaryNum: {
    fontSize: 18,
    fontWeight: "800",
    color: tokens.color.ink,
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: tokens.color.muted,
    textTransform: "uppercase",
  },
  summaryDivider: {
    width: 1,
    height: 28,
    backgroundColor: tokens.color.border,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: tokens.color.surface,
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  filterChipActive: {
    backgroundColor: tokens.color.brand,
    borderColor: tokens.color.brand,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: tokens.color.muted,
  },
  filterChipTextActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  courseCard: {
    backgroundColor: tokens.color.surface,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: tokens.color.border,
    padding: 16,
    gap: 12,
    ...tokens.shadow.card,
  },
  courseThumb: {
    width: 54,
    height: 54,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    ...tokens.shadow.subtle,
  },
  courseTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: tokens.color.ink,
    lineHeight: 22,
  },
});
