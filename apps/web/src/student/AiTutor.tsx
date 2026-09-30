import { useEffect, useRef, type FormEvent, type KeyboardEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { SafeMascot } from "../components/SafeMascot";
import { AiTutorArchive } from "./AiTutorArchive";
import { useSession } from "../auth/session";
import { studentError } from "./api";
import {
  AiTutorConversationProvider,
  tutorPrompts,
  useAiTutorConversation,
  useOptionalAiTutorConversation,
  type TutorCatalogCourse,
} from "./aiTutorConversation";
import "./ai-tutor.css";

function coursePrice(course: TutorCatalogCourse) {
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
  const context = useOptionalAiTutorConversation();
  if (context) {
    return <TutorChat key={profile?.userId ?? "student"} />;
  }
  return (
    <AiTutorConversationProvider>
      <TutorChat key={profile?.userId ?? "student"} />
    </AiTutorConversationProvider>
  );
}

function TutorChat() {
  const [searchParams] = useSearchParams();
  const routeCourseId = searchParams.get("courseId") ?? "";
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
    stopRequest,
    archiveOpen,
    toggleArchive,
    resetConversation,
  } = useAiTutorConversation();
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const appliedRouteSelectionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!routeCourseId || appliedRouteSelectionRef.current === routeCourseId) return;
    appliedRouteSelectionRef.current = routeCourseId;
    if (routeCourseId !== courseId) selectCourse(routeCourseId);
  }, [courseId, routeCourseId, selectCourse]);

  useEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 136)}px`;
  }, [input]);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages, pending]);

  const selectedCourse = (courses.data ?? []).find((course) => course.courseId === courseId);
  const prompts = tutorPrompts(courseId, selectedCourse?.title);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  return (
    <section className="web-tutor" aria-labelledby="web-tutor-title">
      <div className="web-tutor-panel">
        <header className="web-tutor-header">
          <div
            className={`web-tutor-avatar${pending ? " is-working" : ""}`}
            aria-hidden="true"
            style={{ background: "transparent", border: "none" }}
          >
            <SafeMascot
              directions="/mascots/tv-directions.webp"
              reactions="/mascots/tv-reactions.webp"
              size={58}
              label="Gia sư AI AILSS"
            />
          </div>
          <div className="web-tutor-heading">
            <h1 id="web-tutor-title">Gia sư AILSS</h1>
            <p>{pending ? status : "Cùng bạn chọn khóa học và tiến từng bước."}</p>
          </div>
          <div className="web-tutor-header-actions">
            <span className={`web-tutor-status${pending ? " is-working" : ""}`}>
              <i /> {pending ? "Đang trả lời" : "Sẵn sàng"}
            </span>
            <button
              type="button"
              aria-expanded={archiveOpen}
              aria-controls="web-tutor-archive"
              onClick={toggleArchive}
            >
              {archiveOpen ? "Đóng lịch sử" : "Lịch sử"}
            </button>
            <button type="button" disabled={pending} onClick={resetConversation}>
              ＋ Chat mới
            </button>
          </div>
        </header>

        <AiTutorArchive id="web-tutor-archive" />

        <div className="web-tutor-unified-hint">Một cuộc trò chuyện để tìm khóa học và hỏi bài học</div>

        <div className="web-tutor-course-context">
          <label htmlFor="web-tutor-course">Khóa đang học (tùy chọn)</label>
          <select
            id="web-tutor-course"
            aria-label="Khóa học cho AI Tutor"
            value={courseId}
            disabled={pending || courses.pending || !!courses.error || (courses.data?.length ?? 0) === 0}
            onChange={(event) => selectCourse(event.target.value)}
          >
            <option value="">{courses.pending ? "Đang tải khóa học…" : "Chưa chọn khóa học"}</option>
            {(courses.data ?? []).map((course) => (
              <option key={course.courseId} value={course.courseId}>
                {course.title}
              </option>
            ))}
          </select>
          {!!courses.error && (
            <p className="web-tutor-course-note" role="alert">
              {studentError(courses.error)}{" "}
              <button type="button" onClick={courses.retry}>
                Tải lại
              </button>
            </p>
          )}
          {!courses.pending && !courses.error && courses.data?.length === 0 && (
            <p className="web-tutor-course-note">
              Bạn chưa có khóa học đang học. <Link to="/courses">Khám phá khóa học</Link>
            </p>
          )}
        </div>

        <div
          className="web-tutor-thread"
          ref={threadRef}
          role="log"
          aria-live={isStreaming ? "off" : "polite"}
          aria-relevant="additions text"
        >
          {messages.length === 0 && (
            <div className="web-tutor-welcome">
              <span className="web-tutor-welcome-mark" aria-hidden="true">
                ✦
              </span>
              <h2>Bạn muốn học điều gì?</h2>
              <p>
                {selectedCourse
                  ? `Mình sẽ dựa vào khóa ${selectedCourse.title} khi bạn hỏi bài, và vẫn giúp bạn tìm khóa học khác.`
                  : "Bạn có thể hỏi cách chọn khóa học hoặc chọn khóa đang học để hỏi bài."}
              </p>
              <div className="web-tutor-suggestions" aria-label="Gợi ý câu hỏi">
                {prompts.map((prompt) => (
                  <button
                    type="button"
                    key={prompt}
                    disabled={pending}
                    onClick={() => void sendMessage(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <article
              key={message.id}
              className={`web-tutor-message is-${message.sender.toLowerCase()}${message.isStreaming ? " is-streaming" : ""}`}
            >
              <p>{message.text}</p>
              {message.citations?.map((citation, index) => (
                <aside className="web-tutor-citation" key={`${citation.sourceId}:${index}`}>
                  <strong>
                    Nguồn {index + 1}: {citation.title}
                  </strong>
                  {citation.snippet && <p>{citation.snippet}</p>}
                  {(citation.courseVersion !== undefined || citation.lessonVersion !== undefined) && (
                    <small>
                      Course v{citation.courseVersion ?? "?"} · Lesson v{citation.lessonVersion ?? "?"}
                    </small>
                  )}
                  {citation.courseId && citation.lessonId && (
                    <Link
                      to={`/app/learn/${encodeURIComponent(citation.courseId)}/lessons/${encodeURIComponent(citation.lessonId)}`}
                    >
                      Mở bài học
                    </Link>
                  )}
                </aside>
              ))}
              {!!message.catalogCourses?.length && (
                <div className="web-tutor-catalog">
                  <h3>Khóa học đang có trong danh mục</h3>
                  {message.catalogCourses.map((course) => (
                    <Link
                      className="web-tutor-course-card"
                      key={course.courseId}
                      to={`/courses/${encodeURIComponent(course.courseId)}`}
                    >
                      <span>{course.title}</span>
                      <strong>{coursePrice(course)}</strong>
                    </Link>
                  ))}
                </div>
              )}
            </article>
          ))}

          {messages.length > 0 && !pending && !error && (
            <div className="web-tutor-suggestions web-tutor-followups" aria-label="Gợi ý câu hỏi tiếp theo">
              {prompts.map((prompt) => (
                <button type="button" key={prompt} onClick={() => void sendMessage(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          )}

          {pending && !isStreaming && (
            <div className="web-tutor-thinking" role="status">
              <span aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              {status || "Gia sư đang suy nghĩ…"}
              <button type="button" onClick={stopRequest}>
                Dừng
              </button>
            </div>
          )}
          {error && (
            <div className="web-tutor-error" role="alert">
              <p>{error}</p>
              {input.trim() && (
                <button type="button" onClick={() => void sendMessage()}>
                  Thử lại câu hỏi
                </button>
              )}
            </div>
          )}
        </div>

        <form
          className="web-tutor-composer"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            void sendMessage();
          }}
        >
          <label className="visually-hidden" htmlFor="web-tutor-input">
            Nhập câu hỏi cho AI Tutor
          </label>
          <textarea
            ref={inputRef}
            id="web-tutor-input"
            aria-label="Nhập câu hỏi cho AI Tutor"
            value={input}
            maxLength={4000}
            rows={1}
            placeholder="Hỏi về khóa học hoặc bài học của bạn…"
            disabled={pending}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <span className="web-tutor-composer-hint">Enter để gửi · Shift + Enter xuống dòng</span>
          <button
            className="web-tutor-send"
            type="submit"
            aria-label="Gửi câu hỏi"
            disabled={pending || !input.trim()}
          >
            ↑
          </button>
        </form>
      </div>
    </section>
  );
}
