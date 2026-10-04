import { useLanguage, useUiText } from "../lib/i18n";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Dialog } from "../components/ui";
import {
  useStudent,
  useCommand,
  dateLabel,
  type Quiz,
  type Attempt,
  type Result,
  type Answer,
  type Question,
} from "./api";
import { Heading, State, Empty, Status } from "./ui";
import { useUnsavedChanges } from "../components/product";
import { useAssignedQuizzes } from "./overview";
import { Icon } from "../components/Icon";
export interface StudentAssignmentItem {
  id: string;
  quizId: string;
  title: string;
  courseId: string;
  courseTitle: string;
  format: "OBJECTIVE" | "ESSAY" | "PROJECT";
  questionCount: number;
  durationMinutes?: number;
  status: "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "GRADED";
  score?: number | null;
  maxScore?: number;
  deadlineIso: string;
  deadlineLabel: string;
  latePolicy: "BLOCK_LATE" | "ALLOW_LATE_WITH_FLAG";
  submittedAt?: string | null;
  isLate?: boolean;
  lateMinutes?: number;
  teacherNote?: string;
}

export function Assessments() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const query = useAssignedQuizzes();
  const [params] = useSearchParams();
  const [target, setTarget] = useState(params.get("target") ?? "");
  const [search, setSearch] = useState("");
  const targets = [
    ...new Map((query.data ?? []).map((q) => [`${q.targetType}/${q.targetId}`, q.targetTitle])).entries(),
  ];
  const quizzes = (query.data ?? []).filter(
    (q) =>
      (!target || `${q.targetType}/${q.targetId}` === target) &&
      q.title.toLocaleLowerCase("vi").includes(search.toLocaleLowerCase("vi")),
  );
  return (
    <div className="assessments-hub-container animate-fade-in">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">{uiText("HỌC TẬP & ĐÁNH GIÁ NĂNG LỰC")}</p>
          <h1>{uiText("Bài tập & Kiểm tra")}</h1>
          <p className="lead">
            {uiText("Bài kiểm tra được giảng viên phát hành cho khóa học và lớp bạn tham gia.")}
          </p>
        </div>
        <div className="dashboard-header-actions">
          <span className="kpi-tag accent">
            {quizzes.length} {uiText(" bài kiểm tra")}
          </span>
        </div>
      </div>

      <div className="assessment-toolbar-card">
        <div className="assessment-filters-grid">
          <label className="assessment-filter-label">
            <span className="assessment-label-text">{uiText("Khóa học hoặc lớp")}</span>
            <div className="assessment-select-wrap">
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="assessment-select"
              >
                <option value="">{uiText("Tất cả")}</option>
                {targets.map(([id, title]) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </select>
            </div>
          </label>
          <label className="assessment-filter-label">
            <span className="assessment-label-text">{uiText("Tìm bài kiểm tra")}</span>
            <div className="assessment-search-wrap">
              <Icon name="search" size={16} className="assessment-search-icon" />
              <input
                className="assessment-search-input"
                placeholder={uiText("Nhập tên bài kiểm tra cần tìm...")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  type="button"
                  className="assessment-search-clear"
                  onClick={() => setSearch("")}
                  aria-label={uiText("Xóa từ khóa tìm kiếm")}
                >
                  ✕
                </button>
              )}
            </div>
          </label>
        </div>
      </div>

      <State query={{ ...query, pending: !query.error && query.pending }}>
        {quizzes.length ? (
          <div className="assessments-card-list">
            {quizzes.map((q, idx) => {
              const isClosed = q.closesAt ? new Date(q.closesAt).getTime() <= Date.now() : false;
              return (
                <article
                  className="study-card assessment-item-card"
                  key={q.quizId}
                  style={{ animationDelay: `${idx * 60}ms` }}
                >
                  <div className="assessment-card-header">
                    <div className="assessment-badge-group">
                      <span className="badge">
                        <Icon name="book" size={13} />
                        <span>{q.targetTitle}</span>
                      </span>
                      {isClosed ? (
                        <span className="status-pill status-reconciled">{uiText("● Đã đóng")}</span>
                      ) : q.closesAt ? (
                        <span className="status-pill status-pending">
                          <Icon name="clock" size={12} />
                          <span>{uiText("Hạn nộp")}</span>
                        </span>
                      ) : (
                        <span className="status-pill status-success">{uiText("● Đang mở")}</span>
                      )}
                    </div>
                  </div>

                  <h2 className="assessment-card-title">{q.title}</h2>

                  <div className="assessment-card-meta-row">
                    <span className="assessment-meta-item">
                      <Icon name="fileText" size={14} />
                      <span>
                        {q.targetTitle} · {q.questionCount} {uiText(" câu hỏi")}
                      </span>
                    </span>
                    {q.closesAt && (
                      <span className="assessment-meta-item deadline-meta">
                        <Icon name="calendar" size={14} />
                        <span>
                          {uiText("Đóng lúc ")}
                          {dateLabel(q.closesAt, undefined, uiLocale)}
                        </span>
                      </span>
                    )}
                  </div>

                  <div className="assessment-card-footer">
                    <Link className="button assessment-cta-btn" to={`/app/assessments/${q.quizId}`}>
                      <span>{uiText("Xem bài kiểm tra")}</span>
                      <Icon name="chevronRight" size={16} />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <Empty>
            {uiText(
              "Chưa có bài kiểm tra phù hợp. Bài mới sẽ xuất hiện khi giảng viên phát hành cho khóa học hoặc lớp của bạn.",
            )}
          </Empty>
        )}
      </State>
    </div>
  );
}

export function QuizDetail() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const { quizId = "" } = useParams();
  const q = useStudent<Quiz>("/quizzes/" + quizId);
  const command = useCommand();
  const navigate = useNavigate();
  const closed = !!q.data?.closesAt && new Date(q.data.closesAt).getTime() <= Date.now();
  const notOpen = !!q.data?.opensAt && new Date(q.data.opensAt).getTime() > Date.now();
  return (
    <>
      <Link to="/app/assessments">{uiText("← Danh sách bài tập & kiểm tra")}</Link>
      <Heading title={q.data?.title || "Bài kiểm tra"} />
      <State query={q}>
        <section className="study-card">
          <h2>{uiText("Chuẩn bị làm bài")}</h2>
          <p>
            {q.data?.questionCount} {uiText(" câu hỏi")}
            {q.data?.durationSeconds ? uiText(" · {0} phút", [q.data.durationSeconds / 60]) : ""}
          </p>
          {q.data?.opensAt && (
            <p>
              {uiText("Mở lúc ")}
              {dateLabel(q.data.opensAt, undefined, uiLocale)}
            </p>
          )}
          {q.data?.closesAt && (
            <p>
              {uiText("Đóng lúc ")}
              {dateLabel(q.data.closesAt, undefined, uiLocale)}
            </p>
          )}
          <p>
            {uiText("Số lần làm tối đa: ")}
            {q.data?.attemptLimit ?? "Chưa có thông tin"}.
          </p>
          {(closed || notOpen) && (
            <p role="status">
              {closed ? uiText("Bài kiểm tra đã đóng.") : uiText("Bài kiểm tra chưa đến giờ mở.")}
            </p>
          )}
          <button
            className="button"
            disabled={!q.data || closed || notOpen || command.busy}
            onClick={async () => {
              const attempt = await command.run<Attempt>("/quizzes/" + quizId + "/attempts", "POST");
              if (attempt) navigate("/app/attempts/" + attempt.attemptId);
            }}
          >
            {uiText("Bắt đầu / tiếp tục làm bài")}
          </button>
          <Status command={command} />
        </section>
      </State>
    </>
  );
}
export function AttemptPage() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const { attemptId = "" } = useParams(),
    query = useStudent<Attempt>("/attempts/" + attemptId),
    command = useCommand(),
    navigate = useNavigate();
  const [active, setActive] = useState<Attempt | null>(null);
  return (
    <>
      <Heading title={uiText("Lần làm bài của bạn")} />
      <State query={query}>
        {query.data && (
          <>
            {query.data.state === "SUBMITTED" ? (
              <section className="study-card">
                <h2>{uiText("Bài đã nộp")}</h2>
                <Link className="button" to={"/app/attempts/" + attemptId + "/result"}>
                  {uiText("Xem kết quả →")}
                </Link>
              </section>
            ) : query.data.state === "EXPIRED" ? (
              <Empty>
                {uiText("Bài kiểm tra đã hết thời gian.")}{" "}
                <Link to={"/app/assessments/" + query.data.quizId}>{uiText("Về bài kiểm tra")}</Link>
              </Empty>
            ) : active ? (
              <AnswerForm
                key={active.attemptId}
                attempt={active}
                onSuccess={() => navigate("/app/attempts/" + active.attemptId + "/result")}
              />
            ) : (
              <section className="study-card">
                <h2>
                  {query.data.state === "CREATED"
                    ? uiText("Lần làm bài đã được tạo")
                    : uiText("Tiếp tục lần làm bài đang diễn ra")}
                </h2>
                {query.data.deadlineAt && (
                  <p>
                    {uiText("Hạn nộp: ")}
                    {dateLabel(query.data.deadlineAt, undefined, uiLocale)} · Asia/Ho_Chi_Minh
                  </p>
                )}
                <p>
                  {uiText("Câu trả lời chưa nộp không được tự động lưu. Giữ trang này mở trong khi làm bài.")}
                </p>
                <button
                  className="button"
                  disabled={command.busy}
                  onClick={async () => {
                    const next = await command.run<Attempt>(
                      "/quizzes/" + query.data!.quizId + "/attempts",
                      "POST",
                    );
                    if (next) {
                      if (next.attemptId !== attemptId) navigate("/app/attempts/" + next.attemptId);
                      else setActive(next);
                    }
                  }}
                >
                  {uiText("Tải câu hỏi và tiếp tục")}
                </button>
                <Status command={command} />
              </section>
            )}
          </>
        )}
      </State>
    </>
  );
}
function AnswerForm({ attempt, onSuccess }: { attempt: Attempt; onSuccess: () => void }) {
  const uiText = useUiText();
  const [answers, setAnswers] = useState<Record<string, Answer>>({}),
    [confirm, setConfirm] = useState(false),
    [frozen, setFrozen] = useState(false),
    [current, setCurrent] = useState(0),
    command = useCommand();
  const submission = useRef<{
    fingerprint: string;
    payload: { answers: Answer[]; clientSubmittedAt: string };
  } | null>(null);
  const questions = attempt.questions || [];
  const answered = (q: Question) => {
    const a = answers[q.questionId];
    return (
      !!a &&
      ("text" in a ? !!a.text.trim() : "selectedOptionIds" in a ? a.selectedOptionIds.length > 0 : true)
    );
  };
  const answeredCount = questions.filter(answered).length;
  const progressPct = questions.length > 0 ? (answeredCount / questions.length) * 100 : 0;
  useUnsavedChanges(
    answeredCount > 0 && !frozen,
    "Câu trả lời chưa nộp không được lưu trên máy chủ. Rời trang và bỏ bài đang làm?",
  );
  const changed = (answer: Answer) => {
    setAnswers((v) => ({ ...v, [answer.questionId]: answer }));
  };
  return (
    <section className="study-card study-assessment exam-take-card animate-fade-in">
      <div className="exam-card-header">
        <div className="exam-header-title-row">
          <div>
            <span className="kpi-tag accent">{uiText("ĐANG LÀM BÀI THI")}</span>
            <h2>{uiText("Trả lời câu hỏi")}</h2>
          </div>
          <div className="exam-answered-pill">
            <Icon name="checkCircle" size={15} />
            <span>
              <strong>{answeredCount}</strong> / {questions.length} {uiText(" câu đã trả lời")}
            </span>
          </div>
        </div>
        <div className="exam-progress-bar-wrap">
          <div className="exam-progress-track">
            <div className="exam-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      </div>

      {attempt.deadlineAt && <AttemptTimer deadline={attempt.deadlineAt} />}

      <div className="exam-unsaved-banner">
        <Icon name="alert" size={16} />
        <p>
          {uiText(
            "Câu trả lời chưa nộp không được lưu trên máy chủ. Làm mới hoặc đóng trang có thể làm mất nội dung.",
          )}
        </p>
      </div>

      <p className="sr-only">
        {answeredCount} / {questions.length} {uiText(" câu đã trả lời.")}
      </p>

      <div className="exam-nav-wrapper">
        <span className="exam-nav-title">{uiText("Danh sách câu hỏi:")}</span>
        <nav className="question-nav exam-question-nav" aria-label={uiText("Đi đến câu hỏi")}>
          {questions.map((q, i) => (
            <a
              key={q.questionId}
              className={`question-nav-btn ${answered(q) ? "answered" : "unanswered"} ${current === i ? "current" : ""}`}
              href={"#q-" + q.questionId}
              aria-current={current === i ? "step" : undefined}
              onClick={() => setCurrent(i)}
              aria-label={uiText("Câu {0}: {1}", [i + 1, answered(q) ? "đã trả lời" : "chưa trả lời"])}
            >
              <span className="nav-btn-num">{i + 1}</span>
              {answered(q) && <span className="nav-btn-check">✓</span>}
            </a>
          ))}
        </nav>
      </div>

      <fieldset disabled={frozen || command.busy} className="answer-fields exam-questions-list">
        <legend className="sr-only">{uiText("Nội dung bài làm")}</legend>
        {questions.map((q, i) => (
          <fieldset
            id={"q-" + q.questionId}
            key={q.questionId}
            className={`study-question exam-question-card ${answered(q) ? "is-answered" : ""} ${current === i ? "is-current" : ""}`}
          >
            <legend className="exam-question-legend">
              <span className="exam-q-pill">
                {uiText("Câu ")}
                {i + 1}
              </span>
              <span className="exam-q-prompt">{q.prompt}</span>
            </legend>
            <div className="exam-question-input-area">
              <QuestionInput question={q} answer={answers[q.questionId]} onChange={changed} />
            </div>
          </fieldset>
        ))}
      </fieldset>

      <div className="exam-submit-bar">
        <button
          className="button exam-submit-action-btn"
          disabled={frozen || command.busy || !questions.length}
          onClick={() => setConfirm(true)}
        >
          <Icon name="checkCircle" size={16} />
          <span>{uiText("Nộp bài")}</span>
        </button>
      </div>

      {command.message === "Dịch vụ tạm thời không khả dụng. Hãy thử lại." ? (
        <p role="status">
          {uiText("Chưa thể xác nhận trạng thái nộp bài. Hãy thử lại để kiểm tra và tiếp tục yêu cầu trước.")}
        </p>
      ) : (
        <Status command={command} />
      )}
      <Dialog
        open={confirm}
        onClose={() => {
          if (!command.busy) setConfirm(false);
        }}
        title={uiText("Xác nhận nộp bài")}
      >
        <h2>{uiText("Bạn đã sẵn sàng nộp?")}</h2>
        <p>
          {uiText("Đã trả lời: ")}
          {answeredCount}
          {uiText(". Chưa trả lời: ")}
          {questions.length - answeredCount}
          {uiText(". Sau khi nộp thành công, bạn không thể sửa câu trả lời.")}
        </p>
        <button
          className="button"
          disabled={command.busy}
          onClick={async () => {
            const list = Object.values(answers),
              fingerprint = JSON.stringify(list);
            if (submission.current?.fingerprint !== fingerprint)
              submission.current = {
                fingerprint,
                payload: { answers: list, clientSubmittedAt: new Date().toISOString() },
              };
            const result = await command.run<Result>(
              "/attempts/" + attempt.attemptId + "/submit",
              "POST",
              submission.current.payload,
            );
            if (result) {
              setFrozen(true);
              setConfirm(false);
              onSuccess();
            }
          }}
        >
          {uiText("Xác nhận nộp bài")}
        </button>
        <button className="button secondary" disabled={command.busy} onClick={() => setConfirm(false)}>
          {uiText("Tiếp tục kiểm tra")}
        </button>
        {command.message === "Dịch vụ tạm thời không khả dụng. Hãy thử lại." ? (
          <p role="status">
            {uiText(
              "Chưa thể xác nhận trạng thái nộp bài. Hãy thử lại để kiểm tra và tiếp tục yêu cầu trước.",
            )}
          </p>
        ) : (
          <Status command={command} />
        )}
      </Dialog>
    </section>
  );
}

function AttemptTimer({ deadline }: { deadline: string }) {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now()),
      timer = window.setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const left = Math.max(0, Date.parse(deadline) - now),
    seconds = Math.floor(left / 1000),
    hours = Math.floor(seconds / 3600),
    minutes = Math.floor((seconds % 3600) / 60),
    rest = seconds % 60;
  const isUrgent = seconds > 0 && seconds < 300;
  return (
    <div className={`attempt-timer-card ${isUrgent ? "is-urgent" : ""}`} role="timer">
      <div className="attempt-timer-clock-badge">
        <Icon name="clock" size={20} className={isUrgent ? "timer-icon-urgent" : "timer-icon-pulse"} />
        <span className="attempt-timer-text">
          <strong>
            {uiText("Thời gian còn lại: ")}
            {hours ? `${hours}:` : ""}
            {String(minutes).padStart(2, "0")}:{String(rest).padStart(2, "0")}
          </strong>
        </span>
      </div>
      <div className="attempt-timer-deadline-line">
        <span>
          {uiText("Hạn nộp theo máy chủ: ")}
          {dateLabel(deadline, undefined, uiLocale)} · Asia/Ho_Chi_Minh
        </span>
      </div>
      {left === 0 && (
        <div className="attempt-timer-expired-line">
          <span>
            {uiText("Đồng hồ đã về 0. Hệ thống sẽ xác nhận trạng thái khi bạn thực hiện thao tác tiếp theo.")}
          </span>
        </div>
      )}
    </div>
  );
}
function QuestionInput({
  question: q,
  answer: a,
  onChange,
}: {
  question: Question;
  answer?: Answer;
  onChange: (a: Answer) => void;
}) {
  const uiText = useUiText();
  const isEssay =
    (q.questionType as string) === "ESSAY" ||
    q.prompt.toLowerCase().includes("tự luận") ||
    q.prompt.toLowerCase().includes("trình bày") ||
    q.prompt.toLowerCase().includes("phân tích");

  const isProjectFile =
    (q.questionType as string) === "FILE_UPLOAD" ||
    q.prompt.toLowerCase().includes("đồ án") ||
    q.prompt.toLowerCase().includes("tải file") ||
    q.prompt.toLowerCase().includes("nộp file");

  if (isProjectFile) {
    const textVal = a && "text" in a ? a.text : "";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "8px 0" }}>
        <div
          style={{
            padding: 12,
            backgroundColor: "var(--surface-sunken, #f1f5f9)",
            borderRadius: 8,
            border: "1px dashed var(--brand, #0284c7)",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--brand, #0284c7)" }}>
            {uiText("📁 Nộp tệp đồ án / Báo cáo (Giảng viên chấm thủ công)")}
          </span>
          <p style={{ margin: "4px 0 8px 0", fontSize: 12, color: "var(--muted, #64748b)" }}>
            {uiText(
              "Định dạng cho phép: .PDF, .ZIP, .DOCX hoặc liên kết lưu trữ trực tuyến (GitHub, Google Drive)",
            )}
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <label className="button button-subtle button-small" style={{ cursor: "pointer", margin: 0 }}>
              {uiText("📎 Chọn tệp từ máy tính")}
              <input
                type="file"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const desc = `[Tệp: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)] - Đã tải lên.`;
                    onChange({ questionId: q.questionId, text: desc });
                  }
                }}
              />
            </label>
            {textVal && (
              <span style={{ fontSize: 12, fontWeight: 600, color: "#16a34a" }}>
                ✓ {textVal.slice(0, 50)}...
              </span>
            )}
          </div>
        </div>
        <label>
          {uiText("Hoặc dán liên kết Repository / Cloud Drive & Ghi chú đồ án:")}
          <input
            placeholder={uiText("https://github.com/your-username/project-repo hoặc mô tả nộp bài...")}
            maxLength={500}
            value={textVal}
            onChange={(e) => onChange({ questionId: q.questionId, text: e.target.value })}
          />
        </label>
      </div>
    );
  }

  if (isEssay) {
    const textVal = a && "text" in a ? a.text : "";
    return (
      <div style={{ margin: "8px 0" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#7c3aed" }}>
            {uiText("✍️ Bài làm tự luận (Giảng viên chấm thủ công)")}
          </span>
          <span style={{ fontSize: 12, color: "var(--muted, #64748b)" }}>
            {textVal.length} {uiText(" / 500 ký tự")}
          </span>
        </div>
        <textarea
          rows={5}
          style={{
            width: "100%",
            padding: 10,
            borderRadius: 8,
            border: "1px solid var(--line, #cbd5e1)",
            fontFamily: "inherit",
            fontSize: 14,
          }}
          placeholder={uiText("Nhập nội dung bài luận, câu trả lời tự luận hoặc lời giải chi tiết...")}
          maxLength={500}
          value={textVal}
          onChange={(e) => onChange({ questionId: q.questionId, text: e.target.value })}
        />
      </div>
    );
  }

  if (q.questionType === "SHORT_ANSWER")
    return (
      <label>
        {uiText("Câu trả lời ngắn")}
        <input
          maxLength={500}
          value={a && "text" in a ? a.text : ""}
          onChange={(e) => onChange({ questionId: q.questionId, text: e.target.value })}
        />
      </label>
    );
  if (q.questionType === "TRUE_FALSE")
    return (
      <>
        {[true, false].map((v) => (
          <label className="answer-option" key={String(v)}>
            <input
              type="radio"
              name={q.questionId}
              checked={!!a && "value" in a && a.value === v}
              onChange={() => onChange({ questionId: q.questionId, value: v })}
            />
            {v ? uiText("Đúng") : "Sai"}
          </label>
        ))}
      </>
    );
  return (
    <>
      {q.options?.map((option) => (
        <label className="answer-option" key={option}>
          <input
            type={q.questionType === "MULTIPLE_CHOICE" ? "checkbox" : "radio"}
            name={q.questionId}
            checked={
              q.questionType === "MULTIPLE_CHOICE"
                ? !!a && "selectedOptionIds" in a && a.selectedOptionIds.includes(option)
                : !!a && "selectedOptionId" in a && a.selectedOptionId === option
            }
            onChange={(e) => {
              if (q.questionType === "MULTIPLE_CHOICE") {
                const previous = a && "selectedOptionIds" in a ? a.selectedOptionIds : [];
                onChange({
                  questionId: q.questionId,
                  selectedOptionIds: e.target.checked
                    ? [...previous, option]
                    : previous.filter((v) => v !== option),
                });
              } else onChange({ questionId: q.questionId, selectedOptionId: option });
            }}
          />
          {option}
        </label>
      ))}
    </>
  );
}
export function ResultPage() {
  const { locale: uiLocale } = useLanguage();
  const uiText = useUiText();
  const { attemptId = "" } = useParams();
  const query = useStudent<Result>(`/attempts/${attemptId}/result`);
  return (
    <>
      <Heading title={uiText("Kết quả bài kiểm tra")} />
      <State query={query}>
        {query.data && (
          <section className="study-welcome">
            {query.data.gradingStatus === "PENDING_MANUAL_GRADING" ? (
              <h2>{uiText("Đang chờ giảng viên chấm")}</h2>
            ) : (
              <h2>
                {query.data.manualScore ?? query.data.score} / {query.data.maxScore}
              </h2>
            )}
            <p>
              {uiText("Đã nộp lúc ")}
              {dateLabel(query.data.submittedAt, undefined, uiLocale)}
            </p>
            {query.data.teacherFeedback && (
              <p>
                {uiText("Nhận xét của giảng viên: ")}
                {query.data.teacherFeedback}
              </p>
            )}
            <Link className="button" to="/app/assessments">
              {uiText("Trở lại bài kiểm tra")}
            </Link>
          </section>
        )}
      </State>
    </>
  );
}
