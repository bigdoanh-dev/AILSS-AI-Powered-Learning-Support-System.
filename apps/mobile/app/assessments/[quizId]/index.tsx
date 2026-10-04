import { useUiText } from "../../../src/use-language";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { type Href, router, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import {
  attemptWithQuestions as decodeAttemptWithQuestions,
  quizDetail as decodeQuizDetail,
  type QuizDetail,
} from "../../../src/assessment";
import { ApiError } from "../../../src/api";
import { runtime } from "../../../src/runtime";
import { Button, Page, ScreenHeader, BottomNavBar, Badge, Icon, StatCard, tokens } from "../../../src/ui";

export default function QuizDetailScreen() {
  const uiText = useUiText();
  const { quizId } = useLocalSearchParams<{ quizId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [quiz, setQuiz] = useState<QuizDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startOperationId = useRef<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (!quizId || snapshot.state !== "AUTHENTICATED") return;
    try {
      setLoading(true);
      setQuiz(null);
      setError(null);
      const res = await session.request(`/api/v1/quizzes/${encodeURIComponent(quizId)}`);
      setQuiz(decodeQuizDetail(res));
    } catch (err) {
      if (err instanceof ApiError && err.kind === "forbidden") {
        setError("Bạn chưa đủ điều kiện tham gia bài kiểm tra này.");
        return;
      }
      setError(err instanceof ApiError ? err.message : "Không thể xác minh bài kiểm tra từ máy chủ.");
    } finally {
      setLoading(false);
    }
  }, [quizId, session, snapshot.state]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const handleStartAttempt = async () => {
    if (!quizId || starting) return;
    setStarting(true);
    setError(null);

    try {
      startOperationId.current ??= Crypto.randomUUID();
      const res = await session.request(`/api/v1/quizzes/${encodeURIComponent(quizId)}/attempts`, {
        method: "POST",
        idempotencyKey: startOperationId.current,
      });

      const parsed = decodeAttemptWithQuestions(res);
      startOperationId.current = null;
      router.push(`/assessments/${quizId}/attempt/${parsed.attempt.attemptId}` as Href);
    } catch (err: unknown) {
      setError(err instanceof ApiError ? err.message : "Máy chủ chưa tạo lượt làm bài; vui lòng thử lại.");
    } finally {
      setStarting(false);
    }
  };

  if (snapshot.state !== "AUTHENTICATED") {
    return (
      <Page>
        <ScreenHeader
          title={uiText("Chi tiết bài kiểm tra")}
          onBack={() => router.push("/assessments" as Href)}
        />
        <View style={screenStyles.authCard}>
          <Icon name="lock" size={36} color={tokens.color.brand} />
          <Text style={screenStyles.cardTitle}>{uiText("Yêu cầu đăng nhập")}</Text>
          <Text style={screenStyles.authText}>
            {uiText("Vui lòng đăng nhập để xem thông tin và tham gia làm bài kiểm tra.")}
          </Text>
          <Button label={uiText("Đăng nhập ngay")} onPress={() => router.push("/login" as Href)} />
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
          <Text style={screenStyles.loadingText}>{uiText("Đang chuẩn bị đề thi…")}</Text>
        </View>
        <BottomNavBar
          currentRoute="/assessments"
          onNavigate={(r) => router.push(r as Href)}
          role={snapshot.user?.role}
        />
      </Page>
    );
  }

  if (error && !quiz) {
    return (
      <Page>
        <ScreenHeader title={uiText("Thông báo")} onBack={() => router.push("/assessments" as Href)} />
        <View style={screenStyles.errorBox}>
          <Icon name="alert" size={28} color={tokens.color.danger} />
          <Text accessibilityRole="alert" style={screenStyles.errorText}>
            {uiText(error)}
          </Text>
          <View style={screenStyles.actionCol}>
            <Button label={uiText("Thử lại")} onPress={() => void loadDetail()} />
            <Button
              label={uiText("Quay lại danh sách bài kiểm tra")}
              variant="outline"
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

  if (!quiz) return null;

  return (
    <Page testID="student-assessment-detail">
      <ScreenHeader
        title={uiText("Bài kiểm tra")}
        subtitle={quiz.targetType === "COURSE" ? uiText("Theo khóa học") : uiText("Theo lớp học")}
        onBack={() => router.push("/assessments" as Href)}
      />

      {/* Hero Exam Header Card */}
      <View style={screenStyles.heroCard}>
        <View style={screenStyles.badgeRow}>
          <Badge
            label={quiz.targetType === "COURSE" ? uiText("KHÓA HỌC") : uiText("LỚP HỌC")}
            variant="primary"
          />
          <Badge label={uiText("ĐÃ XUẤT BẢN")} variant="success" />
        </View>

        <Text style={screenStyles.examTitle}>{quiz.title}</Text>

        <View style={screenStyles.examTypeRow}>
          <Icon name="academic" size={16} color={tokens.color.brand} />
          <Text style={screenStyles.examTypeText}>
            {uiText("Xem hướng dẫn và câu hỏi được cấu hình cho bài kiểm tra này trước khi bắt đầu.")}
          </Text>
        </View>
      </View>

      {error && (
        <View style={screenStyles.errorBox}>
          <Text accessibilityRole="alert" style={screenStyles.errorText}>
            {uiText(error)}
          </Text>
        </View>
      )}

      {/* Exam Specs - KPI Cards */}
      <View style={screenStyles.kpiRow}>
        <StatCard
          label={uiText("CÂU HỎI")}
          value={`${quiz.questionCount}`}
          icon="book"
          color={tokens.color.brand}
        />
        <StatCard
          label={uiText("THỜI LƯỢNG")}
          value={quiz.durationSeconds ? `${Math.round(quiz.durationSeconds / 60)}'` : "Tự do"}
          icon="clock"
          color={tokens.color.warning}
        />
        <StatCard
          label={uiText("LƯỢT THI")}
          value={quiz.attemptLimit ? `${quiz.attemptLimit}` : "Vô hạn"}
          icon="sparkles"
          color={tokens.color.ai}
        />
      </View>

      {/* Rules & Guidelines Card */}
      <View style={screenStyles.instructionsBox}>
        <View style={screenStyles.instructionHeader}>
          <Icon name="shield" size={18} color={tokens.color.brand} />
          <Text style={screenStyles.instructionsTitle}>{uiText("Quy chế thi và hướng dẫn làm bài")}</Text>
        </View>

        <View style={screenStyles.instructionList}>
          <View style={screenStyles.instructionRow}>
            <Text style={screenStyles.bulletDot}>•</Text>
            <Text style={screenStyles.instructionItem}>
              {uiText("Đồng hồ tính giờ sẽ bắt đầu đếm ngược ngay sau khi bạn bấm bắt đầu.")}
            </Text>
          </View>
          <View style={screenStyles.instructionRow}>
            <Text style={screenStyles.bulletDot}>•</Text>
            <Text style={screenStyles.instructionItem}>
              {uiText("Bạn có thể tự do chuyển đổi qua lại giữa các câu hỏi trong thời gian thi.")}
            </Text>
          </View>
          <View style={screenStyles.instructionRow}>
            <Text style={screenStyles.bulletDot}>•</Text>
            <Text style={screenStyles.instructionItem}>
              {uiText("Nhấn Nộp bài để hoàn tất. Kết quả được hệ thống chấm điểm tự động tức thì.")}
            </Text>
          </View>
          <View style={screenStyles.instructionRow}>
            <Text style={screenStyles.bulletDot}>•</Text>
            <Text style={screenStyles.instructionItem}>
              {uiText("Khi hết thời gian quy định, hệ thống sẽ tự động khóa bài thi.")}
            </Text>
          </View>
        </View>
      </View>

      {/* Primary Action Button */}
      <View style={screenStyles.actionRow}>
        <Button
          testID="student-assessment-start"
          label={starting ? uiText("Đang chuẩn bị đề thi...") : uiText("▶ Bắt đầu làm bài thi")}
          onPress={() => void handleStartAttempt()}
          disabled={starting}
          size="lg"
        />
        <Button
          label={uiText("← Quay lại danh sách bài kiểm tra")}
          variant="outline"
          onPress={() => router.push("/assessments" as Href)}
        />
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
  authText: {
    fontSize: 14,
    color: tokens.color.muted,
    textAlign: "center",
  },
  heroCard: {
    backgroundColor: tokens.color.surface,
    padding: tokens.space.large,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginBottom: tokens.space.medium,
    gap: tokens.space.small,
    ...tokens.shadow.card,
  },
  badgeRow: {
    flexDirection: "row",
    gap: 8,
  },
  examTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: tokens.color.ink,
    lineHeight: 30,
    marginTop: 4,
  },
  examTypeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  examTypeText: {
    fontSize: 13,
    color: tokens.color.muted,
    fontWeight: "500",
  },
  kpiRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: tokens.space.medium,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  instructionsBox: {
    backgroundColor: tokens.color.surface,
    padding: tokens.space.large,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginBottom: tokens.space.large,
    gap: tokens.space.medium,
    ...tokens.shadow.subtle,
  },
  instructionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  instructionsTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  instructionList: {
    gap: 10,
  },
  instructionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  bulletDot: {
    fontSize: 16,
    color: tokens.color.brand,
    lineHeight: 20,
  },
  instructionItem: {
    flex: 1,
    fontSize: 13,
    color: tokens.color.inkSecondary,
    lineHeight: 20,
  },
  errorBox: {
    marginVertical: tokens.space.small,
    padding: tokens.space.medium,
    backgroundColor: "#FEF2F2",
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: "#FECACA",
    alignItems: "center",
    gap: 10,
  },
  errorText: {
    color: tokens.color.danger,
    fontSize: 14,
    textAlign: "center",
    fontWeight: "500",
  },
  actionCol: {
    width: "100%",
    gap: tokens.space.small,
  },
  actionRow: {
    gap: 12,
    marginBottom: tokens.space.xl,
  },
});
