import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { adminError, adminRequest } from "./api";
import { Icon } from "../components/Icon";
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
  const [supportMode, setSupportMode] = useState<"external" | "local-guide">();
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
    let active = true;
    void adminRequest<{ mode: "external" | "local-guide" }>("/assistant/admin-status")
      .then((response) => {
        if (active) setSupportMode(response.data.mode);
      })
      .catch((cause) => {
        if (active) setError(adminError(cause));
      });
    return () => {
      active = false;
    };
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
    <section className="admin-ai animate-fade-in" aria-labelledby="admin-ai-title">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">HỖ TRỢ VẬN HÀNH</p>
          <h1 id="admin-ai-title">
            {supportMode === "local-guide" ? "Hướng dẫn quản trị local" : "AI quản trị"}
          </h1>
          <p className="lead">Hỏi về quy trình kiểm duyệt, quản lý tài khoản và nơi xem số liệu.</p>
        </div>
        <div className="dashboard-header-actions">
          <span className="kpi-tag accent">
            <Icon name="sparkles" size={14} />{" "}
            {supportMode === "local-guide"
              ? "Hướng dẫn local"
              : supportMode === "external"
                ? "AI trực tuyến"
                : "Đang đọc cấu hình…"}
          </span>
        </div>
      </div>

      <div className="admin-ai-banner">
        <div className="admin-ai-banner-icon">
          <Icon name="bot" size={20} />
        </div>
        <p className="admin-ai-note">
          {supportMode === "local-guide"
            ? "Đang dùng hướng dẫn thao tác local, không gọi mô hình AI trực tuyến. Số liệu và quyết định quản trị cần được xác nhận trên màn hình tương ứng."
            : "Trợ lý hướng dẫn thao tác. Số liệu và quyết định quản trị cần được xác nhận trên màn hình tương ứng."}
        </p>
      </div>

      <div className="admin-ai-links" aria-label="Công cụ quản trị">
        <Link className="admin-ai-link-chip" to="/app/admin/stats">
          <Icon name="chart" size={15} />
          <span>Thống kê học tập và AI</span>
        </Link>
        <Link className="admin-ai-link-chip" to="/app/admin/moderation">
          <Icon name="shield" size={15} />
          <span>Kiểm duyệt</span>
        </Link>
        <Link className="admin-ai-link-chip" to="/app/admin/users">
          <Icon name="users" size={15} />
          <span>Người dùng</span>
        </Link>
        <Link className="admin-ai-link-chip" to="/app/admin/logs">
          <Icon name="fileText" size={15} />
          <span>Nhật ký</span>
        </Link>
      </div>

      <div className="admin-ai-layout">
        <aside className="admin-ai-history" aria-label="Lịch sử AI quản trị">
          <div className="admin-ai-history-header">
            <div className="admin-ai-history-title-wrap">
              <Icon name="message" size={16} />
              <h2>Đoạn chat</h2>
            </div>
            <button
              type="button"
              className="button button-small button-subtle admin-new-chat-btn"
              disabled={pending}
              onClick={() => {
                setConversationId(undefined);
                setMessages([]);
                setInput("");
                setError("");
              }}
            >
              + Chat mới
            </button>
          </div>
          {conversations.length === 0 && (
            <div className="admin-ai-history-empty">
              <Icon name="message" size={24} />
              <p>Chưa có đoạn chat nào.</p>
            </div>
          )}
          <div className="admin-ai-conversation-list">
            {conversations.map((item) => (
              <button
                type="button"
                key={item.conversationId}
                className={`admin-ai-conv-item ${item.conversationId === conversationId ? "is-active" : ""}`}
                disabled={pending}
                onClick={() => void openConversation(item.conversationId)}
              >
                <Icon name="message" size={14} />
                <span className="conv-title-text">{item.title || "Đoạn chat"}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="admin-ai-chat">
          <div className="admin-ai-thread" role="log" aria-live="polite" ref={threadRef}>
            {messages.length === 0 && (
              <div className="admin-ai-empty-hub">
                <div className="admin-ai-empty-pulse-icon">
                  <Icon name="sparkles" size={32} />
                </div>
                <p className="admin-ai-empty">Bạn muốn tìm hiểu quy trình quản trị nào?</p>
                <p className="admin-ai-empty-sub">
                  Chọn câu hỏi gợi ý bên dưới hoặc nhập câu hỏi trực tiếp để trợ lý hỗ trợ ngay:
                </p>
                <div className="admin-ai-suggestions">
                  {[
                    "Xem báo cáo kiểm duyệt ở đâu?",
                    "Cách xét duyệt hồ sơ giảng viên mới?",
                    "Quy trình xuất bản khóa học trực tuyến?",
                    "Xem logs đối soát SePay Webhook?",
                  ].map((sample) => (
                    <button
                      key={sample}
                      type="button"
                      className="admin-ai-sample-pill"
                      disabled={pending}
                      onClick={() => setInput(sample)}
                    >
                      <span>{sample}</span>
                      <Icon name="chevronRight" size={13} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message) => (
              <div
                key={message.id}
                className={`admin-ai-message ${message.sender === "USER" ? "from-user" : "from-ai"}`}
              >
                <div className="message-header-row">
                  <div className="message-avatar">
                    <Icon name={message.sender === "USER" ? "user" : "bot"} size={14} />
                  </div>
                  <strong>{message.sender === "USER" ? "Bạn" : "AI quản trị"}</strong>
                </div>
                <div className="message-content-box">
                  <p>{message.content}</p>
                </div>
              </div>
            ))}
            {pending && (
              <div className="admin-ai-typing-indicator" role="status">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span>AI đang trả lời…</span>
              </div>
            )}
          </div>

          {error && (
            <p className="admin-ai-error" role="alert">
              {error}
            </p>
          )}

          <form className="admin-ai-composer" onSubmit={(event) => void send(event)}>
            <label htmlFor="admin-ai-input" className="admin-composer-label">
              <Icon name="sparkles" size={15} />
              <span>Câu hỏi cho AI quản trị</span>
            </label>
            <div className="admin-textarea-wrapper">
              <textarea
                id="admin-ai-input"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                disabled={pending}
                maxLength={4000}
                rows={3}
                placeholder="Ví dụ: Xem báo cáo kiểm duyệt ở đâu?"
                className="admin-ai-textarea"
              />
              <button type="submit" className="button admin-send-btn" disabled={pending || !input.trim()}>
                <span>Gửi câu hỏi</span>
                <Icon name="chevronRight" size={15} />
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
