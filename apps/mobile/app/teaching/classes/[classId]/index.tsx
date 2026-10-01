import { useEffect, useState, useCallback } from "react";
import { Alert, Text, TextInput, View, StyleSheet } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import * as Crypto from "expo-crypto";
import { useSyncExternalStore } from "react";
import { ApiError } from "../../../../src/api";
import { runtime } from "../../../../src/runtime";
import {
  ownedClass,
  classMembers,
  isNewClassStudent,
  type OwnedClass,
  type ClassMember,
} from "../../../../src/teaching";
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
  const [joinCode, setJoinCode] = useState("");
  const [warningStudentId, setWarningStudentId] = useState("");
  const [warningReason, setWarningReason] = useState("");

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

  async function resetCode() {
    if (!classId || busy) return;
    setBusy(true);
    setMsg("");
    try {
      const value = await session.request(`/api/v1/classes/${classId}/join-code/reset`, {
        method: "POST",
        idempotencyKey: Crypto.randomUUID(),
        body: {},
      });
      if (
        !value ||
        typeof value !== "object" ||
        typeof (value as { joinCode?: unknown }).joinCode !== "string"
      )
        throw new ApiError("invalid");
      setJoinCode((value as { joinCode: string }).joinCode);
      setMsg("Mã cũ đã hết hiệu lực. Hãy chia sẻ mã mới với học viên.");
    } catch (cause) {
      setMsg(cause instanceof ApiError ? cause.message : "Không thể tạo mã lớp mới.");
    } finally {
      setBusy(false);
    }
  }

  async function warnStudent(item: ClassMember) {
    if (!classId || busy || warningReason.trim().length < 5 || warningReason.trim().length > 500) {
      setMsg("Nội dung cảnh báo cần từ 5 đến 500 ký tự.");
      return;
    }
    setBusy(true);
    try {
      await session.request(`/api/v1/classes/${classId}/members/${item.studentId}/warnings`, {
        method: "POST",
        idempotencyKey: Crypto.randomUUID(),
        body: { reason: warningReason.trim() },
      });
      setWarningStudentId("");
      setWarningReason("");
      setMsg(`Đã gửi cảnh báo cho ${item.displayName}.`);
    } catch (cause) {
      setMsg(cause instanceof ApiError ? cause.message : "Không thể gửi cảnh báo.");
    } finally {
      setBusy(false);
    }
  }

  function confirmRemove(item: ClassMember) {
    if (!classId) return;
    Alert.alert("Xóa học viên khỏi lớp", `Xóa ${item.displayName} khỏi lớp này?`, [
      { text: "Hủy", style: "cancel" },
      {
        text: "Xóa",
        style: "destructive",
        onPress: () => {
          setBusy(true);
          void session
            .request(`/api/v1/classes/${classId}/members/${item.studentId}`, {
              method: "DELETE",
              idempotencyKey: Crypto.randomUUID(),
              body: {},
            })
            .then(() => {
              setMsg(`Đã xóa ${item.displayName} khỏi lớp.`);
              setRetry((value) => value + 1);
            })
            .catch((cause: unknown) => {
              setMsg(cause instanceof ApiError ? cause.message : "Không thể xóa học viên.");
            })
            .finally(() => setBusy(false));
        },
      },
    ]);
  }

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
    <View
      style={[cd.memberRow, { backgroundColor: isNewClassStudent(item.createdAt) ? "#ECFDF5" : "#F8FAFC" }]}
    >
      <Text style={styles.text}>
        {item.displayName} · {isNewClassStudent(item.createdAt) ? "Mới" : "Cũ"}
      </Text>
      <Text style={styles.small}>{item.emailMasked}</Text>
      <Text style={styles.small}>Đăng ký: {new Date(item.createdAt).toLocaleDateString("vi-VN")}</Text>
      <Text style={styles.small}>Vào lớp: {new Date(item.joinedAt).toLocaleDateString("vi-VN")}</Text>
      <Text style={styles.small}>Mã học viên: {item.studentId}</Text>
      <Button
        label="Cảnh báo"
        size="sm"
        variant="outline"
        disabled={busy}
        onPress={() => {
          setWarningStudentId(item.studentId);
          setWarningReason("");
        }}
      />
      {warningStudentId === item.studentId && (
        <View style={{ gap: 8 }}>
          <TextInput
            style={styles.input}
            value={warningReason}
            onChangeText={setWarningReason}
            maxLength={500}
            multiline
            placeholder="Nội dung cảnh báo gửi cho học viên"
          />
          <Button label="Gửi cảnh báo" size="sm" disabled={busy} onPress={() => void warnStudent(item)} />
          <Button label="Hủy" size="sm" variant="outline" onPress={() => setWarningStudentId("")} />
        </View>
      )}
      {cls?.scheduleState !== "PUBLISHED" && item.source === "JOIN_CODE" && (
        <Button
          label="Xóa khỏi lớp"
          size="sm"
          variant="outline"
          disabled={busy}
          onPress={() => confirmRemove(item)}
        />
      )}
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
            {joinCode ? <Text style={styles.text}>Mã tham gia mới: {joinCode}</Text> : null}
            <Button
              label="Tạo mã tham gia mới"
              variant="outline"
              disabled={busy}
              onPress={() => void resetCode()}
            />
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
              <Button label={busy ? "Đang xuất bản…" : "Xuất bản lịch học"} onPress={handlePublishSchedule} />
            </View>
          )}

          {msg ? <Text style={[styles.small, { color: tokens.color.brand }]}>{msg}</Text> : null}

          <Text style={[styles.text, { fontWeight: "600", marginTop: 12 }]}>
            Thành viên ({members?.length ?? "…"})
          </Text>
          <Text style={styles.small}>Màu xanh: tài khoản mới trong 21 ngày. Màu xám: học viên cũ.</Text>

          {members && members.length === 0 && <Text style={styles.small}>Chưa có thành viên nào.</Text>}
          {members && members.length > 0 && (
            <NonVirtualizedList
              data={members}
              keyExtractor={(item) => item.studentId}
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
    gap: 6,
    padding: 12,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
});
