import { useEffect, useState, useCallback } from "react";
import { Text, View, Pressable, StyleSheet } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useSyncExternalStore } from "react";
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
import { Page, Button, ScreenHeader, styles, tokens } from "../../../../src/ui";

export default function CourseDetail() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [course, setCourse] = useState<LecturerCourse | null>(null);
  const [lessons, setLessons] = useState<LecturerLesson[] | null>(null);
  const [offerings, setOfferings] = useState<OwnedOffering[] | null>(null);
  const [ratingAvg, setRatingAvg] = useState("5.0");
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

    // Course detail (LRN-03)
    void session
      .request(`/api/v1/courses/${courseId}`, { signal: abort.signal })
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
        if (!abort.signal.aborted) setLessons([]);
      });

    // Offerings (LRN-27)
    void session
      .request(`/api/v1/courses/${courseId}/offerings`, { signal: abort.signal })
      .then((value) => {
        if (!abort.signal.aborted) setOfferings(ownedOfferings(value));
      })
      .catch(() => {
        if (!abort.signal.aborted) setOfferings([]);
      });

    // Reviews summary
    void session
      .request(`/api/v1/courses/${courseId}/reviews`, { signal: abort.signal })
      .then((raw) => {
        if (abort.signal.aborted) return;
        try {
          const res = reviewList(raw);
          setReviewCount(res.ratingSummary.reviewCount);
          if (res.ratingSummary.average > 0) {
            setRatingAvg(res.ratingSummary.average.toFixed(1));
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
        <>
          {/* Hero Overview Card */}
          <View style={[styles.card, ds.heroCard]}>
            <View style={ds.heroTopRow}>
              <View style={[ds.badge, course.state === "PUBLISHED" ? ds.published : ds.draft]}>
                <Text style={[ds.badgeText, course.state === "PUBLISHED" ? ds.publishedText : ds.draftText]}>
                  {course.state === "PUBLISHED" ? "● ĐÃ XUẤT BẢN" : "○ BẢN NHÁP"}
                </Text>
              </View>
              <View style={ds.pricePill}>
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
              <Text style={ds.metaChip}>📁 {course.categoryId ?? "Chung"}</Text>
              {course.slug ? <Text style={ds.metaChip}>🔗 {course.slug}</Text> : null}
            </View>
          </View>

          {/* 4 KPI Metric Cards */}
          <View style={ds.kpiGrid}>
            <View style={ds.kpiCard}>
              <Text style={ds.kpiIcon}>📖</Text>
              <Text style={ds.kpiValue}>{lessons?.length ?? 0}</Text>
              <Text style={ds.kpiLabel}>Bài học</Text>
            </View>
            <View style={ds.kpiCard}>
              <Text style={ds.kpiIcon}>🏷️</Text>
              <Text style={ds.kpiValue}>{offerings?.length ?? 0}</Text>
              <Text style={ds.kpiLabel}>Đợt mở bán</Text>
            </View>
            <Pressable
              style={ds.kpiCard}
              onPress={() => router.push(`/teaching/courses/${courseId}/reviews` as Href)}
            >
              <Text style={ds.kpiIcon}>⭐</Text>
              <Text style={[ds.kpiValue, { color: "#f59e0b" }]}>{ratingAvg}</Text>
              <Text style={ds.kpiLabel}>{reviewCount} đánh giá</Text>
            </Pressable>
            <View style={ds.kpiCard}>
              <Text style={ds.kpiIcon}>💰</Text>
              <Text style={[ds.kpiValue, { fontSize: 13 }]} numberOfLines={1}>
                {course.priceType === "FREE" ? "Free" : `${course.price ?? "0"}`}
              </Text>
              <Text style={ds.kpiLabel}>Học phí</Text>
            </View>
          </View>

          {/* Quick Studio Actions */}
          <View style={ds.quickActionsRow}>
            <Pressable
              style={ds.actionButton}
              onPress={() => router.push(`/teaching/courses/${courseId}/edit` as Href)}
            >
              <Text style={ds.actionButtonText}>✏️ Sửa khóa học</Text>
            </Pressable>
            <Pressable
              style={ds.actionButton}
              onPress={() => router.push(`/teaching/courses/${courseId}/lessons` as Href)}
            >
              <Text style={ds.actionButtonText}>➕ Thêm bài học</Text>
            </Pressable>
            <Pressable
              style={[ds.actionButton, ds.actionButtonAccent]}
              onPress={() => router.push(`/teaching/courses/${courseId}/reviews` as Href)}
            >
              <Text style={[ds.actionButtonText, ds.actionButtonAccentText]}>
                ⭐ Đánh giá ({reviewCount})
              </Text>
            </Pressable>
          </View>

          {/* Segmented Tab Switcher */}
          <View style={ds.tabBar}>
            <Pressable
              style={[ds.tabItem, activeTab === "lessons" && ds.tabItemActive]}
              onPress={() => setActiveTab("lessons")}
            >
              <Text style={[ds.tabItemText, activeTab === "lessons" && ds.tabItemTextActive]}>
                📖 Bài Giảng ({lessons?.length ?? 0})
              </Text>
            </Pressable>
            <Pressable
              style={[ds.tabItem, activeTab === "offerings" && ds.tabItemActive]}
              onPress={() => setActiveTab("offerings")}
            >
              <Text style={[ds.tabItemText, activeTab === "offerings" && ds.tabItemTextActive]}>
                🏷️ Đợt Mở Bán ({offerings?.length ?? 0})
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
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
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
                            <Text style={ds.previewBadgeText}>👁️ Xem thử</Text>
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
                <View style={[styles.card, { alignItems: "center", paddingVertical: 24 }]}>
                  <Text style={[styles.text, { marginBottom: 12 }]}>
                    Chưa có bài học nào trong khóa học này.
                  </Text>
                  <Button
                    label="➕ Thêm bài học đầu tiên"
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
                    <Text style={[styles.small, { color: tokens.color.brand }]}>
                      Quản lý đợt tuyển sinh →
                    </Text>
                  </Pressable>
                ))
              ) : (
                <View style={[styles.card, { alignItems: "center", paddingVertical: 24 }]}>
                  <Text style={[styles.text, { marginBottom: 12 }]}>Chưa có đợt mở bán nào.</Text>
                  <Button
                    label="Tạo đợt mở bán mới"
                    onPress={() => router.push("/teaching/offerings" as Href)}
                  />
                </View>
              )}
            </View>
          )}
        </>
      )}

      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {error && <Button label="Thử lại" onPress={handleRetry} />}
      <View style={{ marginTop: 12 }}>
        <Button
          label="Quay lại danh sách"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/teaching/courses"))}
        />
      </View>
    </Page>
  );
}

