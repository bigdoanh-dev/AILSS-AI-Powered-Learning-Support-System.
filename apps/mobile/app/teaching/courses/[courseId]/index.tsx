import { loadCourseCategories, type CourseCategory } from "../../../../src/catalog-preview";
import { useEffect, useState, useCallback } from "react";
import { Text, View, Pressable, StyleSheet } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useSyncExternalStore } from "react";
import { useMobileCommand } from "../../../../src/queries";
import { ApiError } from "../../../../src/api";
import { runtime } from "../../../../src/runtime";
import {
  lecturerCourse,
  lecturerLessons,
  ownedOfferings,
  type LecturerCourse,
  type LecturerLesson,
  type OwnedOffering,
} from "../../../../src/teaching";
import { reviewList } from "../../../../src/interaction";
import { Page, Button, ScreenHeader, Icon, styles, tokens } from "../../../../src/ui";
import { ScalePressable, FadeSlideIn } from "../../../../src/motion";

export default function CourseDetail() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const session = runtime!;
  const command = useMobileCommand();
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [categoryOptions, setCategoryOptions] = useState<CourseCategory[]>([]);
  const [course, setCourse] = useState<LecturerCourse | null>(null);
  const [lessons, setLessons] = useState<LecturerLesson[] | null>(null);
  const [offerings, setOfferings] = useState<OwnedOffering[] | null>(null);
  const [ratingAvg, setRatingAvg] = useState("—");
  const [reviewCount, setReviewCount] = useState(0);
  const [activeTab, setActiveTab] = useState<"lessons" | "offerings">("lessons");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!courseId || snapshot.user?.role !== "LECTURER") return;
    const abort = new AbortController();
    setError("");
    setCourse(null);
    setLessons(null);
    setOfferings(null);
    setRatingAvg("—");
    setReviewCount(0);
    void loadCourseCategories((path, options) => session.api.request(path, options), abort.signal)
      .then((items) => {
        if (!abort.signal.aborted) setCategoryOptions(items);
      })
      .catch(() => {});

    // Course detail (LRN-03)
    void session
      .request(`/api/v1/me/courses/${courseId}`, { signal: abort.signal })
      .then((value) => {
        if (!abort.signal.aborted) setCourse(lecturerCourse(value));
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted) setError(e instanceof ApiError ? e.message : "Không thể tải khóa học.");
      });

    // Lessons (LRN-10)
    void session
      .request(`/api/v1/courses/${courseId}/lessons`, { signal: abort.signal })
      .then((value) => {
        if (!abort.signal.aborted) setLessons(lecturerLessons(value));
      })
      .catch(() => {
        if (!abort.signal.aborted) setError("Không tải được bài học. Hãy thử lại.");
      });

    // Offerings (LRN-27)
    void session
      .request(`/api/v1/courses/${courseId}/offerings`, { signal: abort.signal })
      .then((value) => {
        if (!abort.signal.aborted) setOfferings(ownedOfferings(value));
      })
      .catch(() => {
        if (!abort.signal.aborted) setError("Không tải được đợt mở bán. Hãy thử lại.");
      });

    // Reviews summary
    void session
      .request(`/api/v1/courses/${courseId}/reviews`, { signal: abort.signal, includeMeta: true })
      .then((raw) => {
        if (abort.signal.aborted) return;
        try {
          const res = reviewList(raw);
          setReviewCount(res.ratingSummary.reviewCount);
          if (res.ratingSummary.reviewCount > 0) {
            setRatingAvg(res.ratingSummary.average.toFixed(1));
          } else {
            setRatingAvg("Chưa có đánh giá");
          }
        } catch {
          // ignore parsing error
        }
      })
      .catch(() => {});

    return () => abort.abort();
  }, [courseId, session, snapshot.user?.userId, retry]);

  const handleRetry = useCallback(() => setRetry((v) => v + 1), []);

  if (snapshot.user?.role !== "LECTURER") {
    return (
      <Page>
        <Text style={styles.error}>Bạn không có quyền truy cập.</Text>
        <Button label="Về trang chủ" onPress={() => router.replace("/")} />
      </Page>
    );
  }

  return (
    <Page>
      {command.message ? (
        <Text accessibilityRole="alert" style={styles.text}>
          {command.message}
        </Text>
      ) : null}
      <ScreenHeader
        title={course ? course.title : "Chi tiết khóa học"}
        subtitle="Quản trị nội dung bài giảng & gói đào tạo"
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/teaching/courses"))}
        rightElement={
          course ? (
            <Button
              label="Sửa"
              size="sm"
              variant="outline"
              icon={<Icon name="pencil" size={14} color={tokens.color.ink} />}
              onPress={() => router.push(`/teaching/courses/${courseId}/edit` as Href)}
            />
          ) : undefined
        }
      />

      {!error && !course && (
        <Text accessibilityRole="alert" style={styles.text}>
          Đang tải…
        </Text>
      )}
      {course && (
        <FadeSlideIn duration={320}>
          {/* Hero Overview Card */}
          <View style={[styles.card, ds.heroCard]}>
            <View style={ds.heroAccentStripe} />
            <View style={ds.heroTopRow}>
              <View style={[ds.badge, course.state === "PUBLISHED" ? ds.published : ds.draft]}>
                <View
                  style={[
                    ds.statusDot,
                    { backgroundColor: course.state === "PUBLISHED" ? tokens.color.success : "#D97706" },
                  ]}
                />
                <Text style={[ds.badgeText, course.state === "PUBLISHED" ? ds.publishedText : ds.draftText]}>
                  {course.state === "PUBLISHED"
                    ? "ĐÃ XUẤT BẢN"
                    : course.state === "HIDDEN"
                      ? "ĐÃ ẨN"
                      : "BẢN NHÁP"}
                </Text>
              </View>
              <View style={ds.pricePill}>
                <Icon name="card" size={13} color="#1D4ED8" />
                <Text style={ds.pricePillText}>
                  {course.priceType === "FREE"
                    ? "Miễn phí"
                    : `${course.price ?? "—"} ${course.currency ?? "VND"}`}
                </Text>
              </View>
            </View>

            <Text style={ds.courseTitle}>{course.title}</Text>
            {course.description ? (
              <Text style={ds.courseDesc} numberOfLines={3}>
                {course.description}
              </Text>
            ) : null}

            <View style={ds.metaRow}>
              <View style={ds.metaChip}>
                <Icon name="book" size={13} color={tokens.color.brand} />
                <Text style={ds.metaChipText}>
                  {categoryOptions.find((item) => item.id === course.categoryId)?.name ?? "Chưa phân loại"}
                </Text>
              </View>
              {course.slug ? (
                <View style={ds.metaChip}>
                  <Icon name="grid" size={13} color={tokens.color.muted} />
                  <Text style={ds.metaChipText}>{course.slug}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* 4 KPI Metric Cards */}
          <View style={ds.kpiGrid}>
            <View style={ds.kpiCard}>
              <View style={[ds.kpiIconBox, { backgroundColor: "#E6F7F7" }]}>
                <Icon name="book" size={18} color={tokens.color.brand} />
              </View>
              <Text style={ds.kpiValue}>{lessons?.length ?? 0}</Text>
              <Text style={ds.kpiLabel}>Bài học</Text>
            </View>
            <View style={ds.kpiCard}>
              <View style={[ds.kpiIconBox, { backgroundColor: "#CCFBF1" }]}>
                <Icon name="tag" size={18} color="#0D9488" />
              </View>
              <Text style={ds.kpiValue}>{offerings?.length ?? 0}</Text>
              <Text style={ds.kpiLabel}>Đợt mở bán</Text>
            </View>
            <ScalePressable
              style={ds.kpiCard}
              onPress={() => router.push(`/teaching/courses/${courseId}/reviews` as Href)}
            >
              <View style={[ds.kpiIconBox, { backgroundColor: "#FEF3C7" }]}>
                <Icon name="starFilled" size={18} color="#F59E0B" />
              </View>
              <Text style={[ds.kpiValue, { color: "#D97706" }]}>{ratingAvg}</Text>
              <Text style={ds.kpiLabel}>{reviewCount} đánh giá</Text>
            </ScalePressable>
            <View style={ds.kpiCard}>
              <View style={[ds.kpiIconBox, { backgroundColor: "#D1FAE5" }]}>
                <Icon name="card" size={18} color="#059669" />
              </View>
              <Text style={[ds.kpiValue, { fontSize: 13 }]} numberOfLines={1}>
                {course.priceType === "FREE" ? "Free" : `${course.price ?? "0"}`}
              </Text>
              <Text style={ds.kpiLabel}>Học phí</Text>
            </View>
          </View>

          {/* Primary Management Actions */}
          <View style={ds.primaryActionsRow}>
            {course.state === "DRAFT" && (
              <ScalePressable
                style={[ds.primaryActionBtn, ds.submitReviewBtn]}
                onPress={() => {
                  void command.run(`/api/v1/courses/${courseId}/submit-review`, {}).then((ok) => {
                    if (ok) handleRetry();
                  });
                }}
              >
                <Icon name="sparkles" size={16} color="#FFFFFF" />
                <Text style={ds.primaryActionBtnText}>Gửi xét duyệt khóa học</Text>
              </ScalePressable>
            )}
            <ScalePressable
              style={[ds.primaryActionBtn, ds.rosterBtn, course.state !== "DRAFT" && { flex: 1 }]}
              onPress={() => router.push(`/teaching/courses/${courseId}/roster` as Href)}
            >
              <Icon name="people" size={16} color="#FFFFFF" />
              <Text style={ds.primaryActionBtnText}>Danh sách học viên</Text>
            </ScalePressable>
          </View>

          {/* Quick Studio Actions */}
          <View style={ds.quickActionsRow}>
            <ScalePressable
              style={ds.actionButton}
              onPress={() => router.push(`/teaching/courses/${courseId}/settings` as Href)}
            >
              <Icon name="settings" size={15} color={tokens.color.ink} />
              <Text style={ds.actionButtonText}>Cài đặt</Text>
            </ScalePressable>
            <ScalePressable
              style={ds.actionButton}
              onPress={() => router.push(`/teaching/courses/${courseId}/edit` as Href)}
            >
              <Icon name="pencil" size={15} color={tokens.color.ink} />
              <Text style={ds.actionButtonText}>Chỉnh sửa</Text>
            </ScalePressable>
            <ScalePressable
              style={ds.actionButton}
              onPress={() => router.push(`/teaching/courses/${courseId}/lessons` as Href)}
            >
              <Icon name="add" size={15} color={tokens.color.brand} />
              <Text style={[ds.actionButtonText, { color: tokens.color.brand }]}>Thêm bài học</Text>
            </ScalePressable>
            <ScalePressable
              style={[ds.actionButton, ds.actionButtonAccent]}
              onPress={() => router.push(`/teaching/courses/${courseId}/reviews` as Href)}
            >
              <Icon name="starFilled" size={15} color="#D97706" />
              <Text style={[ds.actionButtonText, ds.actionButtonAccentText]}>Đánh giá ({reviewCount})</Text>
            </ScalePressable>
          </View>

          {/* Segmented Tab Switcher */}
          <View style={ds.tabBar}>
            <Pressable
              style={[ds.tabItem, activeTab === "lessons" && ds.tabItemActive]}
              onPress={() => setActiveTab("lessons")}
            >
              <Icon
                name="book"
                size={15}
                color={activeTab === "lessons" ? tokens.color.brand : tokens.color.muted}
              />
              <Text style={[ds.tabItemText, activeTab === "lessons" && ds.tabItemTextActive]}>
                Bài Giảng ({lessons?.length ?? 0})
              </Text>
            </Pressable>
            <Pressable
              style={[ds.tabItem, activeTab === "offerings" && ds.tabItemActive]}
              onPress={() => setActiveTab("offerings")}
            >
              <Icon
                name="tag"
                size={15}
                color={activeTab === "offerings" ? tokens.color.brand : tokens.color.muted}
              />
              <Text style={[ds.tabItemText, activeTab === "offerings" && ds.tabItemTextActive]}>
                Đợt Mở Bán ({offerings?.length ?? 0})
              </Text>
            </Pressable>
          </View>

          {/* Tab 1: LESSONS LIST */}
          {activeTab === "lessons" && (
            <View style={{ gap: 10 }}>
              {lessons && lessons.length > 0 ? (
                lessons.map((lesson, idx) => (
                  <View key={lesson.lessonId} style={[styles.card, ds.lessonCard]}>
                    <View style={ds.lessonCardHeader}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <View style={ds.orderPill}>
                          <Text style={ds.orderPillText}>{String(idx + 1).padStart(2, "0")}</Text>
                        </View>
                        <Text style={[ds.badgeText, { color: tokens.color.muted }]}>
                          {lesson.sectionTitle}
                        </Text>
                      </View>
                      <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                        {lesson.preview ? (
                          <View style={ds.previewBadge}>
                            <Icon name="eye" size={12} color="#047857" />
                            <Text style={ds.previewBadgeText}>Xem thử</Text>
                          </View>
                        ) : null}
                        <View style={[ds.badge, lesson.state === "PUBLISHED" ? ds.published : ds.draft]}>
                          <Text style={ds.badgeText}>{lesson.state}</Text>
                        </View>
                      </View>
                    </View>
                    <Text style={ds.lessonTitle}>{lesson.title}</Text>
                  </View>
                ))
              ) : (
                <View style={[styles.card, { alignItems: "center", paddingVertical: 28, gap: 10 }]}>
                  <View style={ds.emptyIconRing}>
                    <Icon name="book" size={26} color={tokens.color.brand} />
                  </View>
                  <Text style={ds.emptyText}>Chưa có bài học nào trong khóa học này.</Text>
                  <Button
                    label="Thêm bài học đầu tiên"
                    icon={<Icon name="add" size={16} color="#FFFFFF" />}
                    onPress={() => router.push(`/teaching/courses/${courseId}/lessons` as Href)}
                  />
                </View>
              )}
            </View>
          )}

          {/* Tab 2: OFFERINGS LIST */}
          {activeTab === "offerings" && (
            <View style={{ gap: 10 }}>
              {offerings && offerings.length > 0 ? (
                offerings.map((o) => (
                  <Pressable
                    key={o.offeringId}
                    style={[styles.card, ds.offeringCard]}
                    accessibilityRole="button"
                    onPress={() => router.push(`/teaching/offerings/${o.offeringId}` as Href)}
                  >
                    <View style={ds.heroTopRow}>
                      <View style={[ds.badge, o.state === "PUBLISHED" ? ds.published : ds.draft]}>
                        <Text style={ds.badgeText}>{o.state}</Text>
                      </View>
                      <Text style={ds.offeringPrice}>
                        {o.price ? `${o.price} ${o.currency ?? "VND"}`.trim() : "Miễn phí"}
                      </Text>
                    </View>
                    <Text style={ds.offeringTypeTitle}>Gói: {o.offeringType}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Text style={[styles.small, { color: tokens.color.brand, fontWeight: "700" }]}>
                        Quản lý đợt tuyển sinh
                      </Text>
                      <Icon name="chevronRight" size={14} color={tokens.color.brand} />
                    </View>
                  </Pressable>
                ))
              ) : (
                <View style={[styles.card, { alignItems: "center", paddingVertical: 28, gap: 10 }]}>
                  <View style={ds.emptyIconRing}>
                    <Icon name="tag" size={26} color={tokens.color.brand} />
                  </View>
                  <Text style={ds.emptyText}>Chưa có đợt mở bán nào.</Text>
                  <Button
                    label="Tạo đợt mở bán mới"
                    icon={<Icon name="add" size={16} color="#FFFFFF" />}
                    onPress={() => router.push(`/teaching/offerings/create?courseId=${courseId}` as Href)}
                  />
                </View>
              )}
            </View>
          )}
        </FadeSlideIn>
      )}

      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {error && <Button label="Thử lại" onPress={handleRetry} />}
      <View style={{ marginTop: 14 }}>
        <Button
          label="Quay lại danh sách"
          variant="outline"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/teaching/courses"))}
        />
      </View>
    </Page>
  );
}

