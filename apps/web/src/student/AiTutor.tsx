import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useSession } from "../auth/session";
import { studentError, studentRequest, useStudent, type LearningCourse } from "./api";
import "./ai-tutor.css";

type TutorMode = "STUDENT_ADVISOR" | "STUDY_BUDDY";
interface Citation {
  sourceId: string;
  title: string;
  lessonId?: string;
  courseId?: string;
  courseVersion?: number;
  lessonVersion?: number;
  snippet?: string;
}
interface CatalogCourse {
  courseId: string;
  title: string;
  priceAmount: number;
  priceCurrency: string;
}
interface ChatResponse {
  conversationId: string;
  messageId: string;
  content: string;
  citations: Citation[];
  catalogCourses?: CatalogCourse[];
  safetyBlocked?: boolean;
}
interface Message {
  id: string;
  sender: "USER" | "TUTOR";
  text: string;
  citations?: Citation[];
  catalogCourses?: CatalogCourse[];
}

const advisorPrompts = [
  "Mình chưa biết nên chọn khóa học nào",
  "Mình mới bắt đầu học lập trình, nên học từ đâu?",
  "Mình muốn chuyển sang ngành dữ liệu",
];
const studyPrompts = [
  "Giải thích phần mình đang học và dẫn tài liệu liên quan",
  "Xem năng lực và lộ trình học của mình",
];
const botImage = new URL("../../../mobile/assets/tutor-bot.png", import.meta.url).href;

function messageText(text: string) {
  if (text.startsWith("INSUFFICIENT_EVIDENCE:"))
    return `Chưa tìm thấy đủ bằng chứng trong tài liệu được cấp quyền: ${text.slice("INSUFFICIENT_EVIDENCE:".length).trim()}`;
  if (text.startsWith("RAG_TOOL_FORBIDDEN:"))
    return "Bạn không có quyền truy cập tài liệu của khóa học này. Hãy kiểm tra quyền tham gia khóa học.";
  return text;
}

function coursePrice(course: CatalogCourse) {
  if (course.priceAmount === 0) return "Miễn phí";
  try {
    return new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: course.priceCurrency,
      maximumFractionDigits: 0,
    }).format(course.priceAmount);
  } catch {
    return `${course.priceAmount.toLocaleString("vi-VN")} ${course.priceCurrency}`;
  }
}

export function AiTutorPage() {
  const { profile } = useSession();
  // Never keep a previous learner's transcript visible while the session changes.
  return <TutorChat key={profile?.userId ?? "student"} />;
}

