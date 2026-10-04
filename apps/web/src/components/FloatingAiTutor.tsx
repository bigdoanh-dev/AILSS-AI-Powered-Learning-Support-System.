import { useUiText, useLanguage } from "../lib/i18n";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import { SafeMascot } from "./SafeMascot";
import { AiTutorArchive } from "../student/AiTutorArchive";
import { useSession } from "../auth/session";
import { tutorPrompts, useAiTutorConversation } from "../student/aiTutorConversation";

export const AVAILABLE_MASCOTS = [
  { id: "tv", name: "Robot TV AILSS 📺", label: "Robot TV" },
  { id: "crt", name: "Robot CRT Monitor 🖥️", label: "Robot CRT" },
  { id: "gearbot", name: "GearBot Thông Thái ⚙️", label: "GearBot" },
  { id: "scout", name: "Scout AI Bot 🤖", label: "Scout AI" },
  { id: "drone", name: "Drone Bay Trợ Giảng 🛸", label: "Drone Bay" },
  { id: "fox", name: "Cáo Nhỏ Học Hỏi 🦊", label: "Cáo Nhỏ" },
  { id: "otter", name: "Rái Cá Chăm Chỉ 🦦", label: "Rái Cá" },
];

export function FloatingAiTutor() {
  const uiText = useUiText();
  const { language } = useLanguage();
  const { profile } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const [showGreeting, setShowGreeting] = useState(false);
  const [mascotId, setMascotId] = useState("tv");

  useEffect(() => {
    setShowGreeting(!sessionStorage.getItem("ailss_floating_bubble_dismissed"));
    setMascotId(localStorage.getItem("ailss_mascot_id") || "tv");
  }, []);

  const {
    courseId,
    selectCourse,
    courses,
    input,
    setInput,
    messages,
    pending,
    isStreaming,
    status,
    error,
    sendMessage,
    resetConversation,
    stopRequest,
    archiveOpen,
    toggleArchive,
  } = useAiTutorConversation();

  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Auto-dismiss greeting bubble after 10s
  useEffect(() => {
    if (!showGreeting) return;
    const timer = setTimeout(() => {
      setShowGreeting(false);
    }, 10000);
    return () => clearTimeout(timer);
  }, [showGreeting]);

  // Auto-scroll chat thread to bottom
  useEffect(() => {
    if (isOpen && threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, pending, isOpen]);

  // Adjust textarea height dynamically
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 100)}px`;
  }, [input]);

  const changeMascot = (id: string) => {
    setMascotId(id);
    localStorage.setItem("ailss_mascot_id", id);
  };

  const dismissGreeting = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowGreeting(false);
    sessionStorage.setItem("ailss_floating_bubble_dismissed", "1");
  };

  const toggleOpen = () => {
    setIsOpen((prev) => {
      if (!prev) setShowGreeting(false);
      return !prev;
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const currentMascot = AVAILABLE_MASCOTS.find((m) => m.id === mascotId) || AVAILABLE_MASCOTS[0];
  const courseTitle = courses.data?.find((course) => course.courseId === courseId)?.title;

  return (
    <div className="floating-ai-tutor-root" aria-label={uiText("Gia sư AI AILSS")}>
      {/* Floating Chat Window Modal */}
      {isOpen && (
        <section
          className="floating-ai-window"
          role="dialog"
          aria-labelledby="floating-tutor-heading"
          aria-modal="false"
        >
          {/* Header */}
          <header className="floating-ai-header">
            <div className="floating-ai-header-left">
              <div className="floating-ai-header-avatar" aria-hidden="true">
                <SafeMascot
                  directions={`/mascots/${mascotId}-directions.webp`}
                  reactions={`/mascots/${mascotId}-reactions.webp`}
                  size={40}
                  label={uiText(currentMascot.label)}
                />
              </div>
              <div className="floating-ai-header-info">
                <h2 id="floating-tutor-heading">
                  {uiText("Gia sư AI ")}
                  <span className="floating-ai-tag">{uiText("AILSS")}</span>
                </h2>
                <p>{pending ? uiText(status) : uiText("Sẵn sàng hỗ trợ 24/7")}</p>
              </div>
            </div>
            <div className="floating-ai-header-actions">
              <button
                type="button"
                className="floating-ai-icon-btn"
                onClick={toggleArchive}
                aria-expanded={archiveOpen}
                aria-controls="floating-tutor-archive"
                title={uiText("Đoạn chat đã lưu")}
                aria-label={uiText("Mở lịch sử trò chuyện")}
              >
                ▤
              </button>
              <button
                type="button"
                className="floating-ai-icon-btn"
                onClick={resetConversation}
                disabled={pending}
                title={uiText("Tạo đoạn chat mới")}
                aria-label={uiText("Tạo đoạn chat mới")}
              >
                ＋
              </button>
              <Link
                to={`/app/ai-tutor${courseId ? `?courseId=${encodeURIComponent(courseId)}` : ""}`}
                className="floating-ai-icon-btn"
                title={uiText("Mở toàn màn hình")}
                aria-label={uiText("Mở trang Gia sư đầy đủ")}
                onClick={() => setIsOpen(false)}
              >
                ↗
              </Link>
              <button
                type="button"
                className="floating-ai-icon-btn"
                onClick={toggleOpen}
                title={uiText("Thu nhỏ Gia sư AI")}
                aria-label={uiText("Đóng khung chat Gia sư")}
              >
                ✕
              </button>
            </div>
          </header>

          <AiTutorArchive id="floating-tutor-archive" />

          {/* Mascot Switcher Bar */}
          <div className="floating-ai-mascot-select-row">
            <label htmlFor="floating-mascot-picker">Mascot:</label>
            <select
              id="floating-mascot-picker"
              value={mascotId}
              onChange={(e) => changeMascot(e.target.value)}
              aria-label={uiText("Chọn con mascot bạn thích")}
            >
              {AVAILABLE_MASCOTS.map((m) => (
                <option key={m.id} value={m.id}>
                  {uiText(m.name)}
                </option>
              ))}
            </select>
          </div>

          <div className="floating-ai-unified-hint">
            {uiText("Tìm khóa học · Hỏi bài học trong cùng cuộc trò chuyện")}
          </div>

          <div className="floating-ai-mascot-select-row" style={{ background: "rgba(56, 189, 248, 0.08)" }}>
            <label htmlFor="floating-course-select">{uiText("Đang học:")}</label>
            <select
              id="floating-course-select"
              value={courseId}
              onChange={(e) => selectCourse(e.target.value)}
              disabled={!courses.data?.length || pending}
              aria-label={uiText("Chọn khóa học đang học")}
            >
              <option value="">{uiText("Chưa chọn khóa học")}</option>
              {courses.data?.length
                ? courses.data.map((c) => (
                    <option key={c.courseId} value={c.courseId}>
                      {c.title}
                    </option>
                  ))
                : null}
            </select>
          </div>

          {/* Thread */}
          <div className="floating-ai-thread" ref={threadRef}>
            {messages.length === 0 ? (
              <div className="floating-ai-welcome-box">
                <div className="floating-ai-welcome-mascot">
                  <SafeMascot
                    directions={`/mascots/${mascotId}-directions.webp`}
                    reactions={`/mascots/${mascotId}-reactions.webp`}
                    size={80}
                    label={uiText(currentMascot.label)}
                  />
                </div>
                <h3>
                  {uiText("Chào ")}
                  {profile?.displayName || "bạn"}! ✨
                </h3>
                <p>
                  {courseId
                    ? uiText("Mình có thể giúp bạn hỏi bài trong khóa đã chọn hoặc tìm thêm khóa học khác.")
                    : uiText("Mình có thể giúp bạn tìm khóa học; chọn khóa đang học nếu muốn hỏi bài.")}
                </p>
                <div className="floating-ai-starters">
                  {tutorPrompts(courseId, courseTitle, language).map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="floating-ai-starter-pill"
                      disabled={pending}
                      onClick={() => void sendMessage(prompt)}
                    >
                      <span>{prompt}</span>
                      <span>→</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`floating-ai-msg ${msg.sender === "USER" ? "user" : "tutor"}${msg.isStreaming ? " is-streaming" : ""}`}
                >
                  <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{msg.text}</p>
                  {msg.citations && msg.citations.length > 0 && (
                    <div className="floating-ai-citations">
                      <strong>{uiText("Nguồn tham khảo:")}</strong>
                      {msg.citations.map((c, i) => (
                        <span key={i} className="floating-ai-cite-tag">
                          📖 {c.title}
                        </span>
                      ))}
                    </div>
                  )}
                  {msg.catalogCourses && msg.catalogCourses.length > 0 && (
                    <div className="floating-ai-citations">
                      <strong>{uiText("Khóa học đề xuất:")}</strong>
                      {msg.catalogCourses.map((c) => (
                        <Link
                          key={c.courseId}
                          to={`/courses/${c.courseId}`}
                          className="floating-ai-cite-tag"
                          style={{ textDecoration: "underline" }}
                        >
                          👉 {c.title}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}

            {messages.length > 0 && !pending && !error && (
              <div className="floating-ai-followups" aria-label={uiText("Gợi ý câu hỏi tiếp theo")}>
                <span>{uiText("Bạn có thể hỏi tiếp")}</span>
                {tutorPrompts(courseId, courseTitle, language).map((prompt) => (
                  <button key={prompt} type="button" onClick={() => void sendMessage(prompt)}>
                    {prompt}
                  </button>
                ))}
              </div>
            )}

            {pending && !isStreaming && (
              <div className="floating-ai-typing">
                <div className="floating-ai-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <span>{status || "Gia sư đang suy nghĩ…"}</span>
                <button type="button" onClick={stopRequest}>
                  {uiText("Dừng")}
                </button>
              </div>
            )}

            {error && (
              <div className="floating-ai-error" role="alert">
                <span>⚠️ {uiText(error)}</span>
                {input.trim() && (
                  <button type="button" onClick={() => void sendMessage()}>
                    {uiText("Thử lại")}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Footer Input */}
          <footer className="floating-ai-footer">
            <form
              className="floating-ai-form"
              onSubmit={(e: FormEvent<HTMLFormElement>) => {
                e.preventDefault();
                void sendMessage();
              }}
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={uiText("Hỏi Gia sư AI… (Enter để gửi)")}
                rows={1}
                maxLength={4000}
                aria-label={uiText("Nhập câu hỏi cho Gia sư AI")}
                disabled={pending}
              />
              <button
                type="submit"
                className="floating-ai-send-btn"
                disabled={!input.trim() || pending}
                aria-label={uiText("Gửi tin nhắn")}
                title={uiText("Gửi câu hỏi")}
              >
                ➤
              </button>
            </form>
            <p className="floating-ai-disclaimer">{uiText("Gia sư AI AILSS · Hỗ trợ học tập 24/7")}</p>
          </footer>
        </section>
      )}

      {/* Floating Mascot Launcher Bubble + Button */}
      <div
        className="floating-ai-launcher"
        onClick={toggleOpen}
        role="button"
        tabIndex={0}
        aria-label={uiText("Mở Gia sư AI")}
      >
        {showGreeting && !isOpen && (
          <div className="floating-ai-speech-bubble" onClick={(e) => e.stopPropagation()}>
            <span>{uiText("👋 Chào bạn! Cần giải bài hay tìm khóa học? Bấm vào mình nhé!")}</span>
            <button
              type="button"
              className="floating-ai-bubble-close"
              onClick={dismissGreeting}
              aria-label={uiText("Tắt gợi ý")}
            >
              ✕
            </button>
          </div>
        )}

        <div className="floating-ai-mascot-pod">
          <SafeMascot
            directions={`/mascots/${mascotId}-directions.webp`}
            reactions={`/mascots/${mascotId}-reactions.webp`}
            size={68}
            label={uiText(currentMascot.label)}
          />
          <span className="floating-ai-status-dot" title={uiText("Gia sư AI đang trực tuyến")} />
        </div>
      </div>
    </div>
  );
}
