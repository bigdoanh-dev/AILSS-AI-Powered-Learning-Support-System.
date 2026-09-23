import React, { useEffect, useState } from "react";
import { Heading } from "./ui";
import { studentError, studentRequest, useStudent, type LearningCourse } from "./api";

interface Citation {
  sourceId: string; title: string; lessonId?: string; courseId?: string;
  courseVersion?: number; lessonVersion?: number; snippet?: string;
}
interface ChatResponse {
  conversationId: string; messageId: string; content: string; citations: Citation[];
}
interface Message { id: string; sender: "USER" | "TUTOR"; text: string; citations?: Citation[]; }

export function AiTutorPage() {
  const courses = useStudent<LearningCourse[]>("/me/courses");
  const [courseId, setCourseId] = useState("");
  const [conversationId, setConversationId] = useState<string>();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (!courseId && courses.data?.[0]) setCourseId(courses.data[0].courseId); }, [courseId, courses.data]);

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault();
    const message = input.trim();
    if (!message || !courseId || pending) return;
    setMessages((current) => [...current, { id: crypto.randomUUID(), sender: "USER", text: message }]);
    setInput(""); setPending(true); setError("");
    try {
      const response = await studentRequest<ChatResponse>("/assistant/chat", new AbortController().signal, "POST", {
        ...(conversationId ? { conversationId } : {}), mode: "STUDY_BUDDY", courseId, message,
      });
      setConversationId(response.data.conversationId);
      setMessages((current) => [...current, {
        id: response.data.messageId, sender: "TUTOR", text: response.data.content,
        ...(response.data.citations.length ? { citations: response.data.citations } : {}),
      }]);
    } catch (cause) { setError(studentError(cause)); }
    finally { setPending(false); }
  };

  return <div className="ai-tutor-container" style={{ padding: "var(--space-6) 0", maxWidth: 900, margin: "0 auto" }}>
    <Heading title="AI Tutor — Study Buddy">Trợ lý học tập sử dụng Mastery, Study Plan và tài liệu thật của khóa học.</Heading>
    <label>Khóa học:{" "}<select aria-label="Khóa học cho AI Tutor" value={courseId} onChange={(event) => { setCourseId(event.target.value); setConversationId(undefined); setMessages([]); }}>
      {(courses.data ?? []).map((course) => <option key={course.courseId} value={course.courseId}>{course.title}</option>)}
    </select></label>
    {(courses.pending || pending) && <p role="status">Đang kết nối AI Tutor…</p>}
    {(courses.error || error) && <p role="alert">{error || studentError(courses.error)}</p>}
    <div aria-live="polite" style={{ minHeight: 320, marginTop: 16, display: "grid", gap: 12 }}>
      {!messages.length && <p>Hãy hỏi về mức độ thành thạo, kế hoạch học hoặc nội dung trong tài liệu của khóa học.</p>}
      {messages.map((message) => <article key={message.id} data-sender={message.sender}>
        <strong>{message.sender === "USER" ? "Bạn" : "AI Tutor"}</strong><p>{message.text}</p>
        {message.citations?.map((citation) => <aside key={`${citation.sourceId}:${String(citation.courseVersion)}:${String(citation.lessonVersion)}`}>
          <strong>Nguồn: {citation.title}</strong><p>{citation.snippet}</p>
          <small>Course v{citation.courseVersion ?? "?"} · Lesson v{citation.lessonVersion ?? "?"}</small>
        </aside>)}
      </article>)}
    </div>
    <form onSubmit={(event) => void handleSend(event)} style={{ display: "flex", gap: 12, marginTop: 16 }}>
      <input aria-label="Nhập câu hỏi cho AI Tutor" value={input} onChange={(event) => setInput(event.target.value)} disabled={!courseId || pending} />
      <button type="submit" disabled={!courseId || pending || !input.trim()}>Gửi</button>
    </form>
  </div>;
}
