import { useCallback, useEffect, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { ApiError } from "../../src/api";
import { publicLecturer, type PublicLecturer } from "../../src/public-lecturer";
import { runtime } from "../../src/runtime";
import { loadConfiguredCoursePreview } from "../../src/catalog-preview";
import { courseDetail, type Course } from "../../src/learning";
import { reviewList, type Review } from "../../src/interaction";
import { Button, Page, ScreenHeader, styles, tokens } from "../../src/ui";

export default function LecturerProfileScreen() {
  const { lecturerId, courseId } = useLocalSearchParams<{ lecturerId: string; courseId?: string }>();
  const api = runtime!.api;
  const [profile, setProfile] = useState<PublicLecturer | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [reviews, setReviews] = useState<Array<Review & { courseTitle: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!lecturerId) return;
    setLoading(true);
    setError("");
    try {
      const value = publicLecturer(await api.request(`/api/v1/lecturers/${encodeURIComponent(lecturerId)}`));
      setProfile(value);
      const preview = await loadConfiguredCoursePreview((path, options) => api.request(path, options)).catch(
        () => ({ courses: [] as Course[], failedCategories: [] }),
      );
      const match = preview.courses.filter((item) => item.lecturerId === lecturerId);
      if (courseId && !match.some((item) => item.courseId === courseId)) {
        try {
          const current = courseDetail(await api.request(`/api/v1/courses/${encodeURIComponent(courseId)}`));
          if (current.lecturerId === lecturerId) match.unshift(current);
        } catch {
          /* Keep the verified profile visible when the catalog is unavailable. */
        }
      }
      setCourses(match);
      const entries = await Promise.all(
        match.slice(0, 3).map(async (course) => {
          try {
            const result = reviewList(
              await api.request(`/api/v1/courses/${course.courseId}/reviews?limit=5`, { includeMeta: true }),
            );
            return result.items
              .filter((item) => item.state === "ACTIVE")
              .map((item) => ({ ...item, courseTitle: course.title }));
          } catch {
            return [];
          }
        }),
      );
      setReviews(entries.flat());
    } catch (cause) {
      setProfile(null);
      setError(cause instanceof ApiError ? cause.message : "Không thể tải hồ sơ giảng viên.");
    } finally {
      setLoading(false);
    }
  }, [api, lecturerId, courseId]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <Page>
        <ScreenHeader
          title="Hồ sơ giảng viên"
          onBack={() => (router.canGoBack() ? router.back() : router.replace("/courses"))}
        />
        {loading ? <Text style={styles.small}>Đang tải hồ sơ giảng viên…</Text> : null}
        {error ? (
          <>
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
            <Button label="Thử lại" onPress={() => void load()} />
          </>
        ) : null}
        {profile ? (
          <>
            <View style={[styles.card, { gap: 10, alignItems: "center" }]}>
              {profile.avatarRef ? (
                <Image
                  source={{ uri: profile.avatarRef }}
                  accessibilityLabel={`Ảnh giảng viên ${profile.displayName}`}
                  style={{ width: 96, height: 96, borderRadius: 48 }}
                />
              ) : (
                <View
                  style={{
                    width: 96,
                    height: 96,
                    borderRadius: 48,
                    backgroundColor: tokens.color.brand,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: "white", fontSize: 38 }}>{profile.displayName.slice(0, 1)}</Text>
                </View>
              )}
              <Text style={styles.title}>{profile.displayName}</Text>
              <Text style={styles.small}>
                {profile.verified ? "Giảng viên đã xác minh" : "Hồ sơ giảng viên"}
              </Text>
              <Text style={styles.text}>{profile.bio || "Giảng viên chưa cập nhật lời giới thiệu."}</Text>
            </View>
            <View style={[styles.card, { gap: 8 }]}>
              <Text style={styles.title}>Kinh nghiệm</Text>
              <Text style={styles.text}>{profile.experience || "Chưa cập nhật"}</Text>
              <Text style={styles.title}>Học vấn</Text>
              <Text style={styles.text}>{profile.education || "Chưa cập nhật"}</Text>
              <Text style={styles.title}>Thành tựu</Text>
              <Text style={styles.text}>{profile.achievements || "Chưa cập nhật"}</Text>
            </View>
            <View style={[styles.card, { gap: 8 }]}>
              <Text style={styles.title}>Khóa học tiêu biểu</Text>
              {courses.length ? (
                courses.map((course) => (
                  <Pressable
                    key={course.courseId}
                    accessibilityRole="button"
                    onPress={() => router.push(`/courses/${course.courseId}` as Href)}
                  >
                    <Text style={[styles.text, { color: tokens.color.brand, fontWeight: "700" }]}>
                      {course.title}
                    </Text>
                    <Text style={styles.small}>
                      {course.priceType === "FREE"
                        ? "Miễn phí"
                        : `${course.price ?? "—"} ${course.currency ?? "VND"}`}
                    </Text>
                  </Pressable>
                ))
              ) : (
                <Text style={styles.small}>Chưa có khóa học trong danh mục hiện tại.</Text>
              )}
            </View>
            <View style={[styles.card, { gap: 8 }]}>
              <Text style={styles.title}>Đánh giá của học viên</Text>
              {reviews.length ? (
                reviews.map((review) => (
                  <View
                    key={review.reviewId}
                    style={{ borderTopWidth: 1, borderColor: tokens.color.border, paddingTop: 7 }}
                  >
                    <Text style={styles.small}>
                      {review.courseTitle} · {"★".repeat(review.rating)}
                      {"☆".repeat(5 - review.rating)}
                    </Text>
                    <Text style={styles.text}>{review.body || "Học viên đã đánh giá khóa học này."}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.small}>Chưa có nhận xét công khai trong các khóa học đang hiển thị.</Text>
              )}
            </View>
          </>
        ) : null}
      </Page>
    </View>
  );
}