const ds = StyleSheet.create({
  heroCard: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tokens.color.border,
    padding: 16,
    gap: 8,
  },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  published: { backgroundColor: "#dcfce7" },
  draft: { backgroundColor: "#fef3c7" },
  badgeText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
  publishedText: { color: "#166534" },
  draftText: { color: "#92400e" },
  pricePill: {
    backgroundColor: "#eff6ff",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#bfdbfe",
  },
  pricePillText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  courseTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: tokens.color.ink,
    lineHeight: 24,
  },
  courseDesc: {
    fontSize: 13,
    color: tokens.color.muted,
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    marginTop: 4,
  },
  metaChip: {
    fontSize: 12,
    color: tokens.color.muted,
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  kpiGrid: {
    flexDirection: "row",
    gap: 8,
    marginVertical: 10,
  },
  kpiCard: {
    flex: 1,
    backgroundColor: tokens.color.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: tokens.color.border,
    padding: 10,
    alignItems: "center",
    gap: 2,
  },
  kpiIcon: { fontSize: 16 },
  kpiValue: { fontSize: 15, fontWeight: "700", color: tokens.color.ink },
  kpiLabel: { fontSize: 11, color: tokens.color.muted },
  quickActionsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
  },
  actionButton: {
    flex: 1,
    backgroundColor: "#f1f5f9",
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#334155",
  },
  actionButtonAccent: {
    backgroundColor: "#fef3c7",
    borderColor: "#fde68a",
  },
  actionButtonAccentText: {
    color: "#92400e",
  },
  tabBar: {
    flexDirection: "row",
    backgroundColor: "#e2e8f0",
    borderRadius: 8,
    padding: 3,
    marginBottom: 12,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 6,
  },
  tabItemActive: {
    backgroundColor: "#ffffff",
    elevation: 1,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
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
    padding: 12,
    gap: 6,
    borderLeftWidth: 3,
    borderLeftColor: tokens.color.brand,
  },
  lessonCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  orderPill: {
    backgroundColor: "#eff6ff",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  orderPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: tokens.color.brand,
  },
  previewBadge: {
    backgroundColor: "#ecfdf5",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#a7f3d0",
  },
  previewBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#047857",
  },
  lessonTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.color.ink,
  },
  offeringCard: {
    padding: 14,
    gap: 6,
  },
  offeringPrice: {
    fontSize: 14,
    fontWeight: "700",
    color: tokens.color.brand,
  },
  offeringTypeTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: tokens.color.ink,
  },
});
