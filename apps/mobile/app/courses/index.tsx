import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { runtime } from "../../src/runtime";
import { courses as decodeCourses, type Course } from "../../src/learning";
import { ApiError } from "../../src/api";
import {
  configuredCategoryName,
  isSupportedTitleSearchTerm,
  loadConfiguredCoursePreview,
} from "../../src/catalog-preview";
import { Badge, BottomNavBar, Button, Page, SearchBar, styles, tokens } from "../../src/ui";

export default function CourseDiscoveryScreen() {
  const session = runtime!;
  const auth = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      setWarning(null);
      try {
        if (activeQuery) {
          const params = new URLSearchParams({ q: activeQuery, limit: "20" });
          const result = decodeCourses(
            await session.api.request(`/api/v1/courses/search?${params.toString()}`, { signal }),
          );
          if (!signal?.aborted) setCourses(result);
        } else {
          const result = await loadConfiguredCoursePreview(
            (path, options) => session.api.request(path, options),
            signal,
          );
          if (!signal?.aborted) {
            setCourses(result.courses);
            if (result.failedCategories.length > 0) {
              setWarning(
                `Chưa tải được: ${result.failedCategories.join(", ")}. Danh sách bên dưới chưa đầy đủ.`,
              );
            }
          }
        }
      } catch (cause) {
        if (!signal?.aborted) {
          setCourses([]);
          setError(cause instanceof ApiError ? cause.message : "Không tải được khóa học. Vui lòng thử lại.");
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [activeQuery, session],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load, reloadKey]);

  const retry = () => setReloadKey((value) => value + 1);

  const submitSearch = () => {
    const value = query.trim();
    if (value && !isSupportedTitleSearchTerm(value)) {
      setInputError("Nhập một từ gồm 3–20 ký tự chữ hoặc số trong tên khóa học.");
      return;
    }
    setInputError(null);
    if (value === activeQuery) retry();
    setActiveQuery(value);
  };

  return (
    <View style={screen.root}>
      <Page style={screen.page}>
        <View style={screen.intro}>
          <Badge label="Khóa học đã xuất bản" variant="primary" />
          <Text style={styles.title}>Khám phá khóa học</Text>
          <Text style={styles.text}>Tìm khóa học theo chủ đề và xem giá, nội dung trước khi đăng ký.</Text>
        </View>

        <SearchBar
          value={query}
          onChangeText={(value) => {
            setQuery(value);
            setInputError(null);
          }}
          onSubmit={submitSearch}
          onClear={() => {
            setQuery("");
            setInputError(null);
            setActiveQuery("");
            if (!activeQuery) retry();
          }}
          placeholder="Một từ trong tên khóa học"
        />
        {inputError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {inputError}
          </Text>
        ) : null}
        <Button label="Tìm kiếm" onPress={submitSearch} disabled={loading} />

        {warning ? (
          <View style={screen.warning} accessibilityLiveRegion="polite">
            <Text style={screen.warningText}>{warning}</Text>
            <Button label="Tải lại danh mục" variant="outline" onPress={retry} disabled={loading} />
          </View>
        ) : null}

        {loading ? (
          <View style={screen.center}>
            <ActivityIndicator color={tokens.color.brand} />
            <Text style={styles.text}>Đang tải danh mục…</Text>
          </View>
        ) : error ? (
          <View style={screen.card}>
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
            <Button label="Thử lại" variant="outline" onPress={retry} />
          </View>
        ) : courses.length === 0 ? (
          <View style={screen.card}>
            <Text style={screen.emptyTitle}>Không có khóa học phù hợp</Text>
            <Text style={styles.text}>
              {activeQuery
                ? "Thử một từ khác trong tên khóa học hoặc xóa tìm kiếm."
                : "Chưa có khóa học trong các danh mục đang hiển thị. Hãy thử tìm theo tên."}
            </Text>
          </View>
        ) : (
          <View style={screen.results}>
            <Text style={screen.sectionTitle}>
              {activeQuery
                ? `${courses.length} kết quả đầu tiên cho “${activeQuery}”`
                : `${courses.length} khóa học trong phần xem trước của 4 danh mục`}
            </Text>
            {courses.map((course) => (
              <Pressable
                key={course.courseId}
                accessibilityRole="button"
                accessibilityLabel={`Xem khóa học ${course.title}`}
                onPress={() => router.push(`/courses/${course.courseId}` as Href)}
                style={screen.courseCard}
              >
                <Text style={screen.category}>{configuredCategoryName(course.categoryId)}</Text>
                <Text style={screen.courseTitle}>{course.title}</Text>
                <View style={screen.courseFooter}>
                  <Text style={screen.price}>
                    {course.priceType === "FREE"
                      ? "Miễn phí"
                      : course.price
                        ? `${course.price}${course.currency ? ` ${course.currency}` : ""}`
                        : "Xem giá ở trang chi tiết"}
                  </Text>
                  <Text style={screen.link}>Xem chi tiết →</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
      </Page>
      <BottomNavBar
        currentRoute="/courses"
        onNavigate={(route) => router.push(route as Href)}
        role={auth.user?.role}
      />
    </View>
  );
}

const screen = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.color.canvas },
  page: { gap: 16, paddingBottom: 24 },
  intro: { gap: 8, paddingBottom: 4 },
  results: { gap: 12 },
  center: { minHeight: 160, alignItems: "center", justifyContent: "center", gap: 12 },
  card: {
    gap: 8,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: tokens.color.border,
    backgroundColor: "#FFFFFF",
  },
  warning: {
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#F5D78D",
    backgroundColor: "#FFFBEB",
  },
  warningText: { color: "#7A4B08", fontSize: 13, lineHeight: 20 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: tokens.color.ink },
  sectionTitle: { color: tokens.color.muted, fontSize: 13, fontWeight: "600", lineHeight: 20 },
  courseCard: {
    gap: 10,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: tokens.color.border,
    backgroundColor: "#FFFFFF",
    ...tokens.shadow.subtle,
  },
  category: {
    alignSelf: "flex-start",
    overflow: "hidden",
    backgroundColor: tokens.color.brandLight,
    color: tokens.color.brandDark,
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  courseTitle: { color: tokens.color.ink, fontSize: 17, fontWeight: "700", lineHeight: 24 },
  courseFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: tokens.color.border,
    paddingTop: 12,
  },
  price: { color: tokens.color.brandDark, fontSize: 14, fontWeight: "700", flexShrink: 1 },
  link: { color: tokens.color.brand, fontSize: 13, fontWeight: "700" },
});
