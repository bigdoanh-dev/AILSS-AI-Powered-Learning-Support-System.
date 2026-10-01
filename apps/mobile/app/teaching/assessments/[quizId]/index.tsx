import { useEffect, useState, useCallback } from "react";
import { Text, TextInput, View, StyleSheet, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSyncExternalStore } from "react";
import { useMobileCommand } from "../../../../src/queries";
import { ApiError } from "../../../../src/api";
import { runtime } from "../../../../src/runtime";
import { authoringQuiz, CONTRACT_LIMITED, type AuthoringQuiz } from "../../../../src/assessment-authoring";
import { Page, Button, ScreenHeader, styles, tokens } from "../../../../src/ui";

export default function AssessmentDetailScreen() {
  const { quizId } = useLocalSearchParams<{ quizId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [deadline, setDeadline] = useState("");
  const [quiz, setQuiz] = useState<AuthoringQuiz | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [retry, setRetry] = useState(0);
  const command = useMobileCommand();

  useEffect(() => {
    if (!quizId || snapshot.user?.role !== "LECTURER") return;
    const abort = new AbortController();
    setLoading(true);
    setQuiz(null);
    setError("");

    session
      .request(`/api/v1/quizzes/${quizId}`, { signal: abort.signal })
      .then((data: unknown) => {
        if (!abort.signal.aborted) {
          const loaded = authoringQuiz(data);
          setQuiz(loaded);
          setDeadline(loaded.closesAt ?? "");
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
  }, [session, quizId, retry, snapshot.user?.role, snapshot.user?.userId]);

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
      if (await command.run(`/api/v1/quizzes/${quizId}/publish`, {})) handleRefresh();
      setPublishing(false);
    } catch (e: unknown) {
      setPublishing(false);
      setError(e instanceof ApiError ? e.message : "Không thể xuất bản bài kiểm tra.");
    }
  };

  const handleRefresh = useCallback(() => {
    setRetry((v) => v + 1);
  }, []);

  async function saveDeadline() {
    setError("");
    const date = deadline.trim() ? new Date(deadline) : null;
    if (date && !Number.isFinite(date.getTime())) {
      setError("Hạn đóng bài không hợp lệ. Nhập ngày giờ có múi giờ, ví dụ 2026-10-20T23:59:00+07:00.");
      return;
    }
    if (
      await command.run(
        `/api/v1/quizzes/${quizId}`,
        { closesAt: date?.toISOString() ?? null },
        { method: "PATCH" },
      )
    )
      handleRefresh();
  }

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
      {command.message ? (
        <Text accessibilityRole="alert" style={styles.text}>
          {command.message}
        </Text>
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
                disabled={publishing || command.busy}
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

      {quiz?.state === "DRAFT" ? (
        <View style={styles.card}>
          <Text style={styles.text}>Hạn đóng bài (ISO 8601, có múi giờ; để trống để bỏ hạn)</Text>
          <TextInput
            accessibilityLabel="Hạn đóng bài"
            style={styles.input}
            value={deadline}
            onChangeText={setDeadline}
          />
          <Button label="Lưu hạn đóng bài" disabled={command.busy} onPress={() => void saveDeadline()} />
        </View>
      ) : null}
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
