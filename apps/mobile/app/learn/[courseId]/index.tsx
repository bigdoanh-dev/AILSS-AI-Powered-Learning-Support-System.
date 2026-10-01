import { useSyncExternalStore, useState, useEffect, useCallback, useMemo } from "react";
import { Text, View, ActivityIndicator, Pressable, StyleSheet } from "react-native";
import { type Href, router, useLocalSearchParams } from "expo-router";
import { runtime } from "../../../src/runtime";
import {
  loadCourseSyllabus,
  resumeTarget,
  type LessonSummary,
  type Progress,
  type CourseDetail,
} from "../../../src/learning";
import { ApiError } from "../../../src/api";
import { quizSummaries, type QuizSummary } from "../../../src/assessment";
import {
  Page,
  Button,
  ScreenHeader,
  BottomNavBar,
  ProgressBar,
  Badge,
  Icon,
  EmptyState,
  tokens,
  styles,
} from "../../../src/ui";
import { ScalePressable } from "../../../src/motion";

export default function CourseLearningScreen() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [lessonsList, setLessonsList] = useState<LessonSummary[]>([]);
  const [courseProgress, setCourseProgress] = useState<Progress | null>(null);
  const [courseTab, setCourseTab] = useState<"lessons" | "assessments">("lessons");
  const [courseAssessments, setCourseAssessments] = useState<QuizSummary[] | null>(null);
  const [assessmentsError, setAssessmentsError] = useState<string | null>(null);
  const [assessmentsLoading, setAssessmentsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSyllabus = useCallback(async () => {
    if (!courseId || snapshot.state !== "AUTHENTICATED") return;
    try {
      setLoading(true);
      setError(null);

      const syllabus = await loadCourseSyllabus((path) => session.request(path), courseId);
      setCourse(syllabus.course);
      setLessonsList(syllabus.lessons);
      setCourseProgress(syllabus.progress);
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        if (e.status === 403) setError("Bạn chưa đăng ký hoặc không có quyền truy cập khóa học này.");
        else if (e.status === 404) setError("Không tìm thấy thông tin khóa học.");
        else setError(e.message);
      } else {
        setError("Không thể tải thông tin bài học.");
      }
    } finally {
      setLoading(false);
    }
  }, [courseId, snapshot.state, session]);

  useEffect(() => {
    void fetchSyllabus();
  }, [fetchSyllabus]);

  const fetchCourseAssessments = useCallback(async () => {
    if (!courseId || snapshot.state !== "AUTHENTICATED") return;
    setAssessmentsLoading(true);
    setAssessmentsError(null);
    try {
      const data = await session.request(`/api/v1/targets/COURSE/${encodeURIComponent(courseId)}/quizzes`);
      setCourseAssessments(quizSummaries(data).filter((quiz) => quiz.state === "PUBLISHED"));
    } catch (cause) {
      setAssessmentsError(
        cause instanceof ApiError ? cause.message : "Không thể tải bài kiểm tra của khóa học.",
      );
    } finally {
      setAssessmentsLoading(false);
    }
  }, [courseId, session, snapshot.state]);

  const sections = useMemo(() => {
    const map = new Map<string, LessonSummary[]>();
    const sorted = [...lessonsList].sort((a, b) => {
      if (a.position.sectionOrder !== b.position.sectionOrder) {
        return a.position.sectionOrder - b.position.sectionOrder;
      }
      return a.position.lessonOrder - b.position.lessonOrder;
    });
    for (const lesson of sorted) {
      const section = lesson.sectionTitle || "Bài học chung";
      if (!map.has(section)) map.set(section, []);
      map.get(section)!.push(lesson);
    }
    return Array.from(map.entries()).map(([title, items]) => ({ title, items }));
  }, [lessonsList]);

  const nextLesson = useMemo(() => {
    if (!courseProgress || !lessonsList.length) return null;
    return resumeTarget(lessonsList, courseProgress);
  }, [courseProgress, lessonsList]);

  if (snapshot.state !== "AUTHENTICATED") {
    return (
      <Page>
        <ScreenHeader title="Nội dung khóa học" onBack={() => router.push("/learn" as Href)} />
        <View style={localStyles.authCard}>
          <Icon name="lock" size={36} color={tokens.color.brand} />
          <Text style={localStyles.authTitle}>Yêu cầu đăng nhập</Text>
          <Text style={localStyles.authDesc}>
            Vui lòng đăng nhập tài khoản học viên để truy cập giáo trình và nội dung bài giảng.
          </Text>
          <Button label="Đăng nhập ngay" onPress={() => router.push("/login" as Href)} />
        </View>
        <BottomNavBar
          currentRoute="/learn"
          onNavigate={(r) => router.push(r as Href)}
          role={snapshot.user?.role}
        />
      </Page>
    );
  }

  if (loading) {
    return (
      <Page>
        <ScreenHeader title="Đang tải khóa học..." onBack={() => router.push("/learn" as Href)} />
        <View style={localStyles.center}>
          <ActivityIndicator size="large" color={tokens.color.brand} />
          <Text style={localStyles.loadingText}>Đang chuẩn bị giáo trình bài học…</Text>
        </View>
        <BottomNavBar
          currentRoute="/learn"
          onNavigate={(r) => router.push(r as Href)}
          role={snapshot.user?.role}
        />
      </Page>
    );
  }

  if (error || !course) {
    return (
      <Page>
        <ScreenHeader title="Nội dung khóa học" onBack={() => router.push("/learn" as Href)} />
        <View style={localStyles.errorCard}>
          <Icon name="alert" size={32} color={tokens.color.danger} />
          <Text accessibilityRole="alert" style={localStyles.errorText}>
            {error || "Đã xảy ra lỗi khi tải khóa học."}
          </Text>
          <View style={localStyles.errorActions}>
            <Button label="Thử lại" onPress={() => void fetchSyllabus()} />
            <Button
              label="← Quay lại khóa học của tôi"
              variant="outline"
              onPress={() => router.push("/learn" as Href)}
            />
          </View>
        </View>
        <BottomNavBar
          currentRoute="/learn"
          onNavigate={(r) => router.push(r as Href)}
          role={snapshot.user?.role}
        />
      </Page>
    );
  }

  return (
    <Page>
      <ScreenHeader title="Chi tiết giáo trình" onBack={() => router.push("/learn" as Href)} />

      {/* Course Hero Header */}
      <View style={localStyles.heroCard}>
        <View style={localStyles.heroBadgeRow}>
          <Badge label="CHƯƠNG TRÌNH ĐÀO TẠO" variant="primary" />
          {course.priceType === "FREE" && <Badge label="MIỄN PHÍ" variant="success" />}
        </View>
        <Text style={localStyles.courseTitle}>{course.title}</Text>
        <Text style={localStyles.courseMeta}>
          Tổng số bài: {lessonsList.length} bài • {sections.length} chương chuyên đề
        </Text>
      </View>

      {/* Segmented Tab: Phần Bài Giảng vs Phần Bài Tập & Quiz */}
      <View style={localStyles.tabSwitchRow}>
        <ScalePressable
          style={[localStyles.tabSwitchBtn, courseTab === "lessons" && localStyles.tabSwitchBtnActive]}
          onPress={() => setCourseTab("lessons")}
        >
          <Text
            style={[localStyles.tabSwitchText, courseTab === "lessons" && localStyles.tabSwitchTextActive]}
          >
            📖 Bài Giảng ({lessonsList.length})
          </Text>
        </ScalePressable>
        <ScalePressable
          style={[localStyles.tabSwitchBtn, courseTab === "assessments" && localStyles.tabSwitchBtnActive]}
          onPress={() => {
            setCourseTab("assessments");
            if (courseAssessments === null) void fetchCourseAssessments();
          }}
        >
          <Text
            style={[
              localStyles.tabSwitchText,
              courseTab === "assessments" && localStyles.tabSwitchTextActive,
            ]}
          >
            📝 Bài kiểm tra
          </Text>
        </ScalePressable>
      </View>

      {courseTab === "lessons" ? (
        <>
          {/* Course Progress Section */}
          {courseProgress && (
            <View style={localStyles.progressCard}>
              <View style={localStyles.progressTopRow}>
                <View style={localStyles.progressInfo}>
                  <Text style={localStyles.progressHeading}>Tiến độ học tập</Text>
                  <Text style={localStyles.progressSub}>
                    Đã hoàn thành {courseProgress.completedCount}/{courseProgress.publishedTotal} bài giảng
                  </Text>
                </View>
                <View style={localStyles.percentCircle}>
                  <Text style={localStyles.percentNumber}>{courseProgress.percent}%</Text>
                </View>
              </View>

              <ProgressBar progress={courseProgress.percent} height={8} />

              {nextLesson && (
                <View style={localStyles.resumeBox}>
                  <View style={localStyles.resumeTextCol}>
                    <Text style={localStyles.resumeLabel}>TIẾP TỤC BÀI HỌC</Text>
                    <Text style={localStyles.resumeTitle} numberOfLines={1}>
                      {nextLesson.title}
                    </Text>
                  </View>
                  <Pressable
                    style={localStyles.resumeBtn}
                    onPress={() => router.push(`/learn/${courseId}/lessons/${nextLesson.lessonId}` as Href)}
                    accessibilityRole="button"
                    accessibilityLabel={`Học tiếp bài ${nextLesson.title}`}
                  >
                    <Icon name="play" size={16} color="#FFFFFF" />
                    <Text style={localStyles.resumeBtnText}>Học tiếp</Text>
                  </Pressable>
                </View>
              )}
            </View>
          )}

          {/* Syllabus Section */}
          <View style={localStyles.syllabusSection}>
            <View style={localStyles.sectionHeaderRow}>
              <Text style={localStyles.syllabusHeading}>Danh sách bài giảng</Text>
              <Text style={localStyles.syllabusCounter}>{lessonsList.length} bài học</Text>
            </View>

            {sections.length === 0 ? (
              <EmptyState
                icon="book"
                title="Chưa có bài học nào"
                description="Khóa học này hiện chưa có bài giảng nào được xuất bản. Vui lòng quay lại sau."
              />
            ) : (
              sections.map((sec, secIdx) => (
                <View key={sec.title} style={localStyles.sectionBlock}>
                  <View style={localStyles.chapterHeader}>
                    <View style={localStyles.chapterNumberPill}>
                      <Text style={localStyles.chapterNumberText}>{secIdx + 1}</Text>
                    </View>
                    <View style={localStyles.chapterTitleCol}>
                      <Text style={localStyles.chapterTitle}>{sec.title}</Text>
                      <Text style={localStyles.chapterCount}>{sec.items.length} bài học</Text>
                    </View>
                  </View>

                  <View style={localStyles.lessonList}>
                    {sec.items.map((lesson, lessonIdx) => (
                      <Pressable
                        key={lesson.lessonId}
                        style={({ pressed }) => [
                          localStyles.lessonCard,
                          pressed && localStyles.lessonCardPressed,
                        ]}
                        onPress={() => router.push(`/learn/${courseId}/lessons/${lesson.lessonId}` as Href)}
                        accessibilityRole="button"
                        accessibilityLabel={`Bài học ${lesson.title}`}
                      >
                        <View style={localStyles.lessonIconBox}>
                          <Icon name="play" size={16} color={tokens.color.brand} />
                        </View>

                        <View style={localStyles.lessonContentCol}>
                          <Text style={localStyles.lessonTitle} numberOfLines={2}>
                            {lessonIdx + 1}. {lesson.title}
                          </Text>
                          {lesson.preview && (
                            <View style={localStyles.previewBadgeRow}>
                              <Badge label="Học thử miễn phí" variant="success" />
                            </View>
                          )}
                        </View>

                        <Icon name="chevronRight" size={16} color={tokens.color.muted} />
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))
            )}
          </View>
        </>
      ) : assessmentsLoading ? (
        <View style={localStyles.center} accessibilityRole="progressbar">
          <ActivityIndicator color={tokens.color.brand} />
          <Text style={localStyles.loadingText}>Đang tải bài kiểm tra đã phát hành…</Text>
        </View>
      ) : assessmentsError ? (
        <View style={localStyles.errorCard}>
          <Text accessibilityRole="alert" style={localStyles.errorText}>
            {assessmentsError}
          </Text>
          <Button label="Thử lại" onPress={() => void fetchCourseAssessments()} />
        </View>
      ) : courseAssessments && courseAssessments.length > 0 ? (
        <View style={{ gap: 10 }}>
          {courseAssessments.map((quiz) => (
            <ScalePressable
              key={quiz.quizId}
              style={localStyles.exerciseCard}
              onPress={() => router.push(`/assessments/${quiz.quizId}` as Href)}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Badge label="ĐÃ PHÁT HÀNH" variant="success" />
                <Text style={styles.small}>
                  {quiz.questionCount} câu
                  {quiz.durationSeconds ? ` · ${Math.round(quiz.durationSeconds / 60)} phút` : ""}
                </Text>
              </View>
              <Text style={localStyles.exerciseTitle}>{quiz.title}</Text>
              {!!quiz.opensAt && (
                <Text style={styles.small}>Mở lúc {new Date(quiz.opensAt).toLocaleString()}</Text>
              )}
              {!!quiz.closesAt && (
                <Text style={styles.small}>Đóng lúc {new Date(quiz.closesAt).toLocaleString()}</Text>
              )}
            </ScalePressable>
          ))}
        </View>
      ) : courseAssessments ? (
        <EmptyState
          icon="quiz"
          title="Chưa có bài kiểm tra"
          description="Khóa học hiện chưa có bài kiểm tra đã phát hành."
        />
      ) : (
        <View style={localStyles.center}>
          <Button label="Tải bài kiểm tra" onPress={() => void fetchCourseAssessments()} />
        </View>
      )}

      <View style={localStyles.footerActions}>
        <Button
          label="← Quay lại khóa học của tôi"
          variant="outline"
          onPress={() => router.push("/learn" as Href)}
        />
      </View>

      <BottomNavBar
        currentRoute="/learn"
        onNavigate={(r) => router.push(r as Href)}
        role={snapshot.user?.role}
      />
    </Page>
  );
}

const localStyles = StyleSheet.create({
  center: {
    padding: tokens.space.xl,
    alignItems: "center",
    justifyContent: "center",
    gap: tokens.space.medium,
  },
  loadingText: {
    fontSize: 14,
    color: tokens.color.muted,
  },
  authCard: {
    backgroundColor: tokens.color.surface,
    padding: tokens.space.xl,
    borderRadius: tokens.radius.lg,
    alignItems: "center",
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginVertical: tokens.space.large,
    gap: tokens.space.medium,
    ...tokens.shadow.card,
  },
  authTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  authDesc: {
    fontSize: 14,
    color: tokens.color.muted,
    textAlign: "center",
    lineHeight: 22,
  },
  errorCard: {
    backgroundColor: "#FEF2F2",
    padding: tokens.space.large,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: "#FECACA",
    marginVertical: tokens.space.large,
    alignItems: "center",
    gap: tokens.space.medium,
  },
  errorText: {
    color: tokens.color.danger,
    fontSize: 14,
    textAlign: "center",
  },
  errorActions: {
    width: "100%",
    gap: tokens.space.small,
  },
  heroCard: {
    backgroundColor: tokens.color.surface,
    padding: tokens.space.large,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginBottom: tokens.space.medium,
    ...tokens.shadow.card,
  },
  heroBadgeRow: {
    flexDirection: "row",
    gap: tokens.space.small,
    marginBottom: tokens.space.small,
  },
  courseTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: tokens.color.ink,
    lineHeight: 28,
  },
  courseMeta: {
    fontSize: 13,
    color: tokens.color.muted,
    marginTop: 6,
  },
  progressCard: {
    backgroundColor: tokens.color.surface,
    padding: tokens.space.large,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginBottom: tokens.space.medium,
    gap: tokens.space.medium,
    ...tokens.shadow.card,
  },
  progressTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressInfo: {
    flex: 1,
  },
  progressHeading: {
    fontSize: 16,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  progressSub: {
    fontSize: 13,
    color: tokens.color.muted,
    marginTop: 2,
  },
  percentCircle: {
    backgroundColor: "#F0FDFA",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: tokens.radius.full,
    borderWidth: 1,
    borderColor: "#CCFBF1",
  },
  percentNumber: {
    fontSize: 16,
    fontWeight: "800",
    color: tokens.color.brand,
  },
  resumeBox: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: tokens.color.canvas,
    padding: tokens.space.medium,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  resumeTextCol: {
    flex: 1,
    marginRight: tokens.space.small,
  },
  resumeLabel: {
    fontSize: 10,
    fontWeight: "800",
    color: tokens.color.brand,
    letterSpacing: 0.5,
  },
  resumeTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.color.ink,
    marginTop: 2,
  },
  resumeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: tokens.color.brand,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: tokens.radius.md,
  },
  resumeBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  syllabusSection: {
    gap: tokens.space.medium,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: tokens.space.small,
  },
  syllabusHeading: {
    fontSize: 18,
    fontWeight: "800",
    color: tokens.color.ink,
  },
  syllabusCounter: {
    fontSize: 13,
    color: tokens.color.muted,
    fontWeight: "600",
  },
  sectionBlock: {
    gap: tokens.space.small,
  },
  chapterHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: tokens.space.small,
    marginTop: tokens.space.small,
  },
  chapterNumberPill: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: tokens.color.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  chapterNumberText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },
  chapterTitleCol: {
    flex: 1,
  },
  chapterTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  chapterCount: {
    fontSize: 12,
    color: tokens.color.muted,
  },
  lessonList: {
    gap: 8,
  },
  lessonCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: tokens.color.surface,
    padding: tokens.space.medium,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.color.border,
    gap: tokens.space.medium,
    ...tokens.shadow.subtle,
  },
  lessonCardPressed: {
    backgroundColor: tokens.color.canvas,
  },
  lessonIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F0FDFA",
    alignItems: "center",
    justifyContent: "center",
  },
  lessonContentCol: {
    flex: 1,
    gap: 4,
  },
  lessonTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.color.ink,
    lineHeight: 20,
  },
  previewBadgeRow: {
    flexDirection: "row",
  },
  footerActions: {
    marginTop: tokens.space.large,
    marginBottom: tokens.space.medium,
  },
  tabSwitchRow: {
    flexDirection: "row",
    backgroundColor: "#F1F5F9",
    borderRadius: 12,
    padding: 3,
    marginBottom: 16,
  },
  tabSwitchBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: "center",
  },
  tabSwitchBtnActive: {
    backgroundColor: "#FFFFFF",
    elevation: 2,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  tabSwitchText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748B",
  },
  tabSwitchTextActive: {
    color: "#0284C7",
    fontWeight: "800",
  },
  exerciseSection: {
    marginBottom: 20,
  },
  exerciseCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    gap: 6,
  },
  exerciseTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0F172A",
    marginTop: 4,
    lineHeight: 20,
  },
});
