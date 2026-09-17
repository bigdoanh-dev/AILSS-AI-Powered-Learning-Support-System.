import { useEffect, useState, useCallback } from "react";
import { Text, TextInput, Switch, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSyncExternalStore } from "react";
import * as Crypto from "expo-crypto";
import { ApiError } from "../../../../../src/api";
import { runtime } from "../../../../../src/runtime";
import { lecturerLesson, type LecturerLesson, CONTRACT_LIMITED } from "../../../../../src/teaching";
import { Page, Button, styles } from "../../../../../src/ui";

export default function LessonDetailEdit() {
  const { lessonId } = useLocalSearchParams<{ lessonId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [lesson, setLesson] = useState<LecturerLesson | null>(null);
  const [title, setTitle] = useState("");
  const [sectionTitle, setSectionTitle] = useState("");
  const [sectionOrder, setSectionOrder] = useState("1");
  const [lessonOrder, setLessonOrder] = useState("1");
  const [externalVideo, setExternalVideo] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => Crypto.randomUUID());
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!lessonId || snapshot.user?.role !== "LECTURER") return;
    const abort = new AbortController();
    setError("");
    void session
      .request(`/api/v1/lessons/${lessonId}`, { signal: abort.signal })
      .then((value) => {
        if (abort.signal.aborted) return;
        const l = lecturerLesson(value);
        setLesson(l);
        setTitle(l.title);
        setSectionTitle(l.sectionTitle ?? "");
        setSectionOrder(String(l.position.sectionOrder));
        setLessonOrder(String(l.position.lessonOrder));
        setExternalVideo(l.externalVideo ?? "");
        setPreview(l.preview);
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted) setError(e instanceof ApiError ? e.message : "Không thể tải bài học.");
      });
    return () => abort.abort();
  }, [lessonId, session, snapshot.user?.userId, retry]);

  const handleSave = useCallback(async () => {
    if (!lessonId || !lesson) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const body: Record<string, unknown> = {};
      if (title !== lesson.title) body.title = title;
      if (sectionTitle !== (lesson.sectionTitle ?? "")) body.sectionTitle = sectionTitle;
      if (externalVideo !== (lesson.externalVideo ?? "")) body.externalVideo = externalVideo || null;
      if (preview !== lesson.preview) body.preview = preview;
      const newSO = Number(sectionOrder) || 1;
      const newLO = Number(lessonOrder) || 1;
      if (newSO !== lesson.position.sectionOrder || newLO !== lesson.position.lessonOrder) {
        body.position = { sectionOrder: newSO, lessonOrder: newLO };
      }

      if (Object.keys(body).length === 0) {
        setMessage("Không có thay đổi.");
        return;
      }

      await session.request(`/api/v1/lessons/${lessonId}`, {
        method: "PATCH",
        body,
        idempotencyKey,
      });
      setMessage("Đã lưu thành công.");
      setIdempotencyKey(Crypto.randomUUID());
      setRetry((v) => v + 1);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không thể lưu thay đổi.");
    } finally {
      setBusy(false);
    }
  }, [
    lessonId,
    lesson,
    title,
    sectionTitle,
    sectionOrder,
    lessonOrder,
    externalVideo,
    preview,
    session,
    idempotencyKey,
  ]);

  if (snapshot.user?.role !== "LECTURER") {
    return (
      <Page>
        <Text style={styles.error}>Bạn không có quyền truy cập.</Text>
        <Button label="Về trang chủ" onPress={() => router.replace("/")} />
      </Page>
    );
  }

  return (
    <Page>
      <Text style={styles.title}>Chi tiết bài học</Text>

      {!lesson && !error && (
        <Text accessibilityRole="alert" style={styles.text}>
          Đang tải…
        </Text>
      )}

      {lesson && (
        <>
          <View style={styles.card}>
            <Text style={styles.small}>Trạng thái: {lesson.state ?? "—"}</Text>
            <Text style={styles.small}>Loại nội dung: {lesson.contentType ?? "—"}</Text>
            {lesson.contentUrl && (
              <Text style={styles.small} numberOfLines={1}>
                URL nội dung: {lesson.contentUrl}
              </Text>
            )}
          </View>

          <Text style={styles.small}>Tên bài học</Text>
          <TextInput
            accessibilityLabel="Tên bài học"
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            maxLength={200}
          />

          <Text style={styles.small}>Tên chương</Text>
          <TextInput
            accessibilityLabel="Tên chương"
            style={styles.input}
            value={sectionTitle}
            onChangeText={setSectionTitle}
            maxLength={200}
          />

          <Text style={styles.small}>Thứ tự chương</Text>
          <TextInput
            accessibilityLabel="Thứ tự chương"
            style={styles.input}
            value={sectionOrder}
            onChangeText={setSectionOrder}
            keyboardType="numeric"
          />

          <Text style={styles.small}>Thứ tự bài</Text>
          <TextInput
            accessibilityLabel="Thứ tự bài"
            style={styles.input}
            value={lessonOrder}
            onChangeText={setLessonOrder}
            keyboardType="numeric"
          />

          <Text style={styles.small}>Video bên ngoài (URL)</Text>
          <TextInput
            accessibilityLabel="Video bên ngoài"
            style={styles.input}
            value={externalVideo}
            onChangeText={setExternalVideo}
            autoCapitalize="none"
            keyboardType="url"
          />

          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Text style={styles.text}>Cho xem trước</Text>
            <Switch value={preview} onValueChange={setPreview} />
          </View>

          <View style={{ marginTop: 8, gap: 4 }}>
            <Text style={styles.small}>{CONTRACT_LIMITED.lessonDelete}</Text>
            <Text style={styles.small}>{CONTRACT_LIMITED.lessonFileUpload}</Text>
          </View>

          <Button
            label={busy ? "Đang lưu…" : "Lưu thay đổi"}
            disabled={busy || !title.trim()}
            onPress={() => {
              void handleSave();
            }}
          />

          {message && <Text style={styles.text}>{message}</Text>}
        </>
      )}

      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {error && <Button label="Thử lại" onPress={() => setRetry((v) => v + 1)} />}
      <Button label="Quay lại" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
    </Page>
  );
}
