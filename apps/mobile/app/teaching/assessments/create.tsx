import { useUiText } from "../../../src/use-language";
import { useState } from "react";
import { Text, View, TextInput, StyleSheet } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import { ApiError } from "../../../src/api";
import { runtime } from "../../../src/runtime";
import { authoringQuiz } from "../../../src/assessment-authoring";
import { Page, Button, ScreenHeader, styles, tokens } from "../../../src/ui";

export default function CreateAssessmentScreen() {
  const uiText = useUiText();
  const params = useLocalSearchParams<{ targetType?: string; targetId?: string }>();
  const session = runtime!;

  const [title, setTitle] = useState("");
  const [targetType, setTargetType] = useState<"COURSE" | "CLASS">(
    params.targetType === "CLASS" ? "CLASS" : "COURSE",
  );
  const [targetId, setTargetId] = useState(params.targetId ?? "");
  const [deadline, setDeadline] = useState("");

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
          ...(deadline.trim() ? { closesAt: new Date(deadline).toISOString() } : {}),
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
        title={uiText("Tạo bài kiểm tra")}
        subtitle={uiText("Tạo bản nháp bài kiểm tra mới và thêm câu hỏi sau đó")}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/teaching/assessments"))}
      />

      <View style={s.formCard}>
        <Text style={s.label}>{uiText("Tên bài kiểm tra *")}</Text>
        <TextInput
          accessibilityLabel={uiText("Tên bài kiểm tra")}
          style={s.input}
          placeholder={uiText("Ví dụ: Kiểm tra giữa kỳ môn JavaScript")}
          value={title}
          onChangeText={(v) => {
            setTitle(v);
            if (error) setError("");
          }}
          editable={!busy}
        />

        <Text style={styles.small}>
          {uiText(
            "Bài kiểm tra khách quan gồm trắc nghiệm và câu trả lời ngắn. Bài tự luận dài/nộp file chưa được hỗ trợ.",
          )}
        </Text>
        <Text style={s.label}>{uiText("Hạn đóng bài (ISO 8601, có múi giờ)")}</Text>
        <TextInput
          accessibilityLabel={uiText("Hạn đóng bài")}
          style={s.input}
          value={deadline}
          onChangeText={setDeadline}
          placeholder="2026-10-20T23:59:00+07:00"
        />
        <Text style={s.label}>{uiText("Loại đối tượng liên kết")}</Text>
        <View style={s.radioRow}>
          <Button
            label={targetType === "COURSE" ? uiText("● Khóa học (COURSE)") : uiText("○ Khóa học (COURSE)")}
            onPress={() => setTargetType("COURSE")}
          />
          <Button
            label={targetType === "CLASS" ? uiText("● Lớp học (CLASS)") : uiText("○ Lớp học (CLASS)")}
            onPress={() => setTargetType("CLASS")}
          />
        </View>

        <Text style={s.label}>{uiText("Mã đối tượng (Target ID) *")}</Text>
        <TextInput
          accessibilityLabel={uiText("Mã đối tượng")}
          style={s.input}
          placeholder={uiText("Mã khóa học hoặc lớp học")}
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
          <Text style={styles.error}>{uiText(error)}</Text>
        </View>
      ) : null}

      <Button
        label={busy ? uiText("Đang tạo bản nháp…") : uiText("Tạo bản nháp bài kiểm tra")}
        onPress={() => void handleCreate()}
      />

      <Button label={uiText("Hủy")} onPress={() => router.back()} />
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
