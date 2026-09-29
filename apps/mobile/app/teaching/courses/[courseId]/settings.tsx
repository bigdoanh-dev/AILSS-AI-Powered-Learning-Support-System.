import { useEffect, useState } from "react";
import { Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSyncExternalStore } from "react";
import * as Crypto from "expo-crypto";
import { ApiError } from "../../../../src/api";
import { runtime } from "../../../../src/runtime";
import { lecturerCourse, type LecturerCourse } from "../../../../src/teaching";
import { Page, Button, ScreenHeader, styles } from "../../../../src/ui";

export default function CourseSettings() {
  const { courseId } = useLocalSearchParams<{ courseId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [course, setCourse] = useState<LecturerCourse | null>(null);
  const [mode, setMode] = useState<"LOCK" | "DELETE" | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!courseId || snapshot.user?.role !== "LECTURER") return;
    const abort = new AbortController();
    void session
      .request(`/api/v1/me/courses/${courseId}`, { signal: abort.signal })
      .then((value) => {
        if (!abort.signal.aborted) setCourse(lecturerCourse(value));
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted)
          setMessage(error instanceof ApiError ? error.message : "Không thể tải khóa học.");
      });
    return () => abort.abort();
  }, [courseId, session, snapshot.user?.role]);

  async function submit() {
    if (!course || !mode || confirmation !== course.title || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = lecturerCourse(
        await session.request(`/api/v1/courses/${courseId}/retire`, {
          method: "POST",
          body: { mode },
          idempotencyKey: Crypto.randomUUID(),
        }),
      );
      setCourse({ ...result, activeStudentCount: course.activeStudentCount });
      setMode(null);
      setConfirmation("");
      setMessage(
        result.state === "DELETED"
          ? "Đã xóa bản nháp khóa học."
          : "Đã ẩn khóa học; học viên hiện tại vẫn tiếp tục học.",
      );
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Không thể xử lý yêu cầu.");
    } finally {
      setBusy(false);
    }
  }

  if (snapshot.user?.role !== "LECTURER")
    return (
      <Page>
        <Text style={styles.error}>Bạn không có quyền truy cập.</Text>
      </Page>
    );
  return (
    <Page>
      <ScreenHeader
        title="Cài đặt khóa học"
        subtitle={course?.title ?? "Đang tải…"}
        onBack={() => router.back()}
      />
      {course && (
        <View style={styles.card}>
          <Text style={styles.text}>
            Trạng thái: {course.state} · {course.activeStudentCount ?? 0} học viên đang có quyền học
          </Text>
          <Text style={styles.text}>
            Khóa học đã xuất bản sẽ ẩn khỏi danh mục và ngừng nhận học viên mới. Học viên đã đăng ký vẫn học,
            làm bài và giữ tiến độ. Lớp học, đơn hàng và lịch sử thanh toán được bảo toàn.
          </Text>
          {!["DELETED", "ARCHIVED"].includes(course.state ?? "") &&
            (course.state !== "HIDDEN" || !course.publishedAt) && (
              <>
                {course.state !== "HIDDEN" && (
                  <Button
                    label="Yêu cầu khóa học"
                    variant="outline"
                    onPress={() => {
                      setMode("LOCK");
                      setConfirmation("");
                    }}
                  />
                )}
                <Button
                  label="Yêu cầu xóa khóa học"
                  variant="outline"
                  onPress={() => {
                    setMode("DELETE");
                    setConfirmation("");
                  }}
                />
              </>
            )}
          {mode && (
            <View>
              <Text style={styles.text}>
                {mode === "DELETE" && course.state !== "PUBLISHED"
                  ? "Bản nháp sẽ được xóa mềm."
                  : "Khóa học sẽ được ẩn để bảo toàn quyền học của học viên cũ."}{" "}
                Nhập chính xác tên khóa học để xác nhận.
              </Text>
              <TextInput
                accessibilityLabel="Nhập tên khóa học để xác nhận"
                value={confirmation}
                onChangeText={setConfirmation}
                placeholder={course.title}
                style={{
                  borderWidth: 1,
                  borderColor: "#64748b",
                  borderRadius: 8,
                  padding: 12,
                  color: "#e2e8f0",
                  marginVertical: 12,
                }}
              />
              <Button
                label={busy ? "Đang xử lý…" : "Xác nhận yêu cầu"}
                disabled={busy || confirmation !== course.title}
                onPress={() => void submit()}
              />
              <Button label="Hủy" variant="outline" onPress={() => setMode(null)} />
            </View>
          )}
        </View>
      )}
      {message ? (
        <Text accessibilityRole="alert" style={styles.text}>
          {message}
        </Text>
      ) : null}
    </Page>
  );
}
