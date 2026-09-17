import { useEffect, useState, useCallback } from "react";
import { Text, View, Pressable, StyleSheet } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useSyncExternalStore } from "react";
import { ApiError } from "../../../../../src/api";
import { runtime } from "../../../../../src/runtime";
import { lecturerLessons, type LecturerLesson, CONTRACT_LIMITED } from "../../../../../src/teaching";
import { Page, Button, NonVirtualizedList, styles, tokens } from "../../../../../src/ui";

export default function LessonList() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [items, setItems] = useState<LecturerLesson[] | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!courseId || snapshot.user?.role !== "LECTURER") return;
    const abort = new AbortController();
    setError("");
    setItems(null);
    void session
      .request(`/api/v1/courses/${courseId}/lessons`, { signal: abort.signal })
      .then((value) => {
        if (!abort.signal.aborted) setItems(lecturerLessons(value));
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted)
          setError(e instanceof ApiError ? e.message : "Không thể tải danh sách bài học.");
      });
    return () => abort.abort();
  }, [courseId, session, snapshot.user?.userId, retry]);

  const handleRetry = useCallback(() => setRetry((v) => v + 1), []);

  if (snapshot.user?.role !== "LECTURER") {
    return (
      <Page>
        <Text style={styles.error}>Bạn không có quyền truy cập.</Text>
        <Button label="Về trang chủ" onPress={() => router.replace("/")} />
      </Page>
    );
  }

  const sorted = items
    ? [...items].sort((a, b) => {
        if (a.position.sectionOrder !== b.position.sectionOrder)
          return a.position.sectionOrder - b.position.sectionOrder;
        return a.position.lessonOrder - b.position.lessonOrder;
      })
    : null;

  const renderLesson = ({ item }: { item: LecturerLesson }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Bài học ${item.title}`}
      style={ls.card}
      onPress={() => router.push(`/teaching/courses/${courseId}/lessons/${item.lessonId}` as Href)}
    >
      <View style={ls.row}>
        <View style={ls.position}>
          <Text style={ls.posText}>
            {item.position.sectionOrder}.{item.position.lessonOrder}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={ls.lessonTitle} numberOfLines={2}>
            {item.title}
          </Text>
          {item.sectionTitle && <Text style={styles.small}>{item.sectionTitle}</Text>}
        </View>
        {item.preview && (
          <View style={ls.previewBadge}>
            <Text style={ls.previewText}>XEM TRƯỚC</Text>
          </View>
        )}
      </View>
    </Pressable>
  );

  return (
    <Page>
      <Text style={styles.title}>Bài học</Text>

      <Button
        label="Tạo bài học mới"
        onPress={() => router.push(`/teaching/courses/${courseId}/lessons/create` as Href)}
      />

      {!error && items === null && (
        <Text accessibilityRole="alert" style={styles.text}>
          Đang tải…
        </Text>
      )}
      {sorted && sorted.length === 0 && (
        <Text style={styles.text}>Chưa có bài học nào. Hãy tạo bài học đầu tiên.</Text>
      )}
      {sorted && sorted.length > 0 && (
        <NonVirtualizedList
          data={sorted}
          keyExtractor={(item) => item.lessonId}
          renderItem={renderLesson}
          contentContainerStyle={{ gap: 10 }}
        />
      )}

      <View style={{ marginTop: 8 }}>
        <Text style={styles.small}>{CONTRACT_LIMITED.lessonDelete}</Text>
        <Text style={styles.small}>{CONTRACT_LIMITED.lessonReorder}</Text>
      </View>

      {error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {error && <Button label="Thử lại" onPress={handleRetry} />}
      <Button label="Quay lại" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
    </Page>
  );
}

const ls = StyleSheet.create({
  card: {
    padding: 14,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  position: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: tokens.color.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  posText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  lessonTitle: { fontSize: 15, fontWeight: "600", color: tokens.color.ink },
  previewBadge: {
    backgroundColor: "#e0f2fe",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  previewText: { fontSize: 9, fontWeight: "700", color: "#0369a1" },
});
