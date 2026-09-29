import { useEffect, useState, useCallback } from "react";
import { Text, Pressable, StyleSheet } from "react-native";
import { router, type Href } from "expo-router";
import { useSyncExternalStore } from "react";
import { ApiError } from "../../../src/api";
import { runtime } from "../../../src/runtime";
import { lecturerCourse } from "../../../src/teaching";
import { Page, Button, ScreenHeader, NonVirtualizedList, styles, tokens } from "../../../src/ui";

export default function OwnedCoursesList() {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [courses, setCourses] = useState<{ courseId: string; title: string }[] | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (snapshot.user?.role !== "LECTURER") return;
    const abort = new AbortController();
    setError("");
    setCourses(null);
    void session
      .request("/api/v1/me/owned-courses", { signal: abort.signal })
      .then((value) => {
        if (!abort.signal.aborted) {
          setCourses(Array.isArray(value) ? value.map((item) => lecturerCourse(item)) : []);
        }
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted)
          setError(e instanceof ApiError ? e.message : "Không thể tải danh sách khóa học.");
      });
    return () => abort.abort();
  }, [session, snapshot.user?.userId, retry]);

  const handleRetry = useCallback(() => setRetry((v) => v + 1), []);

  if (snapshot.user?.role !== "LECTURER") {
    return (
      <Page>
        <Text style={styles.error}>Chức năng này chỉ dành cho Giảng viên.</Text>
        <Button label="Về trang chủ" onPress={() => router.replace("/")} />
      </Page>
    );
  }

  const renderCourse = ({ item }: { item: { courseId: string; title: string } }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Khóa học ${item.title}`}
      style={cs.card}
      onPress={() => router.push(`/teaching/courses/${item.courseId}` as Href)}
    >
      <Text style={cs.name} numberOfLines={2}>
        {item.title}
      </Text>
    </Pressable>
  );

  return (
    <Page>
      <ScreenHeader
        title="Khóa giảng dạy"
        subtitle={`${courses?.length ?? 0} khóa học`}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/teaching"))}
        rightElement={
          <Button
            label="+ Tạo mới"
            size="sm"
            onPress={() => router.push("/teaching/courses/create" as Href)}
          />
        }
      />

      {!error && courses === null && (
        <Text accessibilityRole="alert" style={styles.text}>
          Đang tải…
        </Text>
      )}
      {courses && courses.length === 0 && <Text style={styles.text}>Bạn chưa có khóa học nào.</Text>}
      {courses && courses.length > 0 && (
        <NonVirtualizedList
          data={courses}
          keyExtractor={(item) => item.courseId}
          renderItem={renderCourse}
          contentContainerStyle={{ gap: 12 }}
        />
      )}

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

const cs = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  name: {
    fontSize: 16,
    fontWeight: "600",
    color: tokens.color.ink,
  },
});