function TutorChat() {
  const [searchParams] = useSearchParams();
  const routeCourseId = searchParams.get("courseId") ?? "";
  const routeMode = searchParams.get("mode");
  const [mode, setMode] = useState<TutorMode>(() =>
    routeCourseId || routeMode === "SOCRATIC" || routeMode === "STUDY_BUDDY"
      ? "STUDY_BUDDY"
      : "STUDENT_ADVISOR",
  );
  const [courseId, setCourseId] = useState(routeCourseId);
  const courses = useStudent<LearningCourse[]>(mode === "STUDY_BUDDY" ? "/me/courses" : null);
  const [conversationId, setConversationId] = useState<string>();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const pendingPromptRef = useRef("");
  const sendingRef = useRef(false);
  const messageSequenceRef = useRef(0);

  const resetConversation = useCallback(() => {
    const active = controllerRef.current;
    controllerRef.current = null;
    active?.abort();
    sendingRef.current = false;
    pendingPromptRef.current = "";
    setPending(false);
    setConversationId(undefined);
    setMessages([]);
    setInput("");
    setError("");
  }, []);

  useEffect(() => {
    if (!routeCourseId || routeCourseId === courseId) return;
    resetConversation();
    setCourseId(routeCourseId);
    setMode("STUDY_BUDDY");
  }, [courseId, resetConversation, routeCourseId]);

  useEffect(() => {
    if (!courseId || !courses.data || courses.data.some((course) => course.courseId === courseId)) return;
    resetConversation();
    setCourseId("");
  }, [courseId, courses.data, resetConversation]);

  useEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 136)}px`;
  }, [input]);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages, pending, mode]);

  useEffect(
    () => () => {
      const active = controllerRef.current;
      controllerRef.current = null;
      active?.abort();
    },
    [],
  );

  const selectedCourse = (courses.data ?? []).find((course) => course.courseId === courseId);
  const prompts = mode === "STUDENT_ADVISOR" ? advisorPrompts : studyPrompts;
  const chooseMode = (nextMode: TutorMode) => {
    if (nextMode === mode) return;
    resetConversation();
    setMode(nextMode);
  };
  const handleSend = async (event?: FormEvent<HTMLFormElement>, suggestedPrompt?: string) => {
    event?.preventDefault();
    const text = (suggestedPrompt ?? input).trim();
    if (!text || pending || sendingRef.current) return;
    if (mode === "STUDY_BUDDY" && !selectedCourse) {
      setError("Chọn một khóa học bạn đang tham gia trước khi hỏi về bài học.");
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    pendingPromptRef.current = text;
    sendingRef.current = true;
    setPending(true);
    setError("");
    setInput("");
    messageSequenceRef.current += 1;
    setMessages((current) => [...current, { id: `user-${messageSequenceRef.current}`, sender: "USER", text }]);
    try {
      const response = await studentRequest<ChatResponse>("/assistant/chat", controller.signal, "POST", {
        ...(conversationId ? { conversationId } : {}),
        mode,
        ...(mode === "STUDY_BUDDY" ? { courseId: selectedCourse!.courseId } : {}),
        message: text,
      });
      if (controller.signal.aborted || controllerRef.current !== controller) return;
      setConversationId(response.data.conversationId);
      pendingPromptRef.current = "";
      setMessages((current) => [
        ...current,
        {
          id: response.data.messageId,
          sender: "TUTOR",
          text: messageText(response.data.content),
          ...(response.data.citations.length ? { citations: response.data.citations } : {}),
          ...(response.data.catalogCourses?.length
            ? { catalogCourses: response.data.catalogCourses.slice(0, 3) }
            : {}),
        },
      ]);
    } catch (cause) {
      if (controllerRef.current === controller) {
        // A timeout does not prove that the server did not persist the turn.
        // Start a fresh conversation on retry instead of duplicating an uncertain turn.
        setMessages([]);
        setConversationId(undefined);
        setInput(text);
        setError(`${studentError(cause)} Chưa thể xác nhận máy chủ đã xử lý câu hỏi hay chưa; gửi lại sẽ bắt đầu lượt trò chuyện mới.`);
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        sendingRef.current = false;
        setPending(false);
      }
    }
  };

  const stopRequest = () => {
    const active = controllerRef.current;
    if (!active) return;
    controllerRef.current = null;
    sendingRef.current = false;
    active.abort();
    setMessages([]);
    setConversationId(undefined);
    setInput(pendingPromptRef.current);
    pendingPromptRef.current = "";
    setPending(false);
    setError("Đã dừng yêu cầu. Câu hỏi được giữ lại; gửi lại sẽ bắt đầu cuộc trò chuyện mới.");
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  return (
    <section className="web-tutor" aria-labelledby="web-tutor-title">
      <div className="web-tutor-panel">
        <header className="web-tutor-header">
          <div className={`web-tutor-avatar${pending ? " is-working" : ""}`} aria-hidden="true">
            <img src={botImage} alt="" />
          </div>
          <div className="web-tutor-heading">
            <h1 id="web-tutor-title">Gia sư AILSS</h1>
            <p>{pending ? "Đang tìm câu trả lời…" : "Cùng bạn chọn khóa học và tiến từng bước."}</p>
          </div>
          <span className={`web-tutor-status${pending ? " is-working" : ""}`}>
            <i /> {pending ? "Đang trả lời" : "Sẵn sàng"}
          </span>
        </header>

        <div className="web-tutor-modes" role="group" aria-label="Chọn cách Gia sư hỗ trợ">
          <button
            type="button"
            aria-pressed={mode === "STUDENT_ADVISOR"}
            className={mode === "STUDENT_ADVISOR" ? "is-active" : ""}
            onClick={() => chooseMode("STUDENT_ADVISOR")}
          >
            Chọn khóa học
          </button>
          <button
            type="button"
            aria-pressed={mode === "STUDY_BUDDY"}
            className={mode === "STUDY_BUDDY" ? "is-active" : ""}
            onClick={() => chooseMode("STUDY_BUDDY")}
          >
            Hỏi bài học
          </button>
        </div>

        {mode === "STUDY_BUDDY" && (
          <div className="web-tutor-course-context">
            <label htmlFor="web-tutor-course">Khóa học của bạn</label>
            <select
              id="web-tutor-course"
              aria-label="Khóa học cho AI Tutor"
              value={courseId}
              disabled={courses.pending || !!courses.error || (courses.data?.length ?? 0) === 0}
              onChange={(event) => {
                if (event.target.value === courseId) return;
                resetConversation();
                setCourseId(event.target.value);
              }}
            >
              <option value="">{courses.pending ? "Đang tải khóa học…" : "Chọn khóa học"}</option>
              {(courses.data ?? []).map((course) => (
                <option key={course.courseId} value={course.courseId}>{course.title}</option>
              ))}
            </select>
            {!!courses.error && (
              <p className="web-tutor-course-note" role="alert">
                {studentError(courses.error)}{" "}
                <button type="button" onClick={courses.retry}>Tải lại</button>
              </p>
            )}
            {!courses.pending && !courses.error && courses.data?.length === 0 && (
              <p className="web-tutor-course-note">Bạn chưa có khóa học đang học. <Link to="/courses">Khám phá khóa học</Link></p>
            )}
          </div>
        )}

        <div className="web-tutor-thread" ref={threadRef} role="log" aria-live="polite" aria-relevant="additions text">
          {messages.length === 0 && (
            <div className="web-tutor-welcome">
              <span className="web-tutor-welcome-mark" aria-hidden="true">✦</span>
              <h2>{mode === "STUDENT_ADVISOR" ? "Bạn muốn học điều gì?" : "Mình cùng gỡ phần đang vướng nhé."}</h2>
              <p>
                {mode === "STUDENT_ADVISOR"
                  ? "Mình sẽ hỏi thêm về mục tiêu và trình độ, rồi tìm khóa học đang có trong danh mục."
                  : selectedCourse
                    ? `Mình có thể giải thích nội dung trong tài liệu và kết nối với lộ trình của khóa ${selectedCourse.title}.`
                    : "Chọn một khóa học để mình dùng tài liệu và lộ trình liên quan khi trả lời."}
              </p>
              <div className="web-tutor-suggestions" aria-label="Gợi ý câu hỏi">
                {prompts.map((prompt) => (
                  <button
                    type="button"
                    key={prompt}
                    disabled={pending || (mode === "STUDY_BUDDY" && !selectedCourse)}
                    onClick={() => void handleSend(undefined, prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <article key={message.id} className={`web-tutor-message is-${message.sender.toLowerCase()}`}>
              <p>{message.text}</p>
              {message.citations?.map((citation, index) => (
                <aside className="web-tutor-citation" key={`${citation.sourceId}:${index}`}>
                  <strong>Nguồn {index + 1}: {citation.title}</strong>
                  {citation.snippet && <p>{citation.snippet}</p>}
                  {(citation.courseVersion !== undefined || citation.lessonVersion !== undefined) && (
                    <small>Course v{citation.courseVersion ?? "?"} · Lesson v{citation.lessonVersion ?? "?"}</small>
                  )}
                  {citation.courseId && citation.lessonId && (
                    <Link to={`/app/learn/${encodeURIComponent(citation.courseId)}/lessons/${encodeURIComponent(citation.lessonId)}`}>
                      Mở bài học
                    </Link>
                  )}
                </aside>
              ))}
              {!!message.catalogCourses?.length && (
                <div className="web-tutor-catalog">
                  <h3>Khóa học đang có trong danh mục</h3>
                  {message.catalogCourses.map((course) => (
                    <Link className="web-tutor-course-card" key={course.courseId} to={`/courses/${encodeURIComponent(course.courseId)}`}>
                      <span>{course.title}</span>
                      <strong>{coursePrice(course)}</strong>
                    </Link>
                  ))}
                </div>
              )}
            </article>
          ))}

          {pending && (
            <div className="web-tutor-thinking" role="status">
              <span aria-hidden="true"><i /><i /><i /></span>
              Gia sư đang suy nghĩ…
              <button type="button" onClick={stopRequest}>Dừng</button>
            </div>
          )}
          {error && (
            <div className="web-tutor-error" role="alert">
              <p>{error}</p>
              {input.trim() && <small>Câu hỏi vẫn ở ô nhập để bạn gửi lại.</small>}
            </div>
          )}
        </div>

        <form className="web-tutor-composer" onSubmit={(event) => void handleSend(event)}>
          <label className="visually-hidden" htmlFor="web-tutor-input">Nhập câu hỏi cho AI Tutor</label>
          <textarea
            ref={inputRef}
            id="web-tutor-input"
            aria-label="Nhập câu hỏi cho AI Tutor"
            value={input}
            maxLength={4000}
            rows={1}
            placeholder={mode === "STUDENT_ADVISOR" ? "Bạn muốn học gì?" : "Hỏi về bài học của bạn…"}
            disabled={pending || (mode === "STUDY_BUDDY" && !selectedCourse)}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <span className="web-tutor-composer-hint">Enter để gửi · Shift + Enter xuống dòng</span>
          <button
            className="web-tutor-send"
            type="submit"
            aria-label="Gửi câu hỏi"
            disabled={pending || !input.trim() || (mode === "STUDY_BUDDY" && !selectedCourse)}
          >
            ↑
          </button>
        </form>
      </div>
    </section>
  );
}
