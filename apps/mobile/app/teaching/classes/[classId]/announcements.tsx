import { useEffect, useState, useCallback } from "react";
import { Text, View, TextInput, StyleSheet, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSyncExternalStore } from "react";
import * as Crypto from "expo-crypto";
import { ApiError } from "../../../../src/api";
import { runtime } from "../../../../src/runtime";
import {
  announcements as decodeAnnouncements,
  announcement as decodeAnnouncement,
  validateAnnouncement,
  CONTRACT_LIMITED,
  type Announcement,
} from "../../../../src/teaching";
import { Page, Button, Icon, NonVirtualizedList, styles, tokens } from "../../../../src/ui";

export default function ClassAnnouncementsScreen() {
  const { classId } = useLocalSearchParams<{ classId: string }>();
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);

  const [items, setItems] = useState<Announcement[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  // Announcement authoring form
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [formMsg, setFormMsg] = useState<{ type: "error" | "success"; text: string } | null>(null);

  const fetchAnnouncements = useCallback(async () => {
    if (!classId || snapshot.user?.role !== "LECTURER") {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const raw = await session.request(`/api/v1/classes/${classId}/announcements`);
      setItems(decodeAnnouncements(raw));
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : "Không thể tải danh sách thông báo lớp học.");
    } finally {
      setLoading(false);
    }
  }, [classId, session, snapshot.user?.role]);

  useEffect(() => {
    void fetchAnnouncements();
  }, [fetchAnnouncements, retry]);

  const handlePostAnnouncement = async () => {
    setFormMsg(null);
    const validation = validateAnnouncement(title, body);
    if (!validation.valid) {
      setFormMsg({ type: "error", text: validation.error ?? "Dữ liệu không hợp lệ." });
      return;
    }

    try {
      setSaving(true);
      const idempotencyKey = Crypto.randomUUID();
      const raw = await session.request(`/api/v1/classes/${classId}/announcements`, {
        method: "POST",
        idempotencyKey,
        body: {
          title: title.trim(),
          body: body.trim(),
        },
      });

      const newAnn = decodeAnnouncement(raw);
      setItems((prev) => (prev ? [newAnn, ...prev] : [newAnn]));
      setTitle("");
      setBody("");
      setFormMsg({ type: "success", text: "Đăng thông báo lớp thành công." });
    } catch (e: unknown) {
      setFormMsg({
        type: "error",
        text: e instanceof ApiError ? e.message : "Không thể đăng thông báo. Vui lòng thử lại.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (snapshot.user?.role !== "LECTURER") {
    return (
      <Page>
        <Text style={styles.error}>Chỉ Giảng viên phụ trách lớp mới có quyền truy cập thông báo.</Text>
        <Button label="Về trang chủ" onPress={() => router.replace("/")} />
      </Page>
    );
  }

  const renderAnnouncement = ({ item }: { item: Announcement }) => (
    <View style={annStyles.card}>
      <View style={annStyles.cardHeader}>
        <Text style={[styles.title, { fontSize: 16 }]}>{item.title}</Text>
        <Text style={styles.small}>
          {new Date(item.createdAt).toLocaleDateString("vi-VN", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </Text>
      </View>
      <Text style={styles.text}>{item.body}</Text>
    </View>
  );

  return (
    <Page>
      <Text style={styles.small}>LỚP HỌC</Text>
      <Text style={styles.title}>Thông báo lớp học</Text>

      {/* Contract Limited Notice */}
      <View style={[annStyles.infoBanner, { flexDirection: "row", alignItems: "center", gap: 8 }]}>
        <Icon name="info" size={16} color={tokens.color.muted} />
        <Text style={[styles.small, { color: tokens.color.muted, flex: 1 }]}>
          {CONTRACT_LIMITED.announcementEdit}
        </Text>
      </View>

      {/* Post New Announcement Card */}
      <View style={styles.card}>
        <Text style={[styles.title, { fontSize: 16 }]}>Đăng thông báo mới</Text>

        {formMsg && (
          <Text accessibilityRole="alert" style={formMsg.type === "error" ? styles.error : styles.small}>
            {formMsg.text}
          </Text>
        )}

        <View style={annStyles.inputGroup}>
          <Text style={styles.small}>Tiêu đề thông báo</Text>
          <TextInput
            style={annStyles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="Nhập tiêu đề (3-160 ký tự)"
            accessibilityLabel="Tiêu đề thông báo"
          />
        </View>

        <View style={annStyles.inputGroup}>
          <Text style={styles.small}>Nội dung thông báo</Text>
          <TextInput
            style={[annStyles.input, annStyles.textarea]}
            value={body}
            onChangeText={setBody}
            placeholder="Nhập nội dung thông báo cho học viên…"
            multiline
            numberOfLines={4}
            accessibilityLabel="Nội dung thông báo"
          />
        </View>

        <Button
          label={saving ? "Đang đăng thông báo…" : "Đăng thông báo"}
          onPress={() => void handlePostAnnouncement()}
          disabled={saving}
        />
      </View>

      {/* Announcement List */}
      <Text style={[styles.text, { fontWeight: "600", marginTop: tokens.space.medium }]}>
        Danh sách thông báo đã đăng ({items?.length ?? 0})
      </Text>

      {loading ? (
        <View style={annStyles.center}>
          <ActivityIndicator size="large" color={tokens.color.brand} />
          <Text style={styles.small}>Đang tải thông báo…</Text>
        </View>
      ) : error ? (
        <View style={styles.card}>
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
          <Button label="Thử lại" onPress={() => setRetry((v) => v + 1)} />
        </View>
      ) : items && items.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.text}>Lớp học chưa có thông báo nào.</Text>
        </View>
      ) : (
        <NonVirtualizedList
          data={items}
          keyExtractor={(item) => item.announcementId}
          renderItem={renderAnnouncement}
          contentContainerStyle={{ gap: 10, marginTop: 8 }}
        />
      )}

      <Button
        label="Quay lại chi tiết lớp học"
        onPress={() => (router.canGoBack() ? router.back() : router.replace(`/teaching/classes/${classId}`))}
      />
    </Page>
  );
}

const annStyles = StyleSheet.create({
  card: {
    padding: tokens.space.medium,
    backgroundColor: tokens.color.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: tokens.color.border,
  },
  cardHeader: {
    marginBottom: tokens.space.small,
  },
  infoBanner: {
    padding: tokens.space.small,
    backgroundColor: "#f0f9ff",
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#bae6fd",
    marginBottom: tokens.space.small,
  },
  inputGroup: {
    marginVertical: tokens.space.small,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: 6,
    paddingHorizontal: tokens.space.small,
    fontSize: 14,
    backgroundColor: "#fff",
    marginTop: 4,
  },
  textarea: {
    minHeight: 80,
    textAlignVertical: "top",
    paddingTop: tokens.space.small,
  },
  center: {
    padding: tokens.space.large,
    alignItems: "center",
    justifyContent: "center",
  },
});