const ds = StyleSheet.create({
  heroCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: tokens.color.border,
    padding: 16,
    gap: 10,
    overflow: "hidden",
    position: "relative",
    ...tokens.shadow.subtle,
  },
  heroAccentStripe: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: tokens.color.brand,
  },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 2,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  published: { backgroundColor: "#DCFCE7" },
  draft: { backgroundColor: "#FEF3C7" },
  badgeText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
  publishedText: { color: "#166534" },
  draftText: { color: "#92400E" },
  pricePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#EFF6FF",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  pricePillText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1D4ED8",
  },
  courseTitle: {
    fontSize: 19,
    fontWeight: "800",
    color: tokens.color.ink,
    lineHeight: 25,
    letterSpacing: -0.3,
  },
  courseDesc: {
    fontSize: 13,
    color: tokens.color.muted,
    lineHeight: 19,
  },
  metaRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    marginTop: 2,
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  metaChipText: {
    fontSize: 12,
    fontWeight: "600",
    color: tokens.color.inkSecondary,
  },
  kpiGrid: {
    flexDirection: "row",
    gap: 8,
    marginVertical: 12,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: tokens.color.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: tokens.color.border,
    padding: 10,
    alignItems: "center",
    gap: 4,
    ...tokens.shadow.subtle,
  },
  kpiIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  kpiValue: { fontSize: 16, fontWeight: "800", color: tokens.color.ink },
  kpiLabel: { fontSize: 11, color: tokens.color.muted, fontWeight: "500" },
  primaryActionsRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 10,
  },
  primaryActionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    ...tokens.shadow.subtle,
  },
  submitReviewBtn: {
    backgroundColor: "#0D9488",
  },
  rosterBtn: {
    backgroundColor: tokens.color.brand,
  },
  primaryActionBtnText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  quickActionsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 14,
  },
  actionButton: {
    flex: 1,
    flexDirection: "row",
    gap: 5,
    backgroundColor: "#FFFFFF",
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: tokens.color.border,
    ...tokens.shadow.subtle,
  },
  actionButtonText: {
    fontSize: 11,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  actionButtonAccent: {
    backgroundColor: "#FEF3C7",
    borderColor: "#FDE68A",
  },
  actionButtonAccentText: {
    color: "#92400E",
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: tokens.color.surfaceSubtle,
    borderRadius: 12,
    padding: 4,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginBottom: 12,
    gap: 4,
  },
  tabItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    borderRadius: 8,
  },
  tabItemActive: {
    backgroundColor: "#FFFFFF",
    ...tokens.shadow.subtle,
  },
  tabItemText: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.color.muted,
  },
  tabItemTextActive: {
    color: tokens.color.brand,
    fontWeight: "700",
  },
  lessonCard: {
    padding: 14,
    gap: 8,
    borderRadius: 14,
    borderLeftWidth: 4,
    borderLeftColor: tokens.color.brand,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: tokens.color.border,
    ...tokens.shadow.subtle,
  },
  lessonCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  orderPill: {
    backgroundColor: "#E6F7F7",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  orderPillText: {
    fontSize: 11,
    fontWeight: "800",
    color: tokens.color.brand,
  },
  previewBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  previewBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#047857",
  },
  lessonTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: tokens.color.ink,
    lineHeight: 20,
  },
  emptyIconRing: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#E6F7F7",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    color: tokens.color.muted,
    fontSize: 13,
  },
  offeringCard: {
    padding: 14,
    gap: 8,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: tokens.color.border,
    ...tokens.shadow.subtle,
  },
  offeringPrice: {
    fontSize: 14,
    fontWeight: "800",
    color: tokens.color.brand,
  },
  offeringTypeTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: tokens.color.ink,
  },
});
