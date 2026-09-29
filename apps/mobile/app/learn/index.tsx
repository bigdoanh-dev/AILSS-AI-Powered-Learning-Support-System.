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
  tokens,
  styles,
} from "../../src/ui";

type EnrolledCourse = Course & { progress?: Progress };

export default function MyLearningScreen() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [coursesList, setCoursesList] = useState<EnrolledCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  }, [snapshot.state, session]);

  useEffect(() => {
    void fetchMyLearning();
  }, [fetchMyLearning]);

  if (snapshot.state !== "AUTHENTICATED") {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
        <Page>
          <View style={[styles.card, { alignItems: "center", paddingVertical: 40, gap: 14 }]}>
            <Icon name="book" size={40} color={tokens.color.brand} />
            <Text style={styles.title}>Không gian học tập</Text>
            <Text style={[styles.text, { textAlign: "center", maxWidth: 300 }]}>
              Vui lòng đăng nhập tài khoản học viên để xem các khóa học đang theo học.
            </Text>
            <Button label="Đăng nhập ngay" size="lg" onPress={() => router.push("/login")} />
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
          <Badge label="TIẾN ĐỘ HỌC TẬP" variant="primary" icon="sparkles" />
          <Text style={styles.title}>Khóa học của tôi</Text>
          <Text style={styles.text}>Tiếp tục các bài học dở dang và theo dõi mục tiêu học tập.</Text>
        </View>

        {error ? (
          <View style={[styles.card, { borderColor: tokens.color.dangerLight, backgroundColor: "#FEF2F2" }]}>
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
            <Button label="Thử lại" size="sm" onPress={() => void fetchMyLearning()} />
          </View>
        ) : loading ? (
          <View style={localStyles.center}>
            <ActivityIndicator size="large" color={tokens.color.brand} />
            <Text style={styles.small}>Đang tải tiến độ học tập…</Text>
          </View>
        ) : coursesList.length === 0 ? (
          <EmptyState
            icon="book"
            title="Chưa tham gia khóa học nào"
            description="Bạn chưa đăng ký khóa học nào. Hãy bắt đầu khám phá thư viện khóa học phong phú của AILSS ngay!"
            actionLabel="Khám phá khóa học ngay"
            onAction={() => router.push("/courses")}
          />
        ) : (
          <View style={localStyles.list}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: tokens.color.muted }}>
                ĐANG HỌC ({coursesList.length} KHÓA)
              </Text>
            </View>

            {coursesList.map((item, index) => {
              const pct = item.progress?.percent ?? 0;
              const isDone = item.progress?.completed ?? false;
              const bgGradient = index % 2 === 0 ? "#0A7E85" : "#6366F1";
              return (
                <Pressable
                  key={item.courseId}
                  style={localStyles.courseCard}
                  onPress={() => router.push(`/learn/${item.courseId}` as Href)}
                  accessibilityRole="button"
                  accessibilityLabel={`Tiếp tục học ${item.title}`}
                >
                  <View style={{ flexDirection: "row", gap: 14, alignItems: "flex-start" }}>
                    <View style={[localStyles.courseThumb, { backgroundColor: bgGradient }]}>
                      <Icon name={isDone ? "award" : "book"} size={26} color="#FFF" />
                    </View>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Badge
                        label={isDone ? "HOÀN THÀNH" : `${pct}% HOÀN TẤT`}
                        variant={isDone ? "success" : "ai"}
                      />
                      <Text style={localStyles.courseTitle} numberOfLines={2}>
                        {item.title}
                      </Text>
                    </View>
                  </View>

                  <View style={{ gap: 6, marginTop: 4 }}>
                    <ProgressBar progress={pct} color={isDone ? tokens.color.success : "#6366F1"} />
                    <View
                      style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
                    >
                      <Text style={styles.small}>
                        {item.progress
                          ? `Đã học ${item.progress.completedCount}/${item.progress.publishedTotal} bài`
                          : "Đang cập nhật tiến độ"}
                      </Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Text style={{ fontSize: 13, fontWeight: "700", color: tokens.color.brand }}>
                          {isDone ? "Ôn tập lại" : "Học tiếp"}
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
