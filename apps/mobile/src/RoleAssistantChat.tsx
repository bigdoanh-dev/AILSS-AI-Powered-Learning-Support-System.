import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { router, type Href } from "expo-router";
import { ApiError, record, string } from "./api";
import { roleConversation, type AdminMessage, type RoleAssistantMode } from "./admin-ai";
import { runtime } from "./runtime";
import { Button, Page, ScreenHeader, styles, tokens } from "./ui";

type Conversation = { conversationId: string; title: string; mode: RoleAssistantMode };
type Props = {
  role: "ADMIN" | "LECTURER";
  mode: RoleAssistantMode;
  title: string;
  subtitle: string;
  back: Href;
};

export function RoleAssistantChat({ role, mode, title, subtitle, back }: Props) {
  const session = runtime!;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [history, setHistory] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refreshHistory = useCallback(async () => {
    try {
      const result = await session.request("/api/v1/assistant/conversations");
      setHistory(
        Array.isArray(result)
          ? result.filter(
              (item): item is Conversation =>
                !!item &&
                typeof item === "object" &&
                item.mode === mode &&
                typeof item.conversationId === "string" &&
                typeof item.title === "string",
            )
          : [],
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Không tải được lịch sử AI.");
    }
  }, [mode, session]);
  useEffect(() => {
    if (snapshot.user?.role === role) void refreshHistory();
  }, [refreshHistory, role, snapshot.user?.role]);

  async function open(id: string) {
    setBusy(true);
    setError("");
    try {
      const value = roleConversation(
        await session.request(`/api/v1/assistant/conversations/${encodeURIComponent(id)}`),
        mode,
      );
      setConversationId(value.conversationId);
      setMessages(value.messages);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Không thể mở đoạn chat.");
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    const message = draft.trim();
    if (!message || busy) return;
    setBusy(true);
    setError("");
    try {
      const reply = record(
        await session.request("/api/v1/assistant/chat", {
          method: "POST",
          body: { mode, message, ...(conversationId ? { conversationId } : {}) },
          timeoutMs: 65000,
        }),
      );
      if (reply.mode !== mode) throw new ApiError("invalid");
      setMessages((current) => [
        ...current,
        { id: `user-${current.length}`, sender: "USER", content: message },
        { id: string(reply.messageId), sender: "ASSISTANT", content: string(reply.content) },
      ]);
      if (reply.safetyBlocked !== true) setConversationId(string(reply.conversationId));
      setDraft("");
      void refreshHistory();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Trợ lý AI chưa thể trả lời.");
    } finally {
      setBusy(false);
    }
  }

  if (snapshot.user?.role !== role)
    return (
      <Page>
        <ScreenHeader title={title} onBack={() => router.replace("/")} />
        <Text style={styles.error}>
          Tính năng này yêu cầu tài khoản {role === "ADMIN" ? "Quản trị viên" : "Giảng viên"}.
        </Text>
      </Page>
    );
  return (
    <View style={{ flex: 1, backgroundColor: tokens.color.canvas }}>
      <Page>
        <ScreenHeader title={title} subtitle={subtitle} onBack={() => router.replace(back)} />
        <Button
          label="Chat mới"
          variant="outline"
          disabled={busy}
          onPress={() => {
            setConversationId(undefined);
            setMessages([]);
            setDraft("");
          }}
        />
        <View style={[styles.card, { gap: 8 }]}>
          <Text style={styles.title}>Lịch sử</Text>
          {history.length ? (
            history.map((item) => (
              <Pressable
                key={item.conversationId}
                accessibilityRole="button"
                disabled={busy}
                onPress={() => void open(item.conversationId)}
              >
                <Text style={[styles.text, { color: tokens.color.brand }]}>{item.title || "Đoạn chat"}</Text>
              </Pressable>
            ))
          ) : (
            <Text style={styles.small}>Chưa có đoạn chat nào.</Text>
          )}
        </View>
        <View style={[styles.card, { gap: 10 }]}>
          <Text style={styles.title}>{title}</Text>
          {messages.length ? (
            messages.map((item) => (
              <View
                key={item.id}
                style={{
                  padding: 8,
                  backgroundColor: item.sender === "USER" ? tokens.color.canvas : tokens.color.surface,
                  borderRadius: 8,
                }}
              >
                <Text style={styles.small}>{item.sender === "USER" ? "Bạn" : title}</Text>
                <Text style={styles.text}>{item.content}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.small}>
              {role === "ADMIN"
                ? "Bạn muốn tìm hiểu quy trình quản trị nào?"
                : "Bạn muốn hỗ trợ soạn bài hoặc tổ chức lớp học nào?"}
            </Text>
          )}
          {busy ? <Text style={styles.small}>AI đang trả lời…</Text> : null}
        </View>
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
        <TextInput
          accessibilityLabel={`Câu hỏi cho ${title}`}
          style={[styles.input, { minHeight: 90, textAlignVertical: "top" }]}
          multiline
          maxLength={4000}
          value={draft}
          onChangeText={setDraft}
          placeholder={
            role === "ADMIN"
              ? "Ví dụ: Xem báo cáo kiểm duyệt ở đâu?"
              : "Ví dụ: Gợi ý cấu trúc bài giảng về CSDL"
          }
        />
        <Button label="Gửi câu hỏi" disabled={busy || !draft.trim()} onPress={() => void send()} />
      </Page>
    </View>
  );
}
