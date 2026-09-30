import { useState } from "react";
import { Text, View, TextInput, StyleSheet } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import { ApiError } from "../../../src/api";
import { runtime } from "../../../src/runtime";
import { authoringQuiz } from "../../../src/assessment-authoring";
import { Page, Button, ScreenHeader, styles, tokens } from "../../../src/ui";

export default function CreateAssessmentScreen() {
  const params = useLocalSearchParams<{ targetType?: string; targetId?: string }>();
  const session = runtime!;

  const [title, setTitle] = useState("");
  const [targetType, setTargetType] = useState<"COURSE" | "CLASS">(
    params.targetType === "CLASS" ? "CLASS" : "COURSE",
  );
  const [targetId, setTargetId] = useState(params.targetId ?? "");
  const [format, setFormat] = useState<"OBJECTIVE_QUIZ" | "ESSAY" | "PROJECT_FILE">("OBJECTIVE_QUIZ");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async () => {
    if (!title.trim()) {
      setError("Vui lòng nhập tên bài kiểm tra.");
      return;
    }
    if (!targetId.trim()) {
      setError("Vui lòng nhập mã đối tượng (khóa học hoặc lớp).");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const idempotencyKey = Crypto.randomUUID();
      const res = await session.request("/api/v1/quizzes", {
        method: "POST",
        idempotencyKey,
        body: {
          title: title.trim(),
          targetType,
          targetId: targetId.trim(),
          questions: [],
        },
      });

      const quiz = authoringQuiz(res);
      router.replace(`/teaching/assessments/${quiz.quizId}`);
    } catch (e: unknown) {
      setBusy(false);
      setError(e instanceof ApiError ? e.message : "Không thể tạo bài kiểm tra.");
    }
  };

  return (
    <Page>
      <ScreenHeader
        title="Tạo bài kiểm tra"
        subtitle="Tạo bản nháp bài kiểm tra mới và thêm câu hỏi sau đó"
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/teaching/assessments"))}
      />

      <View style={s.formCard}>
        <Text style={s.label}>Tên bài kiểm tra *</Text>
        <TextInput
          accessibilityLabel="Tên bài kiểm tra"
          style={s.input}
          placeholder="Ví dụ: Kiểm tra giữa kỳ môn JavaScript"
          value={title}
          onChangeText={(v) => {
            setTitle(v);
            if (error) setError("");
          }}
          editable={!busy}
        />

        <Text style={s.label}>Hình thức & Chế độ chấm điểm</Text>
        <View style={{ gap: 8, marginVertical: 4 }}>
          <Button
            label={
              format === "OBJECTIVE_QUIZ"
                ? "● ⚡ Trắc nghiệm (Hệ thống chấm tự động)"
                : "○ ⚡ Trắc nghiệm (Hệ thống chấm tự động)"
            }
            onPress={() => setFormat("OBJECTIVE_QUIZ")}
          />
          <Button
            label={
              format === "ESSAY"
                ? "● ✍️ Tự luận (Giảng viên chấm thủ công)"
                : "○ ✍️ Tự luận (Giảng viên chấm thủ công)"
            }
            onPress={() => setFormat("ESSAY")}
          />
          <Button
            label={
              format === "PROJECT_FILE"
                ? "● 📁 Đồ án / Nộp file (Giảng viên chấm thủ công)"
                : "○ 📁 Đồ án / Nộp file (Giảng viên chấm thủ công)"
            }
            onPress={() => setFormat("PROJECT_FILE")}
          />
        </View>

        <Text style={s.label}>Loại đối tượng liên kết</Text>
        <View style={s.radioRow}>
          <Button
            label={targetType === "COURSE" ? "● Khóa học (COURSE)" : "○ Khóa học (COURSE)"}
            onPress={() => setTargetType("COURSE")}
          />
          <Button
            label={targetType === "CLASS" ? "● Lớp học (CLASS)" : "○ Lớp học (CLASS)"}
            onPress={() => setTargetType("CLASS")}
          />
        </View>

        <Text style={s.label}>Mã đối tượng (Target ID) *</Text>
        <TextInput
          accessibilityLabel="Mã đối tượng"
          style={s.input}
          placeholder="Mã khóa học hoặc lớp học"
          value={targetId}
          onChangeText={(v) => {
            setTargetId(v);
            if (error) setError("");
          }}
          editable={!busy}
          autoCapitalize="none"
        />
      </View>

      {error ? (
        <View style={styles.card}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : null}

      <Button
        label={busy ? "Đang tạo bản nháp…" : "Tạo bản nháp bài kiểm tra"}
        onPress={() => void handleCreate()}
      />

      <Button label="Hủy" onPress={() => router.back()} />
    </Page>
  );
}

const s = StyleSheet.create({
  formCard: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: tokens.color.border,
    gap: 10,
    marginVertical: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: tokens.color.ink,
  },
  input: {
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    backgroundColor: "#fafafa",
    color: tokens.color.ink,
  },
  radioRow: {
    gap: 8,
  },
});
