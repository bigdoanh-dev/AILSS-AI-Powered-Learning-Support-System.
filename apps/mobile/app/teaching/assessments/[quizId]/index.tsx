import { useEffect, useState, useCallback } from "react";
import { Text, View, StyleSheet, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSyncExternalStore } from "react";
import { ApiError } from "../../../../src/api";
import { runtime } from "../../../../src/runtime";
import { authoringQuiz, CONTRACT_LIMITED, type AuthoringQuiz } from "../../../../src/assessment-authoring";
import { Page, Button, ScreenHeader, styles, tokens } from "../../../../src/ui";

export default function AssessmentDetailScreen() {
  const { quizId } = useLocalSearchParams<{ quizId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [quiz, setQuiz] = useState<AuthoringQuiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!quizId || snapshot.user?.role !== "LECTURER") return;
    const abort = new AbortController();
    setLoading(true);
    setError("");

    session
      .request(`/api/v1/quizzes/${quizId}`, { signal: abort.signal })
      .then((data: unknown) => {
        if (!abort.signal.aborted) {
          setQuiz(authoringQuiz(data));
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted) {
          setError(e instanceof ApiError ? e.message : "Không thể tải thông tin bài kiểm tra.");
          setLoading(false);
        }
      });

    return () => abort.abort();
  }, [session, quizId, retry, snapshot.user?.role]);

  const handlePublish = async () => {
    if (!quiz) return;
    if (quiz.questions.length === 0) {
      setError("Bài kiểm tra cần có ít nhất 1 câu hỏi trước khi xuất bản.");
      return;
    }

    setPublishing(true);
    setError("");
    setMsg("");

    try {
      const res = await session.request(`/api/v1/quizzes/${quizId}/publish`, {
        method: "POST",
        body: {},
      });
      const updated = authoringQuiz(res);
      setQuiz(updated);
      setMsg(`Đã xuất bản thành công phiên bản v${updated.currentVersion}!`);
      setPublishing(false);
    } catch (e: unknown) {
      setPublishing(false);
      setError(e instanceof ApiError ? e.message : "Không thể xuất bản bài kiểm tra.");
    }
  };

  const handleRefresh = useCallback(() => {
    setRetry((v) => v + 1);
  }, []);

  return (
    <Page>
      <ScreenHeader
        title={quiz ? quiz.title : "Chi tiết bài kiểm tra"}
        subtitle="Quản lý câu hỏi & xuất bản đề thi"
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/teaching/assessments"))}
      />

      {loading && (
        <View style={s.centerBox}>
          <ActivityIndicator color={tokens.color.brand} />
          <Text style={styles.small}>Đang tải chi tiết bài kiểm tra…</Text>
        </View>
      )}

      {error ? (
        <View style={styles.card}>
          <Text style={styles.error}>{error}</Text>
          <Button label="Thử lại" onPress={handleRefresh} />
        </View>
      ) : null}

      {msg ? (
        <View style={[styles.card, s.successCard]}>
          <Text style={s.successText}>{msg}</Text>
        </View>
      ) : null}

      {!loading && quiz && (
        <>

          <View style={styles.card}>
            <View style={s.row}>
              <Text style={styles.small}>Trạng thái:</Text>
              <View
                style={[
                  s.badge,
                  quiz.state === "PUBLISHED"
                    ? s.badgePublished
                    : quiz.state === "CLOSED"
                      ? s.badgeClosed
                      : s.badgeDraft,
                ]}
              >
                <Text style={s.badgeText}>{quiz.state}</Text>
              </View>
            </View>

            <Text style={styles.small}>
              Đối tượng: {quiz.targetType === "COURSE" ? "Khóa học" : "Lớp học"} ({quiz.targetId})
            </Text>
            <Text style={styles.small}>Số lượng câu hỏi: {quiz.questionCount} câu</Text>
            <Text style={styles.small}>Phiên bản hiện tại: v{quiz.currentVersion}</Text>
            {quiz.durationSeconds ? (
              <Text style={styles.small}>
                Thời gian làm bài: {Math.round(quiz.durationSeconds / 60)} phút
              </Text>
            ) : null}
          </View>

          {/* Action CTAs */}
          <View style={s.actionStack}>
            <Button
              label={`Soạn câu hỏi (${quiz.questionCount})`}
              onPress={() => router.push(`/teaching/assessments/${quizId}/questions`)}
            />

            {quiz.state === "DRAFT" && (
              <Button
                label={publishing ? "Đang xuất bản…" : "Xuất bản bài kiểm tra"}
                onPress={() => void handlePublish()}
              />
            )}

            <Button
              label="Xem bảng kết quả làm bài"
              onPress={() => router.push(`/teaching/assessments/${quizId}/results`)}
            />
          </View>

          {/* Contract limited notice */}
          <View style={s.noticeCard}>
            <Text style={s.noticeTitle}>Lưu ý nghiệp vụ</Text>
            <Text style={s.noticeText}>
              {quiz.state === "PUBLISHED"
                ? "Bài kiểm tra đã xuất bản có thể được học viên làm bài. Kết quả chấm điểm tự động theo chuẩn objective-v1."
                : "Bài kiểm tra đang ở trạng thái bản nháp. Học viên chưa thể xem hoặc làm bài."}
            </Text>
            <Text style={s.noticeSmall}>{CONTRACT_LIMITED.quizDelete}</Text>
          </View>
        </>
      )}

      <Button label="Quay lại danh sách" onPress={() => router.replace("/teaching/assessments")} />
    </Page>
  );
}

const s = StyleSheet.create({
  centerBox: {
    padding: 32,
    alignItems: "center",
    gap: 8,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgePublished: {
    backgroundColor: "#dcfce7",
  },
  badgeDraft: {
    backgroundColor: "#fef3c7",
  },
  badgeClosed: {
    backgroundColor: "#fee2e2",
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  actionStack: {
    gap: 10,
    marginVertical: 6,
  },
  successCard: {
    backgroundColor: "#f0fdf4",
    borderColor: "#86efac",
  },
  successText: {
    color: "#15803d",
    fontSize: 14,
    fontWeight: "600",
  },
  noticeCard: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: tokens.color.border,
    gap: 4,
    marginVertical: 4,
  },
  noticeTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  noticeText: {
    fontSize: 12,
    color: tokens.color.ink,
  },
  noticeSmall: {
    fontSize: 11,
    color: tokens.color.muted,
    fontStyle: "italic",
    marginTop: 4,
  },
});
