import { useEffect, useState, useCallback } from "react";
import { Text, View, StyleSheet } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useSyncExternalStore } from "react";
import { ApiError } from "../../../../src/api";
import { runtime } from "../../../../src/runtime";
import { ownedClass, classMembers, type OwnedClass, type ClassMember } from "../../../../src/teaching";
import { Page, Button, ScreenHeader, NonVirtualizedList, styles, tokens } from "../../../../src/ui";

export default function ClassDetail() {
  const { classId } = useLocalSearchParams<{ classId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [cls, setCls] = useState<OwnedClass | null>(null);
  const [members, setMembers] = useState<ClassMember[] | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!classId || snapshot.user?.role !== "LECTURER") return;
    const abort = new AbortController();
    setError("");

    // Class detail (CLS-02)
    void session
      .request(`/api/v1/classes/${classId}`, { signal: abort.signal })
      .then((value) => {
        if (!abort.signal.aborted) setCls(ownedClass(value));
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted) {
          setCls(null);
          setError(e instanceof ApiError ? e.message : "Không thể tải thông tin lớp.");
        }
      });

    // Members (CLS-07)
    void session
      .request(`/api/v1/classes/${classId}/members`, { signal: abort.signal })
      .then((value) => {
        if (!abort.signal.aborted) setMembers(classMembers(value));
      })
      .catch((e: unknown) => {
        if (!abort.signal.aborted) {
          setMembers(null);
          setError(e instanceof ApiError ? e.message : "Không thể tải danh sách thành viên.");
        }
      });

    return () => abort.abort();
  }, [classId, session, snapshot.user?.userId, retry]);

  const handleRetry = useCallback(() => setRetry((v) => v + 1), []);

  const handlePublishSchedule = useCallback(async () => {
    if (!classId) return;
    setBusy(true);
    setMsg("");
    try {
      await session.request(`/api/v1/classes/${classId}/schedule/publish`, {
        method: "POST",
      });
      setMsg("Đã xuất bản lịch học thành công.");
      setRetry((v) => v + 1);
    } catch (e: unknown) {
      setMsg(e instanceof ApiError ? e.message : "Không thể xuất bản lịch.");
    } finally {
      setBusy(false);
    }
  }, [classId, session]);

  if (snapshot.user?.role !== "LECTURER") {
    return (
      <Page>
        <Text style={styles.error}>Bạn không có quyền truy cập.</Text>
        <Button label="Về trang chủ" onPress={() => router.replace("/")} />
      </Page>
    );
  }

  const renderMember = ({ item }: { item: ClassMember }) => (
    <View style={cd.memberRow}>
      <Text style={styles.text}>{item.displayName}</Text>
      <Text style={styles.small}>{item.role}</Text>
    </View>
  );

  return (
    <Page>
      <ScreenHeader
        title={cls ? cls.name : "Chi tiết lớp học"}
        subtitle="Quản lý buổi học, điểm danh & thành viên"
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/teaching/classes"))}
      />

      {!cls && !error && (
        <Text accessibilityRole="alert" style={styles.text}>
          Đang tải…
        </Text>
      )}

      {cls && (
        <>

          <View style={styles.card}>
            <Text style={styles.small}>Loại lớp: {cls.classKind}</Text>
            <Text style={styles.small}>Trạng thái: {cls.state ?? "—"}</Text>
            {cls.maxMembers != null && <Text style={styles.small}>Tối đa: {cls.maxMembers} thành viên</Text>}
            {cls.joinCode && <Text style={styles.small}>Mã tham gia: {cls.joinCode}</Text>}
            {cls.scheduleState && <Text style={styles.small}>Lịch: {cls.scheduleState}</Text>}
            {cls.linkedCourseId && (
              <Text style={styles.small}>Khóa học liên kết: {cls.linkedCourseId.slice(0, 8)}…</Text>
            )}
          </View>

          {/* Sessions, Announcements & Schedule CTA */}
          <View style={{ marginVertical: 8, gap: 8 }}>
            <Button
              label="Thông báo lớp học"
              onPress={() => router.push(`/teaching/classes/${classId}/announcements` as Href)}
            />
            <Button
              label="Lịch giảng dạy & Buổi học"
              onPress={() => router.push(`/teaching/classes/${classId}/sessions` as const)}
            />
          </View>

          {/* Publish Schedule if DRAFT */}
          {cls.scheduleState === "DRAFT" && (
            <View style={{ marginBottom: 8 }}>
              <Button
                label={busy ? "Đang xuất bản…" : "Xuất bản lịch học"}
                onPress={handlePublishSchedule}
              />
            </View>
          )}

          {msg ? <Text style={[styles.small, { color: tokens.color.brand }]}>{msg}</Text> : null}

          <Text style={[styles.text, { fontWeight: "600", marginTop: 12 }]}>
            Thành viên ({members?.length ?? "…"})
          </Text>

          {members && members.length === 0 && <Text style={styles.small}>Chưa có thành viên nào.</Text>}
          {members && members.length > 0 && (
            <NonVirtualizedList
              data={members}
              keyExtractor={(item) => item.userId}
              renderItem={renderMember}
              contentContainerStyle={{ gap: 6 }}
            />
          )}
        </>
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

const cd = StyleSheet.create({
  memberRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
});
