import { useUiText } from "../../src/use-language";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { type Href, router } from "expo-router";
import { loadAssignedQuizzes, type AssignedQuiz } from "../../src/assigned-quizzes";
import { runtime } from "../../src/runtime";
import { Button, Badge, Icon, EmptyState, BottomNavBar, Page, styles, tokens } from "../../src/ui";

export default function AssessmentListScreen() {
  const uiText = useUiText();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [quizzes, setQuizzes] = useState<AssignedQuiz[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [revision, setRevision] = useState(0);
  const [loadedUserId, setLoadedUserId] = useState<string | undefined>();
  useEffect(() => {
    const abort = new AbortController();
    setQuizzes([]);
    setLoadedUserId(undefined);
    setError(null);
    setLoading(true);
    if (snapshot.state === "AUTHENTICATED") {
      void loadAssignedQuizzes((path, options) => session.request(path, options), abort.signal)
        .then((assigned) => {
          if (!abort.signal.aborted) {
            setQuizzes(assigned);
            setLoadedUserId(snapshot.user?.userId);
          }
        })
        .catch(() => {
          if (!abort.signal.aborted) setError("Không thể tải danh sách bài kiểm tra. Vui lòng thử lại sau.");
        })
        .finally(() => {
          if (!abort.signal.aborted) setLoading(false);
        });
    }
    return () => abort.abort();
  }, [session, snapshot.state, snapshot.user?.userId, revision]);
  const visibleQuizzes = loadedUserId === snapshot.user?.userId ? quizzes : [];

  if (snapshot.state !== "AUTHENTICATED") {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
        <Page>
          <View style={[styles.card, { alignItems: "center", paddingVertical: 40, gap: 14 }]}>
            <Icon name="sparkles" size={40} color={tokens.color.brand} />
            <Text style={styles.title}>{uiText("Bài kiểm tra")}</Text>
            <Text style={[styles.text, { textAlign: "center", maxWidth: 300 }]}>
              {uiText("Vui lòng đăng nhập để xem danh sách bài kiểm tra và bài luyện tập.")}
            </Text>
            <Button
              label={uiText("Đăng nhập ngay")}
              size="lg"
              onPress={() => router.push("/login" as Href)}
            />
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
          <Badge label={uiText("ĐÁNH GIÁ NĂNG LỰC")} variant="ai" icon="sparkles" />
          <Text style={styles.title}>{uiText("Bài kiểm tra")}</Text>
          <Text style={styles.text}>
            {uiText("Luyện tập thích ứng AI và hoàn thành các bài thi đánh giá khóa học.")}
          </Text>
        </View>

        {loading && (
          <View style={screenStyles.center}>
            <ActivityIndicator size="large" color={tokens.color.brand} />
            <Text style={screenStyles.loadingText}>{uiText("Đang tải bài kiểm tra...")}</Text>
          </View>
        )}

        {error && (
          <View style={[styles.card, { borderColor: tokens.color.dangerLight, backgroundColor: "#FEF2F2" }]}>
            <Text style={styles.error}>{uiText(error)}</Text>
            <Button label={uiText("Thử lại")} size="sm" onPress={() => setRevision((value) => value + 1)} />
          </View>
        )}

        {!loading &&
          !error &&
          visibleQuizzes.some((quiz) => {
            const now = Date.now();
            return (
              (quiz.opensAt && Date.parse(quiz.opensAt) > now) ||
              (quiz.closesAt && Date.parse(quiz.closesAt) <= now)
            );
          }) && (
            <View style={[styles.card, { gap: 6 }]}>
              <Text style={styles.title}>{uiText("Thời gian mở bài")}</Text>
              <Text style={styles.small}>
                {uiText(
                  "Một số bài đã phát hành nhưng chưa mở hoặc đã đóng; thời gian chính thức được máy chủ xác minh khi bắt đầu làm bài.",
                )}
              </Text>
            </View>
          )}

        {!loading && !error && visibleQuizzes.length === 0 && (
          <EmptyState
            icon="sparkles"
            title={uiText("Chưa có bài kiểm tra")}
            description={uiText(
              "Hiện tại chưa có bài kiểm tra nào được phát hành cho các khóa học hoặc lớp của bạn.",
            )}
            actionLabel="Khám phá khóa học"
            onAction={() => router.push("/courses" as Href)}
          />
        )}

        {!loading && !error && visibleQuizzes.length > 0 && (
          <View style={screenStyles.listContent}>
            {visibleQuizzes.map((item) => (
              <Pressable
                key={item.quizId}
                testID={`student-assessment-${item.quizId}`}
                accessibilityRole="button"
                accessibilityLabel={uiText("Bài kiểm tra: {0}", [item.title])}
                style={screenStyles.quizCard}
                onPress={() => router.push(`/assessments/${item.quizId}` as Href)}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Badge
                    label={item.targetType === "COURSE" ? uiText("KHÓA HỌC") : uiText("LỚP HỌC")}
                    variant="primary"
                  />
                  <Badge label={uiText("ĐÃ XUẤT BẢN")} variant="success" icon="check" />
                </View>

                <Text style={screenStyles.cardTitle}>{item.title}</Text>
                {!!item.opensAt && (
                  <Text style={screenStyles.targetNameText}>
                    {uiText("Mở lúc: ")}
                    {new Date(item.opensAt).toLocaleString()}
                  </Text>
                )}
                {!!item.closesAt && (
                  <Text style={screenStyles.targetNameText}>
                    {uiText("Đóng lúc: ")}
                    {new Date(item.closesAt).toLocaleString()}
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
                    <Text style={screenStyles.infoItem}>
                      {item.questionCount} {uiText(" câu hỏi")}
                    </Text>
                  </View>
                  {item.durationSeconds !== undefined && (
                    <>
                      <Text style={screenStyles.infoDot}>•</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Icon name="clock" size={13} color={tokens.color.muted} />
                        <Text style={screenStyles.infoItem}>
                          {Math.round(item.durationSeconds / 60)} {uiText(" phút")}
                        </Text>
                      </View>
                    </>
                  )}
                  {item.attemptLimit !== undefined && (
                    <>
                      <Text style={screenStyles.infoDot}>•</Text>
                      <Text style={screenStyles.infoItem}>
                        {uiText("Tối đa ")}
                        {item.attemptLimit} {uiText(" lượt")}
                      </Text>
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
                    {uiText("Chi tiết & Làm bài")}
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
