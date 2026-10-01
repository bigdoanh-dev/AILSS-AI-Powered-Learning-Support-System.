import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { runtime } from "../../src/runtime";
import { courses as decodeCourses, type Course } from "../../src/learning";
import { ApiError } from "../../src/api";
import {
  configuredCategoryName,
  configuredCourseCategories,
  isSupportedTitleSearchTerm,
  loadConfiguredCoursePreview,
} from "../../src/catalog-preview";
import { BottomNavBar, Button, Icon, Page, SearchBar, styles, tokens } from "../../src/ui";
import { ScalePressable } from "../../src/motion";

function formatCoursePrice(price?: string, priceType?: string, currency?: string) {
  if (priceType === "FREE") return "Miễn phí";
  if (!price) return "Xem giá ở trang chi tiết";
  const num = Number(price);
  if (!Number.isNaN(num) && num > 0) {
    return new Intl.NumberFormat("vi-VN").format(num) + " ₫";
  }
  return `${price}${currency ? ` ${currency}` : ""}`;
}

function getCategoryTheme(categoryId?: string) {
  if (categoryId === "10000000-0000-4000-8000-000000000001") {
    return {
      bg: "rgba(239, 246, 255, 0.9)",
      badgeBg: "#DBEAFE",
      border: "#BFDBFE",
      text: "#1D4ED8",
      accent: "#2563EB",
      tag: "Lập trình",
      icon: "book" as const,
    };
  }
  if (categoryId === "10000000-0000-4000-8000-000000000002") {
    return {
      bg: "rgba(240, 253, 244, 0.9)",
      badgeBg: "#DCFCE7",
      border: "#BBF7D0",
      text: "#15803D",
      accent: "#16A34A",
      tag: "Cơ sở dữ liệu",
      icon: "document" as const,
    };
  }
  if (categoryId === "10000000-0000-4000-8000-000000000003") {
    return {
      bg: "rgba(250, 245, 255, 0.9)",
      badgeBg: "#F3E8FF",
      border: "#E9D5FF",
      text: "#7E22CE",
      accent: "#9333EA",
      tag: "Trí tuệ nhân tạo",
      icon: "sparkles" as const,
    };
  }
  return {
    bg: "rgba(255, 251, 235, 0.9)",
    badgeBg: "#FEF3C7",
    border: "#FDE68A",
    text: "#B45309",
    accent: "#D97706",
    tag: "Kỹ năng & Ngoại ngữ",
    icon: "academic" as const,
  };
}

