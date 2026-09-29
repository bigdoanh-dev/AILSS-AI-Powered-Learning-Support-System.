import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { adminError, adminRequest } from "./api";
import "./admin-ai.css";

interface Message {
  id: string;
  sender: "USER" | "ASSISTANT";
  content: string;
}

interface Conversation {
  conversationId: string;
  title: string;
  updatedAt: string;
  mode: string;
}

interface ConversationDetail {
  conversation: Conversation;
  messages: Array<{ messageId: string; sender: string; content: string }>;
}

export default function AdminAi() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const pendingRef = useRef(false);
  const threadRef = useRef<HTMLDivElement>(null);

  async function refreshHistory() {
    try {
      const response = await adminRequest<Conversation[]>("/assistant/conversations");
      setConversations(response.data.filter((item) => item.mode === "ADMIN_SUPPORT"));
    } catch (cause) {
      setError(adminError(cause));
    }
  }

  useEffect(() => {
    void refreshHistory();
  }, []);
  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages]);

  async function openConversation(id: string) {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    try {
      const response = await adminRequest<ConversationDetail>(
        `/assistant/conversations/${encodeURIComponent(id)}`,
      );
      if (response.data.conversation.mode !== "ADMIN_SUPPORT")
        throw new Error("Đoạn chat không thuộc AI quản trị.");
      setConversationId(id);
      setMessages(
        response.data.messages.flatMap((message) =>
          message.sender === "USER" || message.sender === "ASSISTANT"
            ? [{ id: message.messageId, sender: message.sender, content: message.content }]
            : [],
        ),
      );
    } catch (cause) {
      setError(adminError(cause));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  async function send(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const message = input.trim();
    if (!message || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError("");
    setInput("");
    const optimisticId = crypto.randomUUID();
    setMessages((current) => [...current, { id: optimisticId, sender: "USER", content: message }]);
    try {
      const response = await adminRequest<{
        conversationId: string;
        messageId: string;
        content: string;
        safetyBlocked?: boolean;
      }>("/assistant/chat", "POST", {
        mode: "ADMIN_SUPPORT",
        ...(conversationId ? { conversationId } : {}),
        message,
      });
      if (!response.data.safetyBlocked) setConversationId(response.data.conversationId);
      setMessages((current) => [
        ...current,
        {
          id: response.data.messageId,
          sender: "ASSISTANT",
          content: response.data.content,
        },
      ]);
      void refreshHistory();
    } catch (cause) {
      setMessages((current) => current.filter((item) => item.id !== optimisticId));
      setInput(message);
      setError(`${adminError(cause)} Câu hỏi đã được giữ lại để bạn thử lại.`);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  return (
    <section className="admin-ai" aria-labelledby="admin-ai-title">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">HỖ TRỢ VẬN HÀNH</p>
          <h1 id="admin-ai-title">AI quản trị</h1>
          <p className="lead">Hỏi về quy trình kiểm duyệt, quản lý tài khoản và nơi xem số liệu.</p>
        </div>
      </div>
      <p className="admin-ai-note">
        Trợ lý hướng dẫn thao tác. Số liệu và quyết định quản trị cần được xác nhận trên màn hình tương ứng.
      </p>
      <div className="admin-ai-links" aria-label="Công cụ quản trị">
        <Link to="/app/admin/stats">Thống kê học tập và AI</Link>
        <Link to="/app/admin/moderation">Kiểm duyệt</Link>
        <Link to="/app/admin/users">Người dùng</Link>
        <Link to="/app/admin/logs">Nhật ký</Link>
      </div>
      <div className="admin-ai-layout">
        <aside className="admin-ai-history" aria-label="Lịch sử AI quản trị">
          <div className="admin-ai-history-header">
            <h2>Đoạn chat</h2>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setConversationId(undefined);
                setMessages([]);
                setInput("");
                setError("");
              }}
            >
              Chat mới
            </button>
          </div>
          {conversations.length === 0 && <p>Chưa có đoạn chat nào.</p>}
          {conversations.map((item) => (
            <button
              type="button"
              key={item.conversationId}
              className={item.conversationId === conversationId ? "is-active" : ""}
              disabled={pending}
              onClick={() => void openConversation(item.conversationId)}
            >
              {item.title || "Đoạn chat"}
            </button>
          ))}
        </aside>
        <div className="admin-ai-chat">
          <div className="admin-ai-thread" role="log" aria-live="polite" ref={threadRef}>
            {messages.length === 0 && (
              <p className="admin-ai-empty">Bạn muốn tìm hiểu quy trình quản trị nào?</p>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={`admin-ai-message ${message.sender === "USER" ? "from-user" : "from-ai"}`}
              >
                <strong>{message.sender === "USER" ? "Bạn" : "AI quản trị"}</strong>
                <p>{message.content}</p>
              </div>
            ))}
            {pending && <p role="status">AI đang trả lời…</p>}
          </div>
          {error && (
            <p className="admin-ai-error" role="alert">
              {error}
            </p>
          )}
          <form className="admin-ai-composer" onSubmit={(event) => void send(event)}>
            <label htmlFor="admin-ai-input">Câu hỏi cho AI quản trị</label>
            <textarea
              id="admin-ai-input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              disabled={pending}
              maxLength={4000}
              rows={3}
              placeholder="Ví dụ: Xem báo cáo kiểm duyệt ở đâu?"
            />
            <button type="submit" className="button" disabled={pending || !input.trim()}>
              Gửi câu hỏi
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
