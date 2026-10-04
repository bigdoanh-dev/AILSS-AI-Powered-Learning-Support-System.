import { useLanguage, useUiText } from "../../../../src/use-language";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { type Href, router, useLocalSearchParams } from "expo-router";
import {
  assessmentResult as decodeAssessmentResult,
  quizDetail as decodeQuizDetail,
  type AssessmentResult,
  type QuizDetail,
} from "../../../../src/assessment";
import { formatDate, formatTime, parseTimestamp } from "../../../../src/classroom";
import { ApiError } from "../../../../src/api";
import { runtime } from "../../../../src/runtime";
import {
  Button,
  Page,
  ScreenHeader,
  BottomNavBar,
  Badge,
  ProgressBar,
  Icon,
  tokens,
} from "../../../../src/ui";

export default function QuizResultScreen() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const { quizId, resultId } = useLocalSearchParams<{ quizId: string; resultId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [result, setResult] = useState<AssessmentResult | null>(null);
  const [quiz, setQuiz] = useState<QuizDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadResult = useCallback(async () => {
    if (!quizId || !resultId || snapshot.state !== "AUTHENTICATED") return;
    try {
      setError(null);
      const [resRes, quizRes] = await Promise.all([
        session.request(`/api/v1/attempts/${encodeURIComponent(resultId)}/result`),
        session.request(`/api/v1/quizzes/${encodeURIComponent(quizId)}`),
      ]);

      setResult(decodeAssessmentResult(resRes));
      setQuiz(decodeQuizDetail(quizRes));
    } catch (cause: unknown) {
      setResult(null);
      setQuiz(null);
      setError(cause instanceof ApiError ? cause.message : "Không thể xác minh kết quả bài thi.");
    } finally {
      setLoading(false);
    }
  }, [quizId, resultId, session, snapshot.state]);

  useEffect(() => {
    void loadResult();
  }, [loadResult]);

  if (snapshot.state !== "AUTHENTICATED") {
    return (
      <Page>
        <ScreenHeader title={uiText("Kết quả bài thi")} onBack={() => router.push("/assessments" as Href)} />
        <View style={screenStyles.authCard}>
          <Icon name="lock" size={36} color={tokens.color.brand} />
          <Text style={screenStyles.cardTitle}>{uiText("Yêu cầu đăng nhập")}</Text>
          <Text style={screenStyles.authText}>{uiText("Vui lòng đăng nhập để xem kết quả.")}</Text>
          <Button label={uiText("Đăng nhập")} onPress={() => router.push("/login" as Href)} />
        </View>
        <BottomNavBar
          currentRoute="/assessments"
          onNavigate={(r) => router.push(r as Href)}
          role={snapshot.user?.role}
        />
      </Page>
    );
  }

  if (loading) {
    return (
      <Page>
        <ScreenHeader title={uiText("Đang tải...")} onBack={() => router.push("/assessments" as Href)} />
        <View style={screenStyles.center}>
          <ActivityIndicator size="large" color={tokens.color.brand} />
          <Text style={screenStyles.loadingText}>{uiText("Đang tải kết quả chấm điểm...")}</Text>
        </View>
        <BottomNavBar
          currentRoute="/assessments"
          onNavigate={(r) => router.push(r as Href)}
          role={snapshot.user?.role}
        />
      </Page>
    );
  }

  if (error && !result) {
    return (
      <Page>
        <ScreenHeader title={uiText("Thông báo")} onBack={() => router.push("/assessments" as Href)} />
        <View style={screenStyles.errorBox}>
          <Icon name="alert" size={28} color={tokens.color.danger} />
          <Text accessibilityRole="alert" style={screenStyles.errorText}>
            {uiText(error)}
          </Text>
          <View style={screenStyles.actionCol}>
            <Button
              label={uiText("Quay lại danh sách")}
              onPress={() => router.push("/assessments" as Href)}
            />
          </View>
        </View>
        <BottomNavBar
          currentRoute="/assessments"
          onNavigate={(r) => router.push(r as Href)}
          role={snapshot.user?.role}
        />
      </Page>
    );
  }

  if (!result) return null;

  const isPendingManual = result.gradingStatus === "PENDING_MANUAL_GRADING";
  const isManuallyGraded = result.gradingStatus === "MANUALLY_GRADED";
  const finalScore = result.manualScore ?? result.score;
  const finalMaxScore = result.maxScore;

  const scoreNum = Number(finalScore);
  const maxScoreNum = Number(finalMaxScore);
  const percent = maxScoreNum > 0 ? Math.round((scoreNum / maxScoreNum) * 100) : 0;
  const isPassed = percent >= 50;
  const submittedDate = parseTimestamp(result.submittedAt);

  return (
    <Page testID="student-assessment-result">
      <ScreenHeader
        title={uiText("Kết quả thi")}
        subtitle={quiz ? quiz.title : undefined}
        onBack={() => router.push("/assessments" as Href)}
      />

      {/* Celebratory Hero Score Card */}
      <View testID="student-assessment-result-score" style={screenStyles.scoreCard}>
        <View style={screenStyles.trophyCircle}>
          <Icon
            name={isPendingManual ? "clock" : isPassed ? "award" : "sparkles"}
            size={36}
            color={isPendingManual ? tokens.color.warning : tokens.color.brand}
          />
        </View>

        {isPendingManual ? (
          <Badge label={uiText("⏳ ĐÃ NỘP BÀI · CHỜ GIẢNG VIÊN CHẤM")} variant="warning" />
        ) : isManuallyGraded ? (
          <Badge label={uiText("✍️ ĐÃ CHẤM THỦ CÔNG BỞI GIẢNG VIÊN")} variant="ai" />
        ) : (
          <Badge label={uiText("⚡ ĐÃ CHẤM TỰ ĐỘNG THÀNH CÔNG")} variant="success" />
        )}

        {isPendingManual ? (
          <View style={{ alignItems: "center", paddingVertical: 12, gap: 6 }}>
            <Text style={[screenStyles.scoreLabel, { color: "#B45309" }]}>
              {uiText("ĐANG ĐỢI CHẤM THỦ CÔNG")}
            </Text>
            <Text
              style={{
                fontSize: 14,
                color: "#475569",
                textAlign: "center",
                paddingHorizontal: 12,
                lineHeight: 20,
              }}
            >
              {uiText(
                "Bài thi Tự luận / Đồ án đã được nộp thành công. Giảng viên sẽ trực tiếp đánh giá và phản hồi điểm số kèm nhận xét chi tiết.",
              )}
            </Text>
          </View>
        ) : (
          <>
            <Text style={screenStyles.scoreLabel}>
              {isManuallyGraded
                ? uiText("ĐIỂM SỐ DO GIẢNG VIÊN ĐÁNH GIÁ")
                : uiText("ĐIỂM SỐ CHÍNH THỨC (TỰ ĐỘNG)")}
            </Text>
            <View style={screenStyles.scoreNumberRow}>
              <Text testID="student-assessment-result-value" style={screenStyles.scoreNumber}>
                {finalScore}
              </Text>
              <Text style={screenStyles.maxScoreNumber}> / {finalMaxScore}</Text>
            </View>

            <View style={screenStyles.percentBadge}>
              <Text style={screenStyles.percentText}>
                {percent}
                {uiText("% Điểm tối đa")}
              </Text>
            </View>

            <View style={screenStyles.progressBarBox}>
              <ProgressBar
                progress={percent}
                height={8}
                color={isPassed ? tokens.color.success : tokens.color.brand}
              />
            </View>
          </>
        )}

        {isManuallyGraded && result.teacherFeedback && (
          <View
            style={{
              marginTop: 12,
              padding: 12,
              backgroundColor: "#F0FDF4",
              borderRadius: 10,
              borderWidth: 1,
              borderColor: "#BBF7D0",
              width: "100%",
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: "700", color: "#166534", marginBottom: 3 }}>
              {uiText("💬 Lời phê & Nhận xét của Giảng viên:")}
            </Text>
            <Text style={{ fontSize: 13, color: "#15803D", fontStyle: "italic", lineHeight: 18 }}>
              "{result.teacherFeedback}"
            </Text>
          </View>
        )}

        {quiz && (
          <Text style={screenStyles.quizTitleSub} numberOfLines={2}>
            {quiz.title}
          </Text>
        )}
      </View>

      {/* Detail info Card */}
      <View style={screenStyles.detailCard}>
        <Text style={screenStyles.detailCardHeading}>{uiText("Thông tin bài làm")}</Text>

        <View style={screenStyles.row}>
          <Text style={screenStyles.label}>{uiText("Thời gian nộp:")}</Text>
          <Text style={screenStyles.value}>
            {formatDate(submittedDate, undefined, uiLocale)} {formatTime(submittedDate, undefined, uiLocale)}
          </Text>
        </View>

        <View style={screenStyles.row}>
          <Text style={screenStyles.label}>{uiText("Phiên bản đề thi:")}</Text>
          <Text style={screenStyles.value}>v{result.quizVersion}</Text>
        </View>

        <View style={[screenStyles.row, { borderBottomWidth: 0 }]}>
          <Text style={screenStyles.label}>{uiText("Thuật toán chấm:")}</Text>
          <Text style={screenStyles.value}>{result.gradingAlgorithmVersion}</Text>
        </View>
      </View>

      {/* Server authority notice */}
      <View style={screenStyles.noticeBox}>
        <View style={screenStyles.noticeHeader}>
          <Icon name="shield" size={16} color={tokens.color.brand} />
          <Text style={screenStyles.noticeTitle}>{uiText("Bảo chứng hệ thống AILSS")}</Text>
        </View>
        <Text style={screenStyles.noticeText}>
          {uiText(
            "Kết quả chấm điểm trên là số liệu chính thức được máy chủ AILSS tính toán và ghi nhận an toàn vào hệ thống. Điểm số này không thể chỉnh sửa từ ứng dụng di động.",
          )}
        </Text>
      </View>

      <View style={screenStyles.actionRow}>
        <Button
          label={uiText("Quay lại danh sách bài kiểm tra")}
          onPress={() => router.push("/assessments" as Href)}
          size="lg"
        />
        <Button label={uiText("Về trang chủ")} variant="outline" onPress={() => router.push("/" as Href)} />
      </View>

      <BottomNavBar
        currentRoute="/assessments"
        onNavigate={(r) => router.push(r as Href)}
        role={snapshot.user?.role}
      />
    </Page>
  );
}

