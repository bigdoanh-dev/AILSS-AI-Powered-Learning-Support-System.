import { useUiText } from "../../../../src/use-language";
import { useEffect, useState, useRef, useMemo } from "react";
import { Text, View, TextInput, Pressable, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSyncExternalStore } from "react";
import * as Crypto from "expo-crypto";
import { ApiError } from "../../../../src/api";
import { runtime } from "../../../../src/runtime";
import {
  aiApprovalResult,
  aiDrafts,
  aiJob,
  AI_JOB_FAILURE_COPY,
  AI_JOB_STATE_COPY,
  COGNITIVE_LABELS,
  TERMINAL_AI_JOB_STATES,
  type AiApprovalResult,
  type AiDraft,
  type AiJob,
  type ObjectiveQuestion,
} from "../../../../src/ai-authoring";
import { Page, Button, ScreenHeader, styles, tokens } from "../../../../src/ui";

export default function AiJobDetailScreen() {
  const uiText = useUiText();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const approvalKeys = useRef(new Map<string, string>());
  const [job, setJob] = useState<AiJob | null>(null);
  const [draft, setDraft] = useState<AiDraft | null>(null);
  const [selected, setSelected] = useState(0);

  const [approval, setApproval] = useState<AiApprovalResult | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [approving, setApproving] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState(false);

  const pollTimer = useRef<NodeJS.Timeout | number | null>(null);

  // Bounded Polling for Job Status
  useEffect(() => {
    if (!jobId || snapshot.user?.role !== "LECTURER") return;
    const abort = new AbortController();

    let delay = 1500;
    const poll = async () => {
      try {
        const res = await session.request(`/api/v1/ai/jobs/${jobId}`, { signal: abort.signal });
        if (abort.signal.aborted) return;
        const currentJob = aiJob(res);
        setJob(currentJob);
        setLoading(false);

        if (TERMINAL_AI_JOB_STATES.has(currentJob.state)) {
          // Terminal reached - halt polling immediately
          if (currentJob.state === "AI_DRAFT" || currentJob.state === "APPROVED") {
            loadDrafts();
          }
          return;
        }

        // Exponential backoff up to 8s
        delay = Math.min(8000, Math.round(delay * 1.5));
        pollTimer.current = setTimeout(poll, delay);
      } catch (e: unknown) {
        if (!abort.signal.aborted) {
          setError(e instanceof ApiError ? e.message : "Lỗi khi đọc trạng thái công việc.");
          setLoading(false);
        }
      }
    };

    const loadDrafts = async () => {
      try {
        const draftRes = await session.request(`/api/v1/ai/jobs/${jobId}/drafts`, { signal: abort.signal });
        if (abort.signal.aborted) return;
        const list = aiDrafts(draftRes);
        if (list.length > 0) {
          setDraft(list[0]);
        }
      } catch (cause) {
        if (!abort.signal.aborted)
          setError(
            cause instanceof ApiError ? cause.message : "Không thể tải bản nháp câu hỏi. Hãy thử lại.",
          );
      }
    };

    void poll();

    return () => {
      abort.abort();
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [session, jobId, snapshot.user?.role]);

  const handleCancel = async () => {
    if (!jobId) return;
    setCancelling(true);
    setError("");

    try {
      await session.request(`/api/v1/ai/jobs/${jobId}/cancel`, { method: "POST", body: {} });
      setMsg("Đã gửi yêu cầu hủy công việc.");
      setCancelling(false);
    } catch (e: unknown) {
      setCancelling(false);
      setError(e instanceof ApiError ? e.message : "Không thể hủy công việc.");
    }
  };

  const questions = draft?.content.questions ?? [];
  const currentQ = questions[selected] as ObjectiveQuestion | undefined;

  const updateQuestion = (patch: Partial<ObjectiveQuestion>) => {
    if (!draft) return;
    const nextQuestions = draft.content.questions.map((q, i) => (i === selected ? { ...q, ...patch } : q));
    setDraft({
      ...draft,
      content: {
        ...draft.content,
        questions: nextQuestions,
      },
    });
    setDirty(true);
  };

  const validationErrors = useMemo(() => {
    if (!draft) return [];
    return draft.content.questions.flatMap((q, i) => {
      const errs: string[] = [];
      if (!q.text.trim()) errs.push(`Câu ${i + 1}: Chưa có nội dung câu hỏi.`);
      if (q.options && q.options.some((o) => !o.text.trim())) {
        errs.push(`Câu ${i + 1}: Có lựa chọn đang để trống.`);
      }
      return errs;
    });
  }, [draft]);

  const handleApprove = async () => {
    if (!draft) return;
    if (validationErrors.length > 0) {
      setError("Vui lòng sửa các lỗi câu hỏi trước khi phê duyệt.");
      return;
    }

    setApproving(true);
    setError("");
    setMsg("");

    try {
      const fingerprint = JSON.stringify([draft.draftId, draft.draftVersion, draft.content]);
      const key = approvalKeys.current.get(fingerprint) ?? Crypto.randomUUID();
      approvalKeys.current.set(fingerprint, key);
      const res = await session.request(`/api/v1/ai/drafts/${draft.draftId}/approve`, {
        idempotencyKey: key,
        method: "POST",
        headers: {
          "If-Match": `"v${draft.draftVersion}"`,
        },
        body: {
          reviewedDraft: draft.content,
        },
      });

      approvalKeys.current.delete(fingerprint);
      const approved = aiApprovalResult(res);
      setApproval(approved);
      setApproving(false);
      setDirty(false);
      setMsg("Đã phê duyệt bản nháp và tạo bài kiểm tra DRAFT trong Assessment!");
    } catch (e: unknown) {
      setApproving(false);
      if (e instanceof ApiError && e.status === 409) {
        setError("Bản nháp đã thay đổi. Vui lòng tải lại trước khi duyệt.");
      } else {
        setError(e instanceof ApiError ? e.message : "Không thể phê duyệt bản nháp.");
      }
    }
  };

  const isWorking = job && ["QUEUED", "PROCESSING", "VALIDATING"].includes(job.state);

  return (
    <Page>
      <ScreenHeader
        title={uiText("Chi tiết công việc AI")}
        subtitle={uiText("Mã: {0}", [jobId])}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/teaching/ai"))}
      />

      {loading && (
        <View style={s.centerBox}>
          <ActivityIndicator color={tokens.color.brand} />
          <Text style={styles.small}>{uiText("Đang đọc trạng thái công việc…")}</Text>
        </View>
      )}

      {error ? (
        <View style={styles.card}>
          <Text style={styles.error}>{uiText(error)}</Text>
        </View>
      ) : null}

      {msg ? (
        <View style={[styles.card, s.successCard]}>
          <Text style={s.successText}>{uiText(msg)}</Text>
        </View>
      ) : null}

      {!loading && job && (
        <View style={styles.card}>
          <View style={s.rowBetween}>
            <Text style={s.stateHeading}>{AI_JOB_STATE_COPY[job.state] ?? job.state}</Text>
            <View
              style={[
                s.badge,
                job.state === "AI_DRAFT"
                  ? s.badgeDraft
                  : job.state === "APPROVED"
                    ? s.badgeApproved
                    : job.state === "FAILED"
                      ? s.badgeFailed
                      : s.badgeProcessing,
              ]}
            >
              <Text style={s.badgeText}>{job.state}</Text>
            </View>
          </View>

          {isWorking && (
            <View style={s.workingBox}>
              <ActivityIndicator color={tokens.color.brand} />
              <Text style={styles.small}>
                {uiText(
                  "AI đang xử lý học liệu và cấu trúc câu hỏi. Trang sẽ tự động cập nhật khi có bản nháp.",
                )}
              </Text>
              <Button
                label={cancelling ? uiText("Đang hủy…") : uiText("Hủy yêu cầu này")}
                onPress={() => void handleCancel()}
              />
            </View>
          )}

          {job.state === "FAILED" && (
            <View style={s.failedBox}>
              <Text style={s.failedText}>
                {AI_JOB_FAILURE_COPY[job.failureCode || ""] ??
                  "Không thể tạo bản nháp. Vui lòng quay lại và tạo yêu cầu mới."}
              </Text>
              <Button
                label={uiText("Quay lại tạo yêu cầu mới")}
                onPress={() => router.replace("/teaching/ai")}
              />
            </View>
          )}

          <Text style={styles.small}>
            {uiText("Đối tượng: ")}
            {job.targetType === "COURSE" ? uiText("Khóa học") : uiText("Lớp học")} ({job.targetId})
          </Text>
          <Text style={styles.small}>
            {uiText("Tài liệu nguồn: ")}
            {job.documentId}
          </Text>
          <Text style={styles.small}>
            {uiText("Phiên bản trạng thái: v")}
            {job.version}
          </Text>
        </View>
      )}

      {/* Approval Success Banner */}
      {approval && (
        <View style={[styles.card, s.approvalCard]}>
          <Text style={s.approvalTitle}>{uiText("Giảng viên đã phê duyệt thành công!")}</Text>
          <Text style={s.approvalDesc}>
            {uiText(
              "Đã tạo bài kiểm tra DRAFT trong Assessment. Học viên chỉ có thể làm bài sau khi bạn xuất bản bài kiểm tra.",
            )}
          </Text>
          <Button
            label={uiText("Mở bài kiểm tra trong Assessment →")}
            onPress={() => router.replace(`/teaching/assessments/${approval.assessment.quizId}`)}
          />
        </View>
      )}

      {/* Draft Review Section */}
      {!approval && draft && (
        <View style={s.draftSection}>
          <View style={s.draftHeader}>
            <Text style={s.sectionTitle}>
              {uiText("Kiểm tra bản nháp v")}
              {draft.draftVersion}
              {dirty ? uiText(" (Đã chỉnh sửa)") : ""}
            </Text>
            <Text style={styles.small}>
              {uiText(
                "AI tạo câu hỏi. Giảng viên kiểm tra và phê duyệt trước khi tạo bài kiểm tra chính thức.",
              )}
            </Text>
          </View>

          {/* Question Navigator */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
            {questions.map((_, idx) => (
              <Pressable
                key={idx}
                accessibilityRole="button"
                style={[s.numChip, selected === idx && s.numChipActive]}
                onPress={() => setSelected(idx)}
              >
                <Text style={[s.numChipText, selected === idx && s.numChipTextActive]}>
                  {uiText("Câu ")}
                  {idx + 1}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Question Card */}
          {currentQ && (
            <View style={s.editorCard}>
              <View style={s.rowBetween}>
                <Text style={s.qOrder}>
                  {uiText("Câu ")}
                  {selected + 1} / {questions.length} ({currentQ.type})
                </Text>
                {currentQ.cognitiveLevel && (
                  <View style={s.cogBadge}>
                    <Text style={s.cogText}>
                      {COGNITIVE_LABELS[currentQ.cognitiveLevel] ?? currentQ.cognitiveLevel}
                    </Text>
                  </View>
                )}
              </View>

              <Text style={s.fieldLabel}>{uiText("Nội dung câu hỏi:")}</Text>
              <TextInput
                accessibilityLabel={uiText("Nội dung câu hỏi nháp")}
                multiline
                numberOfLines={3}
                style={[s.input, s.textArea]}
                value={currentQ.text}
                onChangeText={(text) => updateQuestion({ text })}
              />

              <Text style={s.fieldLabel}>{uiText("Điểm:")}</Text>
              <TextInput
                accessibilityLabel={uiText("Điểm câu hỏi nháp")}
                keyboardType="decimal-pad"
                style={s.input}
                value={currentQ.points}
                onChangeText={(points) => updateQuestion({ points })}
              />

              {/* Options */}
              {currentQ.options && currentQ.options.length > 0 && (
                <View style={s.optionsBox}>
                  <Text style={s.fieldLabel}>{uiText("Lựa chọn & Đáp án:")}</Text>
                  {currentQ.options.map((opt, optIdx) => {
                    const isSelected =
                      "optionId" in currentQ.correctAnswer
                        ? currentQ.correctAnswer.optionId === opt.id
                        : "optionIds" in currentQ.correctAnswer
                          ? currentQ.correctAnswer.optionIds.includes(opt.id)
                          : false;

                    return (
                      <View key={opt.id} style={s.optionRow}>
                        <Pressable
                          accessibilityRole="checkbox"
                          style={[s.checkBtn, isSelected && s.checkBtnActive]}
                          onPress={() => {
                            if (currentQ.type === "SINGLE_CHOICE") {
                              updateQuestion({ correctAnswer: { optionId: opt.id } });
                            } else if (currentQ.type === "MULTIPLE_CHOICE") {
                              const curr =
                                "optionIds" in currentQ.correctAnswer
                                  ? [...currentQ.correctAnswer.optionIds]
                                  : [];
                              const next = curr.includes(opt.id)
                                ? curr.filter((x) => x !== opt.id)
                                : [...curr, opt.id];
                              updateQuestion({ correctAnswer: { optionIds: next } });
                            }
                          }}
                        >
                          <Text style={[s.checkText, isSelected && s.checkTextActive]}>
                            {isSelected ? "✓" : "○"}
                          </Text>
                        </Pressable>

                        <TextInput
                          accessibilityLabel={uiText("Lựa chọn {0}", [optIdx + 1])}
                          style={[s.input, s.optionInput]}
                          value={opt.text}
                          onChangeText={(newText) => {
                            const newOpts = currentQ.options!.map((o) =>
                              o.id === opt.id ? { ...o, text: newText } : o,
                            );
                            updateQuestion({ options: newOpts });
                          }}
                        />
                      </View>
                    );
                  })}
                </View>
              )}

              {currentQ.type === "TRUE_FALSE" && (
                <View style={s.optionsBox}>
                  <Text style={s.fieldLabel}>{uiText("Đáp án đúng:")}</Text>
                  <Text style={s.tfText}>
                    {"value" in currentQ.correctAnswer && currentQ.correctAnswer.value
                      ? uiText("● ĐÚNG")
                      : "● SAI"}
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* Validation Checklist */}
          {validationErrors.length > 0 && (
            <View style={s.errorBox}>
              <Text style={s.errorTitle}>{uiText("Lưu ý trước khi phê duyệt:")}</Text>
              {validationErrors.map((e, idx) => (
                <Text key={idx} style={s.errorText}>
                  • {e}
                </Text>
              ))}
            </View>
          )}

          {/* Approval Action */}
          <Button
            label={approving ? uiText("Đang phê duyệt…") : uiText("Phê duyệt & Nhập vào Assessment")}
            onPress={() => void handleApprove()}
          />
        </View>
      )}

      <Button label={uiText("Quay lại Trợ lý AI")} onPress={() => router.back()} />
    </Page>
  );
}

const s = StyleSheet.create({
  centerBox: {
    padding: 32,
    alignItems: "center",
    gap: 8,
  },
  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  stateHeading: {
    fontSize: 16,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeDraft: { backgroundColor: "#fef3c7" },
  badgeApproved: { backgroundColor: "#dcfce7" },
  badgeFailed: { backgroundColor: "#fee2e2" },
  badgeProcessing: { backgroundColor: "#e0e7ff" },
  badgeText: { fontSize: 11, fontWeight: "700" },
  workingBox: {
    padding: 16,
    alignItems: "center",
    gap: 10,
    marginVertical: 8,
  },
  failedBox: {
    padding: 12,
    backgroundColor: "#fef2f2",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fca5a5",
    gap: 8,
    marginVertical: 8,
  },
  failedText: {
    fontSize: 13,
    color: "#b91c1c",
  },
  approvalCard: {
    backgroundColor: "#f0fdf4",
    borderColor: "#86efac",
    gap: 8,
  },
  approvalTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#15803d",
  },
  approvalDesc: {
    fontSize: 13,
    color: tokens.color.ink,
  },
  draftSection: {
    gap: 10,
    marginTop: 6,
  },
  draftHeader: {
    gap: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  chipRow: {
    flexDirection: "row",
    gap: 6,
    paddingVertical: 4,
  },
  numChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  numChipActive: {
    backgroundColor: tokens.color.brand,
    borderColor: tokens.color.brand,
  },
  numChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.color.ink,
  },
  numChipTextActive: {
    color: "#fff",
  },
  editorCard: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: tokens.color.border,
    gap: 8,
  },
  qOrder: {
    fontSize: 14,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  cogBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: "#f1f5f9",
  },
  cogText: {
    fontSize: 11,
    fontWeight: "600",
    color: tokens.color.brand,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.color.ink,
  },
  input: {
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: 8,
    padding: 10,
    fontSize: 13,
    backgroundColor: "#fafafa",
    color: tokens.color.ink,
  },
  textArea: {
    minHeight: 64,
    textAlignVertical: "top",
  },
  optionsBox: {
    gap: 8,
    marginTop: 4,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  checkBtn: {
    width: 30,
    height: 30,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: tokens.color.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  checkBtnActive: {
    backgroundColor: tokens.color.brand,
    borderColor: tokens.color.brand,
  },
  checkText: {
    fontSize: 15,
    color: tokens.color.muted,
  },
  checkTextActive: {
    color: "#fff",
    fontWeight: "700",
  },
  optionInput: {
    flex: 1,
  },
  tfText: {
    fontSize: 14,
    fontWeight: "700",
    color: tokens.color.brand,
  },
  errorBox: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fca5a5",
    gap: 4,
  },
  errorTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#991b1b",
  },
  errorText: {
    fontSize: 11,
    color: "#b91c1c",
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
});
