import { useUiText } from "../../../../../src/use-language";
import { useState, useCallback } from "react";
import { Text, TextInput, Switch, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSyncExternalStore } from "react";
import * as Crypto from "expo-crypto";
import { ApiError } from "../../../../../src/api";
import { runtime } from "../../../../../src/runtime";
import { CONTRACT_LIMITED } from "../../../../../src/teaching";
import { Page, Button, styles } from "../../../../../src/ui";

export default function CreateLesson() {
  const uiText = useUiText();
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [title, setTitle] = useState("");
  const [sectionTitle, setSectionTitle] = useState("");
  const [sectionOrder, setSectionOrder] = useState("1");
  const [lessonOrder, setLessonOrder] = useState("1");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => Crypto.randomUUID());

  const handleCreate = useCallback(async () => {
    if (!courseId || !title.trim()) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await session.request(`/api/v1/courses/${courseId}/lessons`, {
        method: "POST",
        body: {
          title: title.trim(),
          sectionTitle: sectionTitle.trim() || "Chương 1",
          position: {
            sectionOrder: Number(sectionOrder) || 1,
            lessonOrder: Number(lessonOrder) || 1,
          },
          preview,
        },
        idempotencyKey,
      });
      setMessage("Đã tạo bài học thành công.");
      setIdempotencyKey(Crypto.randomUUID());
      setTitle("");
      setSectionTitle("");
      setPreview(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không thể tạo bài học.");
    } finally {
      setBusy(false);
    }
  }, [courseId, title, sectionTitle, sectionOrder, lessonOrder, preview, session, idempotencyKey]);

  if (snapshot.user?.role !== "LECTURER") {
    return (
      <Page>
        <Text style={styles.error}>{uiText("Bạn không có quyền truy cập.")}</Text>
        <Button label={uiText("Về trang chủ")} onPress={() => router.replace("/")} />
      </Page>
    );
  }

  return (
    <Page>
      <Text style={styles.title}>{uiText("Tạo bài học mới")}</Text>

      <Text style={styles.small}>{uiText("Tên bài học *")}</Text>
      <TextInput
        accessibilityLabel={uiText("Tên bài học")}
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        maxLength={200}
      />

      <Text style={styles.small}>{uiText("Tên chương")}</Text>
      <TextInput
        accessibilityLabel={uiText("Tên chương")}
        style={styles.input}
        value={sectionTitle}
        onChangeText={setSectionTitle}
        maxLength={200}
      />

      <Text style={styles.small}>{uiText("Thứ tự chương")}</Text>
      <TextInput
        accessibilityLabel={uiText("Thứ tự chương")}
        style={styles.input}
        value={sectionOrder}
        onChangeText={setSectionOrder}
        keyboardType="numeric"
      />

      <Text style={styles.small}>{uiText("Thứ tự bài")}</Text>
      <TextInput
        accessibilityLabel={uiText("Thứ tự bài")}
        style={styles.input}
        value={lessonOrder}
        onChangeText={setLessonOrder}
        keyboardType="numeric"
      />

      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Text style={styles.text}>{uiText("Cho xem trước")}</Text>
        <Switch value={preview} onValueChange={setPreview} />
      </View>

      <Text style={styles.small}>{CONTRACT_LIMITED.lessonFileUpload}</Text>

      <Button
        label={busy ? uiText("Đang tạo…") : uiText("Tạo bài học")}
        disabled={busy || !title.trim()}
        onPress={() => {
          void handleCreate();
        }}
      />

      {message && <Text style={styles.text}>{uiText(message)}</Text>}
      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {uiText(error)}
        </Text>
      )}
      <Button
        label={uiText("Quay lại")}
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
      />
    </Page>
  );
}