export default function CourseDiscoveryScreen() {
  const session = runtime!;
  const auth = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
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

  const filteredCourses = selectedCategory
    ? courses.filter((c) => c.categoryId === selectedCategory)
    : courses;

  return (
    <View style={screen.root}>
      <Page style={screen.page}>
        {/* Hero Section */}
        <View style={screen.heroCard}>
          <View style={screen.heroBadgeRow}>
            <View style={screen.heroPill}>
              <Icon name="sparkles" size={13} color="#0D9488" />
              <Text style={screen.heroPillText}>AILSS LEARNING</Text>
            </View>
            <View style={screen.heroCountPill}>
              <Text style={screen.heroCountText}>{courses.length} Khóa học</Text>
            </View>
          </View>
          <Text style={screen.heroTitle}>Khám phá khóa học</Text>
          <Text style={screen.heroSub}>
            Lộ trình học tập chuẩn quốc tế, tích hợp trợ lý AI thông minh đồng hành 24/7.
          </Text>
        </View>

        {/* Search Section */}
        <View style={screen.searchWrap}>
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
            placeholder="Tìm theo từ khóa (vd: python, sql, ai...)"
          />
          {inputError ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {inputError}
            </Text>
          ) : null}
          <Button label="Tìm kiếm" onPress={submitSearch} disabled={loading} />
        </View>

        {/* Category Horizontal Filter Pills */}
        <View style={screen.categoryBarWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={screen.categoryScroll}
          >
            <ScalePressable
              onPress={() => setSelectedCategory(null)}
              style={[screen.categoryPill, selectedCategory === null && screen.categoryPillActive]}
            >
              <Icon
                name="grid"
                size={14}
                color={selectedCategory === null ? "#FFFFFF" : tokens.color.muted}
              />
              <Text
                style={[screen.categoryPillText, selectedCategory === null && screen.categoryPillTextActive]}
              >
                Tất cả ({courses.length})
              </Text>
            </ScalePressable>
            {configuredCourseCategories.map((cat) => {
              const isSelected = selectedCategory === cat.id;
              const count = courses.filter((c) => c.categoryId === cat.id).length;
              return (
                <ScalePressable
                  key={cat.id}
                  onPress={() => setSelectedCategory(isSelected ? null : cat.id)}
                  style={[screen.categoryPill, isSelected && screen.categoryPillActive]}
                >
                  <Text style={[screen.categoryPillText, isSelected && screen.categoryPillTextActive]}>
                    {cat.name} ({count})
                  </Text>
                </ScalePressable>
              );
            })}
          </ScrollView>
        </View>

        {warning ? (
          <View style={screen.warning} accessibilityLiveRegion="polite">
            <Text style={screen.warningText}>{warning}</Text>
            <Button label="Tải lại danh mục" variant="outline" onPress={retry} disabled={loading} />
          </View>
        ) : null}

        {loading ? (
          <View style={screen.center}>
            <ActivityIndicator size="large" color={tokens.color.brand} />
            <Text style={[styles.text, { marginTop: 8 }]}>Đang cập nhật danh mục khóa học…</Text>
          </View>
        ) : error ? (
          <View style={screen.card}>
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
            <Button label="Thử lại" variant="outline" onPress={retry} />
          </View>
        ) : filteredCourses.length === 0 ? (
          <View style={screen.card}>
            <Text style={screen.emptyTitle}>Không có khóa học phù hợp</Text>
            <Text style={styles.text}>
              {activeQuery
                ? "Thử một từ khác trong tên khóa học hoặc xóa tìm kiếm."
                : "Chưa có khóa học trong danh mục này. Hãy chọn danh mục khác hoặc xóa bộ lọc."}
            </Text>
            {selectedCategory && (
              <Button
                label="Xem tất cả khóa học"
                variant="outline"
                onPress={() => setSelectedCategory(null)}
                style={{ marginTop: 12 }}
              />
            )}
          </View>
        ) : (
          <View style={screen.results}>
            <View style={screen.resultsHeaderRow}>
              <Text style={screen.sectionTitle}>
                {activeQuery
                  ? `${filteredCourses.length} kết quả cho “${activeQuery}”`
                  : `${filteredCourses.length} khóa học đang hiển thị`}
              </Text>
              {selectedCategory && (
                <Text style={screen.clearFilterText} onPress={() => setSelectedCategory(null)}>
                  Đặt lại lọc ✕
                </Text>
              )}
            </View>

            {filteredCourses.map((course) => {
              const theme = getCategoryTheme(course.categoryId);
              const priceFormatted = formatCoursePrice(course.price, course.priceType, course.currency);
              const isFree = course.priceType === "FREE";

              return (
                <ScalePressable
                  key={course.courseId}
                  accessibilityRole="button"
                  accessibilityLabel={`Xem khóa học ${course.title}`}
                  onPress={() => router.push(`/courses/${course.courseId}` as Href)}
                  style={screen.courseCard}
                >
                  {/* Decorative Artwork Header */}
                  <View style={[screen.cardTopBanner, { backgroundColor: theme.bg }]}>
                    <View style={screen.bannerTagRow}>
                      <View style={[screen.categoryChip, { backgroundColor: theme.badgeBg }]}>
                        <Icon name={theme.icon} size={13} color={theme.text} />
                        <Text style={[screen.categoryChipText, { color: theme.text }]}>
                          {configuredCategoryName(course.categoryId)}
                        </Text>
                      </View>
                      <View style={screen.ratingPill}>
                        <Icon name="star" size={12} color="#D97706" />
                        <Text style={screen.ratingText}>4.9★</Text>
                      </View>
                    </View>
                  </View>

                  {/* Body Content */}
                  <View style={screen.cardBody}>
                    <Text style={screen.courseTitle} numberOfLines={2}>
                      {course.title}
                    </Text>

                    {/* Metadata tags */}
                    <View style={screen.metaRow}>
                      <View style={screen.metaItem}>
                        <Icon name="book" size={13} color={tokens.color.muted} />
                        <Text style={screen.metaText}>12+ bài học</Text>
                      </View>
                      <Text style={screen.metaDot}>•</Text>
                      <View style={screen.metaItem}>
                        <Icon name="clock" size={13} color={tokens.color.muted} />
                        <Text style={screen.metaText}>Tự học linh hoạt</Text>
                      </View>
                      <Text style={screen.metaDot}>•</Text>
                      <View style={screen.metaItem}>
                        <Icon name="award" size={13} color={tokens.color.muted} />
                        <Text style={screen.metaText}>Chứng chỉ</Text>
                      </View>
                    </View>

                    {/* Footer: Price & CTA */}
                    <View style={screen.courseFooter}>
                      <View>
                        <Text style={screen.priceLabel}>Học phí khóa học</Text>
                        <Text style={[screen.price, isFree && screen.priceFree]}>{priceFormatted}</Text>
                      </View>
                      <View style={screen.actionBtnPill}>
                        <Text style={screen.actionBtnText}>Khám phá ngay</Text>
                        <Icon name="chevronRight" size={13} color="#FFFFFF" />
                      </View>
                    </View>
                  </View>
                </ScalePressable>
              );
            })}
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
  heroCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: tokens.color.border,
    gap: 8,
    ...tokens.shadow.subtle,
  },
  heroBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  heroPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(13, 148, 136, 0.1)",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  heroPillText: {
    color: "#0D9488",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  heroCountPill: {
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  heroCountText: {
    color: tokens.color.muted,
    fontSize: 11.5,
    fontWeight: "600",
  },
  heroTitle: {
    color: tokens.color.ink,
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  heroSub: {
    color: tokens.color.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  searchWrap: {
    gap: 10,
  },
  categoryBarWrap: {
    marginHorizontal: -4,
  },
  categoryScroll: {
    gap: 8,
    paddingHorizontal: 4,
  },
  categoryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  categoryPillActive: {
    backgroundColor: tokens.color.brand,
    borderColor: tokens.color.brand,
    ...tokens.shadow.subtle,
  },
  categoryPillText: {
    fontSize: 12.5,
    fontWeight: "600",
    color: tokens.color.inkSecondary,
  },
  categoryPillTextActive: {
    color: "#FFFFFF",
    fontWeight: "700",
  },
  results: { gap: 14 },
  resultsHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: { color: tokens.color.muted, fontSize: 13, fontWeight: "600" },
  clearFilterText: { color: tokens.color.brand, fontSize: 12, fontWeight: "700" },
  center: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: 12 },
  card: {
    gap: 8,
    padding: 18,
    borderRadius: 16,
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
  courseCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: tokens.color.border,
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
    ...tokens.shadow.subtle,
  },
  cardTopBanner: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
  },
  bannerTagRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  categoryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: "700",
  },
  ratingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.06)",
  },
  ratingText: {
    fontSize: 11.5,
    fontWeight: "700",
    color: "#B45309",
  },
  cardBody: {
    padding: 16,
    gap: 10,
  },
  courseTitle: {
    color: tokens.color.ink,
    fontSize: 16.5,
    fontWeight: "700",
    lineHeight: 23,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  metaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: tokens.color.muted,
  },
  metaDot: {
    fontSize: 10,
    color: tokens.color.borderStrong,
  },
  courseFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
    paddingTop: 12,
    marginTop: 2,
  },
  priceLabel: {
    fontSize: 11,
    color: tokens.color.muted,
    marginBottom: 2,
  },
  price: {
    color: tokens.color.ink,
    fontSize: 16,
    fontWeight: "800",
  },
  priceFree: {
    color: "#16A34A",
  },
  actionBtnPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: tokens.color.brand,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  actionBtnText: {
    color: "#FFFFFF",
    fontSize: 12.5,
    fontWeight: "700",
  },
});
