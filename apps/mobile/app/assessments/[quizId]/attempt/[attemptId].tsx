import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { type Href, router, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import {
  attempt as decodeAttempt,
  buildSubmitPayload,
  AttemptSubmissionGate,
  calculateRemainingSeconds,
  countAnsweredQuestions,
  formatRemainingTime,
  isAttemptExpired,
  reconcileAttemptSubmitOutcome,
  quizDetail as decodeQuizDetail,
  type Attempt,
  type QuizDetail,
  type QuizQuestion,
  type SubmittedAnswer,
} from "../../../../src/assessment";
import { ApiError } from "../../../../src/api";
import { runtime } from "../../../../src/runtime";
import { Button, Page, Badge, ProgressBar, Icon, styles, tokens } from "../../../../src/ui";

export default function AttemptScreen() {
  const { quizId, attemptId, confirm } = useLocalSearchParams<{
    quizId: string;
    attemptId: string;
    confirm?: string;
  }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [attemptData, setAttemptData] = useState<Attempt | null>(null);
  const [quizData, setQuizData] = useState<QuizDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // In-memory answer draft state
  const [draftAnswers, setDraftAnswers] = useState<Record<string, SubmittedAnswer>>({});
  const [currentIndex, setCurrentIndex] = useState(0);

  // Authoritative server-derived countdown timer
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(confirm === "1" || confirm === "true");
  const submissionOperation = useRef<{
    idempotencyKey: string;
    payload: ReturnType<typeof buildSubmitPayload>;
  } | null>(null);
  const submissionGate = useRef(new AttemptSubmissionGate());

  useEffect(() => {
    if (confirm === "1" || confirm === "true") {
      setShowConfirmModal(true);
    }
  }, [confirm]);

  const attemptRef = useRef<Attempt | null>(null);
  attemptRef.current = attemptData;

  const loadData = useCallback(async () => {
    if (!quizId || !attemptId || snapshot.state !== "AUTHENTICATED") return;
    try {
      setError(null);
      const [attRes, quizRes] = await Promise.all([
        session.request(`/api/v1/attempts/${encodeURIComponent(attemptId)}`),
        session.request(`/api/v1/quizzes/${encodeURIComponent(quizId)}`),
      ]);

      const att = decodeAttempt(attRes);
      const qz = decodeQuizDetail(quizRes);

      if (att.state === "SUBMITTED") {
        router.replace(`/assessments/${quizId}/result/${attemptId}` as Href);
        return;
      }

      setAttemptData(att);
      setQuizData(qz);
      setRemainingSeconds(calculateRemainingSeconds(att.deadlineAt));
    } catch (cause) {
      setAttemptData(null);
      setQuizData(null);
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Không thể tải bài làm. Vui lòng kiểm tra kết nối và thử lại.",
      );
    } finally {
      setLoading(false);
    }
  }, [attemptId, quizId, session, snapshot.state]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Periodic timer tick based on authoritative deadline
  useEffect(() => {
    if (!attemptData?.deadlineAt) return;

    const interval = setInterval(() => {
      const remaining = calculateRemainingSeconds(attemptData.deadlineAt);
      setRemainingSeconds(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [attemptData?.deadlineAt]);

  // AppState listener: foreground re-sync timer and state
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === "active" && attemptRef.current?.deadlineAt) {
        const remaining = calculateRemainingSeconds(attemptRef.current.deadlineAt);
        setRemainingSeconds(remaining);

        // Revalidate attempt state from server
        if (attemptId) {
          session
            .request(`/api/v1/attempts/${encodeURIComponent(attemptId)}`)
            .then((res: unknown) => {
              const fresh = decodeAttempt(res);
              setAttemptData(fresh);
              if (fresh.state === "SUBMITTED") {
                router.replace(`/assessments/${quizId}/result/${attemptId}` as Href);
              }
            })
            .catch(() => {});
        }
      }
    };

    const sub = AppState.addEventListener("change", handleAppStateChange);
    return () => sub.remove();
  }, [attemptId, quizId, session]);

  const questions = quizData?.questions ?? [];
  const currentQuestion: QuizQuestion | undefined = questions[currentIndex];
  const isExpired =
    attemptData?.state === "EXPIRED" ||
    (attemptData?.deadlineAt ? isAttemptExpired(attemptData.deadlineAt) : false);

  // Choice handlers
  const handleSelectSingleChoice = (option: string) => {
    if (isExpired || isSubmitting || submissionOperation.current || !currentQuestion) return;
    setDraftAnswers((prev) => ({
      ...prev,
      [currentQuestion.questionId]: {
        questionId: currentQuestion.questionId,
        selectedOptionId: option,
      },
    }));
  };

  const handleToggleMultiChoice = (option: string) => {
    if (isExpired || isSubmitting || submissionOperation.current || !currentQuestion) return;
    const current = draftAnswers[currentQuestion.questionId];
    let selected: string[] = [];
    if (current && "selectedOptionIds" in current) {
      selected = [...current.selectedOptionIds];
    }
    const idx = selected.indexOf(option);
    if (idx >= 0) {
      selected.splice(idx, 1);
    } else {
      selected.push(option);
    }

    setDraftAnswers((prev) => ({
      ...prev,
      [currentQuestion.questionId]: {
        questionId: currentQuestion.questionId,
        selectedOptionIds: selected,
      },
    }));
  };

  const handleSelectTrueFalse = (val: boolean) => {
    if (isExpired || isSubmitting || submissionOperation.current || !currentQuestion) return;
    setDraftAnswers((prev) => ({
      ...prev,
      [currentQuestion.questionId]: {
        questionId: currentQuestion.questionId,
        value: val,
      },
    }));
  };

  const handleShortAnswerChange = (txt: string) => {
    if (isExpired || isSubmitting || submissionOperation.current || !currentQuestion) return;
    setDraftAnswers((prev) => ({
      ...prev,
      [currentQuestion.questionId]: {
        questionId: currentQuestion.questionId,
        text: txt,
      },
    }));
  };

  // Submission handler with reconciliation on timeout/error
  const handleSubmitAttempt = async () => {
    if (!attemptId || !quizId || isSubmitting || isExpired || !submissionGate.current.begin()) return;
    setIsSubmitting(true);
    setShowConfirmModal(false);

    submissionOperation.current ??= {
      idempotencyKey: Crypto.randomUUID(),
      payload: buildSubmitPayload(questions, draftAnswers),
    };
    const operation = submissionOperation.current;

    try {
      await session.request(`/api/v1/attempts/${encodeURIComponent(attemptId)}/submit`, {
        method: "POST",
        idempotencyKey: operation.idempotencyKey,
        body: operation.payload,
      });
      submissionGate.current.finish("COMPLETE");
      router.replace(`/assessments/${quizId}/result/${attemptId}` as Href);
    } catch {
      // Reconcile ambiguous outcome by fetching attempt
      try {
        const checkRes = await session.request(`/api/v1/attempts/${encodeURIComponent(attemptId)}`);
        const fresh = decodeAttempt(checkRes);
        const outcome = reconcileAttemptSubmitOutcome(fresh.state);
        if (outcome === "SUCCESS") {
          submissionGate.current.finish("COMPLETE");
          router.replace(`/assessments/${quizId}/result/${attemptId}` as Href);
          return;
        }
        if (outcome === "EXPIRED") {
          submissionGate.current.finish("COMPLETE");
          Alert.alert("Hết giờ làm bài", "Bài làm đã hết thời gian quy định và hệ thống đã ghi nhận.");
          setAttemptData(fresh);
          setIsSubmitting(false);
          return;
        }
      } catch {
        // Fall through to error presentation
      }

      Alert.alert(
        "Nộp bài chưa hoàn tất",
        "Không xác minh được kết quả với máy chủ. Bản trả lời đã được khóa để lần thử lại dùng cùng mã chống trùng; vui lòng thử nộp lại khi có mạng.",
      );
      submissionGate.current.finish("RETRYABLE");
      setIsSubmitting(false);
    }
  };

  if (snapshot.state !== "AUTHENTICATED") {
    return (
      <Page testID="student-assessment-confirm">
        <Text style={styles.title}>Làm bài kiểm tra</Text>
        <Text style={styles.text}>Vui lòng đăng nhập để tiếp tục.</Text>
        <Button label="Đăng nhập" onPress={() => router.push("/login" as Href)} />
      </Page>
    );
  }

  if (loading) {
    return (
      <Page>
        <View style={screenStyles.center}>
          <ActivityIndicator size="large" color={tokens.color.brand} />
          <Text style={screenStyles.loadingText}>Đang tải câu hỏi bài thi...</Text>
        </View>
      </Page>
    );
  }

  if (error && (!attemptData || !quizData)) {
    return (
      <Page>
        <Text style={styles.title}>Thông báo</Text>
        <View style={screenStyles.errorBox}>
          <Text style={styles.error}>{error}</Text>
        </View>
        <Button label="Quay lại danh sách" onPress={() => router.push("/assessments" as Href)} />
      </Page>
    );
  }

  if (!quizData || !attemptData || !currentQuestion) return null;

  const currentAnswer = draftAnswers[currentQuestion.questionId];
  const { answered, total } = countAnsweredQuestions(questions, draftAnswers);

  if (showConfirmModal) {
    return (
      <Page>
        <View style={screenStyles.topBar}>
          <View>
            <Text style={screenStyles.counterText}>Xác nhận nộp bài thi</Text>
            <Text style={screenStyles.answeredSummary}>
              Tiến độ: {answered}/{total} câu
            </Text>
          </View>
          {attemptData.deadlineAt && (
            <View style={[screenStyles.timerBadge, remainingSeconds < 120 && screenStyles.timerBadgeUrgent]}>
              <Icon
                name="clock"
                size={14}
                color={remainingSeconds < 120 ? tokens.color.danger : tokens.color.brand}
              />
              <Text style={[screenStyles.timerText, remainingSeconds < 120 && screenStyles.timerTextUrgent]}>
                {formatRemainingTime(remainingSeconds)}
              </Text>
            </View>
          )}
        </View>

        <View style={screenStyles.confirmCard}>
          <View style={screenStyles.confirmIconCircle}>
            <Icon name="alert" size={32} color={tokens.color.brand} />
          </View>
          <Text style={screenStyles.confirmTitle}>Bạn đã sẵn sàng nộp bài?</Text>
          <Text style={screenStyles.confirmText}>
            Bạn đã hoàn thành {answered}/{total} câu hỏi trong bài thi. Sau khi nộp bài, bạn không thể chỉnh
            sửa đáp án và hệ thống sẽ tự động chấm điểm khách quan.
          </Text>
          {answered < total && (
            <View style={screenStyles.unansweredNotice}>
              <Icon name="alert" size={16} color={tokens.color.danger} />
              <Text style={screenStyles.unansweredNoticeText}>
                Lưu ý: Còn {total - answered} câu hỏi chưa có câu trả lời!
              </Text>
            </View>
          )}
          {submissionOperation.current && (
            <Text accessibilityRole="alert" style={[styles.text, { color: tokens.color.warning }]}>
              Yêu cầu nộp trước đó chưa được xác minh. Lần thử lại sẽ gửi nguyên câu trả lời với cùng mã chống
              trùng.
            </Text>
          )}
          <View style={screenStyles.confirmActions}>
            <Button
              testID="student-assessment-confirm-submit"
              label={isSubmitting ? "Đang nộp bài..." : "Xác nhận nộp bài"}
              onPress={() => void handleSubmitAttempt()}
              disabled={isSubmitting}
              size="lg"
            />
            <Button label="Quay lại làm tiếp" variant="outline" onPress={() => setShowConfirmModal(false)} />
          </View>
        </View>
      </Page>
    );
  }

  return (
    <Page testID="student-assessment-attempt">
      {/* Header bar: Timer & question counter */}
      <View style={screenStyles.topBar}>
        <View style={{ flex: 1 }}>
          <Text style={screenStyles.counterText}>
            Câu {currentIndex + 1} / {questions.length}
          </Text>
          <Text style={screenStyles.answeredSummary}>
            Đã trả lời: {answered}/{total} câu
          </Text>
        </View>

        {attemptData.deadlineAt && (
          <View style={[screenStyles.timerBadge, remainingSeconds < 120 && screenStyles.timerBadgeUrgent]}>
            <Icon
              name="clock"
              size={14}
              color={remainingSeconds < 120 ? tokens.color.danger : tokens.color.brand}
            />
            <Text style={[screenStyles.timerText, remainingSeconds < 120 && screenStyles.timerTextUrgent]}>
              {formatRemainingTime(remainingSeconds)}
            </Text>
          </View>
        )}
      </View>

      <View style={screenStyles.progressWrapper}>
        <ProgressBar
          progress={total > 0 ? (answered / total) * 100 : 0}
          height={6}
          color={tokens.color.brand}
        />
      </View>

      {/* Expired banner */}
      {isExpired && (
        <View style={screenStyles.expiredBanner}>
          <Text style={screenStyles.expiredTitle}>Hết thời gian làm bài</Text>
          <Text style={screenStyles.expiredText}>
            Thời gian làm bài thi đã kết thúc. Bài thi đã quá hạn và không thể nộp thêm câu trả lời.
          </Text>
        </View>
      )}
      {submissionOperation.current && (
        <View style={screenStyles.expiredBanner} accessibilityRole="alert">
          <Text style={screenStyles.expiredTitle}>Đáp án đã khóa để xác minh lần nộp</Text>
          <Text style={screenStyles.expiredText}>
            Nếu mạng gián đoạn, thử nộp lại sẽ dùng cùng nội dung và mã chống trùng.
          </Text>
        </View>
      )}

      <View style={screenStyles.scrollArea}>
        {/* Question card */}
        <View style={screenStyles.questionCard}>
          <View style={screenStyles.questionHeader}>
            <Text style={screenStyles.questionNumber}>CÂU HỎI {currentIndex + 1}</Text>
            <Badge label={`${currentQuestion.points} điểm`} variant="primary" />
          </View>

          <Text style={screenStyles.promptText}>{currentQuestion.prompt}</Text>

          {/* SINGLE_CHOICE Options */}
          {currentQuestion.questionType === "SINGLE_CHOICE" &&
            currentQuestion.options?.map((opt, idx) => {
              const selected =
                currentAnswer &&
                "selectedOptionId" in currentAnswer &&
                currentAnswer.selectedOptionId === opt;
              return (
                <Pressable
                  key={idx}
                  testID={`student-assessment-answer-${idx + 1}`}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={opt}
                  disabled={isExpired || isSubmitting || !!submissionOperation.current}
                  style={[screenStyles.optionRow, selected && screenStyles.optionRowSelected]}
                  onPress={() => handleSelectSingleChoice(opt)}
                >
                  <View style={[screenStyles.radioOuter, selected && screenStyles.radioOuterSelected]}>
                    {selected && <View style={screenStyles.radioInner} />}
                  </View>
                  <Text style={[screenStyles.optionText, selected && screenStyles.optionTextSelected]}>
                    {opt}
                  </Text>
                </Pressable>
              );
            })}

          {/* MULTIPLE_CHOICE Options */}
          {currentQuestion.questionType === "MULTIPLE_CHOICE" &&
            currentQuestion.options?.map((opt, idx) => {
              const selected =
                currentAnswer &&
                "selectedOptionIds" in currentAnswer &&
                currentAnswer.selectedOptionIds.includes(opt);
              return (
                <Pressable
                  key={idx}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={opt}
                  disabled={isExpired || isSubmitting || !!submissionOperation.current}
                  style={[screenStyles.optionRow, selected && screenStyles.optionRowSelected]}
                  onPress={() => handleToggleMultiChoice(opt)}
                >
                  <View style={[screenStyles.checkboxOuter, selected && screenStyles.checkboxOuterSelected]}>
                    {selected && <Text style={screenStyles.checkmarkText}>✓</Text>}
                  </View>
                  <Text style={[screenStyles.optionText, selected && screenStyles.optionTextSelected]}>
                    {opt}
                  </Text>
                </Pressable>
              );
            })}

          {/* TRUE_FALSE Options */}
          {currentQuestion.questionType === "TRUE_FALSE" && (
            <View style={screenStyles.tfRow}>
              <Pressable
                testID="student-assessment-answer-true"
                accessibilityRole="radio"
                accessibilityState={{
                  selected: currentAnswer && "value" in currentAnswer && currentAnswer.value === true,
                }}
                accessibilityLabel="Đúng"
                disabled={isExpired || isSubmitting || !!submissionOperation.current}
                style={[
                  screenStyles.tfButton,
                  currentAnswer &&
                    "value" in currentAnswer &&
                    currentAnswer.value === true &&
                    screenStyles.tfButtonSelected,
                ]}
                onPress={() => handleSelectTrueFalse(true)}
              >
                <Text
                  style={[
                    screenStyles.tfButtonText,
                    currentAnswer &&
                      "value" in currentAnswer &&
                      currentAnswer.value === true &&
                      screenStyles.tfButtonTextSelected,
                  ]}
                >
                  Đúng
                </Text>
              </Pressable>

              <Pressable
                testID="student-assessment-answer-false"
                accessibilityRole="radio"
                accessibilityState={{
                  selected: currentAnswer && "value" in currentAnswer && currentAnswer.value === false,
                }}
                accessibilityLabel="Sai"
                disabled={isExpired || isSubmitting || !!submissionOperation.current}
                style={[
                  screenStyles.tfButton,
                  currentAnswer &&
                    "value" in currentAnswer &&
                    currentAnswer.value === false &&
                    screenStyles.tfButtonSelected,
                ]}
                onPress={() => handleSelectTrueFalse(false)}
              >
                <Text
                  style={[
                    screenStyles.tfButtonText,
                    currentAnswer &&
                      "value" in currentAnswer &&
                      currentAnswer.value === false &&
                      screenStyles.tfButtonTextSelected,
                  ]}
                >
                  Sai
                </Text>
              </Pressable>
            </View>
          )}

          {/* SHORT_ANSWER Input */}
          {currentQuestion.questionType === "SHORT_ANSWER" && (
            <TextInput
              accessibilityRole="none"
              accessibilityLabel="Câu trả lời ngắn"
              editable={!isExpired && !isSubmitting && !submissionOperation.current}
              style={screenStyles.textInput}
              placeholder="Nhập câu trả lời của bạn..."
              placeholderTextColor={tokens.color.muted}
              value={currentAnswer && "text" in currentAnswer ? currentAnswer.text : ""}
              onChangeText={handleShortAnswerChange}
            />
          )}
        </View>

        {/* Question Index Grid */}
        <View style={screenStyles.indexGridCard}>
          <Text style={screenStyles.indexGridHeading}>Danh sách câu hỏi</Text>
          <View style={screenStyles.indexGrid}>
            {questions.map((q, idx) => {
              const isAns = !!draftAnswers[q.questionId];
              const isCurr = idx === currentIndex;
              return (
                <Pressable
                  key={q.questionId}
                  accessibilityRole="button"
                  accessibilityLabel={`Câu ${idx + 1}`}
                  style={[
                    screenStyles.indexDot,
                    isAns && screenStyles.indexDotAnswered,
                    isCurr && screenStyles.indexDotCurrent,
                  ]}
                  onPress={() => setCurrentIndex(idx)}
                >
                  <Text
                    style={[
                      screenStyles.indexDotText,
                      isAns && screenStyles.indexDotTextAnswered,
                      isCurr && screenStyles.indexDotTextCurrent,
                    ]}
                  >
                    {idx + 1}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>

      {/* Navigation Buttons */}
      <View style={screenStyles.navButtonsRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Câu hỏi trước"
          disabled={currentIndex === 0}
          style={[screenStyles.navButton, currentIndex === 0 && screenStyles.navButtonDisabled]}
          onPress={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
        >
          <Text
            style={[screenStyles.navButtonText, currentIndex === 0 && screenStyles.navButtonTextDisabled]}
          >
            ← Câu trước
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Câu hỏi tiếp"
          disabled={currentIndex === questions.length - 1}
          style={[
            screenStyles.navButton,
            currentIndex === questions.length - 1 && screenStyles.navButtonDisabled,
          ]}
          onPress={() => setCurrentIndex((prev) => Math.min(questions.length - 1, prev + 1))}
        >
          <Text
            style={[
              screenStyles.navButtonText,
              currentIndex === questions.length - 1 && screenStyles.navButtonTextDisabled,
            ]}
          >
            Câu tiếp →
          </Text>
        </Pressable>
      </View>

      <View style={screenStyles.footer}>
        <Button
          testID="student-assessment-submit"
          label={
            isExpired
              ? "Thời gian đã hết"
              : submissionOperation.current
                ? "Thử xác minh nộp bài"
                : "Nộp bài thi"
          }
          onPress={() => {
            if (!isExpired) setShowConfirmModal(true);
          }}
          size="lg"
        />
      </View>
    </Page>
  );
}

const screenStyles = StyleSheet.create({
  center: {
    paddingVertical: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: 12,
    color: tokens.color.muted,
    fontSize: 14,
  },
  errorBox: {
    marginVertical: 12,
    padding: 12,
    backgroundColor: "#FEF2F2",
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: tokens.space.small,
  },
  counterText: {
    fontSize: 18,
    fontWeight: "800",
    color: tokens.color.ink,
  },
  answeredSummary: {
    fontSize: 12,
    color: tokens.color.muted,
    marginTop: 2,
    fontWeight: "500",
  },
  progressWrapper: {
    marginBottom: tokens.space.medium,
  },
  timerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F0FDFA",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: tokens.radius.full,
    borderWidth: 1,
    borderColor: "#CCFBF1",
  },
  timerBadgeUrgent: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
  },
  timerText: {
    fontSize: 14,
    fontWeight: "800",
    color: tokens.color.brand,
  },
  timerTextUrgent: {
    color: tokens.color.danger,
  },
  expiredBanner: {
    backgroundColor: "#FEE2E2",
    padding: tokens.space.medium,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: "#FECACA",
    marginBottom: tokens.space.medium,
  },
  expiredTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#B91C1C",
    marginBottom: 2,
  },
  expiredText: {
    fontSize: 13,
    color: "#991B1B",
    lineHeight: 18,
  },
  scrollArea: {
    paddingBottom: tokens.space.medium,
  },
  questionCard: {
    backgroundColor: tokens.color.surface,
    padding: tokens.space.large,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginBottom: tokens.space.medium,
    ...tokens.shadow.card,
  },
  questionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  questionNumber: {
    fontSize: 12,
    fontWeight: "800",
    color: tokens.color.brand,
    letterSpacing: 0.8,
  },
  pointsBadge: {
    fontSize: 12,
    fontWeight: "600",
    color: tokens.color.muted,
  },
  promptText: {
    fontSize: 16,
    fontWeight: "700",
    color: tokens.color.ink,
    lineHeight: 24,
    marginBottom: tokens.space.large,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: tokens.radius.md,
    borderWidth: 1.5,
    borderColor: tokens.color.border,
    marginBottom: 10,
    backgroundColor: tokens.color.surface,
    minHeight: 52,
    ...tokens.shadow.subtle,
  },
  optionRowSelected: {
    borderColor: tokens.color.brand,
    backgroundColor: "#F0FDFA",
  },
  radioOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: tokens.color.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  radioOuterSelected: {
    borderColor: tokens.color.brand,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: tokens.color.brand,
  },
  checkboxOuter: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: tokens.color.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  checkboxOuterSelected: {
    borderColor: tokens.color.brand,
    backgroundColor: tokens.color.brand,
  },
  checkmarkText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  optionText: {
    fontSize: 14,
    color: tokens.color.ink,
    flex: 1,
    lineHeight: 20,
  },
  optionTextSelected: {
    fontWeight: "700",
    color: tokens.color.brand,
  },
  tfRow: {
    flexDirection: "row",
    gap: 12,
  },
  tfButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: tokens.radius.md,
    borderWidth: 1.5,
    borderColor: tokens.color.border,
    alignItems: "center",
    backgroundColor: tokens.color.surface,
    minHeight: 50,
    ...tokens.shadow.subtle,
  },
  tfButtonSelected: {
    borderColor: tokens.color.brand,
    backgroundColor: "#F0FDFA",
  },
  tfButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: tokens.color.ink,
  },
  tfButtonTextSelected: {
    color: tokens.color.brand,
    fontWeight: "800",
  },
  textInput: {
    borderWidth: 1.5,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.md,
    padding: 14,
    fontSize: 15,
    color: tokens.color.ink,
    backgroundColor: tokens.color.surface,
    minHeight: 52,
  },
  indexGridCard: {
    backgroundColor: tokens.color.surface,
    padding: tokens.space.medium,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.color.border,
    ...tokens.shadow.subtle,
  },
  indexGridHeading: {
    fontSize: 13,
    fontWeight: "700",
    color: tokens.color.inkSecondary,
    marginBottom: tokens.space.small,
  },
  indexGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  indexDot: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: tokens.color.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.color.surface,
  },
  indexDotAnswered: {
    backgroundColor: "#CCFBF1",
    borderColor: "#14B8A6",
  },
  indexDotCurrent: {
    borderColor: tokens.color.brand,
    backgroundColor: tokens.color.brand,
    ...tokens.shadow.subtle,
  },
  indexDotText: {
    fontSize: 13,
    fontWeight: "700",
    color: tokens.color.inkSecondary,
  },
  indexDotTextAnswered: {
    color: tokens.color.brandDark,
  },
  indexDotTextCurrent: {
    color: "#FFFFFF",
  },
  navButtonsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginVertical: tokens.space.small,
  },
  navButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: tokens.radius.md,
    borderWidth: 1.5,
    borderColor: tokens.color.borderStrong,
    alignItems: "center",
    backgroundColor: tokens.color.surface,
    minHeight: 48,
    justifyContent: "center",
    ...tokens.shadow.subtle,
  },
  navButtonDisabled: {
    opacity: 0.4,
  },
  navButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  navButtonTextDisabled: {
    color: tokens.color.muted,
  },
  confirmCard: {
    backgroundColor: tokens.color.surface,
    padding: tokens.space.xl,
    borderRadius: tokens.radius.lg,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginVertical: tokens.space.medium,
    alignItems: "center",
    ...tokens.shadow.card,
  },
  confirmIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#F0FDFA",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: tokens.space.medium,
  },
  confirmTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: tokens.color.ink,
    marginBottom: 8,
    textAlign: "center",
  },
  confirmText: {
    fontSize: 14,
    color: tokens.color.muted,
    lineHeight: 22,
    textAlign: "center",
    marginBottom: tokens.space.medium,
  },
  unansweredNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FEF2F2",
    padding: tokens.space.medium,
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: "#FECACA",
    width: "100%",
    marginBottom: tokens.space.large,
  },
  unansweredNoticeText: {
    fontSize: 13,
    color: tokens.color.danger,
    fontWeight: "600",
    flex: 1,
  },
  confirmActions: {
    width: "100%",
    gap: tokens.space.small,
  },
  footer: {
    marginTop: tokens.space.small,
    marginBottom: tokens.space.large,
  },
});
