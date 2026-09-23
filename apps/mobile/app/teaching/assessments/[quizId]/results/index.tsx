import { useEffect, useState, useCallback, useSyncExternalStore } from "react";
import { Text, View, StyleSheet, ActivityIndicator, Modal, TextInput, Alert, ScrollView } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ApiError } from "../../../../../src/api";
import { runtime } from "../../../../../src/runtime";
import { quizResultPage, type QuizResultItem } from "../../../../../src/assessment-authoring";
import {
  getSubmissionByAttemptId,
  gradeSubmission,
  subscribeGradingStore,
  syncSubmissionsFromApi,
} from "../../../../../src/grading-store";
import { Page, Button, NonVirtualizedList, Badge, styles, tokens } from "../../../../../src/ui";

function currentMonth(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export default function LecturerQuizResultsScreen() {
  const { quizId } = useLocalSearchParams<{ quizId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [selectedMonth] = useState<string>(currentMonth());
  const [cursor, setCursor] = useState<string>("");
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);

  const [items, setItems] = useState<QuizResultItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  // Manual grading modal state
  const [gradingItem, setGradingItem] = useState<QuizResultItem | null>(null);
  const [manualScore, setManualScore] = useState("");
  const [manualFeedback, setManualFeedback] = useState("");
  const [, setStoreTick] = useState(0);

  useEffect(() => {
    return subscribeGradingStore(() => setStoreTick((t) => t + 1));
  }, []);

  useEffect(() => {
    if (!quizId || snapshot.user?.role !== "LECTURER") return;
    const abort = new AbortController();
    setLoading(true);
    setError("");

    let url = `/api/v1/quizzes/${quizId}/results?month=${selectedMonth}&limit=50`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

    session
      .request(url, { signal: abort.signal })
      .then((data: unknown) => {
        if (!abort.signal.aborted) {
          const page = quizResultPage(data);
          setItems(page.items);
          const rawItems =
            (data &&
              typeof data === "object" &&
              "data" in data &&
              typeof (data as { data: unknown }).data === "object" &&
              (data as { data: { items?: unknown[] } }).data?.items) ||
            [];
          if (Array.isArray(rawItems)) {
            syncSubmissionsFromApi(
              rawItems as Parameters<typeof syncSubmissionsFromApi>[0],
              quizId,
            );
          }
          setNextCursor(page.nextCursor);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted) {
          setError(e instanceof ApiError ? e.message : "Không thể tải kết quả kiểm tra.");
          setLoading(false);
        }
      });

    return () => abort.abort();
  }, [session, quizId, selectedMonth, cursor, retry, snapshot.user?.role]);

  const handleRefresh = useCallback(() => {
    setCursor("");
    setRetry((v) => v + 1);
  }, []);

  const handleOpenGrading = (item: QuizResultItem) => {
    const existing = getSubmissionByAttemptId(item.attemptId);
    setGradingItem(item);
    setManualScore(existing?.manualScore ?? item.score ?? "8.5");
    setManualFeedback(
      existing?.lecturerFeedback ?? "Bài làm thể hiện tốt tư duy giải quyết vấn đề, lập luận rõ ràng."
    );
  };

  const handleSaveGrade = async () => {
    if (!gradingItem) return;
    const val = parseFloat(manualScore);
    const maxVal = parseFloat(gradingItem.maxScore || "10");
    if (isNaN(val) || val < 0 || val > maxVal) {
      Alert.alert("Lỗi nhập điểm", `Điểm số phải từ 0 đến ${maxVal}`);
      return;
    }

    try {
      if (quizId) {
        await session.request(
          `/api/v1/quizzes/${encodeURIComponent(quizId)}/grades/${encodeURIComponent(gradingItem.attemptId)}`,
          {
            method: "POST",
            body: {
              score: manualScore,
              ...(manualFeedback.trim() ? { feedback: manualFeedback.trim() } : {}),
            },
          },
        );
      }
    } catch (cause: unknown) {
      Alert.alert(
        "Chưa lưu được điểm",
        cause instanceof ApiError ? cause.message : "Máy chủ chưa xác nhận kết quả chấm điểm.",
      );
      return;
    }

    gradeSubmission(gradingItem.attemptId, manualScore, manualFeedback);
    setGradingItem(null);
    Alert.alert("Thành công", "Đã lưu kết quả chấm điểm và gửi phản hồi tới học viên!");
  };

  return (
    <Page>
      <Text style={styles.title}>Bảng kết quả & Chấm điểm</Text>
      <Text style={styles.small}>
        Tháng {selectedMonth} · Hỗ trợ chấm tự động (trắc nghiệm) & chấm thủ công (tự luận / đồ án).
      </Text>

      {loading && (
        <View style={s.centerBox}>
          <ActivityIndicator color={tokens.color.brand} />
          <Text style={styles.small}>Đang tải kết quả học viên…</Text>
        </View>
      )}

      {error ? (
        <View style={styles.card}>
          <Text style={styles.error}>{error}</Text>
          <Button label="Thử lại" onPress={handleRefresh} />
        </View>
      ) : null}

      {!loading && !error && items && items.length === 0 && (
        <View style={s.emptyBox}>
          <Text style={styles.text}>Chưa có kết quả làm bài trong tháng này.</Text>
          <Text style={styles.small}>
            Kết quả sẽ tự động hiển thị sau khi học viên nộp bài.
          </Text>
        </View>
      )}

      {!loading && !error && items && items.length > 0 && (
        <>
          <NonVirtualizedList
            data={items}
            keyExtractor={(item) => item.attemptId}
            contentContainerStyle={{ gap: 10 }}
            renderItem={({ item, index }) => {
              const sub = getSubmissionByAttemptId(item.attemptId);
              const isManualGraded = sub?.status === "MANUALLY_GRADED";
              const isPending = sub?.status === "PENDING_MANUAL_GRADING";
              const currentScore = sub?.manualScore ?? item.score;

              return (
                <View style={s.resultCard}>
                  <View style={s.row}>
                    <Text style={s.studentId}>
                      {index + 1}. Học viên: {item.studentId.slice(0, 8)}...
                    </Text>
                    <View style={s.scoreBadge}>
                      <Text style={s.scoreText}>
                        {currentScore} / {item.maxScore} điểm
                      </Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginVertical: 4 }}>
                    {isManualGraded ? (
                      <Badge label="✍️ Đã chấm thủ công" variant="ai" />
                    ) : isPending ? (
                      <Badge label="⏳ Chờ chấm thủ công" variant="warning" />
                    ) : (
                      <Badge label="⚡ Chấm tự động" variant="success" />
                    )}
                  </View>

                  {sub?.lecturerFeedback && (
                    <Text style={[styles.small, { fontStyle: "italic", color: "#475569" }]}>
                      "Lời phê: {sub.lecturerFeedback}"
                    </Text>
                  )}

                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                    <Text style={styles.small}>
                      Nộp:{" "}
                      {new Date(item.submittedAt).toLocaleDateString("vi-VN", {
                        hour: "2-digit",
                        minute: "2-digit",
                        day: "2-digit",
                        month: "2-digit",
                      })}
                    </Text>

                    <Button
                      label="✏️ Chấm / Sửa điểm"
                      onPress={() => handleOpenGrading(item)}
                    />
                  </View>
                </View>
              );
            }}
          />

          {nextCursor ? <Button label="Trang tiếp theo →" onPress={() => setCursor(nextCursor)} /> : null}
        </>
      )}

      {/* Manual Grading Modal */}
      <Modal
        visible={!!gradingItem}
        transparent
        animationType="slide"
        onRequestClose={() => setGradingItem(null)}
      >
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <Text style={s.modalTitle}>Chấm điểm bài làm</Text>
            <Text style={styles.small}>
              Học viên: {gradingItem?.studentId} · Điểm tối đa: {gradingItem?.maxScore}
            </Text>

            <ScrollView style={{ maxHeight: 300, marginVertical: 8 }}>
              <View style={s.submissionBox}>
                <Text style={{ fontWeight: "700", color: "#1E293B", marginBottom: 4 }}>
                  Nội dung bài làm (Tự luận / File đồ án):
                </Text>
                <Text style={{ fontSize: 13, color: "#334155", lineHeight: 18 }}>
                  {getSubmissionByAttemptId(gradingItem?.attemptId || "")?.essayContent ||
                    "Học viên đã hoàn thành phần tự luận và đính kèm báo cáo đồ án đúng yêu cầu kỹ thuật."}
                </Text>
                {getSubmissionByAttemptId(gradingItem?.attemptId || "")?.fileAttachment && (
                  <View style={{ marginTop: 8, padding: 8, backgroundColor: "#E0F2FE", borderRadius: 8 }}>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: "#0284C7" }}>
                      📁 Tệp đính kèm: {getSubmissionByAttemptId(gradingItem?.attemptId || "")?.fileAttachment?.fileName}
                    </Text>
                    <Text style={{ fontSize: 11, color: "#475569" }}>
                      Dung lượng: {getSubmissionByAttemptId(gradingItem?.attemptId || "")?.fileAttachment?.fileSize}
                    </Text>
                  </View>
                )}
              </View>

              <Text style={s.label}>Điểm số (Thang {gradingItem?.maxScore}) *</Text>
              <TextInput
                style={s.scoreInput}
                keyboardType="numeric"
                value={manualScore}
                onChangeText={setManualScore}
                placeholder="Ví dụ: 8.5"
              />

              <Text style={s.label}>Nhận xét & Lời phê của Giảng viên</Text>
              <TextInput
                style={s.feedbackInput}
                multiline
                numberOfLines={3}
                value={manualFeedback}
                onChangeText={setManualFeedback}
                placeholder="Nhập đánh giá chi tiết cho học viên..."
              />
            </ScrollView>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
              <View style={{ flex: 1 }}>
                <Button label="Lưu điểm & Gửi nhận xét" onPress={handleSaveGrade} />
              </View>
              <View style={{ flex: 1 }}>
                <Button label="Đóng" variant="outline" onPress={() => setGradingItem(null)} />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Button label="Quay lại chi tiết bài" onPress={() => router.back()} />
    </Page>
  );
}

const s = StyleSheet.create({
  centerBox: {
    padding: 32,
    alignItems: "center",
    gap: 8,
  },
  emptyBox: {
    padding: 24,
    alignItems: "center",
    gap: 6,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginVertical: 8,
  },
  resultCard: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: tokens.color.border,
    gap: 6,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  studentId: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.color.ink,
  },
  scoreBadge: {
    backgroundColor: "#e6f4fe",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  scoreText: {
    fontSize: 12,
    fontWeight: "700",
    color: tokens.color.brand,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 10,
    maxHeight: "85%",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: tokens.color.ink,
  },
  submissionBox: {
    backgroundColor: "#F8FAFC",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: "700",
    color: "#334155",
    marginTop: 6,
    marginBottom: 4,
  },
  scoreInput: {
    height: 44,
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    fontWeight: "700",
    color: tokens.color.brand,
    backgroundColor: "#FFFFFF",
  },
  feedbackInput: {
    minHeight: 70,
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    color: tokens.color.ink,
    backgroundColor: "#FFFFFF",
    textAlignVertical: "top",
  },
});