const screenStyles = StyleSheet.create({
  center: {
    paddingVertical: 60,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: 12,
    color: tokens.color.muted,
    fontSize: 14,
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
  cardTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  authText: {
    fontSize: 14,
    color: tokens.color.muted,
    textAlign: "center",
  },
  scoreCard: {
    backgroundColor: tokens.color.surface,
    padding: tokens.space.xl,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.color.border,
    alignItems: "center",
    marginBottom: tokens.space.medium,
    ...tokens.shadow.card,
  },
  trophyCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: "#F0FDFA",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: tokens.space.medium,
    borderWidth: 1,
    borderColor: "#CCFBF1",
    ...tokens.shadow.subtle,
  },
  scoreLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: tokens.color.muted,
    letterSpacing: 1.2,
    marginTop: 14,
    marginBottom: 6,
  },
  scoreNumberRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
  },
  scoreNumber: {
    fontSize: 48,
    fontWeight: "800",
    color: tokens.color.brand,
    lineHeight: 52,
  },
  maxScoreNumber: {
    fontSize: 22,
    fontWeight: "700",
    color: tokens.color.muted,
  },
  percentBadge: {
    marginTop: 10,
    backgroundColor: "#F0FDFA",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: tokens.radius.full,
    borderWidth: 1,
    borderColor: "#CCFBF1",
  },
  percentText: {
    fontSize: 13,
    fontWeight: "700",
    color: tokens.color.brandDark,
  },
  progressBarBox: {
    width: "100%",
    marginTop: 14,
    paddingHorizontal: tokens.space.small,
  },
  quizTitleSub: {
    fontSize: 13,
    color: tokens.color.muted,
    marginTop: 12,
    textAlign: "center",
    fontWeight: "500",
  },
  detailCard: {
    backgroundColor: tokens.color.surface,
    padding: tokens.space.large,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginBottom: tokens.space.medium,
    ...tokens.shadow.subtle,
  },
  detailCardHeading: {
    fontSize: 15,
    fontWeight: "700",
    color: tokens.color.ink,
    marginBottom: tokens.space.small,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: tokens.color.border,
  },
  label: {
    fontSize: 14,
    color: tokens.color.muted,
  },
  value: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.color.ink,
  },
  noticeBox: {
    backgroundColor: tokens.color.surface,
    padding: tokens.space.medium,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginBottom: tokens.space.large,
    gap: 6,
    ...tokens.shadow.subtle,
  },
  noticeHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  noticeTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  noticeText: {
    fontSize: 12,
    color: tokens.color.muted,
    lineHeight: 18,
  },
  errorBox: {
    marginVertical: tokens.space.large,
    padding: tokens.space.large,
    backgroundColor: "#FEF2F2",
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: "#FECACA",
    alignItems: "center",
    gap: tokens.space.medium,
  },
  errorText: {
    color: tokens.color.danger,
    fontSize: 14,
    textAlign: "center",
  },
  actionCol: {
    width: "100%",
  },
  actionRow: {
    gap: 12,
    marginBottom: tokens.space.xl,
  },
});
