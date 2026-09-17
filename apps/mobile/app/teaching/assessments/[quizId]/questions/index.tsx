import { useEffect, useState, useMemo } from "react";
import { Text, View, TextInput, Pressable, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import { useSyncExternalStore } from "react";
import { ApiError } from "../../../../../src/api";
import { runtime } from "../../../../../src/runtime";
import {
  authoringQuiz,
  blankQuestion,
  cleanQuestion,
  validateAuthoringQuestions,
  type AuthoringQuiz,
  type AuthoringQuestion,
  type QuestionType,
} from "../../../../../src/assessment-authoring";
import { Page, Button, styles, tokens } from "../../../../../src/ui";

export default function QuestionsEditorScreen() {
  const { quizId } = useLocalSearchParams<{ quizId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [quiz, setQuiz] = useState<AuthoringQuiz | null>(null);
  const [questions, setQuestions] = useState<AuthoringQuestion[]>([]);
  const [selected, setSelected] = useState(0);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!quizId || snapshot.user?.role !== "LECTURER") return;
    const abort = new AbortController();
    setLoading(true);
    setError("");

    session
      .request(`/api/v1/quizzes/${quizId}`, { signal: abort.signal })
      .then((data: unknown) => {
        if (!abort.signal.aborted) {
          const q = authoringQuiz(data);
          setQuiz(q);
          setQuestions(q.questions.length > 0 ? q.questions : [blankQuestion()]);
          setSelected(0);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted) {
          setError(e instanceof ApiError ? e.message : "Không thể tải câu hỏi.");
          setLoading(false);
        }
      });

    return () => abort.abort();
  }, [session, quizId, snapshot.user?.role]);

  const errors = useMemo(() => validateAuthoringQuestions(questions), [questions]);
  const editable = quiz?.state === "DRAFT";

  const updateQuestion = (patch: Partial<AuthoringQuestion>) => {
    setQuestions((prev) => prev.map((q, i) => (i === selected ? { ...q, ...patch } : q)));
    setDirty(true);
    if (msg) setMsg("");
  };

  const handleAddQuestion = () => {
    const nextIndex = questions.length;
    setQuestions((prev) => [...prev, blankQuestion()]);
    setSelected(nextIndex);
    setDirty(true);
  };

  const handleRemoveQuestion = (idx: number) => {
    if (questions.length <= 1) {
      setError("Bài kiểm tra cần có ít nhất 1 câu hỏi.");
      return;
    }
    setQuestions((prev) => prev.filter((_, i) => i !== idx));
    setSelected((prev) => (prev >= idx ? Math.max(0, prev - 1) : prev));
    setDirty(true);
  };

  const handleSave = async () => {
    if (errors.length > 0) {
      setError("Vui lòng khắc phục các lỗi trước khi lưu.");
      return;
    }
    if (!quiz) return;

    setSaving(true);
    setError("");
    setMsg("");

    try {
      const res = await session.request(`/api/v1/quizzes/${quizId}`, {
        method: "PATCH",
        idempotencyKey: Crypto.randomUUID(),
        body: {
          title: quiz.title,
          questions: questions.map(cleanQuestion),
        },
      });

      const updated = authoringQuiz(res);
      setQuiz(updated);
      setQuestions(updated.questions);
      setDirty(false);
      setSaving(false);
      setMsg(`Đã lưu thành công phiên bản v${updated.currentVersion}!`);
    } catch (e: unknown) {
      setSaving(false);
      if (e instanceof ApiError && e.status === 409) {
        setError("Bài kiểm tra đã được cập nhật ở phiên làm việc khác. Vui lòng tải lại.");
      } else {
        setError(e instanceof ApiError ? e.message : "Không thể lưu câu hỏi.");
      }
    }
  };

  const currentQ = questions[selected] as AuthoringQuestion | undefined;

  return (
    <Page>
      <Text style={styles.title}>Soạn câu hỏi</Text>
      <Text style={styles.small}>
        {quiz?.title ?? "Bài kiểm tra"} · {questions.length} câu hỏi
      </Text>

      {loading && (
        <View style={s.centerBox}>
          <ActivityIndicator color={tokens.color.brand} />
          <Text style={styles.small}>Đang tải câu hỏi…</Text>
        </View>
      )}

      {error ? (
        <View style={styles.card}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : null}

      {msg ? (
        <View style={[styles.card, s.successCard]}>
          <Text style={s.successText}>{msg}</Text>
        </View>
      ) : null}

      {!loading && (
        <>
          {/* Question Index Tabs */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
            {questions.map((_, i) => (
              <Pressable
                key={i}
                accessibilityRole="button"
                accessibilityLabel={`Câu hỏi ${i + 1}`}
                style={[s.numChip, selected === i && s.numChipActive]}
                onPress={() => setSelected(i)}
              >
                <Text style={[s.numChipText, selected === i && s.numChipTextActive]}>Câu {i + 1}</Text>
              </Pressable>
            ))}
            {editable && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Thêm câu hỏi mới"
                style={s.addChip}
                onPress={handleAddQuestion}
              >
                <Text style={s.addChipText}>+ Thêm câu</Text>
              </Pressable>
            )}
          </ScrollView>

          {/* Current Question Editor */}
          {currentQ && (
            <View style={s.editorCard}>
              <View style={s.editorHeader}>
                <Text style={s.editorTitle}>
                  Câu {selected + 1} / {questions.length}
                </Text>
                {editable && questions.length > 1 && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Xóa câu hỏi này"
                    onPress={() => handleRemoveQuestion(selected)}
                  >
                    <Text style={s.deleteText}>✕ Xóa câu</Text>
                  </Pressable>
                )}
              </View>

              {/* Question Type */}
              <Text style={s.fieldLabel}>Loại câu hỏi:</Text>
              <View style={s.typeGrid}>
                {(
                  [
                    ["SINGLE_CHOICE", "Một đáp án"],
                    ["MULTIPLE_CHOICE", "Nhiều đáp án"],
                    ["TRUE_FALSE", "Đúng / Sai"],
                    ["SHORT_ANSWER", "Trả lời ngắn"],
                  ] as [QuestionType, string][]
                ).map(([t, label]) => (
                  <Pressable
                    key={t}
                    disabled={!editable}
                    style={[s.typeBtn, currentQ.questionType === t && s.typeBtnActive]}
                    onPress={() => updateQuestion(blankQuestion(t))}
                  >
                    <Text style={[s.typeBtnText, currentQ.questionType === t && s.typeBtnTextActive]}>
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* Prompt */}
              <Text style={s.fieldLabel}>Nội dung câu hỏi *</Text>
              <TextInput
                accessibilityLabel="Nội dung câu hỏi"
                multiline
                numberOfLines={3}
                style={[s.input, s.textArea]}
                placeholder="Nhập nội dung câu hỏi..."
                value={currentQ.prompt}
                onChangeText={(text) => updateQuestion({ prompt: text })}
                editable={editable}
              />

              {/* Points */}
              <Text style={s.fieldLabel}>Điểm (1-100):</Text>
              <TextInput
                accessibilityLabel="Điểm câu hỏi"
                keyboardType="decimal-pad"
                style={s.input}
                value={currentQ.points}
                onChangeText={(text) => updateQuestion({ points: text })}
                editable={editable}
              />

              {/* Options for Choice questions */}
              {(currentQ.questionType === "SINGLE_CHOICE" || currentQ.questionType === "MULTIPLE_CHOICE") && (
                <View style={s.optionsSection}>
                  <Text style={s.fieldLabel}>Các lựa chọn & Đáp án đúng *</Text>
                  {currentQ.options?.map((opt, optIdx) => {
                    const isCorrect =
                      currentQ.questionType === "SINGLE_CHOICE"
                        ? currentQ.correctAnswer === opt && opt.length > 0
                        : Array.isArray(currentQ.correctAnswer) &&
                          currentQ.correctAnswer.includes(opt) &&
                          opt.length > 0;

                    return (
                      <View key={optIdx} style={s.optionRow}>
                        <Pressable
                          disabled={!editable}
                          accessibilityRole="checkbox"
                          style={[s.checkBtn, isCorrect && s.checkBtnActive]}
                          onPress={() => {
                            if (currentQ.questionType === "SINGLE_CHOICE") {
                              updateQuestion({ correctAnswer: opt });
                            } else {
                              const curr = Array.isArray(currentQ.correctAnswer)
                                ? [...currentQ.correctAnswer]
                                : [];
                              const next = curr.includes(opt)
                                ? curr.filter((x) => x !== opt)
                                : [...curr, opt];
                              updateQuestion({ correctAnswer: next });
                            }
                          }}
                        >
                          <Text style={[s.checkText, isCorrect && s.checkTextActive]}>
                            {isCorrect ? "✓" : "○"}
                          </Text>
                        </Pressable>

                        <TextInput
                          accessibilityLabel={`Lựa chọn ${optIdx + 1}`}
                          style={[s.input, s.optionInput]}
                          placeholder={`Lựa chọn ${optIdx + 1}`}
                          value={opt}
                          onChangeText={(newText) => {
                            const newOptions = [...(currentQ.options ?? [])];
                            const oldVal = newOptions[optIdx];
                            newOptions[optIdx] = newText;

                            let newAns = currentQ.correctAnswer;
                            if (currentQ.questionType === "SINGLE_CHOICE" && newAns === oldVal) {
                              newAns = newText;
                            } else if (Array.isArray(newAns)) {
                              newAns = newAns.map((a) => (a === oldVal ? newText : a));
                            }
                            updateQuestion({ options: newOptions, correctAnswer: newAns });
                          }}
                          editable={editable}
                        />

                        {editable && (currentQ.options?.length ?? 0) > 2 && (
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => {
                              const newOptions = currentQ.options?.filter((_, i) => i !== optIdx);
                              updateQuestion({ options: newOptions });
                            }}
                          >
                            <Text style={s.deleteText}>✕</Text>
                          </Pressable>
                        )}
                      </View>
                    );
                  })}

                  {editable && (currentQ.options?.length ?? 0) < 10 && (
                    <Button
                      label="+ Thêm lựa chọn"
                      onPress={() => updateQuestion({ options: [...(currentQ.options ?? []), ""] })}
                    />
                  )}
                </View>
              )}

              {/* True / False answer */}
              {currentQ.questionType === "TRUE_FALSE" && (
                <View style={s.optionsSection}>
                  <Text style={s.fieldLabel}>Đáp án đúng *</Text>
                  <View style={s.radioRow}>
                    <Pressable
                      disabled={!editable}
                      style={[s.radioBtn, currentQ.correctAnswer === true && s.radioBtnActive]}
                      onPress={() => updateQuestion({ correctAnswer: true })}
                    >
                      <Text style={[s.radioBtnText, currentQ.correctAnswer === true && s.radioBtnTextActive]}>
                        ● ĐÚNG
                      </Text>
                    </Pressable>
                    <Pressable
                      disabled={!editable}
                      style={[s.radioBtn, currentQ.correctAnswer === false && s.radioBtnActive]}
                      onPress={() => updateQuestion({ correctAnswer: false })}
                    >
                      <Text
                        style={[s.radioBtnText, currentQ.correctAnswer === false && s.radioBtnTextActive]}
                      >
                        ● SAI
                      </Text>
                    </Pressable>
                  </View>
                </View>
              )}

              {/* Short answer */}
              {currentQ.questionType === "SHORT_ANSWER" && (
                <View style={s.optionsSection}>
                  <Text style={s.fieldLabel}>Đáp án mẫu được chấp nhận *</Text>
                  <TextInput
                    accessibilityLabel="Đáp án mẫu"
                    style={s.input}
                    placeholder="Nhập đáp án chính xác..."
                    value={String(currentQ.correctAnswer ?? "")}
                    onChangeText={(text) => updateQuestion({ correctAnswer: text })}
                    editable={editable}
                  />
                </View>
              )}
            </View>
          )}

          {/* Validation Warnings */}
          {errors.length > 0 && (
            <View style={s.errorBox}>
              <Text style={s.errorTitle}>Lưu ý kiểm tra ({errors.length}):</Text>
              {errors.slice(0, 3).map((e, idx) => (
                <Text key={idx} style={s.errorText}>
                  • {e}
                </Text>
              ))}
              {errors.length > 3 && <Text style={s.errorText}>... và {errors.length - 3} lưu ý khác.</Text>}
            </View>
          )}

          {/* Save Action */}
          {editable && (
            <Button
              label={saving ? "Đang lưu câu hỏi…" : dirty ? "Lưu thay đổi" : "Đã lưu thay đổi"}
              onPress={() => void handleSave()}
            />
          )}

          {!editable && (
            <View style={s.noticeCard}>
              <Text style={s.noticeText}>
                Bài kiểm tra đã xuất bản ({quiz?.state}). Không thể chỉnh sửa câu hỏi trực tiếp.
              </Text>
            </View>
          )}
        </>
      )}

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
  chipRow: {
    flexDirection: "row",
    gap: 6,
    paddingVertical: 6,
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
  addChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#e6f4fe",
    borderWidth: 1,
    borderColor: tokens.color.brand,
  },
  addChipText: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.color.brand,
  },
  editorCard: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: tokens.color.border,
    gap: 10,
    marginVertical: 6,
  },
  editorHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  editorTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: tokens.color.ink,
  },
  deleteText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#dc2626",
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.color.ink,
    marginTop: 4,
  },
  typeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  typeBtn: {
    flexBasis: "48%",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: tokens.color.border,
    backgroundColor: "#f8fafc",
    alignItems: "center",
  },
  typeBtnActive: {
    backgroundColor: tokens.color.brand,
    borderColor: tokens.color.brand,
  },
  typeBtnText: {
    fontSize: 12,
    color: tokens.color.ink,
  },
  typeBtnTextActive: {
    color: "#fff",
    fontWeight: "700",
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
    minHeight: 72,
    textAlignVertical: "top",
  },
  optionsSection: {
    gap: 8,
    marginTop: 4,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  checkBtn: {
    width: 32,
    height: 32,
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
    fontSize: 16,
    color: tokens.color.muted,
  },
  checkTextActive: {
    color: "#fff",
    fontWeight: "700",
  },
  optionInput: {
    flex: 1,
  },
  radioRow: {
    flexDirection: "row",
    gap: 12,
  },
  radioBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: tokens.color.border,
    backgroundColor: "#fff",
  },
  radioBtnActive: {
    backgroundColor: "#dcfce7",
    borderColor: "#16a34a",
  },
  radioBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: tokens.color.ink,
  },
  radioBtnTextActive: {
    color: "#15803d",
    fontWeight: "700",
  },
  errorBox: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fca5a5",
    gap: 4,
    marginVertical: 4,
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
  noticeCard: {
    padding: 12,
    borderRadius: 8,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: tokens.color.border,
    marginVertical: 4,
  },
  noticeText: {
    fontSize: 12,
    color: tokens.color.ink,
  },
});
