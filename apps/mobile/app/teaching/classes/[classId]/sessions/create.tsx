import { useState } from "react";
import { Text, TextInput, View, StyleSheet, ScrollView, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as Crypto from "expo-crypto";
import { ApiError } from "../../../../../src/api";
import { runtime } from "../../../../../src/runtime";
import { Page, Button, styles, tokens } from "../../../../../src/ui";

export default function CreateSessionScreen() {
  const { classId } = useLocalSearchParams<{ classId: string }>();
  const session = runtime!;

  // Default time: tomorrow 09:00 to 11:00 UTC+7
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const startStr = `${tomorrow.toISOString().slice(0, 10)}T09:00:00.000Z`;
  const endStr = `${tomorrow.toISOString().slice(0, 10)}T11:00:00.000Z`;

  const [title, setTitle] = useState("");
  const [startAt, setStartAt] = useState(startStr);
  const [endAt, setEndAt] = useState(endStr);
  const [mode, setMode] = useState<"ONLINE" | "OFFLINE">("ONLINE");
  const [meetingUrl, setMeetingUrl] = useState("https://meet.ailss.local/session-1");
  const [location, setLocation] = useState("Phòng Lab 402, Tòa AILSS");
  const [timezone] = useState("Asia/Ho_Chi_Minh");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!title.trim() || title.trim().length < 3) {
      setError("Tiêu đề buổi học phải có ít nhất 3 ký tự.");
      return;
    }
    if (!startAt.trim() || !endAt.trim()) {
      setError("Thời gian bắt đầu và kết thúc không được để trống.");
      return;
    }
    if (mode === "ONLINE" && !meetingUrl.trim()) {
      setError("Buổi học trực tuyến cần nhập link phòng học (meetingUrl).");
      return;
    }
    if (mode === "OFFLINE" && !location.trim()) {
      setError("Buổi học trực tiếp cần nhập địa điểm phòng học (location).");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const payload = {
        title: title.trim(),
        startAt: startAt.trim(),
        endAt: endAt.trim(),
        timezone,
        mode,
        ...(mode === "ONLINE"
          ? { meetingProvider: "CUSTOM", meetingUrl: meetingUrl.trim() }
          : { location: location.trim() }),
      };

      await session.request(`/api/v1/classes/${classId}/sessions`, {
        method: "POST",
        headers: {
          "Idempotency-Key": Crypto.randomUUID(),
        },
        body: payload,
      });

      router.back();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : "Không thể tạo buổi học.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <ScrollView contentContainerStyle={{ gap: 12 }}>
        <Text style={styles.title}>Thêm buổi học mới</Text>

        <Text style={styles.small}>Tiêu đề buổi học *</Text>
        <TextInput
          accessibilityLabel="Tiêu đề buổi học"
          style={sc.input}
          placeholder="VD: Buổi 1: Giới thiệu tổng quan"
          value={title}
          onChangeText={setTitle}
        />

        <Text style={styles.small}>Hình thức tổ chức *</Text>
        <View style={sc.modeRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => setMode("ONLINE")}
            style={[sc.modeButton, mode === "ONLINE" && sc.modeButtonActive]}
          >
            <Text style={[sc.modeButtonText, mode === "ONLINE" && sc.modeButtonTextActive]}>
              Trực tuyến (Online)
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setMode("OFFLINE")}
            style={[sc.modeButton, mode === "OFFLINE" && sc.modeButtonActive]}
          >
            <Text style={[sc.modeButtonText, mode === "OFFLINE" && sc.modeButtonTextActive]}>
              Trực tiếp (Offline)
            </Text>
          </Pressable>
        </View>

        {mode === "ONLINE" ? (
          <>
            <Text style={styles.small}>Đường dẫn phòng họp trực tuyến (URL) *</Text>
            <TextInput
              accessibilityLabel="Đường dẫn họp"
              style={sc.input}
              placeholder="https://meet.google.com/..."
              value={meetingUrl}
              onChangeText={setMeetingUrl}
              autoCapitalize="none"
            />
          </>
        ) : (
          <>
            <Text style={styles.small}>Địa điểm phòng học *</Text>
            <TextInput
              accessibilityLabel="Địa điểm"
              style={sc.input}
              placeholder="VD: Phòng B302, Giảng đường A"
              value={location}
              onChangeText={setLocation}
            />
          </>
        )}

        <Text style={styles.small}>Thời gian bắt đầu (ISO 8601 UTC) *</Text>
        <TextInput
          accessibilityLabel="Thời gian bắt đầu"
          style={sc.input}
          value={startAt}
          onChangeText={setStartAt}
        />

        <Text style={styles.small}>Thời gian kết thúc (ISO 8601 UTC) *</Text>
        <TextInput
          accessibilityLabel="Thời gian kết thúc"
          style={sc.input}
          value={endAt}
          onChangeText={setEndAt}
        />

        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}

        <Button label={busy ? "Đang tạo…" : "Lưu buổi học"} onPress={handleSubmit} />

        <Button label="Hủy bỏ" onPress={() => router.back()} />
      </ScrollView>
    </Page>
  );
}

const sc = StyleSheet.create({
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
  },
  modeRow: {
    flexDirection: "row",
    gap: 8,
  },
  modeButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: tokens.color.border,
    backgroundColor: "#fff",
    alignItems: "center",
  },
  modeButtonActive: {
    borderColor: tokens.color.brand,
    backgroundColor: "#EFF6FF",
  },
  modeButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#374151",
  },
  modeButtonTextActive: {
    color: tokens.color.brand,
  },
});
