import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { type Href, router } from "expo-router";
import { quizSummaries, type QuizSummary } from "../../src/assessment";
import { courses as decodeCourses } from "../../src/learning";
import { studentClasses as decodeStudentClasses } from "../../src/classroom";
import { runtime } from "../../src/runtime";
import { Button, Badge, Icon, EmptyState, BottomNavBar, Page, styles, tokens } from "../../src/ui";

interface QuizWithTarget extends QuizSummary {
  targetName?: string;
}

export default function AssessmentListScreen() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [quizzes, setQuizzes] = useState<QuizWithTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAssessments = useCallback(async () => {
    if (snapshot.state !== "AUTHENTICATED") return;
    try {
      setLoading(true);
      setError(null);

      const [coursesRes, classesRes] = await Promise.all([
        session.request("/api/v1/me/courses"),
        session.request("/api/v1/me/classes"),
      ]);

      const courseList = decodeCourses(coursesRes);
      const classList = decodeStudentClasses(classesRes);

      const targetMap = new Map<string, string>();
      for (const c of courseList) targetMap.set(c.courseId, c.title);
      for (const cl of classList) targetMap.set(cl.classId, cl.name);

      const quizPromises: Promise<{ targetId: string; data: unknown }>[] = [];
      for (const c of courseList) {
        quizPromises.push(
          session
            .request(`/api/v1/targets/COURSE/${c.courseId}/quizzes`)
            .then((data: unknown) => ({ targetId: c.courseId, data })),
        );
      }
      for (const cl of classList) {
        quizPromises.push(
          session
            .request(`/api/v1/targets/CLASS/${cl.classId}/quizzes`)
            .then((data: unknown) => ({ targetId: cl.classId, data })),
        );
      }

      const results = await Promise.all(quizPromises);
      const allQuizzes: QuizWithTarget[] = [];
      const seenIds = new Set<string>();

      for (const res of results) {
        const parsed = quizSummaries(res.data);
        for (const q of parsed) {
          if (!seenIds.has(q.quizId) && q.state === "PUBLISHED") {
            seenIds.add(q.quizId);
            allQuizzes.push({
              ...q,
              targetName: targetMap.get(q.targetId) || undefined,
            });
          }
        }
      }

      setQuizzes(allQuizzes);
    } catch {
      setError("Không thể tải danh sách bài kiểm tra. Vui lòng thử lại sau.");
    } finally {
      setLoading(false);
    }
  }, [session, snapshot.state]);

  useEffect(() => {
    void loadAssessments();
  }, [loadAssessments]);

  if (snapshot.state !== "AUTHENTICATED") {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
        <Page>
          <View style={[styles.card, { alignItems: "center", paddingVertical: 40, gap: 14 }]}>
            <Icon name="sparkles" size={40} color={tokens.color.brand} />
            <Text style={styles.title}>Bài kiểm tra</Text>
            <Text style={[styles.text, { textAlign: "center", maxWidth: 300 }]}>
              Vui lòng đăng nhập để xem danh sách bài kiểm tra và bài luyện tập.
            </Text>
            <Button label="Đăng nhập ngay" size="lg" onPress={() => router.push("/login" as Href)} />
          </View>
        </Page>
        <BottomNavBar currentRoute="classes" onNavigate={(path) => router.push(path as Href)} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <Page testID="student-assessment-list" style={{ paddingBottom: 24 }}>
        <View style={{ gap: 4 }}>
          <Badge label="ĐÁNH GIÁ NĂNG LỰC" variant="ai" icon="sparkles" />
          <Text style={styles.title}>Bài kiểm tra</Text>
          <Text style={styles.text}>Luyện tập thích ứng AI và hoàn thành các bài thi đánh giá khóa học.</Text>
        </View>

        {loading && (
          <View style={screenStyles.center}>
            <ActivityIndicator size="large" color={tokens.color.brand} />
            <Text style={screenStyles.loadingText}>Đang tải bài kiểm tra...</Text>
          </View>
        )}

        {error && (
          <View style={[styles.card, { borderColor: tokens.color.dangerLight, backgroundColor: "#FEF2F2" }]}>
            <Text style={styles.error}>{error}</Text>
            <Button label="Thử lại" size="sm" onPress={() => void loadAssessments()} />
          </View>
        )}

        {!loading &&
          !error &&
          quizzes.some((quiz) => {
            const now = Date.now();
            return (
              (quiz.opensAt && Date.parse(quiz.opensAt) > now) ||
              (quiz.closesAt && Date.parse(quiz.closesAt) <= now)
            );
          }) && (
            <View style={[styles.card, { gap: 6 }]}>
              <Text style={styles.title}>Thời gian mở bài</Text>
              <Text style={styles.small}>
                Một số bài đã phát hành nhưng chưa mở hoặc đã đóng; thời gian chính thức được máy chủ xác minh
                khi bắt đầu làm bài.
              </Text>
            </View>
          )}

        {!loading && !error && quizzes.length === 0 && (
          <EmptyState
            icon="sparkles"
            title="Chưa có bài kiểm tra"
            description="Hiện tại chưa có bài kiểm tra nào được phát hành cho các khóa học hoặc lớp của bạn."
            actionLabel="Khám phá khóa học"
            onAction={() => router.push("/courses" as Href)}
          />
        )}

        {!loading && !error && quizzes.length > 0 && (
          <View style={screenStyles.listContent}>
            {quizzes.map((item) => (
              <Pressable
                key={item.quizId}
                testID={`student-assessment-${item.quizId}`}
                accessibilityRole="button"
                accessibilityLabel={`Bài kiểm tra: ${item.title}`}
                style={screenStyles.quizCard}
                onPress={() => router.push(`/assessments/${item.quizId}` as Href)}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Badge label={item.targetType === "COURSE" ? "KHÓA HỌC" : "LỚP HỌC"} variant="primary" />
                  <Badge label="ĐÃ XUẤT BẢN" variant="success" icon="check" />
                </View>

                <Text style={screenStyles.cardTitle}>{item.title}</Text>
                {!!item.opensAt && (
                  <Text style={screenStyles.targetNameText}>
                    Mở lúc: {new Date(item.opensAt).toLocaleString()}
                  </Text>
                )}
                {!!item.closesAt && (
                  <Text style={screenStyles.targetNameText}>
                    Đóng lúc: {new Date(item.closesAt).toLocaleString()}
                  </Text>
                )}
                {item.targetName && (
                  <Text style={screenStyles.targetNameText} numberOfLines={1}>
                    {item.targetName}
                  </Text>
                )}

                <View style={screenStyles.infoRow}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Icon name="academic" size={13} color={tokens.color.muted} />
                    <Text style={screenStyles.infoItem}>{item.questionCount} câu hỏi</Text>
                  </View>
                  {item.durationSeconds !== undefined && (
                    <>
                      <Text style={screenStyles.infoDot}>•</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Icon name="clock" size={13} color={tokens.color.muted} />
                        <Text style={screenStyles.infoItem}>
                          {Math.round(item.durationSeconds / 60)} phút
                        </Text>
                      </View>
                    </>
                  )}
                  {item.attemptLimit !== undefined && (
                    <>
                      <Text style={screenStyles.infoDot}>•</Text>
                      <Text style={screenStyles.infoItem}>Tối đa {item.attemptLimit} lượt</Text>
                    </>
                  )}
                </View>

                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "flex-end",
                    alignItems: "center",
                    gap: 4,
                    marginTop: 4,
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: "700", color: tokens.color.brand }}>
                    Chi tiết & Làm bài
                  </Text>
                  <Icon name="chevronRight" size={14} color={tokens.color.brand} />
                </View>
              </Pressable>
            ))}
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

const screenStyles = StyleSheet.create({
  center: {
    paddingVertical: 32,
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    color: tokens.color.muted,
    fontSize: 14,
  },
  errorBox: {
    marginVertical: 16,
    padding: 16,
    backgroundColor: "#fef2f2",
    borderRadius: 8,
  },
  listContent: {
    paddingBottom: 24,
    gap: 12,
  },
  quizCard: {
    backgroundColor: tokens.color.surface,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  targetBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: tokens.color.brand,
    backgroundColor: "#ccfbf1",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    overflow: "hidden",
  },
  publishedBadge: {
    fontSize: 11,
    fontWeight: "600",
    color: "#059669",
    backgroundColor: "#ecfdf5",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    overflow: "hidden",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: tokens.color.ink,
    marginBottom: 4,
  },
  targetNameText: {
    fontSize: 13,
    color: tokens.color.muted,
    marginBottom: 10,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  infoItem: {
    fontSize: 13,
    color: tokens.color.muted,
  },
  infoDot: {
    marginHorizontal: 6,
    color: tokens.color.border,
    fontSize: 13,
  },
  actionText: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.color.brand,
  },
  emptyBox: {
    paddingVertical: 48,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: tokens.color.ink,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: tokens.color.muted,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 24,
  },
  footer: {
    marginTop: 16,
  },
});
